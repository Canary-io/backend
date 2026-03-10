
const express = require("express");
const router = express.Router();
const { createDeployment, getRepos } = require("../controllers/userController.ts");

router.post("/createDeployment", createDeployment);
router.get("/repos", getRepos);

module.exports = router;
