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
    'lib/job-runtime/index.js',
    'lib/job-runtime/effect-ledger.js',
    'lib/job-runtime/workload-handlers.js',
  ].map(read).join('\n');
  const metrics = [...alerts.matchAll(/(?:increase\()?\b(job_runtime_[a-z_]+)\b/g)].map((match) => match[1]);
  assert.ok(metrics.length >= 7);
  for (const metric of new Set(metrics)) assert.match(runtimeSource, new RegExp(`['"]${metric}['"]`), metric);
  assert.match(alerts, /job_runtime_claims_enabled == 1 and job_runtime_accepting_claims == 0/);
  assert.match(alerts, /job_runtime_queue_oldest_age_seconds > 2/);
  assert.match(alerts, /job_runtime_pool_waiting_requests > 0/);
});

test('every Given-When-Then acceptance criterion has an automated regression scenario', () => {
  const e2e = read('tests/e2e/job-runtime-workloads.e2e.test.js');
  for (let criterion = 1; criterion <= 7; criterion += 1) {
    assert.match(e2e, new RegExp(`test\\('AC${criterion}[^']+@regression'`), `AC${criterion}`);
  }
});

test('issue 287 workload, compatibility, operations, and compliance artifacts are committed', () => {
  const artifacts = [
    'config/job-runtime-workload-inventory.json',
    'docs/architecture/job-runtime-workloads.md',
    'docs/architecture/job-runtime-runtime-configuration.md',
    'docs/api/job-runtime-internal-contract.md',
    'docs/api/job-runtime-openapi.yml',
    'docs/reports/ISSUE-287_DEPENDENCY_REVIEW.md',
    'docs/reports/ISSUE-287_STANDARDS_COMPLIANCE_CHECKLIST.md',
    'docs/runbooks/job-runtime.md',
    'docs/diagrams/workflow-graphile-02.mmd',
    'docs/diagrams/schema-graphile-02.mmd',
    'docs/diagrams/architecture-graphile-02.mmd',
  ];
  for (const artifact of artifacts) assert.match(read(artifact), /Graphile|job.runtime|workload/i, artifact);
  assert.match(read(artifacts[5]), /Standards Alignment/);
  assert.match(read(artifacts[6]), /Required Evidence/);
  assert.match(read(artifacts[1]), /GitLab, GitHub, deployment, notifications/);
  assert.match(read(artifacts[7]), /Delivery acknowledgment is not business completion/);
  assert.match(read(artifacts[4]), /\/api\/v1\/job-runtime\/jobs/);
});

test('shared-host performance files run serially without weakening their budgets', () => {
  const pkg = JSON.parse(read('package.json'));
  const ci = read('.gitlab-ci.yml');
  assert.match(pkg.scripts['test:performance'], /wait-for-performance-host\.js && node --test --test-concurrency=1/);
  assert.match(
    pkg.scripts['test:browser:performance'],
    /wait-for-performance-host\.js && BROWSER_PERFORMANCE_MODE=production node scripts\/run-playwright\.js/,
  );
  assert.doesNotMatch(pkg.scripts['test:node:aggregate'], /tests\/performance/);
  assert.equal(pkg.scripts.test, 'npm run test:performance && npm run test:browser:performance && npm run test:functional');
  assert.match(pkg.scripts['test:functional'], /test:node:aggregate && npm run test:browser:functional/);
  assert.match(ci, /performance-evidence:\n[\s\S]*?stage: performance[\s\S]*?- npm run test:performance[\s\S]*?- npm run test:browser:performance/);
  assert.equal((ci.match(/- npm run test:performance/g) || []).length, 1);
  assert.equal((ci.match(/- npm run test:browser:performance/g) || []).length, 1);
  assert.equal((ci.match(/PERFORMANCE_EVIDENCE_COMPLETE=1 make verify/g) || []).length, 2);
  assert.match(ci, /PERFORMANCE_HOST_MAX_CPU_PERCENT: "25"/);
  assert.match(ci, /PERFORMANCE_HOST_WAIT_TIMEOUT_MS: "1200000"/);
  assert.match(read('tests/performance/job-runtime.performance.test.js'), /percentile\(latencies, 0\.95\) < 100/);
  assert.match(read('tests/performance/job-runtime.performance.test.js'), /percentile\(latencies, 0\.99\) < 250/);
});
