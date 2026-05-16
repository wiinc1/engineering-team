DROP INDEX IF EXISTS idx_project_mutations_idempotency;
DROP INDEX IF EXISTS idx_project_mutations_tenant_created;
DROP TABLE IF EXISTS project_mutations;

DROP INDEX IF EXISTS idx_tasks_project_updated;

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS fk_tasks_project;

ALTER TABLE tasks
  DROP COLUMN IF EXISTS project_id;

DROP INDEX IF EXISTS idx_projects_owner_updated;
DROP INDEX IF EXISTS idx_projects_status_updated;
DROP INDEX IF EXISTS idx_projects_tenant_name_unique;

DROP TABLE IF EXISTS projects;
