
const express = require("express");
const router = express.Router();
const { createDeployment } = require("../controllers/userController.ts");

//router.get("/deployments", getDeployments);
//router.get("/repositories", getRepositories);
router.post("/createDeployment", createDeployment)

module.exports = router;
