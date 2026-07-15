DO $$
BEGIN
  IF to_regclass('job_runtime.job_delivery_registry') IS NOT NULL
     AND EXISTS (SELECT 1 FROM job_runtime.job_delivery_registry LIMIT 1) THEN
    RAISE EXCEPTION 'job runtime registry is not empty; rollback refused';
  END IF;
END
$$;

DROP TABLE IF EXISTS job_runtime.job_delivery_registry;
DROP SCHEMA IF EXISTS job_runtime;
