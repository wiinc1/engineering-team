ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by_actor_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_actor_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ai_agents_version_positive'
  ) THEN
    ALTER TABLE ai_agents
      ADD CONSTRAINT chk_ai_agents_version_positive
      CHECK (version > 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ai_agents_supported_role'
  ) THEN
    ALTER TABLE ai_agents
      ADD CONSTRAINT chk_ai_agents_supported_role
      CHECK (role IN ('pm', 'architect', 'engineer', 'qa', 'sre', 'human')) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ai_agents_inactive_not_assignable'
  ) THEN
    ALTER TABLE ai_agents
      ADD CONSTRAINT chk_ai_agents_inactive_not_assignable
      CHECK (active = true OR assignable = false) NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agent_mutations (
  mutation_id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_version INTEGER NOT NULL,
  mutation_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  request_id TEXT,
  idempotency_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_agent_mutations_agent
    FOREIGN KEY (tenant_id, agent_id)
    REFERENCES ai_agents (tenant_id, agent_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_mutations_idempotency
  ON agent_mutations (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_mutations_agent
  ON agent_mutations (tenant_id, agent_id, created_at DESC);
