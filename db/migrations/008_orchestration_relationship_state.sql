ALTER TABLE audit_task_relationships
  ADD COLUMN IF NOT EXISTS child_dependencies JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE audit_task_relationships
  ADD COLUMN IF NOT EXISTS orchestration_state JSONB;
