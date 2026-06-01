const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('authenticated browser API contract documents deploy bootstrap wrapper behavior', () => {
  const spec = fs.readFileSync(
    path.join(__dirname, '../../docs/api/authenticated-browser-app-openapi.yml'),
    'utf8'
  );

  assert.match(spec, /Vercel API entrypoints await deploy auth bootstrap/);
  assert.match(spec, /bootstrap failures fail closed/);
});

test('audit foundation API contract documents Vercel workflow proxy aliases', () => {
  const spec = fs.readFileSync(
    path.join(__dirname, '../../docs/api/audit-foundation-openapi.yml'),
    'utf8'
  );

  assert.match(spec, /versioned task workflow aliases/);
  assert.match(spec, /\/api\/v1\/tasks\/\{taskId\}\/refinement\/start/);
  assert.match(spec, /\/api\/v1\/tasks\/\{taskId\}\/execution-contract\/\{action\}/);
  assert.match(spec, /api\/v1\/task-workflow-proxy\.js/);
});

test('audit foundation API contract documents Vercel task detail read aliases', () => {
  const spec = fs.readFileSync(
    path.join(__dirname, '../../docs/api/audit-foundation-openapi.yml'),
    'utf8'
  );

  assert.match(spec, /unversioned task detail read aliases/);
  assert.match(spec, /\/api\/tasks\/\{taskId\}\/history/);
  assert.match(spec, /__audit_path/);
});
