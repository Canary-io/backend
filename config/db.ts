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
      github_id TEXT NOT NULL,
      deployment_name TEXT NOT NULL,
      status TEXT NOT NULL,
      repo_url TEXT,
      image_name TEXT,
      tag TEXT,
      dockerfile_path TEXT,
      deployment_strategy TEXT,
      steps TEXT,
      deployment_url TEXT[],
      metric_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE deployments
    ADD COLUMN IF NOT EXISTS github_id TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS repo_url TEXT,
    ADD COLUMN IF NOT EXISTS image_name TEXT,
    ADD COLUMN IF NOT EXISTS tag TEXT,
    ADD COLUMN IF NOT EXISTS dockerfile_path TEXT,
    ADD COLUMN IF NOT EXISTS deployment_strategy TEXT,
    ADD COLUMN IF NOT EXISTS steps TEXT,
    ADD COLUMN IF NOT EXISTS metric_url TEXT;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'deployments'
          AND column_name = 'deployment_url'
          AND data_type = 'text'
      ) THEN
        ALTER TABLE deployments
        ALTER COLUMN deployment_url TYPE TEXT[]
        USING CASE
          WHEN deployment_url IS NULL THEN NULL
          ELSE ARRAY[deployment_url]
        END;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'deployments' AND column_name = 'username'
      ) THEN
        ALTER TABLE deployments
        ALTER COLUMN username DROP NOT NULL;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'deployments' AND column_name = 'username'
      ) THEN
        UPDATE deployments
        SET github_id = COALESCE(github_id, username)
        WHERE github_id IS NULL;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'deployments' AND column_name = 'rollout_status'
      ) THEN
        UPDATE deployments
        SET status = COALESCE(status, rollout_status)
        WHERE status IS NULL;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'deployments' AND column_name = 'metrics_url'
      ) THEN
        UPDATE deployments
        SET metric_url = COALESCE(metric_url, metrics_url)
        WHERE metric_url IS NULL;
      END IF;
    END $$;
  `);

  await pool.query(`
    ALTER TABLE deployments
    ALTER COLUMN github_id SET NOT NULL,
    ALTER COLUMN status SET NOT NULL;
  `);

  await pool.query(`
    ALTER TABLE deployments
    DROP COLUMN IF EXISTS username,
    DROP COLUMN IF EXISTS rollout_status,
    DROP COLUMN IF EXISTS metrics_url;
  `);
};

module.exports = pool;
module.exports.ensureTablesExist = ensureTablesExist;
