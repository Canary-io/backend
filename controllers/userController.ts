const pool = require("../config/db.ts");

const { exec } = require("child_process");
const path = require("path");

const createDeployment = async (req, res) => {
  const imageName = req.body.imageName;
  const repoUrl = req.body.repoUrl;
  const tag = req.body.tag;
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
    (.spec.arguments.parameters[] | select(.name=="image-name").value) = "${imageName}" |
    (.spec.arguments.parameters[] | select(.name=="tag").value) = "${tag}"
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

const getRepos = async (req, res) => {
  try {
    const { username } = req.params;

    const response = await fetch(`https://api.github.com/users/josephjophy/repos`);

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch repositories"});
    }

    const repos = await response.json();

    return res.json(repos.map(repo => repo.html_url));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};


module.exports = { createDeployment, getRepos };