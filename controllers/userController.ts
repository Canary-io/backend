const pool = require("../config/db.ts");

const { exec, execFile } = require("child_process");
const path = require("path");

const createDeployment = async (req, res) => {
  const deploymentName = req.body.deploymentName;
  const repoUrl = req.body.repoUrl;
  const imageName = req.body.imageName;
  const tag = req.body.tag;
  const dockerfilePath = req.body.dockerfilePath || "Dockerfile";
  const deploymentStrategy = req.body.deploymentStrategy;
  const steps = req.body.steps;

  console.log(repoUrl)
  if (!repoUrl) {
    return res.status(400).json({ error: "repoUrl is required" });
  }

  const workflowPath = path.join(__dirname, "workflow.yaml");

  try {
    console.log("trying apply")
    const command = `kubectl create -f ${workflowPath} -n argo --dry-run=client -o yaml | kubectl apply -f - --validate=false`;
    
    process.env.REPO_URL = repoUrl;

    const finalCommand = `
  yq e '
    (.spec.arguments.parameters[] | select(.name=="deployment-name").value) = "${deploymentName}" |
    (.spec.arguments.parameters[] | select(.name=="repo-url").value) = "${repoUrl}" |
    (.spec.arguments.parameters[] | select(.name=="image-name").value) = "${imageName}" |
    (.spec.arguments.parameters[] | select(.name=="tag").value) = "${tag}" |
    (.spec.arguments.parameters[] | select(.name=="dockerfile-path").value) = "${dockerfilePath}" |
    (.spec.arguments.parameters[] | select(.name=="deployment-strategy").value) = "${deploymentStrategy}" |
    (.spec.arguments.parameters[] | select(.name=="steps").value) = "${steps}"
  ' ${workflowPath} | kubectl create -f - --validate=false
`;

    exec(finalCommand, (error, stdout, stderr) => {
      if (error) {
        console.error("Error deploying workflow:", stderr);
        return res.status(500).json({ error: stderr });
      }
      res.status(202).json({ message: "Workflow triggered successfully", output: stdout });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

const promoteRollout = async (req, res) => {
  const rolloutName = req.body.rolloutName;

  if (!rolloutName) {
    return res.status(400).json({ error: "rolloutName is required" });
  }

  execFile(
    "kubectl",
    ["argo", "rollouts", "promote", rolloutName, "-n", "argo-rollouts"],
    (error, stdout, stderr) => {
      if (error) {
        console.error("Error promoting rollout:", stderr || error.message);
        return res.status(500).json({
          error: stderr || error.message,
        });
      }

      return res.status(200).json({
        message: "Rollout promoted successfully",
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

module.exports = { createDeployment, promoteRollout, getCurrentUser };
