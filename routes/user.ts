
const express = require("express");
const router = express.Router();
const {
  createDeployment,
  promoteRollout,
  getCurrentUser,
} = require("../controllers/userController.ts");

router.get("/me", getCurrentUser);
router.post("/createDeployment", createDeployment);
router.post("/promoteRollout", promoteRollout);

module.exports = router;
