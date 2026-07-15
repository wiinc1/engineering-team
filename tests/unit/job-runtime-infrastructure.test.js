'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { captureLogger, deliveryRecord, metricRecorder } = require('../fixtures/job-runtime/v1');
const { createGraphileAdapter, graphileLogger } = require('../../lib/job-runtime/graphile-adapter');
const { createJobRuntimeInfrastructure } = require('../../lib/job-runtime');
const { ensurePoolErrorHandler } = require('../../lib/job-runtime/pool');
const {
  DEFAULT_ROLES,
  applyLeastPrivilegeGrants,
  grantStatements,
  quoteIdentifier,
  requireRoles,
  verifyJobRuntimePrivileges,
} = require('../../lib/job-runtime/postgres-roles');
const { createDeliveryRegistry, normalizeRecord } = require('../../lib/job-runtime/registry');
const { attachWorkerEvents, createJobRuntime, poolSummary } = require('../../lib/job-runtime/runtime');

function databaseRow(overrides = {}) {
  const record = deliveryRecord();
  return {
    delivery_id: record.deliveryId,
    tenant_id: record.tenantId,
    workload_id: record.workloadId,
    semantic_job_key: record.semanticJobKey,
    task_identifier: record.taskIdentifier,
    task_name: record.task,
    payload_version: record.version,
    graphile_job_id: record.graphileJobId,
    named_queue: record.queue,
    status: record.status,
    attempt_count: record.attemptCount,
    scheduled_for: record.scheduledFor,
    correlation_id: record.correlationId,
    trace_id: record.traceId,
    ...overrides,
  };
}

function queuedPool(responses) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response || { rows: [] };
    },
  };
}

test('delivery registry normalizes and finds an application-owned record', async () => {
  assert.equal(normalizeRecord(null), null);
  const row = databaseRow();
  assert.deepEqual(normalizeRecord(row), deliveryRecord());
  const pool = queuedPool([{ rows: [row] }]);
  const registry = createDeliveryRegistry(pool);
  assert.deepEqual(await registry.findBySemanticKey('tenant-one', 'jr:v1:fixture'), deliveryRecord());
  assert.match(pool.queries[0].sql, /job_runtime\.job_delivery_registry/);
  const byId = createDeliveryRegistry(queuedPool([{ rows: [row] }]));
  assert.deepEqual(await byId.findByDeliveryId(row.delivery_id), deliveryRecord());
});

test('delivery registry creates a pending record or returns the semantic duplicate', async () => {
  const row = databaseRow({ graphile_job_id: null, status: 'pending_enqueue' });
  const input = {
    deliveryId: row.delivery_id, tenantId: row.tenant_id, workloadId: row.workload_id,
    semanticJobKey: row.semantic_job_key, taskIdentifier: row.task_identifier, task: row.task_name,
    version: 1, catalogVersion: 1, queue: row.named_queue, maxAttempts: 3, priority: 0,
    canonicalResourceType: 'synthetic', canonicalResourceId: 'probe-286', correlationId: row.correlation_id,
    payloadSizeBytes: 200, scheduledFor: new Date(row.scheduled_for),
  };
  const created = createDeliveryRegistry(queuedPool([{ rows: [row] }]));
  assert.equal((await created.createPending(input)).created, true);
  const duplicate = createDeliveryRegistry(queuedPool([{ rows: [] }, { rows: [row] }]));
  const duplicateResult = await duplicate.createPending(input);
  assert.equal(duplicateResult.created, false);
  assert.equal(duplicateResult.record.status, 'pending_enqueue');
});

test('delivery registry transitions queued, running, acknowledged, retrying, and failed states', async () => {
  const rows = [
    databaseRow({ status: 'queued' }),
    databaseRow({ status: 'running', attempt_count: 1 }),
    databaseRow({ status: 'delivery_acknowledged' }),
    databaseRow({ status: 'redelivery_pending' }),
    databaseRow({ status: 'delivery_failed' }),
    { delivery_id: '00000000-0000-4000-8000-000000000287' },
    { status: 'delivery_acknowledged', count: 2 },
    { queue_depth: 3, oldest_age_seconds: 1.25 },
  ];
  const registry = createDeliveryRegistry(queuedPool(rows.map((row) => ({ rows: [row] }))));
  assert.equal((await registry.attachGraphileJob(rows[0].delivery_id, '42')).status, 'queued');
  assert.equal((await registry.markRunning({ deliveryId: rows[0].delivery_id, tenantId: 'tenant-one', graphileJobId: '42', attemptCount: 1 })).status, 'running');
  assert.equal((await registry.markAcknowledged(rows[0].delivery_id)).status, 'delivery_acknowledged');
  assert.equal((await registry.markFailed(rows[0].delivery_id, { retrying: true, errorCode: 'job_runtime_unavailable' })).status, 'redelivery_pending');
  assert.equal((await registry.markFailed(rows[0].delivery_id, { retrying: false, errorCode: 'job_runtime_unavailable' })).status, 'delivery_failed');
  assert.equal(await registry.markRunningForRedelivery(), 1);
  assert.deepEqual(await registry.summarizeCorrelationPrefix('load_%'), { delivery_acknowledged: 2 });
  assert.deepEqual(await registry.operationalMetrics(), { queueDepth: 3, oldestAgeSeconds: 1.25 });
});

test('delivery registry fails closed for invalid transitions and missing schema', async () => {
  const attach = createDeliveryRegistry(queuedPool([{ rows: [] }]));
  await assert.rejects(() => attach.attachGraphileJob('00000000-0000-4000-8000-000000000286', '42'), { code: 'job_schedule_conflict' });
  const running = createDeliveryRegistry(queuedPool([{ rows: [] }]));
  await assert.rejects(() => running.markRunning({ deliveryId: 'x', tenantId: 't', graphileJobId: '1', attemptCount: 1 }), {
    code: 'job_schedule_conflict',
  });
  const acknowledged = createDeliveryRegistry(queuedPool([{ rows: [] }]));
  await assert.rejects(() => acknowledged.markAcknowledged('x'), { code: 'job_schedule_conflict' });
  const missing = createDeliveryRegistry(queuedPool([{ rows: [{ present: false }] }]));
  await assert.rejects(() => missing.verifySchema(), { code: 'job_runtime_unavailable' });
  const present = createDeliveryRegistry(queuedPool([{ rows: [{ present: true }] }]));
  assert.equal(await present.verifySchema(), true);
});

test('delivery registry retention prunes only bounded terminal records', async () => {
  const cutoff = new Date('2026-06-14T12:00:00.000Z');
  const pool = queuedPool([{ rows: [{ delivery_id: 'one' }, { delivery_id: 'two' }] }]);
  const registry = createDeliveryRegistry(pool);
  assert.equal(await registry.pruneTerminalBefore(cutoff, 1000), 2);
  assert.deepEqual(pool.queries[0].params.slice(0, 2), ['delivery_acknowledged', 'delivery_failed']);
  assert.deepEqual(pool.queries[0].params.slice(2), [cutoff, 1000]);
  await assert.rejects(() => registry.pruneTerminalBefore(new Date('invalid'), 1), {
    code: 'job_runtime_unavailable', safeDetails: { reason: 'retention_policy' },
  });
  await assert.rejects(() => registry.pruneTerminalBefore(cutoff, 10_001), { code: 'job_runtime_unavailable' });
});

test('least-privilege grants use validated static roles and no Graphile table names', async () => {
  assert.equal(quoteIdentifier('job_runtime_worker'), '"job_runtime_worker"');
  assert.throws(() => quoteIdentifier('worker; DROP ROLE'), { code: 'job_runtime_unavailable' });
  const statements = grantStatements(DEFAULT_ROLES);
  assert.ok(statements.some((statement) => statement.includes('GRANT SELECT, UPDATE, DELETE ON job_runtime.job_delivery_registry')));
  assert.equal(statements.some((statement) => /graphile_worker\.[a-z_]+/.test(statement)), false);
  const roles = Object.values(DEFAULT_ROLES).map((rolname) => ({ rolname }));
  const pool = queuedPool([{ rows: roles }, ...statements.map(() => ({ rows: [] }))]);
  await applyLeastPrivilegeGrants(pool);
  assert.equal(pool.queries.length, statements.length + 1);
  await assert.rejects(() => requireRoles(queuedPool([{ rows: [] }]), DEFAULT_ROLES), { code: 'job_runtime_unavailable' });
});

test('runtime privilege verification accepts complete grants and rejects partial grants', async () => {
  const allowed = queuedPool([{ rows: [{ graphile_usage: true, registry_usage: true, registry_access: true }] }]);
  assert.equal(await verifyJobRuntimePrivileges(allowed), true);
  const denied = queuedPool([{ rows: [{ graphile_usage: true, registry_usage: false, registry_access: false }] }]);
  await assert.rejects(() => verifyJobRuntimePrivileges(denied), { code: 'job_runtime_unavailable' });
});

test('shared pool and connected clients receive one sanitized error handler', () => {
  const pool = new EventEmitter();
  const client = new EventEmitter();
  const logger = captureLogger();
  const metrics = metricRecorder();
  assert.equal(ensurePoolErrorHandler(pool, logger, metrics), true);
  assert.equal(ensurePoolErrorHandler(pool, logger, metrics), true);
  assert.equal(pool.listenerCount('error'), 1);
  assert.equal(pool.listenerCount('connect'), 1);
  pool.emit('connect', client);
  pool.emit('error', new Error('postgres://credential'));
  client.emit('error', new Error('password=secret'));
  assert.equal(metrics.increments.length, 2);
  assert.equal(JSON.stringify(logger.entries).includes('password=secret'), false);
  assert.equal(ensurePoolErrorHandler({}, logger, metrics), false);
});

class FakeGraphileLogger {
  constructor(factory) { this.factory = factory; }
}

test('Graphile logger drops raw library messages and preserves safe scope fields', () => {
  const logger = captureLogger();
  const graphile = graphileLogger(logger, FakeGraphileLogger);
  graphile.factory({ label: 'Worker', workerId: 'worker-1', taskIdentifier: 'synthetic.v1', jobId: '42' })('warning', 'token=secret');
  graphile.factory({ label: 'Worker' })('info', 'database URL here');
  assert.equal(logger.entries[0].fields.worker_id, 'worker-1');
  assert.equal(JSON.stringify(logger.entries).includes('token=secret'), false);
  assert.equal(logger.entries[1].level, 'info');
});

function fakeWorkerApi() {
  const calls = { migrate: 0, added: [], completed: [], released: 0, runs: [] };
  const utils = {
    async migrate() { calls.migrate += 1; },
    async addJob(...args) { calls.added.push(args); return { id: '42' }; },
    async completeJobs(ids) { calls.completed.push(ids); },
    async release() { calls.released += 1; },
  };
  const api = {
    Logger: FakeGraphileLogger,
    async makeWorkerUtils() { return utils; },
    async run(options) {
      calls.runs.push(options);
      return { promise: new Promise(() => {}), async stop() {}, async kill() {} };
    },
  };
  return { api, calls };
}

test('Graphile adapter uses only public migrate, add, run, stop, kill, and release APIs', async () => {
  const { api, calls } = fakeWorkerApi();
  const logger = captureLogger();
  const adapter = createGraphileAdapter({ pool: {}, schema: 'graphile_worker', logger, workerApi: api });
  await adapter.migrate();
  const definition = { identifier: 'synthetic.v1' };
  assert.equal((await adapter.addJob(definition, { safe: true }, { queueName: 'safe-queue' }, 'jr:v1:key')).id, '42');
  await adapter.compensate('42');
  const fingerprintPool = { async query() { return { rows: [{ relkind: 'r', relname: 'opaque' }] }; } };
  const fingerprintAdapter = createGraphileAdapter({ pool: fingerprintPool, schema: 'graphile_worker', logger, workerApi: api });
  assert.match(await fingerprintAdapter.schemaFingerprint(), /^[a-f0-9]{64}$/);
  assert.equal(await adapter.start({}, { claimsEnabled: false }), null);
  const runner = await adapter.start({}, { claimsEnabled: true, concurrency: 2, pollIntervalMs: 1000, shutdownDeadlineMs: 30000 });
  await runner.stop('test');
  await runner.kill('test');
  await adapter.close();
  assert.equal(calls.migrate, 1);
  assert.deepEqual(calls.completed, [['42']]);
  assert.equal(calls.runs[0].noHandleSignals, true);
  assert.equal(calls.released, 1);
  assert.throws(() => createGraphileAdapter({ logger, schema: 'graphile_worker', workerApi: api }), { code: 'job_runtime_unavailable' });
});

function runtimeFakes(overrides = {}) {
  const calls = { migrate: 0, verify: 0, privilege: 0, stop: 0, kill: 0, close: 0 };
  const runner = overrides.runner === undefined ? null : overrides.runner;
  const adapter = {
    async migrate() { calls.migrate += 1; if (overrides.migrateError) throw overrides.migrateError; },
    async start() { return runner; },
    async close() { calls.close += 1; },
  };
  const pool = {
    options: { max: 10 }, totalCount: 3, idleCount: 2, waitingCount: 0,
    async query() { if (overrides.databaseError) throw overrides.databaseError; return { rows: [{ '?column?': 1 }] }; },
  };
  const registry = {
    async verifySchema() { calls.verify += 1; if (overrides.schemaError) throw overrides.schemaError; },
    async markRunningForRedelivery() {
      calls.redelivery = (calls.redelivery || 0) + 1;
      if (overrides.redeliveryError) throw overrides.redeliveryError;
    },
    async operationalMetrics() { return { queueDepth: 2, oldestAgeSeconds: 0.5 }; },
    ...(overrides.pruneRetention ? { async pruneTerminalBefore(cutoff, limit) {
      calls.prune = [...(calls.prune || []), { cutoff, limit }];
      if (overrides.retentionError) throw overrides.retentionError;
      return 2;
    } } : {}),
  };
  const logger = captureLogger();
  const metrics = metricRecorder();
  const config = {
    claimsEnabled: Boolean(runner), concurrency: 2, pollIntervalMs: 1000, shutdownDeadlineMs: 1000,
    retentionDays: 30, retentionBatch: 1000, retentionIntervalMs: 60_000,
  };
  const runtime = createJobRuntime({
    adapter, pool, registry, logger, metrics, config, taskList: {},
    async verifyPrivileges() { calls.privilege += 1; },
    timers: overrides.timers || { setTimeout, clearTimeout },
  });
  return { runtime, calls, logger, metrics, pool };
}

test('runtime starts in ready or standby mode with sanitized health and pool data', async () => {
  const activeRunner = { promise: new Promise(() => {}), async stop() {}, async kill() {} };
  const active = runtimeFakes({ runner: activeRunner });
  const health = await active.runtime.start();
  assert.equal(health.state, 'ready');
  assert.equal(health.acceptingClaims, true);
  assert.deepEqual(health.pool, { max: 10, total: 3, idle: 2, waiting: 0 });
  assert.ok(active.metrics.gauges.some((entry) => entry.name === 'job_runtime_queue_depth' && entry.value === 2));
  assert.ok(active.metrics.gauges.some((entry) => entry.name === 'job_runtime_pool_total_connections' && entry.value === 3));
  assert.equal(active.calls.privilege, 1);
  assert.equal((await active.runtime.start()).state, 'ready');
  const standby = runtimeFakes();
  assert.equal((await standby.runtime.start()).state, 'standby');
  assert.equal((await standby.runtime.readiness()).ready, true);
});

test('runtime prunes terminal registry records on startup and a bounded interval', async () => {
  let intervalCallback;
  let cleared = 0;
  const timers = {
    setTimeout() { return 1; }, clearTimeout() {},
    setInterval(callback) { intervalCallback = callback; return { unref() {} }; },
    clearInterval() { cleared += 1; },
  };
  const fixture = runtimeFakes({ pruneRetention: true, timers });
  await fixture.runtime.start();
  assert.equal(fixture.calls.prune.length, 1);
  assert.equal(fixture.calls.prune[0].limit, 1000);
  intervalCallback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.calls.prune.length, 2);
  await fixture.runtime.drain();
  assert.equal(cleared, 1);
});

test('runtime keeps serving when bounded retention maintenance fails safely', async () => {
  const fixture = runtimeFakes({
    pruneRetention: true,
    retentionError: new Error('database password=secret'),
  });
  assert.equal((await fixture.runtime.start()).state, 'standby');
  assert.ok(fixture.metrics.increments.some((entry) => entry.name === 'job_runtime_retention_failure_total'));
  assert.equal(JSON.stringify(fixture.logger.entries).includes('password=secret'), false);
});

test('runtime draining stops claims, honors graceful completion, and enforces deadline kill', async () => {
  let stopResolve;
  const runner = {
    promise: new Promise(() => {}),
    stop() { return new Promise((resolve) => { stopResolve = resolve; }); },
    async kill() {},
  };
  const active = runtimeFakes({ runner });
  await active.runtime.start();
  const drainPromise = active.runtime.drain('SIGTERM');
  assert.equal((await active.runtime.readiness()).draining, true);
  stopResolve();
  assert.equal((await drainPromise).state, 'stopped');
  let killed = 0;
  const deadlineRunner = { promise: new Promise(() => {}), stop: () => new Promise(() => {}), async kill() { killed += 1; } };
  const deadline = runtimeFakes({ runner: deadlineRunner, timers: { setTimeout(callback) { callback(); return 1; }, clearTimeout() {} } });
  await deadline.runtime.start();
  await deadline.runtime.drain();
  assert.equal(killed, 1);
  assert.equal(deadline.metrics.increments[0].name, 'job_runtime_shutdown_deadline_total');
});

test('runtime closes and reports degraded state when stop and redelivery fail', async () => {
  let killed = 0;
  let clearedDeadline = 0;
  const runner = {
    promise: new Promise(() => {}),
    async stop() { throw new Error('stop failed credential=secret'); },
    async kill() { killed += 1; },
  };
  const fixture = runtimeFakes({
    runner,
    redeliveryError: new Error('redelivery failed'),
    timers: { setTimeout() { return 1; }, clearTimeout() { clearedDeadline += 1; } },
  });
  await fixture.runtime.start();
  await assert.rejects(() => fixture.runtime.drain(), { code: 'job_runtime_unavailable' });
  assert.equal(killed, 1);
  assert.equal(fixture.calls.redelivery, 1);
  assert.equal(fixture.calls.close, 1);
  assert.equal(clearedDeadline, 1);
  assert.equal((await fixture.runtime.readiness()).state, 'failed');
  assert.equal(JSON.stringify(fixture.logger.entries).includes('credential=secret'), false);
});

test('runtime fails closed on startup or database loss and reacts to public worker events', async () => {
  const failed = runtimeFakes({ migrateError: new Error('database password=secret') });
  await assert.rejects(() => failed.runtime.start(), { code: 'job_runtime_unavailable' });
  assert.equal((await failed.runtime.health()).state, 'failed');
  const unavailable = runtimeFakes({ databaseError: new Error('network') });
  assert.equal((await unavailable.runtime.health()).database, false);
  const events = new EventEmitter();
  const logger = captureLogger();
  const metrics = metricRecorder();
  attachWorkerEvents(events, { logger, metrics });
  events.emit('pool:listen:error');
  events.emit('pool:fatalError');
  events.emit('pool:gracefulShutdown');
  events.emit('pool:forcefulShutdown');
  assert.equal(metrics.increments.length, 4);
  assert.equal(logger.entries.length, 2);
});

test('runtime records an unexpected runner rejection as a fatal degraded state', async () => {
  let rejectRunner;
  const runner = {
    promise: new Promise((resolve, reject) => { rejectRunner = reject; }),
    async stop() {},
    async kill() {},
  };
  const fixture = runtimeFakes({ runner });
  await fixture.runtime.start();
  rejectRunner(new Error('network credential should not leak'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await fixture.runtime.health()).state, 'failed');
  assert.equal(fixture.metrics.increments[0].name, 'job_runtime_worker_fatal_total');
});

test('runtime installs and removes signal handlers without process exit', async () => {
  const target = new EventEmitter();
  const fixture = runtimeFakes();
  await fixture.runtime.start();
  fixture.runtime.installSignalHandlers(target);
  fixture.runtime.installSignalHandlers(target);
  assert.equal(target.listenerCount('SIGTERM'), 1);
  target.emit('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(target.listenerCount('SIGTERM'), 0);
  assert.equal(fixture.calls.close, 1);
});

test('infrastructure composes the application port without leaking Graphile internals', () => {
  const pool = { options: { max: 10 }, async query() { return { rows: [{ present: true }] }; } };
  const registry = {
    async createPending() { return { created: false, record: deliveryRecord() }; },
    async verifySchema() {},
  };
  const adapter = { async migrate() {}, async start() { return null; }, async close() {} };
  const infrastructure = createJobRuntimeInfrastructure({
    pool, registry, adapter, logger: captureLogger(), metrics: metricRecorder(), verifyPrivileges: async () => true,
    config: { claimsEnabled: false },
  });
  assert.equal(typeof infrastructure.port.enqueue, 'function');
  assert.equal(infrastructure.graphileWorker, undefined);
  assert.equal(infrastructure.config.claimsEnabled, false);
  assert.deepEqual(poolSummary(pool), { max: 10, total: 0, idle: 0, waiting: 0 });
});

test('infrastructure default privilege verifier and clock execute through the composed runtime', async () => {
  const pool = {
    options: { max: 10 },
    async query(sql) {
      if (sql.includes('has_schema_privilege')) {
        return { rows: [{ graphile_usage: true, registry_usage: true, registry_access: true }] };
      }
      return { rows: [{ '?column?': 1 }] };
    },
  };
  const registry = { async verifySchema() {} };
  const adapter = { async migrate() {}, async start() { return null; }, async close() {} };
  const infrastructure = createJobRuntimeInfrastructure({
    pool, registry, adapter, logger: captureLogger(), metrics: metricRecorder(), config: { claimsEnabled: false },
  });
  assert.equal((await infrastructure.runtime.start()).state, 'standby');
});
