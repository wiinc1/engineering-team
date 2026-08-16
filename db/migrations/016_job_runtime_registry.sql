CREATE SCHEMA IF NOT EXISTS job_runtime;
REVOKE ALL ON SCHEMA job_runtime FROM PUBLIC;

CREATE TABLE IF NOT EXISTS job_runtime.job_delivery_registry (
  delivery_id UUID PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  workload_id VARCHAR(128) NOT NULL,
  semantic_job_key VARCHAR(80) NOT NULL,
  task_identifier VARCHAR(96) NOT NULL,
  task_name VARCHAR(80) NOT NULL,
  payload_version SMALLINT NOT NULL,
  catalog_version SMALLINT NOT NULL,
  graphile_job_id TEXT,
  named_queue VARCHAR(64) NOT NULL,
  max_attempts SMALLINT NOT NULL,
  priority SMALLINT NOT NULL,
  canonical_resource_type VARCHAR(32) NOT NULL,
  canonical_resource_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_enqueue',
  correlation_id VARCHAR(128) NOT NULL,
  request_id VARCHAR(128),
  trace_id VARCHAR(32),
  payload_size_bytes INTEGER NOT NULL,
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  scheduled_for TIMESTAMPTZ NOT NULL,
  enqueued_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  last_error_code VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT job_delivery_registry_tenant_key_unique UNIQUE (tenant_id, semantic_job_key),
  CONSTRAINT job_delivery_registry_tenant_id_check CHECK (tenant_id ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  CONSTRAINT job_delivery_registry_workload_id_check CHECK (workload_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT job_delivery_registry_task_version_check CHECK (payload_version BETWEEN 1 AND 999),
  CONSTRAINT job_delivery_registry_catalog_version_check CHECK (catalog_version > 0),
  CONSTRAINT job_delivery_registry_attempts_check CHECK (
    max_attempts BETWEEN 1 AND 10 AND attempt_count BETWEEN 0 AND max_attempts
  ),
  CONSTRAINT job_delivery_registry_payload_size_check CHECK (payload_size_bytes BETWEEN 2 AND 65536),
  CONSTRAINT job_delivery_registry_status_check CHECK (status IN (
    'pending_enqueue', 'queued', 'running', 'redelivery_pending',
    'delivery_acknowledged', 'delivery_failed'
  )),
  CONSTRAINT job_delivery_registry_trace_id_check CHECK (trace_id IS NULL OR trace_id ~ '^[A-Fa-f0-9]{16,32}$')
);

COMMENT ON TABLE job_runtime.job_delivery_registry IS
  'Operational delivery records only; delivery acknowledgment is not canonical business completion.';
COMMENT ON COLUMN job_runtime.job_delivery_registry.graphile_job_id IS
  'Opaque Graphile Worker reference. Application code must not join to Graphile-owned tables.';

CREATE INDEX IF NOT EXISTS job_delivery_registry_queue_status_idx
  ON job_runtime.job_delivery_registry (named_queue, status, scheduled_for);
CREATE INDEX IF NOT EXISTS job_delivery_registry_canonical_idx
  ON job_runtime.job_delivery_registry (tenant_id, canonical_resource_type, canonical_resource_id);
CREATE INDEX IF NOT EXISTS job_delivery_registry_correlation_idx
  ON job_runtime.job_delivery_registry (tenant_id, correlation_id);
CREATE INDEX IF NOT EXISTS job_delivery_registry_retention_idx
  ON job_runtime.job_delivery_registry (updated_at)
  WHERE status IN ('delivery_acknowledged', 'delivery_failed');

REVOKE ALL ON TABLE job_runtime.job_delivery_registry FROM PUBLIC;
