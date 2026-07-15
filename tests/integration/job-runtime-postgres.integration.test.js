'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createPgPoolFromEnv, runMigrations } = require('../../lib/audit/postgres');
const { createJobRuntimeInfrastructure } = require('../../lib/job-runtime');
const { JobRuntimeError } = require('../../lib/job-runtime/errors');
const { createGraphileAdapter } = require('../../lib/job-runtime/graphile-adapter');
const { createJobRuntimeLogger, createMetricSink } = require('../../lib/job-runtime/observability');
const { applyLeastPrivilegeGrants, verifyJobRuntimePrivileges } = require('../../lib/job-runtime/postgres-roles');
const { createDeliveryRegistry } = require('../../lib/job-runtime/registry');
const { FIXED_NOW, validContext, validRequest } = require('../fixtures/job-runtime/v1');

const connectionString = process.env.DATABASE_URL;
const pgTest = connectionString ? test : test.skip;
const root = path.join(__dirname, '../..');
let pool;
let logger;
let setupAdapter;
const integrationLogEntries = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function silentLogger() {
  return createJobRuntimeLogger({ logger: {
    info(payload) { integrationLogEntries.push(payload); },
    error(payload) { integrationLogEntries.push(payload); },
  } });
}

async function setupDatabase() {
  pool = createPgPoolFromEnv(connectionString);
  logger = silentLogger();
  setupAdapter = createGraphileAdapter({ pool, schema: 'graphile_worker', logger });
  await pool.query(read('db/roles/job_runtime_roles.sql'));
  await setupAdapter.migrate();
  await runMigrations(pool, { baseDir: root });
  await applyLeastPrivilegeGrants(pool);
}

test.before(async () => {
  if (connectionString) await setupDatabase();
});

test.after(async () => {
  if (setupAdapter) await setupAdapter.close();
  if (pool) await pool.end();
});

async function waitUntil(predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

async function waitForStatus(registry, deliveryId, status, timeoutMs) {
  let lastRecord;
  try {
    return await waitUntil(async () => {
      lastRecord = await registry.findByDeliveryId(deliveryId);
      return lastRecord?.status === status ? lastRecord : null;
    }, timeoutMs);
  } catch {
    const events = integrationLogEntries.slice(-12).map((entry) => entry.event).join(',');
    throw new Error(`delivery ${deliveryId} expected ${status}; last status ${lastRecord?.status || 'missing'} attempt ${lastRecord?.attemptCount ?? 'unknown'} events ${events}`);
  }
}

function enqueueProbe(infrastructure, workloadId, expectedOutcome) {
  return infrastructure.port.enqueue(validContext({ correlationId: `corr-${workloadId}` }), validRequest({
    workloadId,
    canonicalResource: { type: 'synthetic', id: workloadId },
    data: { probeId: workloadId, expectedOutcome },
    runAt: new Date(),
  }));
}

function metricValues(snapshot, name) {
  return Object.entries(snapshot.observations).find(([key]) => key.includes(name))?.[1] || [];
}

pgTest('Graphile and application schemas initialize with least-privilege roles', async () => {
  assert.equal(await createDeliveryRegistry(pool).verifySchema(), true);
  assert.equal(await verifyJobRuntimePrivileges(pool), true);
  const schemaResult = await pool.query(`SELECT
    to_regnamespace('graphile_worker') IS NOT NULL AS graphile,
    to_regnamespace('job_runtime') IS NOT NULL AS registry`);
  assert.deepEqual(schemaResult.rows[0], { graphile: true, registry: true });
  const privilegeResult = await pool.query(`SELECT
    has_schema_privilege('job_runtime_producer', 'graphile_worker', 'CREATE') AS producer_create,
    has_table_privilege('job_runtime_producer', 'job_runtime.job_delivery_registry', 'INSERT') AS producer_insert,
    has_schema_privilege('job_runtime_worker', 'graphile_worker', 'CREATE') AS worker_create,
    has_table_privilege('job_runtime_worker', 'job_runtime.job_delivery_registry', 'UPDATE') AS worker_update,
    has_table_privilege('job_runtime_worker', 'tasks', 'UPDATE') AS worker_canonical_update`);
  assert.deepEqual(privilegeResult.rows[0], {
    producer_create: false,
    producer_insert: true,
    worker_create: false,
    worker_update: true,
    worker_canonical_update: false,
  });
});

pgTest('migration apply rollback apply preserves populated canonical task and audit rows', async () => {
  const client = await pool.connect();
  const migration = '016_job_runtime_registry.sql';
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO tasks (tenant_id, task_id, title, status)
      VALUES ('tenant-migration', 'TSK-GRAPHILE-286', 'Migration sentinel', 'TODO')`);
    await client.query(`INSERT INTO audit_events (
      event_id, tenant_id, task_id, event_type, occurred_at, recorded_at,
      actor_type, actor_id, sequence_number, idempotency_key, source
    ) VALUES (
      '00000000-0000-4000-8000-000000000286', 'tenant-migration', 'TSK-GRAPHILE-286',
      'task.created', NOW(), NOW(), 'system', 'migration-test', 1, 'graphile-286-migration', 'integration'
    )`);
    const before = await client.query(`SELECT
      (SELECT COUNT(*)::integer FROM tasks WHERE tenant_id = 'tenant-migration') AS tasks,
      (SELECT COUNT(*)::integer FROM audit_events WHERE tenant_id = 'tenant-migration') AS audit_events`);
    const fingerprint = await setupAdapter.schemaFingerprint();
    await pool.query(read('db/migrations/016_job_runtime_registry.down.sql'));
    await pool.query('DELETE FROM schema_migrations WHERE version = $1', [migration]);
    await runMigrations(pool, { baseDir: root });
    await setupAdapter.migrate();
    const after = await client.query(`SELECT
      (SELECT COUNT(*)::integer FROM tasks WHERE tenant_id = 'tenant-migration') AS tasks,
      (SELECT COUNT(*)::integer FROM audit_events WHERE tenant_id = 'tenant-migration') AS audit_events`);
    assert.deepEqual(before.rows[0], { tasks: 1, audit_events: 1 });
    assert.deepEqual(after.rows[0], before.rows[0]);
    assert.equal(await setupAdapter.schemaFingerprint(), fingerprint);
    assert.equal(await createDeliveryRegistry(pool).verifySchema(), true);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

pgTest('delivery registry persists retry state with the live database constraints', async () => {
  const deliveryId = '00000000-0000-4000-8000-000000000288';
  await pool.query(`INSERT INTO job_runtime.job_delivery_registry (
    delivery_id, tenant_id, workload_id, semantic_job_key, task_identifier, task_name,
    payload_version, catalog_version, named_queue, max_attempts, priority,
    canonical_resource_type, canonical_resource_id, correlation_id, payload_size_bytes,
    scheduled_for, status, graphile_job_id, attempt_count
  ) VALUES ($1, 'tenant-one', 'probe-registry-live', 'jr:v1:registry-live',
    'job_runtime.synthetic.v1', 'job_runtime.synthetic', 1, 1, 'job-runtime-synthetic',
    3, 0, 'synthetic', 'probe-registry-live', 'corr-registry-live', 200, NOW(),
    'running', '88', 1)`, [deliveryId]);
  try {
    const record = await createDeliveryRegistry(pool).markFailed(deliveryId, {
      retrying: true,
      errorCode: 'job_runtime_unavailable',
    });
    assert.equal(record.status, 'redelivery_pending');
  } finally {
    await pool.query('DELETE FROM job_runtime.job_delivery_registry WHERE delivery_id = $1', [deliveryId]);
  }
});

pgTest('enqueue claim retry dedupe and named-queue concurrency run through LISTEN/NOTIFY', { timeout: 40_000 }, async () => {
  const events = new EventEmitter();
  const listening = new Promise((resolve) => events.once('pool:listen:success', resolve));
  const metrics = createMetricSink();
  let active = 0;
  let maxActive = 0;
  const handlers = {
    'job_runtime.synthetic.v1': async (data, context) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 75));
      active -= 1;
      if (data.expectedOutcome === 'retry_once' && context.attempt === 1) {
        throw new JobRuntimeError('job_runtime_unavailable');
      }
    },
  };
  const infrastructure = createJobRuntimeInfrastructure({
    pool, logger, metrics, handlers, events,
    config: { claimsEnabled: true, concurrency: 4, reservedConnections: 4, shutdownDeadlineMs: 5000 },
    clock: { now: Date.now },
  });
  try {
    await infrastructure.runtime.start();
    await Promise.race([listening, new Promise((_, reject) => setTimeout(() => reject(new Error('LISTEN timeout')), 3000))]);
    const startedAt = Date.now();
    const retry = await enqueueProbe(infrastructure, 'probe-retry', 'retry_once');
    const second = await enqueueProbe(infrastructure, 'probe-second', 'acknowledge');
    const third = await enqueueProbe(infrastructure, 'probe-third', 'acknowledge');
    const completed = await Promise.all([retry, second, third].map((record) => (
      waitForStatus(infrastructure.registry, record.deliveryId, 'delivery_acknowledged', 20_000)
    )));
    assert.equal(completed[0].attemptCount, 2);
    assert.equal(maxActive, 1);
    assert.ok(Date.now() - startedAt < 20_000);
    const duplicate = await infrastructure.port.enqueue(validContext({ correlationId: 'corr-duplicate' }), validRequest({
      workloadId: 'probe-second', canonicalResource: { type: 'synthetic', id: 'probe-second' },
      data: { probeId: 'probe-second', expectedOutcome: 'acknowledge' }, runAt: second.scheduledFor,
    }));
    assert.equal(duplicate.deliveryId, second.deliveryId);
    assert.equal(pool.waitingCount === 0 && pool.totalCount <= pool.options.max, true);
    const snapshot = metrics.snapshot();
    assert.ok(Object.keys(snapshot.counters).some((key) => key.includes('job_runtime_retry_total')));
    const readyMetric = metricValues(snapshot, 'job_runtime_ready_to_start_ms');
    assert.equal(readyMetric.length, 3);
    assert.ok(Math.max(...readyMetric) < 2_000);
  } finally {
    await infrastructure.runtime.drain('integration complete');
  }
});

pgTest('SIGTERM-style drain rejects readiness and lets eligible active work finish', { timeout: 15_000 }, async () => {
  let releaseHandler;
  let handlerStarted;
  const started = new Promise((resolve) => { handlerStarted = resolve; });
  const waitForRelease = new Promise((resolve) => { releaseHandler = resolve; });
  const infrastructure = createJobRuntimeInfrastructure({
    pool, logger,
    handlers: { 'job_runtime.synthetic.v1': async () => { handlerStarted(); await waitForRelease; } },
    config: { claimsEnabled: true, concurrency: 1, reservedConnections: 4, shutdownDeadlineMs: 5000 },
  });
  await infrastructure.runtime.start();
  const record = await infrastructure.port.enqueue(validContext({ correlationId: 'corr-drain' }), validRequest({
    workloadId: 'probe-drain', canonicalResource: { type: 'synthetic', id: 'probe-drain' },
    data: { probeId: 'probe-drain' }, runAt: new Date(),
  }));
  await started;
  const draining = infrastructure.runtime.drain('SIGTERM');
  assert.deepEqual(await infrastructure.runtime.readiness(), {
    ready: false, draining: true, state: 'draining', claimsEnabled: true, acceptingClaims: false,
  });
  releaseHandler();
  assert.equal((await draining).state, 'stopped');
  assert.equal((await infrastructure.registry.findByDeliveryId(record.deliveryId)).status, 'delivery_acknowledged');
});
