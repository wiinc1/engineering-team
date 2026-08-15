DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime_migrator') THEN
    CREATE ROLE job_runtime_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime_producer') THEN
    CREATE ROLE job_runtime_producer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime_worker') THEN
    CREATE ROLE job_runtime_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;

COMMENT ON ROLE job_runtime_migrator IS 'Owns Graphile and application job-runtime schema changes; never used by the running service.';
COMMENT ON ROLE job_runtime_producer IS 'May enqueue allowlisted jobs and maintain application delivery records; cannot claim jobs or create schema objects.';
COMMENT ON ROLE job_runtime_worker IS 'May claim Graphile jobs and update delivery records; cannot create schema objects or mutate canonical business data.';
