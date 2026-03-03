const pool = require("../config/db.ts");

const { exec } = require("child_process");
const path = require("path");

const createDeployment = async (req, res) => {
  const imageName = req.body.imageName;
  const repoUrl = req.body.repoUrl;
  console.log(repoUrl)
  if (!repoUrl) {
    return res.status(400).json({ error: "repoUrl is required" });
  }

  const workflowPath = path.join(__dirname, "workflow.yaml");

  try {
    const command = `kubectl create -f ${workflowPath} -n argo --dry-run=client -o yaml | kubectl apply -f -`;
    
    process.env.REPO_URL = repoUrl;

    const finalCommand = `
  yq e '
    (.spec.arguments.parameters[] | select(.name=="repo-url").value) = "${repoUrl}" |
    (.spec.arguments.parameters[] | select(.name=="image-name").value) = "${imageName}"
  ' ${workflowPath} | kubectl create -f -
`;

    exec(finalCommand, (error, stdout, stderr) => {
      if (error) {
        console.error("Error deploying workflow:", stderr);
        return res.status(500).json({ error: stderr });
      }
      res.json({ message: "Workflow triggered successfully", output: stdout });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { createDeployment };
