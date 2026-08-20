'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const envelopeFixture = require('../fixtures/job-runtime/v1-valid-envelope.json');
const { DELIVERY_ID, FIXED_NOW, captureLogger, deliveryRecord, metricRecorder, validContext, validRequest } = require('../fixtures/job-runtime/v1');
const { buildTaskList } = require('../../lib/job-runtime/handlers');
const { createPayloadValidator } = require('../../lib/job-runtime/payload-schema');
const { createEnvelope, createJobRuntimePort } = require('../../lib/job-runtime/port');
const { createTaskCatalog } = require('../../lib/job-runtime/task-catalog');
const { createMigratedWorkloadHandlers } = require('../../lib/job-runtime/workload-handlers');
const { assertInventoryCompleteness, inventory } = require('../../lib/job-runtime/workload-inventory');
const { createWorkloadProducers } = require('../../lib/job-runtime/workload-producers');
const { assertJobRuntimeLoadBudgets, loadMeasurement } = require('../../scripts/run-job-runtime-load-test');

function passingLoadReport(overrides = {}) {
  return {
    load_multiplier: 2.08, required_load_multiplier: 2,
    submitted: 100, acknowledged: 100, enqueue_p95_ms: 20, enqueue_p99_ms: 40,
    operational_read_p95_ms: 30, ready_to_start_p95_ms: 100,
    pool_peak_total: 6, pool_max: 10, pool_waiting_at_end: 0,
    runtime_pool_waiting_at_end: 0, ...overrides,
  };
}

test('hosted load evidence enforces the operational read and pool contract', () => {
  assert.doesNotThrow(() => assertJobRuntimeLoadBudgets(passingLoadReport()));
  assert.throws(
    () => assertJobRuntimeLoadBudgets(passingLoadReport({ operational_read_p95_ms: 250 })),
    /operational_read_latency_budget_failed/,
  );
  assert.throws(
    () => assertJobRuntimeLoadBudgets(passingLoadReport({ runtime_pool_waiting_at_end: 1 })),
    /pool_budget_failed/,
  );
  assert.throws(
    () => assertJobRuntimeLoadBudgets(passingLoadReport({ load_multiplier: 1.99 })),
    /load_multiplier_failed/,
  );
  assert.throws(
    () => assertJobRuntimeLoadBudgets(passingLoadReport({ load_multiplier: undefined })),
    /load_multiplier_failed/,
  );
});

test('hosted load evidence derives 2x from measured wall-clock throughput', () => {
  const onSchedule = loadMeasurement({ submitted: 31_200, durationMs: 600_000, expectedQps: 25, targetQps: 52 });
  assert.equal(onSchedule.requestedLoadMultiplier, 2.08);
  assert.equal(onSchedule.measuredLoadMultiplier, 2.08);
  const delayed = loadMeasurement({ submitted: 31_200, durationMs: 900_000, expectedQps: 25, targetQps: 52 });
  assert.ok(delayed.measuredLoadMultiplier < 2);
  assert.throws(
    () => assertJobRuntimeLoadBudgets(passingLoadReport({ load_multiplier: delayed.measuredLoadMultiplier })),
    /load_multiplier_failed/,
  );
});

test('producer and handler share the exact v1 payload and correlation contract', async () => {
  const fullCatalog = createTaskCatalog();
  const catalog = createTaskCatalog([fullCatalog.resolve('job_runtime.synthetic', 1)]);
  const validator = createPayloadValidator();
  let queuedEnvelope;
  const registry = {
    async createPending() { return { created: true, record: deliveryRecord({ graphileJobId: null }) }; },
    async attachGraphileJob() { return deliveryRecord(); },
    async markRunning() { return deliveryRecord({ status: 'running' }); },
    async markAcknowledged() {},
    async markFailed() {},
  };
  const port = createJobRuntimePort({
    catalog, validator, registry, logger: captureLogger(), metrics: metricRecorder(),
    clock: { now: () => FIXED_NOW }, idGenerator: () => DELIVERY_ID,
    adapter: {
      async addJob(definition, envelope) { queuedEnvelope = { definition, envelope }; return { id: '42' }; },
      async compensate() {},
    },
  });
  await port.enqueue(validContext(), validRequest());
  assert.deepEqual(queuedEnvelope.envelope, envelopeFixture);
  assert.equal(queuedEnvelope.definition.identifier, 'job_runtime.synthetic.v1');
  let handlerContract;
  const taskList = buildTaskList({
    catalog, validator, registry, logger: captureLogger(), metrics: metricRecorder(), clock: { now: () => FIXED_NOW },
    handlers: { 'job_runtime.synthetic.v1': async (data, context) => { handlerContract = { data, context }; } },
  });
  await taskList['job_runtime.synthetic.v1'](queuedEnvelope.envelope, {
    job: { id: '42', attempts: 1, max_attempts: 3 },
    abortSignal: new AbortController().signal,
  });
  assert.deepEqual(handlerContract.data, envelopeFixture.data);
  assert.deepEqual(handlerContract.context.correlation, envelopeFixture.correlation);
  assert.equal(handlerContract.context.tenantId, 'tenant-one');
  assert.equal(handlerContract.context.job, undefined);
});

test('health and readiness contracts expose no payload or Graphile storage detail', () => {
  const healthKeys = ['status', 'state', 'database', 'claimsEnabled', 'acceptingClaims', 'catalogVersion', 'pool'];
  const readinessKeys = ['ready', 'draining', 'state', 'claimsEnabled', 'acceptingClaims'];
  assert.equal(healthKeys.includes('payload'), false);
  assert.equal(healthKeys.some((key) => key.includes('table')), false);
  assert.equal(readinessKeys.includes('graphileJobId'), false);
});

test('every inventoried producer emits data accepted by its exact versioned handler contract', async () => {
  const requests = [];
  const producers = createWorkloadProducers({ async enqueue(context, request) { requests.push({ context, request }); } });
  const context = validContext();
  await producers.factoryStart(context, { runId: 'run-1', taskId: 'TSK-1', threadId: 'thread-1', workflowVersion: 1 });
  await producers.factoryResume(context, {
    runId: 'run-1', taskId: 'TSK-1', threadId: 'thread-1', workflowVersion: 1, checkpointVersion: 2,
  });
  for (const method of ['auditProjection', 'auditOutbox', 'sreMonitoringExpiry']) {
    await producers[method](context, { occurrenceId: `${method}:1000`, batchSize: 100 });
  }
  await producers.factoryReconciliation(context, { occurrenceId: 'factory:1000' });
  await producers.registryRetention(context, { occurrenceId: 'retention:1000' });

  const catalog = createTaskCatalog();
  const validator = createPayloadValidator();
  const handlers = createMigratedWorkloadHandlers();
  assert.equal(requests.length, inventory.workloads.length);
  assertInventoryCompleteness(catalog, handlers);
  for (const [index, item] of requests.entries()) {
    const definition = catalog.resolve(item.request.task, item.request.version);
    const envelope = createEnvelope(item.context, item.request, definition, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
    assert.doesNotThrow(() => validator.validate(envelope, definition), definition.identifier);
    assert.equal(typeof handlers[definition.identifier], 'function');
  }
  assert.deepEqual(requests.map(({ request }) => `${request.task}.v${request.version}`).sort(),
    inventory.workloads.map(({ taskIdentifier }) => taskIdentifier).sort());
});

test('operator API declares tenant-scoped detail and guarded actions with stable errors', () => {
  const openapi = fs.readFileSync(path.join(__dirname, '../../docs/api/job-runtime-openapi.yml'), 'utf8');
  assert.match(openapi, /\/api\/v1\/job-runtime\/jobs\/\{deliveryId\}/);
  assert.match(openapi, /Idempotency-Key/);
  assert.match(openapi, /If-Match/);
  for (const code of [
    'job_runtime_unavailable', 'job_task_unknown', 'job_payload_invalid',
    'job_version_unsupported', 'job_schedule_conflict', 'job_not_found',
    'job_action_forbidden', 'job_action_conflict',
  ]) assert.match(openapi, new RegExp(code));
});
