CREATE TABLE IF NOT EXISTS projects (
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PLANNING',
  owner_actor_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, project_id),
  CONSTRAINT chk_projects_id
    CHECK (project_id ~ '^PRJ-[A-Z0-9]{8}$'),
  CONSTRAINT chk_projects_status
    CHECK (status IN ('PLANNING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')),
  CONSTRAINT chk_projects_version_positive
    CHECK (version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_tenant_name_unique
  ON projects (tenant_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_projects_status_updated
  ON projects (tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_owner_updated
  ON projects (tenant_id, owner_actor_id, updated_at DESC);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS project_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_tasks_project'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT fk_tasks_project
      FOREIGN KEY (tenant_id, project_id)
      REFERENCES projects (tenant_id, project_id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_project_updated
  ON tasks (tenant_id, project_id, updated_at DESC)
  WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_mutations (
  mutation_id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT,
  task_id TEXT,
  project_version INTEGER,
  task_version INTEGER,
  mutation_type TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT 'system',
  request_id TEXT,
  idempotency_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_project_mutations_project_or_task
    CHECK (project_id IS NOT NULL OR task_id IS NOT NULL),
  CONSTRAINT fk_project_mutations_project
    FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects (tenant_id, project_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT fk_project_mutations_task
    FOREIGN KEY (tenant_id, task_id)
    REFERENCES tasks (tenant_id, task_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_project_mutations_tenant_created
  ON project_mutations (tenant_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_mutations_idempotency
  ON project_mutations (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
