DO $$
BEGIN
  IF to_regclass('job_runtime.job_operator_actions') IS NOT NULL
     AND EXISTS (SELECT 1 FROM job_runtime.job_operator_actions LIMIT 1) THEN
    RAISE EXCEPTION 'job operator action history is not empty; rollback refused';
  END IF;
END
$$;

DROP TABLE IF EXISTS job_runtime.job_operator_actions;

ALTER TABLE job_runtime.job_delivery_registry
  DROP CONSTRAINT job_delivery_registry_status_check,
  DROP COLUMN IF EXISTS cancelled_at,
  DROP COLUMN IF EXISTS operator_version,
  ADD CONSTRAINT job_delivery_registry_status_check CHECK (status IN (
    'pending_enqueue', 'queued', 'running', 'redelivery_pending',
    'delivery_acknowledged', 'delivery_failed'
  ));
