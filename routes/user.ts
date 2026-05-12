
const express = require("express");
const router = express.Router();
const {
  createDeployment,
  getDeployments,
  startRollout,
  promoteRollout,
  getCurrentUser,
} = require("../controllers/userController.ts");

router.get("/me", getCurrentUser);
router.get("/deployments", getDeployments);
router.post("/createDeployment", createDeployment);
router.post("/startRollout", startRollout);
router.post("/promoteRollout", promoteRollout);

module.exports = router;
