const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const ensureTablesExist = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      github_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS deployments (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      deployment_name TEXT NOT NULL,
      rollout_status TEXT NOT NULL,
      deployment_url TEXT,
      metrics_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
};

module.exports = pool;
module.exports.ensureTablesExist = ensureTablesExist;
