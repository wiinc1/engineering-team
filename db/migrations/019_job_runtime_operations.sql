ALTER TABLE job_runtime.job_delivery_registry
  DROP CONSTRAINT job_delivery_registry_status_check;

ALTER TABLE job_runtime.job_delivery_registry
  ADD COLUMN IF NOT EXISTS operator_version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD CONSTRAINT job_delivery_registry_status_check CHECK (status IN (
    'pending_enqueue', 'queued', 'running', 'redelivery_pending',
    'delivery_acknowledged', 'delivery_failed', 'delivery_cancelled'
  ));

CREATE TABLE IF NOT EXISTS job_runtime.job_operator_actions (
  action_id UUID PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  delivery_id UUID NOT NULL REFERENCES job_runtime.job_delivery_registry(delivery_id),
  idempotency_key VARCHAR(128) NOT NULL,
  action VARCHAR(16) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  request_id VARCHAR(128),
  expected_version BIGINT NOT NULL,
  resulting_version BIGINT,
  outcome VARCHAR(16) NOT NULL DEFAULT 'pending',
  error_code VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT job_operator_actions_tenant_idempotency_unique UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT job_operator_actions_action_check CHECK (action IN ('retry', 'requeue', 'cancel')),
  CONSTRAINT job_operator_actions_outcome_check CHECK (outcome IN ('pending', 'succeeded', 'failed')),
  CONSTRAINT job_operator_actions_reason_check CHECK (length(trim(reason)) > 0),
  CONSTRAINT job_operator_actions_version_check CHECK (expected_version >= 0)
);

CREATE INDEX IF NOT EXISTS job_operator_actions_delivery_idx
  ON job_runtime.job_operator_actions (tenant_id, delivery_id, created_at DESC);

REVOKE ALL ON TABLE job_runtime.job_operator_actions FROM PUBLIC;

COMMENT ON TABLE job_runtime.job_operator_actions IS
  'Tenant-scoped audit ledger for idempotent operator actions. It contains metadata only, never job payloads.';
