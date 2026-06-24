// Golden-path replay seeds forge tasks via Postgres audit store before GP-011 dispatch.
// Hosted worker preflight uses task-platform `/api/v1/tasks/{taskId}/events` append routes on the operator URL.
// Factory orchestrator advances queued requirements through golden-path phases on the local stack.
// Unit tests run through scripts/run-unit-tests.js with sanitized env for isolated file backends.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('audit foundation OpenAPI documents forge execution-readiness route and canonical task shape', () => {
  const root = path.join(__dirname, '../..');
  const openapi = fs.readFileSync(path.join(root, 'docs/api/audit-foundation-openapi.yml'), 'utf8');
  const platform = fs.readFileSync(path.join(root, 'docs/api/task-platform-openapi.yml'), 'utf8');

  for (const expected of [
    '/tasks/{id}/forge-execution-readiness:',
    'operationId: getForgeExecutionReadiness',
    'ForgeCanonicalTask',
    'forge:read',
    'FORGE_SERVICE_TOKEN',
    'task_not_execution_ready',
  ]) {
    assert.match(openapi, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const expected of [
    'pollForgeExecutionReadiness',
    'golden-path:smoke:gp-002',
    'golden-path:smoke:gp-015',
    'golden-path:smoke:gp-013',
    'contract-coverage audit history rows matching the current implementation attempt',
    'task.sre_monitoring_started',
    'golden-path-phases.js',
  ]) {
    assert.match(platform, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});