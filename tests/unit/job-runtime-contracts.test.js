'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const envelopeFixture = require('../fixtures/job-runtime/v1-valid-envelope.json');
const { runtimeConfig, boolean, integer } = require('../../lib/job-runtime/config');
const {
  ERROR_DEFINITIONS,
  JobRuntimeError,
  asJobRuntimeError,
  sanitizedError,
} = require('../../lib/job-runtime/errors');
const { createJobRuntimeLogger, createMetricSink } = require('../../lib/job-runtime/observability');
const { createPayloadValidator, jsonDepthAndShape } = require('../../lib/job-runtime/payload-schema');
const { assertConcurrencyPolicy, queueLane, schedulingPolicy, semanticJobKey } = require('../../lib/job-runtime/policies');
const { findSecretPath, isSecretLikeKey, isSecretLikeValue, redact } = require('../../lib/job-runtime/redaction');
const { createTaskCatalog } = require('../../lib/job-runtime/task-catalog');

const catalog = createTaskCatalog();
const definition = catalog.resolve('job_runtime.synthetic', 1);

test('versioned catalog resolves only allowlisted task versions', () => {
  assert.equal(definition.identifier, 'job_runtime.synthetic.v1');
  assert.deepEqual(catalog.identifiers, [
    'job_runtime.synthetic.v1',
    'factory.langgraph.start.v1',
    'factory.langgraph.resume.v1',
    'audit.projection.catch_up.v1',
    'audit.outbox.deliver.v1',
    'maintenance.sre_monitoring.expire.v1',
    'maintenance.factory.reconcile.v1',
    'maintenance.job_runtime.prune.v1',
  ]);
  assert.equal(catalog.resolveIdentifier(definition.identifier).queue, 'job-runtime-synthetic');
  assert.throws(() => catalog.resolve('unknown.task', 1), { code: 'job_task_unknown' });
  assert.throws(() => catalog.resolve('job_runtime.synthetic', 2), { code: 'job_version_unsupported' });
  assert.throws(() => catalog.resolveIdentifier('unknown.v1'), { code: 'job_task_unknown' });
});

test('every workload has a strict v1 handler contract and complete delivery policy', () => {
  const validData = {
    'job_runtime.synthetic.v1': { probeId: 'probe-287', expectedOutcome: 'acknowledge' },
    'factory.langgraph.start.v1': { runId: 'run-1', taskId: 'TSK-1', threadId: 'thread-1', workflowVersion: 2 },
    'factory.langgraph.resume.v1': {
      runId: 'run-1', taskId: 'TSK-1', threadId: 'thread-1', workflowVersion: 2, checkpointVersion: 3,
    },
    'audit.projection.catch_up.v1': { occurrenceId: 'projection:1000', batchSize: 100 },
    'audit.outbox.deliver.v1': { occurrenceId: 'outbox:1000', batchSize: 100 },
    'maintenance.sre_monitoring.expire.v1': { occurrenceId: 'sre:1000', batchSize: 100 },
    'maintenance.factory.reconcile.v1': { occurrenceId: 'factory:1000' },
    'maintenance.job_runtime.prune.v1': { occurrenceId: 'retention:1000' },
  };
  const validator = createPayloadValidator();
  for (const identifier of catalog.identifiers) {
    const task = catalog.resolveIdentifier(identifier);
    const envelope = {
      ...envelopeFixture,
      task: task.name,
      workloadId: `contract-${identifier.replace(/[^a-z0-9]+/gi, '-')}`,
      data: validData[identifier],
    };
    assert.equal(validator.validate(envelope, task).envelope, envelope, identifier);
    assert.throws(() => validator.validate({ ...envelope, data: { ...validData[identifier], token: 'forbidden' } }, task), {
      code: 'job_payload_invalid',
    }, identifier);
    assert.equal(task.handlerVersion, 1);
    assert.match(task.queue, /^[a-z][a-z0-9-]+$/);
    assert.ok(task.concurrency.lanes >= 1 && task.concurrency.lanes <= 32);
    assert.ok(task.timeoutMs >= 30_000);
    assert.match(task.retry.backoff, /^graphile_/);
    assert.ok(task.retry.maxAttempts >= 1 && task.retry.maxAttempts <= 10);
    assert.equal(task.cancellation, 'retry_if_effect_unconfirmed');
    assert.equal(task.gracefulShutdown, 'finish_until_deadline_then_reconcile');
  }
});

test('catalog rejects duplicate names, versions, and identifiers', () => {
  const duplicate = { ...definition };
  assert.throws(() => createTaskCatalog([definition, duplicate]), /Duplicate/);
  assert.throws(() => createTaskCatalog([definition, { ...definition, name: 'different.task' }]), /Duplicate/);
  assert.throws(() => createTaskCatalog([{ ...definition, schema: null }]), /Incomplete/);
  assert.throws(() => createTaskCatalog([{ ...definition, timeoutMs: 'forever' }]), /Invalid/);
});

test('strict payload validator accepts the versioned fixture', () => {
  const result = createPayloadValidator().validate(envelopeFixture, definition);
  assert.equal(result.envelope, envelopeFixture);
  assert.ok(result.bytes > 100);
});

test('envelope schema requires every identity and correlation field', () => {
  const validator = createPayloadValidator();
  for (const field of ['catalogVersion', 'deliveryId', 'task', 'version', 'tenantId', 'workloadId', 'correlation', 'data']) {
    const candidate = structuredClone(envelopeFixture);
    delete candidate[field];
    assert.throws(() => validator.validate(candidate, definition), {
      code: 'job_payload_invalid', safeDetails: { reason: 'envelope_schema' },
    });
  }
  const missingCorrelation = structuredClone(envelopeFixture);
  delete missingCorrelation.correlation.correlationId;
  assert.throws(() => validator.validate(missingCorrelation, definition), {
    code: 'job_payload_invalid', safeDetails: { reason: 'envelope_schema' },
  });
});

test('envelope schema enforces exact versioned identifier formats', () => {
  const validator = createPayloadValidator();
  const invalidValues = [
    ['catalogVersion', 2],
    ['deliveryId', `prefix-${envelopeFixture.deliveryId}`],
    ['task', 'X'],
    ['version', 0],
    ['version', 1000],
    ['tenantId', 'A'],
    ['workloadId', 'contains space'],
  ];
  for (const [field, value] of invalidValues) {
    assert.throws(() => validator.validate({ ...envelopeFixture, [field]: value }, definition), {
      code: 'job_payload_invalid', safeDetails: { reason: 'envelope_schema' },
    });
  }
  assert.throws(() => validator.validate({
    ...envelopeFixture,
    correlation: { correlationId: 'corr-286', extra: true },
  }, definition), { code: 'job_payload_invalid', safeDetails: { reason: 'envelope_schema' } });
  assert.throws(() => validator.validate({
    ...envelopeFixture,
    correlation: { correlationId: 'corr-286', traceId: 'not-hex' },
  }, definition), { code: 'job_payload_invalid', safeDetails: { reason: 'envelope_schema' } });
});

test('payload validator rejects secret, schema, shape, depth, and size violations', () => {
  const validator = createPayloadValidator();
  assert.throws(() => validator.validate({ ...envelopeFixture, data: { probeId: 'ok', token: 'abc' } }, definition), {
    code: 'job_payload_invalid', safeDetails: { reason: 'secret_like_content' },
  });
  assert.throws(() => validator.validate({ ...envelopeFixture, extra: true }, definition), {
    code: 'job_payload_invalid', safeDetails: { reason: 'envelope_schema' },
  });
  assert.throws(() => validator.validate({ ...envelopeFixture, data: { probeId: 'bad id!' } }, definition), {
    code: 'job_payload_invalid', safeDetails: { reason: 'task_schema' },
  });
  const cyclic = { ...envelopeFixture, data: { probeId: 'ok' } };
  cyclic.data.cyclic = cyclic;
  assert.throws(() => validator.validate(cyclic, definition), { code: 'job_payload_invalid' });
  const small = createPayloadValidator({ maxBytes: 100 });
  assert.throws(() => small.validate(envelopeFixture, definition), {
    code: 'job_payload_invalid', safeDetails: { reason: 'payload_too_large' },
  });
});

test('JSON shape guard rejects unsupported values and excessive arrays or depth', () => {
  assert.equal(jsonDepthAndShape({ safe: [1, true, null, 'x'] }), true);
  assert.equal(jsonDepthAndShape(Array.from({ length: 100 }, () => 1)), true);
  assert.equal(jsonDepthAndShape([1, undefined]), false);
  assert.equal(jsonDepthAndShape({ valid: 1, invalid: undefined }), false);
  assert.equal(jsonDepthAndShape({ invalid: Number.POSITIVE_INFINITY }), false);
  assert.equal(jsonDepthAndShape({ invalid: undefined }), false);
  assert.equal(jsonDepthAndShape({ invalid: new Date() }), false);
  assert.equal(jsonDepthAndShape({ invalid: Array.from({ length: 101 }, () => 1) }), false);
  let deep = {};
  for (let index = 0; index < 10; index += 1) deep = { deep };
  assert.equal(jsonDepthAndShape(deep), false);
  let maximumDepth = 'leaf';
  for (let index = 0; index < 8; index += 1) maximumDepth = { nested: maximumDepth };
  assert.equal(jsonDepthAndShape(maximumDepth), true);
});

test('payload byte limit is exclusive only above the configured maximum', () => {
  const serializedBytes = Buffer.byteLength(JSON.stringify(envelopeFixture), 'utf8');
  assert.equal(createPayloadValidator({ maxBytes: serializedBytes }).validate(envelopeFixture, definition).bytes, serializedBytes);
  assert.throws(() => createPayloadValidator({ maxBytes: serializedBytes - 1 }).validate(envelopeFixture, definition), {
    code: 'job_payload_invalid', safeDetails: { reason: 'payload_too_large' },
  });
});

test('synthetic task schema requires a bounded probe and allowlisted outcome', () => {
  const validator = createPayloadValidator();
  for (const data of [
    {},
    { probeId: 'probe-286', extra: true },
    { probeId: 'probe-286', expectedOutcome: 'execute-command' },
  ]) {
    assert.throws(() => validator.validate({ ...envelopeFixture, data }, definition), {
      code: 'job_payload_invalid', safeDetails: { reason: 'task_schema' },
    });
  }
});

test('secret detection and redaction cover keys, values, arrays, and cycles', () => {
  assert.equal(isSecretLikeKey('databaseUrl'), true);
  assert.equal(isSecretLikeValue('Bearer abcdefghijklmnop'), true);
  assert.equal(findSecretPath({ nested: { password: 'value' } }), '$.nested.password');
  assert.equal(findSecretPath({ safe: 'value' }), null);
  assert.deepEqual(redact({ token: 'abc', safe: ['postgres://host/db', 'ok'] }), {
    token: '[REDACTED]', safe: ['[REDACTED]', 'ok'],
  });
  const cyclic = {};
  cyclic.self = cyclic;
  assert.deepEqual(redact(cyclic), { self: '[REDACTED]' });
});

test('semantic key and scheduling policies are deterministic and bounded', () => {
  const input = {
    tenantId: 'tenant-one', task: definition.name, version: 1, workloadId: 'probe-286',
    canonicalResourceType: 'synthetic', canonicalResourceId: 'probe-286',
  };
  const key = semanticJobKey(input);
  assert.match(key, /^jr:v1:[a-f0-9]{64}$/);
  assert.equal(semanticJobKey({ ...input }), key);
  assert.notEqual(semanticJobKey({ ...input, workloadId: 'probe-287' }), key);
  assert.deepEqual(schedulingPolicy(definition), { queueName: 'job-runtime-synthetic', maxAttempts: 3, priority: 0 });
  assert.throws(() => semanticJobKey({ ...input, tenantId: '' }), { code: 'job_payload_invalid' });
  assert.throws(() => schedulingPolicy({ ...definition, queue: 'dynamic:queue' }), { code: 'job_payload_invalid' });
  assert.throws(() => schedulingPolicy({ ...definition, retry: { maxAttempts: 11, priority: 0 } }), { code: 'job_payload_invalid' });
  assert.throws(() => schedulingPolicy({ ...definition, retry: { maxAttempts: 2, priority: 11 } }), { code: 'job_payload_invalid' });
  assert.deepEqual(schedulingPolicy({ ...definition, retry: { maxAttempts: 1, priority: -10 } }), {
    queueName: definition.queue, maxAttempts: 1, priority: -10,
  });
  assert.deepEqual(schedulingPolicy({ ...definition, retry: { maxAttempts: 10, priority: 10 } }), {
    queueName: definition.queue, maxAttempts: 10, priority: 10,
  });
  for (const retry of [
    { maxAttempts: 0, priority: 0 },
    { maxAttempts: 1.5, priority: 0 },
    { maxAttempts: 1, priority: -11 },
    { maxAttempts: 1, priority: 1.5 },
  ]) assert.throws(() => schedulingPolicy({ ...definition, retry }), { code: 'job_payload_invalid' });
  const factory = catalog.resolve('factory.langgraph.start', 1);
  const lane = queueLane(factory, 'tenant-one:factory_run:run-1');
  assert.equal(lane, 'factory-workflow');
  assert.equal(queueLane(factory, 'tenant-one:factory_run:run-1'), lane);
  assert.equal(queueLane(factory), 'factory-workflow');
  for (const lanes of [0.5, 33]) {
    assert.throws(() => queueLane({ ...factory, concurrency: { lanes } }, 'ordering'), {
      safeDetails: { reason: 'queue_policy' },
    });
  }
  assert.equal(queueLane({ queue: 'single-queue' }, null), 'single-queue');
  assert.throws(() => schedulingPolicy({ ...definition, retry: null }), {
    safeDetails: { reason: 'retry_policy' },
  });
});

test('concurrency and runtime configuration reserve pool capacity and reject percentage flags', () => {
  assert.deepEqual(assertConcurrencyPolicy({ concurrency: 4, poolMax: 10, reservedConnections: 4 }), {
    concurrency: 4, poolMax: 10, reservedConnections: 4, available: 6,
  });
  assert.throws(() => assertConcurrencyPolicy({ concurrency: 7, poolMax: 10, reservedConnections: 4 }), { code: 'job_runtime_unavailable' });
  assert.throws(() => assertConcurrencyPolicy({ concurrency: 1.5, poolMax: 10, reservedConnections: 4 }), { code: 'job_runtime_unavailable' });
  assert.deepEqual(assertConcurrencyPolicy({ concurrency: 1, poolMax: 3, reservedConnections: 2 }), {
    concurrency: 1, poolMax: 3, reservedConnections: 2, available: 1,
  });
  assert.throws(() => assertConcurrencyPolicy({ concurrency: 0, poolMax: 3, reservedConnections: 2 }), { code: 'job_runtime_unavailable' });
  assert.throws(() => assertConcurrencyPolicy({ concurrency: 1, poolMax: 2, reservedConnections: 1 }), { code: 'job_runtime_unavailable' });
  assert.equal(boolean('on', false), true);
  assert.equal(boolean('OFF', true), false);
  assert.equal(boolean('', true), true);
  assert.throws(() => boolean('25%', false), { code: 'job_runtime_unavailable' });
  assert.equal(integer('5', 1, { min: 1, max: 10 }), 5);
  assert.equal(integer('', 3, { min: 1, max: 10 }), 3);
  assert.throws(() => integer('11', 1, { min: 1, max: 10 }), { code: 'job_runtime_unavailable' });
  const config = runtimeConfig({}, { FF_GRAPHILE_WORKER_CUTOVER: 'false', PGPOOL_MAX: '10' });
  assert.equal(config.claimsEnabled, false);
  assert.equal(config.poolBudget.reservedConnections, 4);
  assert.equal(config.retentionDays, 30);
  assert.equal(config.retentionBatch, 1000);
  assert.equal(config.retentionIntervalMs, 3_600_000);
  assert.throws(() => runtimeConfig({ production: true, claimsEnabled: true, concurrency: 4, poolMax: 10, reservedConnections: 4 }, {}), {
    code: 'job_runtime_unavailable', safeDetails: { reason: 'ownership_epoch_required' },
  });
  assert.equal(runtimeConfig({ production: true, claimsEnabled: true, concurrency: 4, poolMax: 10, reservedConnections: 4, ownershipEpoch: '98f48812-7aa6-4ce8-9e88-184ba4bcbb52' }, {}).claimsEnabled, true);
  assert.throws(() => runtimeConfig({ claimsEnabled: true, concurrency: 3, poolMax: 10, reservedConnections: 4 }), {
    code: 'job_runtime_unavailable', safeDetails: { reason: 'fair_concurrency' },
  });
  assert.throws(() => runtimeConfig({ claimsEnabled: true, concurrency: 5, poolMax: 12, reservedConnections: 4 }), {
    code: 'job_runtime_unavailable', safeDetails: { reason: 'fair_concurrency' },
  });
});

test('stable errors expose only sanitized codes and safe details', () => {
  const cause = new Error('postgres://user:password@host/database');
  const error = new JobRuntimeError('job_task_unknown', { cause, safeDetails: { task: 'unknown' } });
  assert.equal(error.message, 'Job task is not registered.');
  assert.deepEqual(sanitizedError(error), {
    code: 'job_task_unknown', message: 'Job task is not registered.', retryable: false, details: { task: 'unknown' },
  });
  assert.equal(asJobRuntimeError(cause).code, 'job_runtime_unavailable');
  assert.equal(new JobRuntimeError('not_real').code, 'job_runtime_unavailable');
  assert.equal(asJobRuntimeError(cause, 'job_payload_invalid').code, 'job_payload_invalid');
  assert.equal(asJobRuntimeError(error), error);
  assert.equal(error.name, 'JobRuntimeError');
  assert.equal(error.cause, cause);
});

test('stable error catalog preserves exact public message and retry semantics', () => {
  const expected = {
    job_action_conflict: ['Job action conflicts with the current delivery state.', false],
    job_action_forbidden: ['Job action is not permitted.', false],
    job_not_found: ['Job delivery was not found.', false],
    job_payload_invalid: ['Job payload was rejected.', false],
    job_runtime_unavailable: ['Job runtime is unavailable.', true],
    job_schedule_conflict: ['Job schedule conflicts with an existing delivery.', false],
    job_task_unknown: ['Job task is not registered.', false],
    job_version_unsupported: ['Job payload version is unsupported.', false],
  };
  assert.deepEqual(ERROR_DEFINITIONS, expected);
  for (const [code, [message, retryable]] of Object.entries(expected)) {
    const error = new JobRuntimeError(code);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    assert.equal(error.retryable, retryable);
  }
  assert.equal(new JobRuntimeError('job_payload_invalid', { retryable: true }).retryable, true);
});

test('structured logger redacts and metric sink records counters and observations', () => {
  const entries = [];
  const logger = createJobRuntimeLogger({ logger: {
    info(payload) { entries.push(payload); },
    error(payload) { entries.push(payload); },
  } });
  logger.info('safe_event', { token: 'forbidden', correlation_id: 'corr-286' });
  logger.error('safe_error', { password: 'forbidden' });
  assert.equal(entries[0].token, '[REDACTED]');
  assert.equal(entries[0].correlation_id, 'corr-286');
  assert.equal(entries[1].password, '[REDACTED]');
  const metrics = createMetricSink();
  metrics.increment('enqueue', { outcome: 'ok' });
  metrics.increment('enqueue', { outcome: 'ok' }, 2);
  metrics.observe('latency', 12, { task: 'synthetic' });
  metrics.gauge('queue_depth', 4, { queue: 'synthetic' });
  metrics.gauge('queue_depth', 2, { queue: 'synthetic' });
  const snapshot = metrics.snapshot();
  assert.equal(Object.values(snapshot.counters)[0], 3);
  assert.deepEqual(Object.values(snapshot.observations)[0], [12]);
  assert.equal(Object.values(snapshot.gauges)[0], 2);
});
