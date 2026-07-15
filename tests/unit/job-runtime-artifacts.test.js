'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('issue 286 required architecture operations and compliance artifacts are committed', () => {
  const artifacts = [
    'docs/adr/ADR-003-application-owned-graphile-job-runtime.md',
    'docs/reports/ISSUE-286_DEPENDENCY_REVIEW.md',
    'docs/reports/ISSUE-286_STANDARDS_COMPLIANCE_CHECKLIST.md',
    'docs/api/job-runtime-internal-contract.md',
    'docs/architecture/job-runtime-runtime-configuration.md',
    'docs/runbooks/job-runtime.md',
    'docs/diagrams/workflow-graphile-01.mmd',
    'docs/diagrams/schema-graphile-01.mmd',
    'docs/diagrams/architecture-graphile-01.mmd',
    'monitoring/alerts/job-runtime.yml',
  ];
  for (const artifact of artifacts) assert.match(read(artifact), /job.runtime|Graphile/i, artifact);
  assert.match(read(artifacts[0]), /Standards Alignment/);
  assert.match(read(artifacts[0]), /Required Evidence/);
  assert.match(read(artifacts[4]), /Backup classification/i);
  assert.match(read(artifacts[4]), /30 days/);
  assert.match(read(artifacts[5]), /not business completion/i);
});

test('alert fixtures reference metrics emitted by application-owned runtime code', () => {
  const alerts = read('monitoring/alerts/job-runtime.yml');
  const runtimeSource = [
    'lib/job-runtime/handlers.js',
    'lib/job-runtime/port.js',
    'lib/job-runtime/runtime.js',
  ].map(read).join('\n');
  const metrics = [...alerts.matchAll(/(?:increase\()?\b(job_runtime_[a-z_]+)\b/g)].map((match) => match[1]);
  assert.ok(metrics.length >= 7);
  for (const metric of new Set(metrics)) assert.match(runtimeSource, new RegExp(`['"]${metric}['"]`), metric);
  assert.match(alerts, /job_runtime_claims_enabled == 1 and job_runtime_accepting_claims == 0/);
  assert.match(alerts, /job_runtime_queue_oldest_age_seconds > 2/);
  assert.match(alerts, /job_runtime_pool_waiting_requests > 0/);
});

test('every Given-When-Then acceptance criterion has an automated regression scenario', () => {
  const e2e = read('tests/e2e/job-runtime.e2e.test.js');
  for (let criterion = 1; criterion <= 6; criterion += 1) {
    assert.match(e2e, new RegExp(`test\\('AC${criterion}[^']+@regression'`), `AC${criterion}`);
  }
});
