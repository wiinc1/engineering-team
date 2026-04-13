CREATE TABLE IF NOT EXISTS ai_agents (
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT,
  execution_kind TEXT NOT NULL DEFAULT 'software-factory',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  assignable BOOLEAN NOT NULL DEFAULT TRUE,
  environment_scope TEXT NOT NULL DEFAULT 'default',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_assignable
  ON ai_agents (tenant_id, active, assignable, role, display_name);

CREATE TABLE IF NOT EXISTS tasks (
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  priority TEXT,
  owner_agent_id TEXT,
  source_system TEXT NOT NULL DEFAULT 'canonical',
  source_of_truth_version INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  last_audit_event_id UUID,
  last_audit_sequence_number INTEGER,
  migration_state TEXT NOT NULL DEFAULT 'pending_backfill',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, task_id),
  CONSTRAINT fk_tasks_owner_agent
    FOREIGN KEY (tenant_id, owner_agent_id)
    REFERENCES ai_agents (tenant_id, agent_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT chk_tasks_version_positive
    CHECK (version > 0),
  CONSTRAINT chk_tasks_status_nonempty
    CHECK (char_length(trim(status)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_tasks_owner
  ON tasks (tenant_id, owner_agent_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_status
  ON tasks (tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS task_mutations (
  mutation_id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_version INTEGER NOT NULL,
  mutation_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  request_id TEXT,
  idempotency_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_task_mutations_task
    FOREIGN KEY (tenant_id, task_id)
    REFERENCES tasks (tenant_id, task_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_mutations_idempotency
  ON task_mutations (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_mutations_task
  ON task_mutations (tenant_id, task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task_sync_checkpoints (
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  canonical_version INTEGER NOT NULL DEFAULT 0,
  last_projected_audit_event_id UUID,
  last_projected_sequence_number INTEGER,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  PRIMARY KEY (tenant_id, task_id),
  CONSTRAINT fk_task_sync_checkpoints_task
    FOREIGN KEY (tenant_id, task_id)
    REFERENCES tasks (tenant_id, task_id)
    ON DELETE CASCADE
);

CREATE OR REPLACE VIEW v_task_platform_assignment_candidates AS
SELECT
  t.tenant_id,
  t.task_id,
  t.title,
  t.status,
  t.version,
  t.owner_agent_id,
  a.display_name AS owner_display_name,
  a.role AS owner_role,
  a.active AS owner_active,
  a.assignable AS owner_assignable
FROM tasks t
LEFT JOIN ai_agents a
  ON a.tenant_id = t.tenant_id
 AND a.agent_id = t.owner_agent_id;
