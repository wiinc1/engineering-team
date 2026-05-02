CREATE TABLE IF NOT EXISTS merge_readiness_reviews (
  tenant_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  repository TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL,
  commit_sha TEXT NOT NULL,
  review_status TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  policy_version TEXT NOT NULL DEFAULT 'merge-readiness-review-storage.v1',
  record_version INTEGER NOT NULL DEFAULT 1,
  github_check_run_id BIGINT,
  source_inventory JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_check_inventory JSONB NOT NULL DEFAULT '[]'::jsonb,
  reviewed_log_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  classification JSONB NOT NULL DEFAULT 'null'::jsonb,
  owner JSONB NOT NULL DEFAULT 'null'::jsonb,
  rationale JSONB NOT NULL DEFAULT 'null'::jsonb,
  follow_up_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewer_actor_id TEXT NOT NULL DEFAULT 'system',
  reviewer_actor_type TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, review_id),
  CONSTRAINT fk_merge_readiness_reviews_task
    FOREIGN KEY (tenant_id, task_id)
    REFERENCES tasks (tenant_id, task_id)
    ON DELETE CASCADE,
  CONSTRAINT chk_merge_readiness_review_status
    CHECK (review_status IN ('pending', 'passed', 'blocked', 'stale', 'error')),
  CONSTRAINT chk_merge_readiness_review_version_positive
    CHECK (record_version > 0),
  CONSTRAINT chk_merge_readiness_pull_request_positive
    CHECK (pull_request_number > 0),
  CONSTRAINT chk_merge_readiness_commit_sha
    CHECK (commit_sha ~* '^[0-9a-f]{7,40}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_merge_readiness_reviews_current_identity
  ON merge_readiness_reviews (tenant_id, task_id, repository, pull_request_number, commit_sha)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_merge_readiness_reviews_task_current
  ON merge_readiness_reviews (tenant_id, task_id, is_current, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_merge_readiness_reviews_pr_lookup
  ON merge_readiness_reviews (tenant_id, repository, pull_request_number, commit_sha, is_current, updated_at DESC);
