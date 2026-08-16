ALTER TABLE langgraph_checkpoint.factory_threads
  ADD COLUMN IF NOT EXISTS operator_version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(64);

ALTER TABLE langgraph_checkpoint.factory_threads
  DROP CONSTRAINT IF EXISTS langgraph_thread_status_check;
ALTER TABLE langgraph_checkpoint.factory_threads
  ADD CONSTRAINT langgraph_thread_status_check
  CHECK (status IN ('active','paused','completed','failed','cancelled','expired'));

CREATE TABLE IF NOT EXISTS langgraph_checkpoint.factory_interrupts (
  interrupt_id VARCHAR(128) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  thread_id VARCHAR(51) NOT NULL REFERENCES langgraph_checkpoint.factory_threads(thread_id),
  checkpoint_id VARCHAR(128) NOT NULL,
  interrupt_type VARCHAR(64) NOT NULL,
  interrupt_version SMALLINT NOT NULL,
  payload JSONB NOT NULL,
  authorized_roles TEXT[] NOT NULL,
  wait_reason VARCHAR(256) NOT NULL,
  next_action VARCHAR(256) NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'pending',
  resolution_action VARCHAR(16),
  resolution_edits JSONB,
  resolver_actor_id VARCHAR(128),
  idempotency_key VARCHAR(128),
  version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT langgraph_interrupt_tenant_idempotency_unique UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT langgraph_interrupt_type_check CHECK (interrupt_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT langgraph_interrupt_version_check CHECK (interrupt_version BETWEEN 1 AND 999),
  CONSTRAINT langgraph_interrupt_state_check CHECK (state IN ('pending','resolving','resolved','cancelled')),
  CONSTRAINT langgraph_interrupt_action_check CHECK (resolution_action IS NULL OR resolution_action IN ('accept','reject','edit')),
  CONSTRAINT langgraph_interrupt_payload_size_check CHECK (octet_length(payload::text) <= 16384)
);

CREATE INDEX IF NOT EXISTS langgraph_interrupts_thread_idx
  ON langgraph_checkpoint.factory_interrupts (tenant_id, thread_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS langgraph_interrupts_one_pending_idx
  ON langgraph_checkpoint.factory_interrupts (tenant_id, thread_id)
  WHERE state IN ('pending','resolving');

REVOKE ALL ON TABLE langgraph_checkpoint.factory_interrupts FROM PUBLIC;

CREATE TABLE IF NOT EXISTS langgraph_checkpoint.factory_run_actions (
  action_id UUID PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  thread_id VARCHAR(51) NOT NULL REFERENCES langgraph_checkpoint.factory_threads(thread_id),
  idempotency_key VARCHAR(128) NOT NULL,
  action VARCHAR(16) NOT NULL,
  node VARCHAR(64),
  actor_id VARCHAR(128) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  outcome VARCHAR(16) NOT NULL DEFAULT 'pending',
  error_code VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT langgraph_run_actions_tenant_idempotency_unique UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT langgraph_run_actions_action_check CHECK (action IN ('retry','cancel')),
  CONSTRAINT langgraph_run_actions_outcome_check CHECK (outcome IN ('pending','succeeded','failed')),
  CONSTRAINT langgraph_run_actions_reason_check CHECK (length(trim(reason)) > 0)
);
CREATE INDEX IF NOT EXISTS langgraph_run_actions_thread_idx
  ON langgraph_checkpoint.factory_run_actions (tenant_id, thread_id, created_at DESC);
REVOKE ALL ON TABLE langgraph_checkpoint.factory_run_actions FROM PUBLIC;

COMMENT ON TABLE langgraph_checkpoint.factory_interrupts IS
  'Sanitized durable human-gate index. Raw checkpoint state and secrets are never copied here.';
COMMENT ON TABLE langgraph_checkpoint.factory_run_actions IS
  'Idempotent audit ledger for retry and cancellation requests.';
