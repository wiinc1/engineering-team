const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('task platform OpenAPI documents Projects planning containers', () => {
  const root = path.join(__dirname, '../..');
  const openapi = fs.readFileSync(path.join(root, 'docs/api/task-platform-openapi.yml'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'db/migrations/012_projects.sql'), 'utf8');

  for (const expected of [
    '/projects:',
    'operationId: createProject',
    'operationId: listProjects',
    '/projects/{projectId}:',
    'operationId: updateProject',
    '/tasks/{taskId}/project:',
    'operationId: updateTaskProject',
    'ProjectStatus',
    'UpdateTaskProjectRequest',
    'ProjectSummary',
  ]) {
    assert.match(openapi, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const expected of [
    'CREATE TABLE IF NOT EXISTS projects',
    'project_id TEXT NOT NULL',
    "CHECK (status IN ('PLANNING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'))",
    'ALTER TABLE tasks',
    'ADD COLUMN IF NOT EXISTS project_id TEXT',
    'CREATE TABLE IF NOT EXISTS project_mutations',
    'idx_project_mutations_idempotency',
  ]) {
    assert.match(migration, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
