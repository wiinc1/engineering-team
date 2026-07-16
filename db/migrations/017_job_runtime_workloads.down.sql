DO $$
BEGIN
  IF to_regclass('job_runtime.job_effect_ledger') IS NOT NULL
     AND EXISTS (SELECT 1 FROM job_runtime.job_effect_ledger LIMIT 1) THEN
    RAISE EXCEPTION 'job effect ledger is not empty; rollback refused';
  END IF;
END
$$;

DROP TABLE IF EXISTS job_runtime.job_effect_ledger;
DROP INDEX IF EXISTS job_runtime.job_delivery_registry_ordering_idx;
ALTER TABLE job_runtime.job_delivery_registry
  DROP CONSTRAINT IF EXISTS job_delivery_registry_handler_version_check,
  DROP CONSTRAINT IF EXISTS job_delivery_registry_ordering_key_check,
  DROP COLUMN IF EXISTS ordering_key,
  DROP COLUMN IF EXISTS handler_version;
