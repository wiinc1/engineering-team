'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { captureLogger, deliveryRecord, metricRecorder, validContext, validRequest } = require('../fixtures/job-runtime/v1');
const { runtimeConfig } = require('../../lib/job-runtime/config');
const { createJobRuntime } = require('../../lib/job-runtime/runtime');
const { createPayloadValidator } = require('../../lib/job-runtime/payload-schema');
const { createJobRuntimePort } = require('../../lib/job-runtime/port');
const { createTaskCatalog } = require('../../lib/job-runtime/task-catalog');

function portHarness(overrides = {}) {
  const records = [];
  const jobs = [];
  const registry = {
    async createPending(input) {
      const record = deliveryRecord({
        deliveryId: input.deliveryId,
        workloadId: input.workloadId,
        semanticJobKey: input.semanticJobKey,
        scheduledFor: new Date(input.scheduledFor).toISOString(),
        graphileJobId: null,
      });
      records.push(record);
      return { created: true, record };
    },
    async attachGraphileJob(deliveryId, jobId) {
      return { ...records.find((record) => record.deliveryId === deliveryId), graphileJobId: jobId, status: 'queued' };
    },
    async markFailed() {},
  };
  const adapter = {
    async addJob(definition, envelope, schedule, key) {
      const job = { id: String(jobs.length + 1), definition, envelope, schedule, key };
      jobs.push(job);
      return job;
    },
    async compensate() {},
  };
  let sequence = 0;
  const port = createJobRuntimePort({
    catalog: createTaskCatalog(), registry, adapter, logger: captureLogger(), metrics: metricRecorder(),
    idGenerator: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    authorizeCanonical: overrides.authorizeCanonical,
  });
  return { port, jobs, records };
}

test('AC1 production startup initializes migration schema pool and role checks @regression', async () => {
  const calls = [];
  const runtime = createJobRuntime({
    adapter: {
      async migrate() { calls.push('graphile_migrate'); },
      async start() { calls.push('worker_start'); return null; },
      async close() {},
    },
    registry: { async verifySchema() { calls.push('registry_schema'); } },
    async verifyPrivileges() { calls.push('least_privilege'); },
    pool: { options: { max: 10 }, async query() { calls.push('database_tls_pool'); return { rows: [] }; } },
    logger: captureLogger(), metrics: metricRecorder(), taskList: {},
    config: runtimeConfig({ claimsEnabled: false, poolMax: 10 }),
    timers: { setTimeout, clearTimeout },
  });
  const health = await runtime.start();
  assert.deepEqual(calls.slice(0, 4), ['graphile_migrate', 'registry_schema', 'least_privilege', 'worker_start']);
  assert.equal(health.status, 'ok');
  assert.equal(health.pool.max, 10);
});

test('AC2 valid registered payload persists semantic key queue retry correlation and registry @regression', async () => {
  const harness = portHarness();
  const record = await harness.port.enqueue(validContext(), validRequest({ runAt: new Date() }));
  assert.match(record.semanticJobKey, /^jr:v1:[a-f0-9]{64}$/);
  assert.equal(harness.jobs[0].schedule.queueName, 'job-runtime-synthetic');
  assert.equal(harness.jobs[0].schedule.maxAttempts, 3);
  assert.equal(harness.jobs[0].envelope.correlation.correlationId, 'corr-286');
  assert.equal(harness.records.length, 1);
});

test('AC3 unknown version oversized secret and schema-invalid payloads fail before execution @regression', async () => {
  const harness = portHarness();
  const invalidRequests = [
    validRequest({ task: 'unknown.task', runAt: new Date() }),
    validRequest({ version: 2, runAt: new Date() }),
    validRequest({ data: { probeId: 'probe-286', token: 'forbidden' }, runAt: new Date() }),
    validRequest({ data: { probeId: 'bad id!' }, runAt: new Date() }),
    validRequest({ data: { probeId: 'x'.repeat(70_000) }, runAt: new Date() }),
  ];
  const codes = [];
  for (const request of invalidRequests) {
    try { await harness.port.enqueue(validContext(), request); } catch (error) { codes.push(error.code); }
  }
  assert.deepEqual(codes, [
    'job_task_unknown', 'job_version_unsupported', 'job_payload_invalid',
    'job_payload_invalid', 'job_payload_invalid',
  ]);
  assert.equal(harness.jobs.length, 0);
});

test('AC4 concurrent producers receive one low-cardinality serial named queue policy @regression', async () => {
  const harness = portHarness();
  const requests = Array.from({ length: 20 }, (_, index) => validRequest({
    workloadId: `probe-concurrent-${index}`,
    canonicalResource: { type: 'synthetic', id: `probe-concurrent-${index}` },
    data: { probeId: `probe-concurrent-${index}` },
    runAt: new Date(),
  }));
  await Promise.all(requests.map((request, index) => harness.port.enqueue(validContext({ correlationId: `corr-${index}` }), request)));
  assert.equal(new Set(harness.jobs.map((job) => job.schedule.queueName)).size, 1);
  assert.equal(harness.jobs[0].definition.concurrency.serialByNamedQueue, true);
  assert.equal(new Set(harness.jobs.map((job) => job.key)).size, 20);
});

test('AC5 shutdown deadline stops claims and marks active work for redelivery @regression', async () => {
  const calls = [];
  const runtime = createJobRuntime({
    adapter: {
      async migrate() {}, async start() {
        return { promise: new Promise(() => {}), stop: () => new Promise(() => {}), async kill() { calls.push('kill'); } };
      },
      async close() { calls.push('close'); },
    },
    registry: { async verifySchema() {}, async markRunningForRedelivery() { calls.push('redeliver'); } },
    async verifyPrivileges() {},
    pool: { options: { max: 10 }, async query() { return { rows: [] }; } },
    logger: captureLogger(), metrics: metricRecorder(), taskList: {},
    config: runtimeConfig({ claimsEnabled: true, poolMax: 10, shutdownDeadlineMs: 1000 }),
    timers: { setTimeout(callback) { callback(); return 1; }, clearTimeout() {} },
  });
  await runtime.start();
  assert.equal((await runtime.drain('SIGTERM')).state, 'stopped');
  assert.deepEqual(calls, ['kill', 'redeliver', 'close']);
});

test('AC6 migration rollback is registry-scoped and refuses populated registry loss @regression', () => {
  const root = path.join(__dirname, '../..');
  const up = fs.readFileSync(path.join(root, 'db/migrations/016_job_runtime_registry.sql'), 'utf8');
  const down = fs.readFileSync(path.join(root, 'db/migrations/016_job_runtime_registry.down.sql'), 'utf8');
  assert.match(up, /CREATE TABLE IF NOT EXISTS job_runtime\.job_delivery_registry/);
  assert.match(down, /rollback refused/);
  assert.equal(/\b(DROP|DELETE|UPDATE|TRUNCATE)\s+(TABLE\s+)?(tasks|audit_events)\b/i.test(down), false);
  assert.equal(createPayloadValidator().validate instanceof Function, true);
});
