
const express = require("express");
const router = express.Router();
const { createDeployment } = require("../controllers/userController.ts");

router.post("/createDeployment", createDeployment);

module.exports = router;
