'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const envelopeFixture = require('../fixtures/job-runtime/v1-valid-envelope.json');
const {
  DELIVERY_ID,
  FIXED_NOW,
  captureLogger,
  deliveryRecord,
  metricRecorder,
  validContext,
  validRequest,
} = require('../fixtures/job-runtime/v1');
const { JobRuntimeError } = require('../../lib/job-runtime/errors');
const { applicationContext, buildTaskList, runWithPolicy } = require('../../lib/job-runtime/handlers');
const { createPayloadValidator } = require('../../lib/job-runtime/payload-schema');
const { createEnvelope, createJobRuntimePort, scheduleDate } = require('../../lib/job-runtime/port');
const { createTaskCatalog } = require('../../lib/job-runtime/task-catalog');

function syntheticCatalog() {
  const catalog = createTaskCatalog();
  return createTaskCatalog([catalog.resolve('job_runtime.synthetic', 1)]);
}

function portFakes(overrides = {}) {
  const record = deliveryRecord();
  const calls = { pending: [], attached: [], failed: [], added: [], compensated: [] };
  const registry = {
    async createPending(input) {
      calls.pending.push(input);
      return overrides.pending || { created: true, record: { ...record, graphileJobId: null } };
    },
    async attachGraphileJob(deliveryId, jobId) {
      calls.attached.push({ deliveryId, jobId });
      if (overrides.attachError) throw overrides.attachError;
      return record;
    },
    async markFailed(deliveryId, input) { calls.failed.push({ deliveryId, ...input }); },
  };
  const adapter = {
    async addJob(definition, envelope, schedule, key) {
      calls.added.push({ definition, envelope, schedule, key });
      if (overrides.addError) throw overrides.addError;
      return { id: '42' };
    },
    async compensate(jobId) { calls.compensated.push(jobId); },
  };
  const logger = captureLogger();
  const metrics = metricRecorder();
  const port = createJobRuntimePort({
    catalog: syntheticCatalog(),
    registry,
    adapter,
    logger,
    metrics,
    clock: { now: () => FIXED_NOW },
    idGenerator: () => DELIVERY_ID,
    authorizeCanonical: overrides.authorizeCanonical,
  });
  return { port, calls, logger, metrics, record };
}

test('application port validates and persists every delivery policy before enqueue', async () => {
  const fixture = portFakes();
  const result = await fixture.port.enqueue(validContext(), validRequest());
  assert.equal(result, fixture.record);
  assert.equal(fixture.calls.pending[0].payloadSizeBytes > 100, true);
  assert.equal(fixture.calls.pending[0].queue, 'job-runtime-synthetic');
  assert.equal(fixture.calls.pending[0].maxAttempts, 3);
  assert.deepEqual(fixture.calls.pending[0], {
    deliveryId: DELIVERY_ID,
    tenantId: 'tenant-one',
    workloadId: 'probe-286',
    semanticJobKey: fixture.calls.pending[0].semanticJobKey,
    taskIdentifier: 'job_runtime.synthetic.v1',
    task: 'job_runtime.synthetic',
    version: 1,
    catalogVersion: 1,
    handlerVersion: 1,
    orderingKey: 'tenant-one:synthetic:probe-286',
    queueName: 'job-runtime-synthetic',
    queue: 'job-runtime-synthetic',
    maxAttempts: 3,
    priority: 0,
    runAt: new Date(FIXED_NOW),
    canonicalResourceType: 'synthetic',
    canonicalResourceId: 'probe-286',
    correlationId: 'corr-286',
    requestId: 'request-286',
    traceId: '0123456789abcdef0123456789abcdef',
    payloadSizeBytes: fixture.calls.pending[0].payloadSizeBytes,
    scheduledFor: new Date(FIXED_NOW),
  });
  assert.match(fixture.calls.pending[0].semanticJobKey, /^jr:v1:[a-f0-9]{64}$/);
  assert.equal(fixture.calls.added[0].envelope.deliveryId, DELIVERY_ID);
  assert.deepEqual(fixture.calls.attached, [{ deliveryId: DELIVERY_ID, jobId: '42' }]);
  assert.deepEqual(fixture.logger.entries[0], {
    level: 'info', event: 'job_enqueued', fields: {
      delivery_id: DELIVERY_ID, tenant_id: 'tenant-one', task_identifier: 'job_runtime.synthetic.v1',
      correlation_id: 'corr-286', trace_id: '0123456789abcdef0123456789abcdef',
    },
  });
  assert.deepEqual(fixture.metrics.increments[0], {
    name: 'job_runtime_enqueue_total', labels: { task: 'job_runtime.synthetic.v1', outcome: 'queued' }, value: undefined,
  });
});

test('application port returns an idempotent duplicate and rejects schedule changes', async () => {
  const duplicate = portFakes({ pending: { created: false, record: deliveryRecord() } });
  assert.deepEqual(await duplicate.port.enqueue(validContext(), validRequest()), duplicate.record);
  assert.equal(duplicate.calls.added.length, 0);
  assert.deepEqual(duplicate.metrics.increments, [
    { name: 'job_runtime_enqueue_total', labels: { task: 'job_runtime.synthetic.v1', outcome: 'duplicate' }, value: undefined },
    { name: 'job_runtime_duplicate_delivery_total', labels: { task: 'job_runtime.synthetic.v1' }, value: undefined },
  ]);
  const conflict = portFakes({
    pending: { created: false, record: deliveryRecord({ scheduledFor: '2026-07-15T12:00:00.000Z' }) },
  });
  await assert.rejects(() => conflict.port.enqueue(validContext(), validRequest()), { code: 'job_schedule_conflict' });
});

test('application port compensates an enqueued job if registry attachment fails', async () => {
  const fixture = portFakes({ attachError: new Error('registry unavailable with token=secret') });
  await assert.rejects(() => fixture.port.enqueue(validContext(), validRequest()), { code: 'job_runtime_unavailable' });
  assert.deepEqual(fixture.calls.compensated, ['42']);
  assert.equal(fixture.calls.failed[0].errorCode, 'job_runtime_unavailable');
  assert.equal(fixture.logger.entries[0].fields.error.message, 'Job runtime is unavailable.');
  assert.deepEqual(fixture.metrics.increments.at(-1), {
    name: 'job_runtime_enqueue_total', labels: { outcome: 'failed' }, value: undefined,
  });
});

test('application port keeps the stable failure when compensation and failure recording also fail', async () => {
  const fixture = portFakes({ attachError: new Error('attach failed') });
  fixture.port.options.adapter.compensate = async () => { throw new Error('compensation failed'); };
  fixture.port.options.registry.markFailed = async () => { throw new Error('record failure'); };
  await assert.rejects(() => fixture.port.enqueue(validContext(), validRequest()), { code: 'job_runtime_unavailable' });
});

test('application port marks a closed failure when Graphile enqueue is unavailable', async () => {
  const fixture = portFakes({ addError: new JobRuntimeError('job_runtime_unavailable') });
  await assert.rejects(() => fixture.port.enqueue(validContext(), validRequest()), { code: 'job_runtime_unavailable' });
  assert.equal(fixture.calls.compensated.length, 0);
  assert.equal(fixture.calls.failed[0].retrying, false);
});

test('application port rejects unsafe identity, tenant mismatch, and invalid schedules', async () => {
  const fixture = portFakes({ authorizeCanonical: async () => false });
  await assert.rejects(() => fixture.port.enqueue(validContext(), validRequest()), {
    code: 'job_payload_invalid', safeDetails: { reason: 'tenant_mismatch' },
  });
  assert.ok(fixture.metrics.increments.some((entry) => entry.name === 'job_runtime_tenant_rejection_total'));
  const safe = portFakes();
  await assert.rejects(() => safe.port.enqueue(validContext({ tenantId: 'BAD TENANT' }), validRequest()), { code: 'job_payload_invalid' });
  await assert.rejects(() => safe.port.enqueue(validContext({ correlationId: 'bad correlation' }), validRequest()), { code: 'job_payload_invalid' });
  await assert.rejects(() => safe.port.enqueue(validContext(), validRequest({ canonicalResource: { type: 'task', id: 'TSK-1' } })), {
    code: 'job_payload_invalid',
  });
  await assert.rejects(() => safe.port.enqueue(validContext(), validRequest({ runAt: 'not-a-date' })), { code: 'job_payload_invalid' });
  await assert.rejects(() => safe.port.enqueue(validContext(), validRequest({ runAt: new Date(FIXED_NOW + 31 * 86400000) })), {
    code: 'job_payload_invalid',
  });
  assert.ok(safe.metrics.increments.some((entry) => entry.name === 'job_runtime_validation_failure_total'));
});

test('application port counts unsupported payload versions without logging raw input', async () => {
  const fixture = portFakes();
  await assert.rejects(() => fixture.port.enqueue(validContext(), validRequest({ version: 2 })), {
    code: 'job_version_unsupported',
  });
  assert.ok(fixture.metrics.increments.some((entry) => entry.name === 'job_runtime_unknown_version_total'));
  assert.equal(fixture.logger.entries[0].event, 'job_enqueue_rejected');
  assert.equal(JSON.stringify(fixture.logger.entries).includes('probe-286'), false);
});

test('application port rejects and counts tasks outside the allowlisted catalog', async () => {
  const fixture = portFakes();
  await assert.rejects(() => fixture.port.enqueue(validContext(), validRequest({ task: 'arbitrary.execute' })), {
    code: 'job_task_unknown',
  });
  assert.deepEqual(fixture.metrics.increments.map((entry) => entry.name), [
    'job_runtime_validation_failure_total', 'job_runtime_unknown_task_total',
  ]);
});

test('envelope and schedule helpers copy only application-owned fields', () => {
  const catalog = createTaskCatalog();
  const envelope = createEnvelope(validContext(), validRequest(), catalog.resolve('job_runtime.synthetic', 1), DELIVERY_ID);
  assert.deepEqual(envelope, envelopeFixture);
  assert.equal(scheduleDate(null, { now: () => FIXED_NOW }).toISOString(), new Date(FIXED_NOW).toISOString());
  assert.equal(scheduleDate(new Date(FIXED_NOW), { now: () => FIXED_NOW }).toISOString(), new Date(FIXED_NOW).toISOString());
  assert.equal(scheduleDate(new Date(FIXED_NOW - 1_000), { now: () => FIXED_NOW }).toISOString(), new Date(FIXED_NOW - 1_000).toISOString());
  assert.equal(scheduleDate(new Date(FIXED_NOW + 30 * 86400000), { now: () => FIXED_NOW }).toISOString(),
    new Date(FIXED_NOW + 30 * 86400000).toISOString());
  assert.throws(() => scheduleDate(new Date(FIXED_NOW + 30 * 86400000 + 1), { now: () => FIXED_NOW }), {
    code: 'job_payload_invalid', safeDetails: { reason: 'schedule' },
  });
  assert.throws(() => scheduleDate(new Date(FIXED_NOW - 2_000), { now: () => FIXED_NOW }), { code: 'job_payload_invalid' });
  assert.equal(
    scheduleDate(new Date(FIXED_NOW - 2_000), { now: () => FIXED_NOW }, { allowPast: true }).toISOString(),
    new Date(FIXED_NOW - 2_000).toISOString(),
  );
  const minimal = createEnvelope({ tenantId: 'tenant-one', correlationId: 'corr-minimal' }, validRequest(),
    catalog.resolve('job_runtime.synthetic', 1), DELIVERY_ID);
  assert.deepEqual(minimal.correlation, { correlationId: 'corr-minimal' });
});

test('application port accepts an exact semantic replay after its schedule has passed', async () => {
  const fixture = portFakes();
  const existing = deliveryRecord({ scheduledFor: new Date(FIXED_NOW - 5_000).toISOString() });
  fixture.port.options.registry.findBySemanticKey = async () => existing;
  const result = await fixture.port.enqueue(validContext(), validRequest({ runAt: existing.scheduledFor }));
  assert.equal(result.deliveryId, existing.deliveryId);
  assert.equal(fixture.calls.pending.length, 0);
  assert.equal(fixture.calls.added.length, 0);
});

test('application port default identity and authorization factories accept only same-workload synthetic probes', async () => {
  const fixture = portFakes();
  const port = createJobRuntimePort({
    ...fixture.port.options,
    idGenerator: undefined,
    authorizeCanonical: undefined,
  });
  await port.enqueue(validContext(), validRequest());
  assert.match(fixture.calls.pending[0].deliveryId, /^[0-9a-f-]{36}$/);
  await assert.rejects(() => port.enqueue(validContext(), validRequest({
    canonicalResource: { type: 'synthetic', id: 'different-probe' },
  })), { code: 'job_payload_invalid' });
});

function handlerFakes(overrides = {}) {
  const calls = { running: [], acknowledged: [], failed: [] };
  const registry = {
    async markRunning(input) { calls.running.push(input); return deliveryRecord({ status: 'running' }); },
    async markAcknowledged(id) { calls.acknowledged.push(id); },
    async markFailed(id, input) { calls.failed.push({ id, ...input }); },
  };
  const logger = captureLogger();
  const metrics = metricRecorder();
  const options = {
    catalog: syntheticCatalog(),
    validator: createPayloadValidator(),
    registry,
    logger,
    metrics,
    clock: overrides.clock || { now: (() => { let now = 100; return () => { now += 10; return now; }; })() },
    handlers: overrides.handlers,
    timers: overrides.timers,
  };
  return { taskList: buildTaskList(options), calls, logger, metrics };
}

function graphileHelpers(overrides = {}) {
  return {
    job: { id: '42', attempts: 1, max_attempts: 3 },
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

test('handler wrapper provides an application context and records delivery acknowledgment', async () => {
  let received;
  const fixture = handlerFakes({ handlers: {
    'job_runtime.synthetic.v1': async (data, context) => { received = { data, context }; },
  } });
  await fixture.taskList['job_runtime.synthetic.v1'](envelopeFixture, graphileHelpers());
  assert.equal(received.context.deliveryId, DELIVERY_ID);
  assert.equal(received.context.job, undefined);
  assert.equal(received.data.probeId, 'probe-286');
  assert.equal(fixture.calls.running[0].graphileJobId, '42');
  assert.deepEqual(fixture.calls.acknowledged, [DELIVERY_ID]);
  assert.deepEqual(fixture.metrics.increments, [
    { name: 'job_runtime_claim_total', labels: { task: 'job_runtime.synthetic.v1' }, value: undefined },
    { name: 'job_runtime_finish_total', labels: { task: 'job_runtime.synthetic.v1', outcome: 'acknowledged' }, value: undefined },
  ]);
  assert.deepEqual(fixture.metrics.observations, [
    { name: 'job_runtime_ready_to_start_ms', value: 0, labels: { task: 'job_runtime.synthetic.v1' } },
    { name: 'job_runtime_duration_ms', value: 10, labels: { task: 'job_runtime.synthetic.v1' } },
  ]);
  const logFields = {
    delivery_id: DELIVERY_ID, tenant_id: 'tenant-one', task_identifier: 'job_runtime.synthetic.v1',
    workload_id: 'probe-286', request_id: 'request-286',
    correlation_id: 'corr-286', trace_id: '0123456789abcdef0123456789abcdef',
  };
  assert.deepEqual(fixture.logger.entries, [
    { level: 'info', event: 'job_delivery_started', fields: { ...logFields, attempt: 1 } },
    { level: 'info', event: 'job_delivery_acknowledged', fields: logFields },
  ]);
});

test('handler wrapper records retry and terminal delivery failures with stable codes', async () => {
  const handler = async () => { throw new Error('password=should-not-leak'); };
  const retry = handlerFakes({ handlers: { 'job_runtime.synthetic.v1': handler } });
  await assert.rejects(() => retry.taskList['job_runtime.synthetic.v1'](envelopeFixture, graphileHelpers()), {
    code: 'job_runtime_unavailable',
  });
  assert.equal(retry.calls.failed[0].retrying, true);
  assert.equal(retry.logger.entries.at(-1).fields.error.message, 'Job runtime is unavailable.');
  assert.deepEqual(retry.metrics.increments.map(({ name, labels }) => ({ name, labels })), [
    { name: 'job_runtime_claim_total', labels: { task: 'job_runtime.synthetic.v1' } },
    { name: 'job_runtime_retry_total', labels: { task: 'job_runtime.synthetic.v1' } },
  ]);
  const terminal = handlerFakes({ handlers: { 'job_runtime.synthetic.v1': handler } });
  const helpers = graphileHelpers({ job: { id: '42', attempts: 3, max_attempts: 3 } });
  assert.deepEqual(await terminal.taskList['job_runtime.synthetic.v1'](envelopeFixture, helpers), {
    acknowledged: true, terminal: true, code: 'job_runtime_unavailable',
  });
  assert.equal(terminal.calls.failed[0].retrying, false);
  assert.ok(terminal.metrics.increments.some((entry) => entry.name === 'job_runtime_fail_total'));
});

test('handler wrapper acknowledges explicit non-retryable business outcomes without redelivery', async () => {
  const handler = async () => {
    throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'tenant_mismatch' } });
  };
  const fixture = handlerFakes({ handlers: { 'job_runtime.synthetic.v1': handler } });
  const result = await fixture.taskList['job_runtime.synthetic.v1'](envelopeFixture, graphileHelpers());
  assert.deepEqual(result, { acknowledged: true, terminal: true, code: 'job_payload_invalid' });
  assert.equal(fixture.calls.failed[0].retrying, false);
  assert.ok(fixture.metrics.increments.some((entry) => entry.name === 'job_runtime_tenant_rejection_total'));
  assert.deepEqual(fixture.metrics.increments.map((entry) => entry.name), [
    'job_runtime_claim_total', 'job_runtime_fail_total', 'job_runtime_tenant_rejection_total',
  ]);
});

test('handler policy deterministically rejects pre-cancelled, timed-out, and actively cancelled work', async () => {
  const definition = { timeoutMs: 100 };
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(() => runWithPolicy(async () => {}, {}, { abortSignal: aborted.signal }, definition, {}), {
    code: 'job_runtime_unavailable', retryable: true, safeDetails: { reason: 'cancelled' },
  });

  let timeoutCallback;
  const timeoutController = new AbortController();
  await assert.rejects(() => {
    const promise = runWithPolicy(() => new Promise(() => {}), {}, { abortSignal: timeoutController.signal }, definition, {
      timers: { setTimeout(callback) { timeoutCallback = callback; return 7; }, clearTimeout() {} },
    });
    timeoutCallback();
    return promise;
  }, { code: 'job_runtime_unavailable', retryable: true, safeDetails: { reason: 'handler_timeout' } });

  const active = new AbortController();
  const cancelled = runWithPolicy(() => new Promise(() => {}), {}, { abortSignal: active.signal }, definition, {});
  active.abort();
  await assert.rejects(() => cancelled, { code: 'job_runtime_unavailable', retryable: true, safeDetails: { reason: 'cancelled' } });
});

test('task executor records timeout and cancellation before requesting redelivery', async () => {
  let timeoutCallback;
  const timeout = handlerFakes({
    handlers: { 'job_runtime.synthetic.v1': () => new Promise(() => {}) },
    timers: { setTimeout(callback) { timeoutCallback = callback; return 1; }, clearTimeout() {} },
  });
  const timedOut = timeout.taskList['job_runtime.synthetic.v1'](envelopeFixture, graphileHelpers());
  await new Promise((resolve) => setImmediate(resolve));
  timeoutCallback();
  await assert.rejects(() => timedOut, { safeDetails: { reason: 'handler_timeout' } });
  assert.ok(timeout.metrics.increments.some((entry) => entry.name === 'job_runtime_timeout_total'));
  assert.equal(timeout.metrics.increments.some((entry) => entry.name === 'job_runtime_cancellation_total'), false);

  const controller = new AbortController();
  const cancelled = handlerFakes({ handlers: { 'job_runtime.synthetic.v1': () => new Promise(() => {}) } });
  const execution = cancelled.taskList['job_runtime.synthetic.v1'](envelopeFixture, graphileHelpers({ abortSignal: controller.signal }));
  controller.abort();
  await assert.rejects(() => execution, { safeDetails: { reason: 'cancelled' } });
  assert.ok(cancelled.metrics.increments.some((entry) => entry.name === 'job_runtime_cancellation_total'));
  assert.equal(cancelled.metrics.increments.some((entry) => entry.name === 'job_runtime_timeout_total'), false);
});

test('handler wrapper rejects invalid execution payload before registry or handler access', async () => {
  const fixture = handlerFakes();
  const invalid = { ...envelopeFixture, data: { probeId: 'bad id', token: 'forbidden' } };
  await assert.rejects(() => fixture.taskList['job_runtime.synthetic.v1'](invalid, graphileHelpers()), { code: 'job_payload_invalid' });
  assert.equal(fixture.calls.running.length, 0);
  assert.equal(fixture.metrics.increments[0].name, 'job_runtime_validation_failure_total');
  assert.deepEqual(fixture.metrics.increments[0].labels, { task: 'job_runtime.synthetic.v1' });
  assert.deepEqual(fixture.logger.entries[0], {
    level: 'error', event: 'job_execution_rejected', fields: {
      task_identifier: 'job_runtime.synthetic.v1',
      error: {
        code: 'job_payload_invalid', message: 'Job payload was rejected.', retryable: false,
        details: { reason: 'secret_like_content' },
      },
    },
  });
});

test('synthetic task retries exactly once and application context is immutable', async () => {
  const fixture = handlerFakes();
  const payload = { ...envelopeFixture, data: { probeId: 'probe-286', expectedOutcome: 'retry_once' } };
  await assert.rejects(() => fixture.taskList['job_runtime.synthetic.v1'](payload, graphileHelpers()), { code: 'job_runtime_unavailable' });
  await fixture.taskList['job_runtime.synthetic.v1'](payload, graphileHelpers({ job: { id: '42', attempts: 2, max_attempts: 3 } }));
  const context = applicationContext(envelopeFixture, graphileHelpers());
  assert.equal(Object.isFrozen(context), true);
});

test('task-list construction fails closed when an allowlisted handler is missing', () => {
  const catalog = createTaskCatalog([{ ...createTaskCatalog().resolve('job_runtime.synthetic', 1), identifier: 'another.v1' }]);
  assert.throws(() => buildTaskList({ catalog, handlers: {}, validator: createPayloadValidator() }), { code: 'job_task_unknown' });
});
