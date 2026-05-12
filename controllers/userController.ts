const pool = require("../config/db.ts");

const { exec, execFile } = require("child_process");
const path = require("path");

const deploymentWorkflowPath = path.join(__dirname, "workflow.yaml");
const rolloutWorkflowPath = path.join(__dirname, "startRolloutWorkflow.yaml");
const WORKFLOW_NAMESPACE = "argo";
const ROLLOUT_NAMESPACE = "argo-rollouts";
const WORKFLOW_POLL_INTERVAL_MS = 5000;
const WORKFLOW_POLL_TIMEOUT_MS = 15 * 60 * 1000;
const ROLLOUT_POLL_INTERVAL_MS = 5000;
const ROLLOUT_POLL_TIMEOUT_MS = 30 * 60 * 1000;

const escapeWorkflowValue = (value) =>
  String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, `'\"'\"'`)
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");

const normalizeSteps = (steps) => {
  if (steps === undefined || steps === null) {
    return "";
  }

  return typeof steps === "string" ? steps : JSON.stringify(steps);
};

const buildDeploymentUrls = (deploymentName, deploymentStrategy) => {
  const normalizedStrategy = String(deploymentStrategy ?? "").toLowerCase();
  const baseUrl = `http://${deploymentName}.orcademo.com`;

  if (normalizedStrategy === "canary") {
    return [
      baseUrl,
      `http://${deploymentName}-canary.orcademo.com`,
      `http://${deploymentName}-stable.orcademo.com`,
    ];
  }

  if (normalizedStrategy === "bluegreen") {
    return [
      baseUrl,
      `http://${deploymentName}-active.orcademo.com`,
      `http://${deploymentName}-preview.orcademo.com`,
    ];
  }

  return [baseUrl];
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const execFileAsync = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        const execError = new Error(stderr || error.message);
        execError.code = error.code;
        return reject(execError);
      }

      resolve(stdout);
    });
  });

const extractWorkflowName = (stdout) => {
  const match = String(stdout ?? "")
    .trim()
    .match(/workflow\.argoproj\.io\/([^\s]+)/);

  return match ? match[1] : null;
};

const getWorkflowPhase = (workflowName) =>
  new Promise((resolve, reject) => {
    execFile(
      "kubectl",
      [
        "get",
        "workflow",
        workflowName,
        "-n",
        WORKFLOW_NAMESPACE,
        "-o",
        "json",
      ],
      (error, stdout, stderr) => {
        if (error) {
          return reject(new Error(stderr || error.message));
        }

        try {
          const workflow = JSON.parse(stdout);
          resolve(workflow?.status?.phase || null);
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
  });

const getRollout = async (rolloutName) => {
  try {
    const stdout = await execFileAsync("kubectl", [
      "get",
      "rollout",
      rolloutName,
      "-n",
      ROLLOUT_NAMESPACE,
      "-o",
      "json",
    ]);

    return JSON.parse(stdout);
  } catch (error) {
    if (String(error.message || "").includes("NotFound")) {
      return null;
    }

    throw error;
  }
};

const getPauseReason = (rollout) =>
  rollout?.status?.pauseConditions?.[0]?.reason || null;

const getCanaryStepWeight = (rollout) => {
  const weights = rollout?.status?.canary?.weights;

  if (typeof weights?.canary?.weight === "number") {
    return weights.canary.weight;
  }

  const steps = rollout?.spec?.strategy?.canary?.steps;
  const currentStepIndex = rollout?.status?.currentStepIndex;

  if (!Array.isArray(steps) || typeof currentStepIndex !== "number") {
    return rollout?.status?.phase === "Healthy" ? 100 : null;
  }

  let currentWeight = 0;

  for (let index = 0; index <= currentStepIndex && index < steps.length; index += 1) {
    if (typeof steps[index]?.setWeight === "number") {
      currentWeight = steps[index].setWeight;
    }
  }

  return currentWeight;
};

const deriveRolloutStatus = (deployment, rollout) => {
  if (!rollout) {
    return {
      status: deployment.status,
      rolloutStatus: null,
    };
  }

  const phase = rollout?.status?.phase || null;
  const message = rollout?.status?.message || null;
  const pauseReason = getPauseReason(rollout);
  const isPaused = Boolean(rollout?.status?.controllerPause || pauseReason);
  const isAborted = Boolean(rollout?.status?.abort || rollout?.status?.abortedAt);
  const strategy = String(
    deployment.deployment_strategy ||
      (rollout?.spec?.strategy?.canary ? "canary" : rollout?.spec?.strategy?.blueGreen ? "bluegreen" : "")
  ).toLowerCase();

  if (isAborted || phase === "Degraded") {
    return {
      status: message ? `degraded: ${message}` : "degraded",
      rolloutStatus: {
        phase,
        message,
        pauseReason,
      },
    };
  }

  if (strategy === "canary") {
    const weight = getCanaryStepWeight(rollout);

    if (phase === "Healthy" && !isPaused) {
      return {
        status: "healthy",
        rolloutStatus: {
          phase,
          message,
          pauseReason,
          weight: 100,
        },
      };
    }

    if (typeof weight === "number" && weight < 100) {
      return {
        status: isPaused ? `canary ${weight}% paused` : `canary ${weight}% in progress`,
        rolloutStatus: {
          phase,
          message,
          pauseReason,
          weight,
        },
      };
    }

    return {
      status: isPaused ? "canary paused" : "canary promoting",
      rolloutStatus: {
        phase,
        message,
        pauseReason,
        weight,
      },
    };
  }

  if (strategy === "bluegreen") {
    const activeSelector = rollout?.status?.blueGreen?.activeSelector || null;
    const previewSelector = rollout?.status?.blueGreen?.previewSelector || null;
    const switching =
      rollout?.status?.currentPodHash &&
      rollout?.status?.stableRS &&
      rollout.status.currentPodHash !== rollout.status.stableRS;
    const previewActive =
      activeSelector && previewSelector && activeSelector !== previewSelector;

    if (phase === "Healthy" && !isPaused && !switching) {
      return {
        status: "healthy",
        rolloutStatus: {
          phase,
          message,
          pauseReason,
          activeSelector,
          previewSelector,
        },
      };
    }

    if (isPaused) {
      return {
        status: previewActive ? "blue/green preview ready" : "blue/green paused",
        rolloutStatus: {
          phase,
          message,
          pauseReason,
          activeSelector,
          previewSelector,
        },
      };
    }

    if (switching || previewActive || phase === "Progressing") {
      return {
        status: "blue/green switching traffic",
        rolloutStatus: {
          phase,
          message,
          pauseReason,
          activeSelector,
          previewSelector,
        },
      };
    }
  }

  return {
    status: phase ? phase.toLowerCase() : deployment.status,
    rolloutStatus: {
      phase,
      message,
      pauseReason,
    },
  };
};

const enrichDeploymentStatus = async (deployment) => {
  if (!deployment?.deployment_name) {
    return deployment;
  }

  try {
    const rollout = await getRollout(deployment.deployment_name);
    const derived = deriveRolloutStatus(deployment, rollout);

    return {
      ...deployment,
      status: derived.status,
      rollout_status: derived.rolloutStatus,
    };
  } catch (error) {
    console.error(`Error fetching rollout status for ${deployment.deployment_name}:`, error.message);
    return {
      ...deployment,
      rollout_status: null,
    };
  }
};

const waitForWorkflowCompletion = async (workflowName) => {
  const deadline = Date.now() + WORKFLOW_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const phase = await getWorkflowPhase(workflowName);

    if (phase === "Succeeded") {
      return phase;
    }

    if (phase === "Failed" || phase === "Error") {
      throw new Error(`Workflow ${workflowName} finished with phase ${phase}`);
    }

    await sleep(WORKFLOW_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for workflow ${workflowName} to complete`);
};

const isRolloutSettledStatus = (status) =>
  status === "healthy" ||
  status === "canary paused" ||
  status === "blue/green paused" ||
  status === "blue/green preview ready" ||
  String(status || "").endsWith("% paused") ||
  String(status || "").startsWith("degraded");

const updateDeploymentStatus = async ({ id, status, tag = null }) => {
  await pool.query(
    `
      UPDATE deployments
      SET
        status = $1,
        tag = COALESCE($2, tag)
      WHERE id = $3
    `,
    [status, tag ?? null, id]
  );
};

const monitorRolloutStatus = async ({
  id,
  deploymentName,
  deploymentStrategy,
  initialStatus,
  tag = null,
}) => {
  const deadline = Date.now() + ROLLOUT_POLL_TIMEOUT_MS;
  let lastStatus = initialStatus;

  while (Date.now() < deadline) {
    const rollout = await getRollout(deploymentName);
    const derived = deriveRolloutStatus(
      {
        deployment_name: deploymentName,
        deployment_strategy: deploymentStrategy,
        status: lastStatus,
      },
      rollout
    );

    if (derived.status !== lastStatus) {
      await updateDeploymentStatus({
        id,
        status: derived.status,
        tag,
      });
      lastStatus = derived.status;
    }

    if (isRolloutSettledStatus(derived.status)) {
      return derived.status;
    }

    await sleep(ROLLOUT_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for rollout ${deploymentName} to settle`);
};

const createPendingDeploymentRecord = async ({ githubId, deploymentName }) => {
  const result = await pool.query(
    `
      INSERT INTO deployments (
        github_id,
        deployment_name,
        status
      )
      VALUES ($1, $2, $3)
      RETURNING id
    `,
    [githubId, deploymentName, "deploying"]
  );

  return result.rows[0].id;
};

const updateDeploymentRecord = async ({
  id,
  status,
  repoUrl,
  imageName,
  tag,
  dockerfilePath,
  deploymentStrategy,
  steps,
  deploymentUrls,
  metricUrl,
}) => {
  await pool.query(
    `
      UPDATE deployments
      SET
        status = $1,
        repo_url = $2,
        image_name = $3,
        tag = $4,
        dockerfile_path = $5,
        deployment_strategy = $6,
        steps = $7,
        deployment_url = $8,
        metric_url = $9
      WHERE id = $10
    `,
    [
      status,
      repoUrl,
      imageName,
      tag,
      dockerfilePath,
      deploymentStrategy,
      normalizeSteps(steps) || null,
      deploymentUrls,
      metricUrl,
      id,
    ]
  );
};

const triggerDeploymentWorkflow = (
  {
    workflowPath,
    deploymentName,
    repoUrl,
    imageName,
    tag,
    dockerfilePath,
    deploymentStrategy,
    steps,
  },
  callback
) => {
  const finalCommand = `
  yq e '
    (.spec.arguments.parameters[] | select(.name=="deployment-name").value) = "${escapeWorkflowValue(deploymentName)}" |
    (.spec.arguments.parameters[] | select(.name=="repo-url").value) = "${escapeWorkflowValue(repoUrl)}" |
    (.spec.arguments.parameters[] | select(.name=="image-name").value) = "${escapeWorkflowValue(imageName)}" |
    (.spec.arguments.parameters[] | select(.name=="tag").value) = "${escapeWorkflowValue(tag)}" |
    (.spec.arguments.parameters[] | select(.name=="dockerfile-path").value) = "${escapeWorkflowValue(dockerfilePath)}" |
    (.spec.arguments.parameters[] | select(.name=="deployment-strategy").value) = "${escapeWorkflowValue(deploymentStrategy)}" |
    (.spec.arguments.parameters[] | select(.name=="steps").value) = "${escapeWorkflowValue(normalizeSteps(steps))}"
  ' ${workflowPath} | kubectl create -f - --validate=false -o name
`;

  exec(finalCommand, callback);
};

const createDeployment = async (req, res) => {
  const deploymentName = req.body.deploymentName;
  const repoUrl = req.body.repoUrl;
  const imageName = req.body.imageName;
  const tag = req.body.tag;
  const dockerfilePath = req.body.dockerfilePath || "Dockerfile";
  const deploymentStrategy = req.body.deploymentStrategy;
  const steps = req.body.steps;
  const githubId = req.session?.user?.githubId;

  if (!repoUrl) {
    return res.status(400).json({ error: "repoUrl is required" });
  }

  if (!deploymentName) {
    return res.status(400).json({ error: "deploymentName is required" });
  }

  if (!imageName) {
    return res.status(400).json({ error: "imageName is required" });
  }

  if (!tag) {
    return res.status(400).json({ error: "tag is required" });
  }

  if (!githubId) {
    return res.status(401).json({ error: "Authenticated GitHub user is required" });
  }

  const deploymentUrls = buildDeploymentUrls(
    deploymentName,
    deploymentStrategy
  );
  const metricUrl = `http://${deploymentName}-grafana.orcademo.com/d/${deploymentName}-metrics/${deploymentName}-metrics`;

  try {
    const pendingDeploymentId = await createPendingDeploymentRecord({
      githubId,
      deploymentName,
    });

    triggerDeploymentWorkflow(
      {
        workflowPath: deploymentWorkflowPath,
        deploymentName,
        repoUrl,
        imageName,
        tag,
        dockerfilePath,
        deploymentStrategy,
        steps,
      },
      async (error, stdout, stderr) => {
        if (error) {
          console.error("Error deploying workflow:", stderr);
          return res.status(500).json({ error: stderr });
        }

        const workflowName = extractWorkflowName(stdout);

        if (!workflowName) {
          console.error("Unable to determine workflow name from create output:", stdout);
          return res.status(500).json({
            error: "Workflow triggered, but workflow name could not be determined",
            output: stdout,
          });
        }

        void (async () => {
          try {
            await waitForWorkflowCompletion(workflowName);
            await updateDeploymentRecord({
              id: pendingDeploymentId,
              status: "healthy",
              repoUrl,
              imageName,
              tag,
              dockerfilePath,
              deploymentStrategy,
              steps,
              deploymentUrls,
              metricUrl,
            });
            console.log(`Deployment ${deploymentName} updated after workflow ${workflowName} succeeded`);
          } catch (monitorError) {
            try {
              await updateDeploymentStatus({
                id: pendingDeploymentId,
                status: "failed",
              });
            } catch (statusError) {
              console.error("Failed to mark deployment as failed:", statusError);
            }
            console.error(
              `Workflow ${workflowName} did not complete successfully; deployment details were not filled in:`,
              monitorError
            );
          }
        })();

        res.status(202).json({
          message: "Workflow triggered successfully",
          workflowName,
          output: stdout,
        });
      }
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

const getDeployments = async (req, res) => {
  const githubId = req.session?.user?.githubId;

  if (!githubId) {
    return res.status(401).json({ error: "Authenticated GitHub user is required" });
  }

  try {
    const result = await pool.query(
      `
        SELECT
          id,
          deployment_name,
          status,
          repo_url,
          image_name,
          tag,
          dockerfile_path,
          deployment_strategy,
          steps,
          deployment_url,
          metric_url,
          created_at
        FROM deployments
        WHERE github_id = $1
        ORDER BY created_at DESC
      `,
      [githubId]
    );

    const deployments = await Promise.all(result.rows.map(enrichDeploymentStatus));

    return res.status(200).json({ deployments });
  } catch (err) {
    console.error("Error fetching deployments:", err);
    return res.status(500).json({ error: err.message });
  }
};

const startRollout = async (req, res) => {
  const deploymentName = req.body.deploymentName;
  const tag = req.body.tag;
  const githubId = req.session?.user?.githubId;

  if (!deploymentName) {
    return res.status(400).json({ error: "deploymentName is required" });
  }

  if (!tag) {
    return res.status(400).json({ error: "tag is required" });
  }

  if (!githubId) {
    return res.status(401).json({ error: "Authenticated GitHub user is required" });
  }

  try {
    const result = await pool.query(
      `
        SELECT id, repo_url, image_name, dockerfile_path, deployment_strategy, steps
        FROM deployments
        WHERE github_id = $1 AND deployment_name = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [githubId, deploymentName]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Deployment not found" });
    }

    const deployment = result.rows[0];

    if (!deployment.repo_url || !deployment.image_name) {
      return res.status(409).json({
        error: "Deployment is missing repo metadata required to rebuild",
      });
    }

    triggerDeploymentWorkflow(
      {
        workflowPath: rolloutWorkflowPath,
        deploymentName,
        repoUrl: deployment.repo_url,
        imageName: deployment.image_name,
        tag,
        dockerfilePath: deployment.dockerfile_path || "Dockerfile",
        deploymentStrategy: deployment.deployment_strategy || "canary",
        steps: deployment.steps,
      },
      async (error, stdout, stderr) => {
        if (error) {
          console.error("Error starting rollout:", stderr || error.message);
          return res.status(500).json({ error: stderr || error.message });
        }

        const workflowName = extractWorkflowName(stdout);

        if (!workflowName) {
          console.error("Unable to determine workflow name from create output:", stdout);
          return res.status(500).json({
            error: "Workflow triggered, but workflow name could not be determined",
            output: stdout,
          });
        }

        try {
          await updateDeploymentStatus({
            id: deployment.id,
            status: "requested",
            tag,
          });
        } catch (dbError) {
          console.error("Workflow created but failed to update deployment:", dbError);
          return res.status(500).json({
            error: "Workflow triggered, but failed to update deployment record",
            output: stdout,
          });
        }

        void (async () => {
          try {
            await waitForWorkflowCompletion(workflowName);
            await monitorRolloutStatus({
              id: deployment.id,
              deploymentName,
              deploymentStrategy: deployment.deployment_strategy || "canary",
              initialStatus: "requested",
              tag,
            });
            console.log(`Rollout ${deploymentName} updated after workflow ${workflowName} settled`);
          } catch (monitorError) {
            try {
              await updateDeploymentStatus({
                id: deployment.id,
                status: "failed",
                tag,
              });
            } catch (statusError) {
              console.error("Failed to mark rollout as failed:", statusError);
            }
            console.error(
              `Rollout ${deploymentName} did not complete successfully after workflow ${workflowName}:`,
              monitorError
            );
          }
        })();

        return res.status(202).json({
          message: "Rollout started successfully",
          workflowName,
          output: stdout,
        });
      }
    );
  } catch (err) {
    console.error("Error preparing rollout:", err);
    return res.status(500).json({ error: err.message });
  }
};

const promoteRollout = async (req, res) => {
  const rolloutName = req.body.rolloutName || req.body.deploymentName;

  if (!rolloutName) {
    return res.status(400).json({
      error: "rolloutName or deploymentName is required",
    });
  }

  execFile(
    "kubectl",
    [
      "argo",
      "rollouts",
      "promote",
      rolloutName,
      "-n",
      "argo-rollouts",
    ],
    async (error, stdout, stderr) => {
      if (error) {
        console.error("Error promoting rollout:", stderr || error.message);
        return res.status(500).json({
          error: stderr || error.message,
        });
      }

      try {
        const result = await pool.query(
          `
            SELECT id, deployment_strategy, status
            FROM deployments
            WHERE deployment_name = $1
            ORDER BY created_at DESC
            LIMIT 1
          `,
          [rolloutName]
        );

        const deployment = result.rows[0];

        if (deployment?.id) {
          void monitorRolloutStatus({
            id: deployment.id,
            deploymentName: rolloutName,
            deploymentStrategy: deployment.deployment_strategy || "canary",
            initialStatus: deployment.status || "requested",
          }).catch(async (monitorError) => {
            try {
              await updateDeploymentStatus({
                id: deployment.id,
                status: "failed",
              });
            } catch (statusError) {
              console.error("Failed to mark promoted rollout as failed:", statusError);
            }
            console.error(`Promoted rollout ${rolloutName} did not settle successfully:`, monitorError);
          });
        }
      } catch (dbError) {
        console.error("Rollout promoted but failed to attach DB monitor:", dbError);
      }

      return res.status(200).json({
        message: "Rollout fully promoted successfully",
        output: stdout.trim(),
      });
    }
  );
};

const getCurrentUser = async (req, res) => {
  return res.status(200).json({
    user: req.session?.user || null,
  });
};

module.exports = {
  createDeployment,
  getDeployments,
  startRollout,
  promoteRollout,
  getCurrentUser,
};
