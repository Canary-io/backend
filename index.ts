const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const pool = require("./config/db.ts");
const authRoutes = require("./routes/auth.ts");

dotenv.config();

const app = express();
const PORT = 4001;

app.use("/auth", authRoutes);
  
app.listen(PORT, async () => {
	console.log(`Running at http://localhost:${PORT}`);
  
	try {
	  const client = await pool.connect();
	  console.log("Database connected successfully ");
	  client.release();
	} catch (err) {
	  console.error("Database connection failed ");
	  console.error(err);
	}
});