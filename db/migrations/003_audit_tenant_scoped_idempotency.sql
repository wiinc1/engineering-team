ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_idempotency_key_key;
DROP INDEX IF EXISTS audit_events_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_tenant_idempotency ON audit_events (tenant_id, idempotency_key);
