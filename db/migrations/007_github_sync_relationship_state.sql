ALTER TABLE audit_task_relationships
  ADD COLUMN IF NOT EXISTS linked_prs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE audit_task_relationships
  ADD COLUMN IF NOT EXISTS github_sync JSONB;
