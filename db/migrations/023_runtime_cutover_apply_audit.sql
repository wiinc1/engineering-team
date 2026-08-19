ALTER TABLE runtime_control.migration_records
  ADD COLUMN IF NOT EXISTS reconciliation_digest VARCHAR(71);

ALTER TABLE runtime_control.migration_records
  DROP CONSTRAINT IF EXISTS runtime_migration_reconciliation_digest_check;
ALTER TABLE runtime_control.migration_records
  ADD CONSTRAINT runtime_migration_reconciliation_digest_check
  CHECK (reconciliation_digest IS NULL OR reconciliation_digest ~ '^sha256:[0-9a-f]{64}$');

CREATE TABLE IF NOT EXISTS runtime_control.cutover_audit (
  request_id VARCHAR(128) PRIMARY KEY,
  revision CHAR(40) NOT NULL,
  jobs_epoch UUID NOT NULL,
  factory_epoch UUID NOT NULL,
  jobs_plan_digest VARCHAR(71) NOT NULL,
  factory_plan_digest VARCHAR(71) NOT NULL,
  graphile_manifest_digest VARCHAR(71) NOT NULL,
  langgraph_manifest_digest VARCHAR(71) NOT NULL,
  approval_digest VARCHAR(71) NOT NULL UNIQUE,
  actor_id VARCHAR(128) NOT NULL,
  actor_role VARCHAR(32) NOT NULL,
  result VARCHAR(16) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT runtime_cutover_audit_revision_check CHECK (revision ~ '^[0-9a-f]{40}$'),
  CONSTRAINT runtime_cutover_audit_actor_role_check CHECK (actor_role IN ('admin','platform_owner')),
  CONSTRAINT runtime_cutover_audit_result_check CHECK (result = 'applied'),
  CONSTRAINT runtime_cutover_audit_jobs_plan_check CHECK (jobs_plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT runtime_cutover_audit_factory_plan_check CHECK (factory_plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT runtime_cutover_audit_graphile_manifest_check CHECK (graphile_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT runtime_cutover_audit_langgraph_manifest_check CHECK (langgraph_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT runtime_cutover_audit_approval_check CHECK (approval_digest ~ '^sha256:[0-9a-f]{64}$')
);

CREATE OR REPLACE FUNCTION runtime_control.reject_cutover_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cutover_audit is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reject_cutover_audit_update ON runtime_control.cutover_audit;
CREATE TRIGGER trg_reject_cutover_audit_update
BEFORE UPDATE ON runtime_control.cutover_audit
FOR EACH ROW EXECUTE FUNCTION runtime_control.reject_cutover_audit_mutation();

DROP TRIGGER IF EXISTS trg_reject_cutover_audit_delete ON runtime_control.cutover_audit;
CREATE TRIGGER trg_reject_cutover_audit_delete
BEFORE DELETE ON runtime_control.cutover_audit
FOR EACH ROW EXECUTE FUNCTION runtime_control.reject_cutover_audit_mutation();

REVOKE ALL ON runtime_control.cutover_audit FROM PUBLIC;
COMMENT ON TABLE runtime_control.cutover_audit IS 'Append-only approval and exact-evidence identity for joint Graphile/LangGraph cutover.';
