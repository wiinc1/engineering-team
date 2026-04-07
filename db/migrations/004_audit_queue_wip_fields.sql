ALTER TABLE audit_task_current_state
  ADD COLUMN IF NOT EXISTS waiting_state TEXT,
  ADD COLUMN IF NOT EXISTS next_required_action TEXT,
  ADD COLUMN IF NOT EXISTS queue_entered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wip_owner TEXT,
  ADD COLUMN IF NOT EXISTS wip_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_audit_task_current_state_queue_order
  ON audit_task_current_state (tenant_id, priority, queue_entered_at, task_id);

CREATE INDEX IF NOT EXISTS idx_audit_task_current_state_wip_owner
  ON audit_task_current_state (tenant_id, wip_owner, wip_started_at);
