CREATE TABLE IF NOT EXISTS langgraph_checkpoint.factory_lifecycle_events (
  event_id UUID PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  factory_run_id VARCHAR(128) NOT NULL,
  task_id TEXT,
  thread_id VARCHAR(51) NOT NULL,
  event_type VARCHAR(16) NOT NULL,
  node VARCHAR(64) NOT NULL,
  attempt INTEGER NOT NULL,
  outcome VARCHAR(32),
  delegation JSONB,
  idempotency_key VARCHAR(192) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT langgraph_lifecycle_event_tenant_idempotency_unique UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT langgraph_lifecycle_event_tenant_check CHECK (tenant_id ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  CONSTRAINT langgraph_lifecycle_event_run_check CHECK (factory_run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT langgraph_lifecycle_event_thread_check CHECK (thread_id ~ '^lg_[a-f0-9]{48}$'),
  CONSTRAINT langgraph_lifecycle_event_type_check CHECK (event_type IN ('node_started','node_finished')),
  CONSTRAINT langgraph_lifecycle_event_node_check CHECK (node ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT langgraph_lifecycle_event_attempt_check CHECK (attempt BETWEEN 1 AND 1000),
  CONSTRAINT langgraph_lifecycle_event_outcome_check CHECK (
    (event_type = 'node_started' AND outcome IS NULL)
    OR (event_type = 'node_finished' AND outcome IN ('success','retry','failed','dead_letter','cancelled'))
  ),
  CONSTRAINT langgraph_lifecycle_event_delegation_size_check CHECK (
    delegation IS NULL OR octet_length(delegation::text) <= 16384
  ),
  FOREIGN KEY (tenant_id, task_id) REFERENCES tasks(tenant_id, task_id)
);

CREATE INDEX IF NOT EXISTS langgraph_lifecycle_events_run_idx
  ON langgraph_checkpoint.factory_lifecycle_events (tenant_id, factory_run_id, occurred_at);
CREATE INDEX IF NOT EXISTS langgraph_lifecycle_events_thread_idx
  ON langgraph_checkpoint.factory_lifecycle_events (tenant_id, thread_id, occurred_at);
CREATE INDEX IF NOT EXISTS langgraph_lifecycle_events_task_idx
  ON langgraph_checkpoint.factory_lifecycle_events (tenant_id, task_id, occurred_at)
  WHERE task_id IS NOT NULL;

CREATE OR REPLACE FUNCTION langgraph_checkpoint.reject_factory_lifecycle_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'factory_lifecycle_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reject_factory_lifecycle_event_update
  ON langgraph_checkpoint.factory_lifecycle_events;
CREATE TRIGGER trg_reject_factory_lifecycle_event_update
BEFORE UPDATE ON langgraph_checkpoint.factory_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION langgraph_checkpoint.reject_factory_lifecycle_event_mutation();

DROP TRIGGER IF EXISTS trg_reject_factory_lifecycle_event_delete
  ON langgraph_checkpoint.factory_lifecycle_events;
CREATE TRIGGER trg_reject_factory_lifecycle_event_delete
BEFORE DELETE ON langgraph_checkpoint.factory_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION langgraph_checkpoint.reject_factory_lifecycle_event_mutation();

REVOKE ALL ON TABLE langgraph_checkpoint.factory_lifecycle_events FROM PUBLIC;

COMMENT ON TABLE langgraph_checkpoint.factory_lifecycle_events IS
  'Append-only, tenant-bound lifecycle evidence. Intake may start without a task_id; later events also reconcile into canonical task audit history.';
