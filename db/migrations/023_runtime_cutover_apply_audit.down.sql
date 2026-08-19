DROP TABLE IF EXISTS runtime_control.cutover_audit;
DROP FUNCTION IF EXISTS runtime_control.reject_cutover_audit_mutation();
ALTER TABLE runtime_control.migration_records
  DROP COLUMN IF EXISTS reconciliation_digest;
