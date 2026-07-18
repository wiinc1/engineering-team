'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('issues 283 284 289 and 290 commit their gates runbooks decisions reports and named diagrams', () => {
  const files = [
    'docs/architecture/runtime-production-gates.md', 'docs/architecture/exclusive-runtime-cutover.md',
    'docs/adr/ADR-005-exclusive-runtime-ownership.md', 'docs/runbooks/runtime-hardening-cutover.md',
    ...[283, 284, 289, 290].map((issue) => `docs/reports/ISSUE-${issue}_STANDARDS_COMPLIANCE_CHECKLIST.md`),
    ...['graphile-04', 'graphile-05', 'langgraph-04', 'langgraph-05'].flatMap((name) => [
      `docs/diagrams/workflow-${name}.mmd`, `docs/diagrams/architecture-${name}.mmd`, `docs/diagrams/schema-${name}.mmd`,
    ]),
  ];
  for (const file of files) assert.ok(read(file).trim().length > 40, file);
  assert.match(read('docs/architecture/runtime-production-gates.md'), /24-hour|86,400/);
  assert.match(read('docs/architecture/exclusive-runtime-cutover.md'), /percentage/i);
  assert.match(read('docs/reports/ISSUE-283_STANDARDS_COMPLIANCE_CHECKLIST.md'), /BLOCKED/);
  assert.match(read('docs/reports/ISSUE-289_STANDARDS_COMPLIANCE_CHECKLIST.md'), /BLOCKED/);
});

test('cutover schema is evidence-first and refuses destructive rollback with history', () => {
  const up = read('db/migrations/021_runtime_cutover_ownership.sql');
  const down = read('db/migrations/021_runtime_cutover_ownership.down.sql');
  assert.match(up, /ownership_epochs/);
  assert.match(up, /migration_records/);
  assert.match(up, /runtime_ownership_one_current_idx/);
  assert.match(up, /REVOKE ALL/);
  assert.match(down, /rollback refused/);
});
