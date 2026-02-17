
const express = require("express");
const router = express.Router();
const { getRepositories } = require("../controllers/userController.ts");

//router.get("/deployments", getDeployments);
router.get("/repositories", getRepositories);
router.post("/createDeployment", createDeployments)

module.exports = router;
