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
