const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const pool = require("./config/db.ts");
const { ensureTablesExist } = require("./config/db.ts");
const authRoutes = require("./routes/auth.ts");
const userRoutes = require("./routes/user.ts")

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4001;

const session = require("express-session");

app.use(
  session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  })
);



app.use(express.json());       
app.use(
	cors({
	  origin: "http://localhost:3001",
	  credentials: true,
	})
  );

app.use("/auth", authRoutes);
app.use("/user", userRoutes);
  
app.listen(PORT, async () => {
	console.log(`Running at http://localhost:${PORT}`);
  
	try {
	  const client = await pool.connect();
	  console.log("Database connected successfully ");
	  client.release();
	  await ensureTablesExist();
	  console.log("Database tables created");
	} catch (err) {
	  console.error("Database connection failed ");
	  console.error(err);
	
	}
});
