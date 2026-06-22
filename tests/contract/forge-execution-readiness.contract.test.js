const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('audit foundation OpenAPI documents forge execution-readiness route and canonical task shape', () => {
  const root = path.join(__dirname, '../..');
  const openapi = fs.readFileSync(path.join(root, 'docs/api/audit-foundation-openapi.yml'), 'utf8');

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
});