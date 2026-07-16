ALTER TABLE job_runtime.job_delivery_registry
  ADD COLUMN IF NOT EXISTS handler_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS ordering_key VARCHAR(320);

UPDATE job_runtime.job_delivery_registry
SET ordering_key = tenant_id || ':' || canonical_resource_type || ':' || canonical_resource_id
WHERE ordering_key IS NULL;

ALTER TABLE job_runtime.job_delivery_registry
  ALTER COLUMN ordering_key SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_delivery_registry_handler_version_check'
  ) THEN
    ALTER TABLE job_runtime.job_delivery_registry
      ADD CONSTRAINT job_delivery_registry_handler_version_check CHECK (handler_version BETWEEN 1 AND 999);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_delivery_registry_ordering_key_check'
  ) THEN
    ALTER TABLE job_runtime.job_delivery_registry
      ADD CONSTRAINT job_delivery_registry_ordering_key_check CHECK (
        ordering_key ~ '^[a-z0-9][a-z0-9_-]{1,63}:[A-Za-z0-9][A-Za-z0-9._:-]{0,31}:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS job_delivery_registry_ordering_idx
  ON job_runtime.job_delivery_registry (tenant_id, ordering_key, status, scheduled_for);

CREATE TABLE IF NOT EXISTS job_runtime.job_effect_ledger (
  tenant_id VARCHAR(64) NOT NULL,
  effect_key VARCHAR(80) NOT NULL,
  task_identifier VARCHAR(96) NOT NULL,
  effect_category VARCHAR(64) NOT NULL,
  canonical_resource_type VARCHAR(32) NOT NULL,
  canonical_resource_id VARCHAR(128) NOT NULL,
  effect_version BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'started',
  owner_token UUID NOT NULL,
  result_code VARCHAR(64),
  lease_expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, effect_key),
  CONSTRAINT job_effect_ledger_tenant_check CHECK (tenant_id ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  CONSTRAINT job_effect_ledger_key_check CHECK (effect_key ~ '^effect:v1:[a-f0-9]{64}$'),
  CONSTRAINT job_effect_ledger_task_check CHECK (task_identifier ~ '^[a-z][a-z0-9_.]{2,90}\.v[1-9][0-9]{0,2}$'),
  CONSTRAINT job_effect_ledger_category_check CHECK (effect_category ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT job_effect_ledger_resource_type_check CHECK (canonical_resource_type ~ '^[a-z][a-z0-9_]{1,31}$'),
  CONSTRAINT job_effect_ledger_resource_id_check CHECK (canonical_resource_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT job_effect_ledger_version_check CHECK (effect_version BETWEEN 1 AND 9007199254740991),
  CONSTRAINT job_effect_ledger_result_code_check CHECK (
    result_code IS NULL OR result_code ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  CONSTRAINT job_effect_ledger_status_check CHECK (status IN ('started', 'completed', 'terminal')),
  CONSTRAINT job_effect_ledger_started_lease_check CHECK (
    (status = 'started' AND lease_expires_at IS NOT NULL AND completed_at IS NULL)
    OR (status IN ('completed', 'terminal') AND lease_expires_at IS NULL AND completed_at IS NOT NULL)
  )
);

COMMENT ON TABLE job_runtime.job_effect_ledger IS
  'Payload-free application replay guard. External adapters must use effect_key as their idempotency key.';

CREATE INDEX IF NOT EXISTS job_effect_ledger_resource_idx
  ON job_runtime.job_effect_ledger (tenant_id, canonical_resource_type, canonical_resource_id, effect_version);
CREATE INDEX IF NOT EXISTS job_effect_ledger_retention_idx
  ON job_runtime.job_effect_ledger (completed_at)
  WHERE status IN ('completed', 'terminal');

REVOKE ALL ON TABLE job_runtime.job_effect_ledger FROM PUBLIC;
