CREATE TABLE IF NOT EXISTS audit_events (
  event_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  correlation_id TEXT,
  causation_id TEXT,
  sequence_number INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL UNIQUE,
  trace_id TEXT,
  source TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, task_id, sequence_number)
);

CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reject_audit_event_update ON audit_events;
CREATE TRIGGER trg_reject_audit_event_update
BEFORE UPDATE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

DROP TRIGGER IF EXISTS trg_reject_audit_event_delete ON audit_events;
CREATE TRIGGER trg_reject_audit_event_delete
BEFORE DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

CREATE INDEX IF NOT EXISTS idx_audit_events_task ON audit_events (tenant_id, task_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events (tenant_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events (tenant_id, actor_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS audit_projection_queue (
  queue_id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES audit_events(event_id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_projection_queue_pending ON audit_projection_queue (status, available_at, queue_id);

CREATE TABLE IF NOT EXISTS audit_outbox (
  outbox_id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES audit_events(event_id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  destination TEXT NOT NULL DEFAULT 'stdout',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_outbox_pending ON audit_outbox (status, available_at, outbox_id);

CREATE TABLE IF NOT EXISTS audit_task_current_state (
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  last_event_id UUID NOT NULL,
  last_event_type TEXT NOT NULL,
  last_occurred_at TIMESTAMPTZ NOT NULL,
  last_actor_id TEXT NOT NULL,
  current_stage TEXT,
  assignee TEXT,
  priority TEXT,
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  closed BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tenant_id, task_id)
);

CREATE TABLE IF NOT EXISTS audit_task_history (
  event_id UUID PRIMARY KEY REFERENCES audit_events(event_id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  correlation_id TEXT,
  trace_id TEXT,
  summary TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_task_history_task ON audit_task_history (tenant_id, task_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_audit_task_history_filters ON audit_task_history (tenant_id, task_id, event_type, actor_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS audit_task_relationships (
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  child_task_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  escalations JSONB NOT NULL DEFAULT '[]'::jsonb,
  decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (tenant_id, task_id)
);

CREATE TABLE IF NOT EXISTS audit_metrics (
  metric_key TEXT PRIMARY KEY,
  metric_value DOUBLE PRECISION,
  metric_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
