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
