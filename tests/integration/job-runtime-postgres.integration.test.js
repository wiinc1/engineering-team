'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createPgPoolFromEnv, runMigrations } = require('../../lib/audit/postgres');
const { createJobRuntimeInfrastructure } = require('../../lib/job-runtime');
const { createEffectGuard, createEffectLedger } = require('../../lib/job-runtime/effect-ledger');
const { JobRuntimeError } = require('../../lib/job-runtime/errors');
const { createGraphileAdapter } = require('../../lib/job-runtime/graphile-adapter');
const { createJobRuntimeLogger, createMetricSink } = require('../../lib/job-runtime/observability');
const { createJobOperatorService } = require('../../lib/job-runtime/operator-service');
const { applyLeastPrivilegeGrants, verifyJobRuntimePrivileges } = require('../../lib/job-runtime/postgres-roles');
const { createDeliveryRegistry } = require('../../lib/job-runtime/registry');
const { FIXED_NOW, validContext, validRequest } = require('../fixtures/job-runtime/v1');
const { assertJobRuntimeLoadBudgets } = require('../../scripts/run-job-runtime-load-test');

test('load gate rejects a registry read at the hosted 250ms boundary', () => assert.throws(
  () => assertJobRuntimeLoadBudgets({ load_multiplier: 2, required_load_multiplier: 2,
    submitted: 1, acknowledged: 1, enqueue_p95_ms: 1, enqueue_p99_ms: 1, operational_read_p95_ms: 250,
    ready_to_start_p95_ms: 1, pool_peak_total: 1, pool_max: 10, pool_waiting_at_end: 0, runtime_pool_waiting_at_end: 0 }), /job_runtime_operational_read_latency_budget_failed/));

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

function hasCounter(metrics, name) {
  return Object.keys(metrics.snapshot().counters).some((key) => key.includes(name));
}

async function seedWorkloadMigration(client) {
  await client.query(`INSERT INTO tasks (tenant_id, task_id, title, status)
    VALUES ('tenant-workload-migration', 'TSK-GRAPHILE-287', 'Workload migration sentinel', 'TODO')`);
  await client.query(`INSERT INTO task_sync_checkpoints (
    tenant_id, task_id, canonical_version, sync_status, last_synced_at
  ) VALUES ('tenant-workload-migration', 'TSK-GRAPHILE-287', 1, 'active', NOW())`);
  await client.query(`INSERT INTO audit_events (
    event_id, tenant_id, task_id, event_type, occurred_at, recorded_at,
    actor_type, actor_id, sequence_number, idempotency_key, source
  ) VALUES (
    '00000000-0000-4000-8000-000000000287', 'tenant-workload-migration', 'TSK-GRAPHILE-287',
    'task.created', NOW(), NOW(), 'system', 'migration-test', 1, 'graphile-287-migration', 'integration'
  )`);
  await client.query(`INSERT INTO audit_projection_queue (event_id, tenant_id, task_id)
    VALUES ('00000000-0000-4000-8000-000000000287', 'tenant-workload-migration', 'TSK-GRAPHILE-287')`);
  await client.query(`INSERT INTO audit_outbox (event_id, tenant_id, task_id)
    VALUES ('00000000-0000-4000-8000-000000000287', 'tenant-workload-migration', 'TSK-GRAPHILE-287')`);
  await client.query(`INSERT INTO factory_delivery_queue (
    tenant_id, queue_id, idempotency_key, title, requirements, task_id
  ) VALUES (
    'tenant-workload-migration', 'queue-287', 'queue-287-key', 'Factory sentinel', 'Preserve me', 'TSK-GRAPHILE-287'
  )`);
}

async function workloadMigrationSnapshot(client) {
  const result = await client.query(`SELECT
    (SELECT COUNT(*)::integer FROM tasks WHERE tenant_id = 'tenant-workload-migration') AS tasks,
    (SELECT COUNT(*)::integer FROM task_sync_checkpoints WHERE tenant_id = 'tenant-workload-migration') AS checkpoints,
    (SELECT COUNT(*)::integer FROM audit_events WHERE tenant_id = 'tenant-workload-migration') AS audit_events,
    (SELECT COUNT(*)::integer FROM audit_projection_queue WHERE tenant_id = 'tenant-workload-migration') AS projection_queue,
    (SELECT COUNT(*)::integer FROM audit_outbox WHERE tenant_id = 'tenant-workload-migration') AS outbox,
    (SELECT COUNT(*)::integer FROM factory_delivery_queue WHERE tenant_id = 'tenant-workload-migration') AS factory_queue`);
  return result.rows[0];
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
  const migrations = [
    '016_job_runtime_registry.sql',
    '017_job_runtime_workloads.sql',
    '019_job_runtime_operations.sql',
  ];
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
    // Roll back dependent application-owned tables before their registry base.
    // This mirrors the supported reverse migration order after GRAPHILE-03.
    await pool.query(read('db/migrations/019_job_runtime_operations.down.sql'));
    await pool.query(read('db/migrations/017_job_runtime_workloads.down.sql'));
    await pool.query(read('db/migrations/016_job_runtime_registry.down.sql'));
    await pool.query('DELETE FROM schema_migrations WHERE version = ANY($1)', [migrations]);
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

pgTest('workload migration apply rollback apply preserves canonical task audit queue factory and checkpoint data', async () => {
  const migration = '017_job_runtime_workloads.sql';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedWorkloadMigration(client);
    const before = await workloadMigrationSnapshot(client);
    const graphileFingerprint = await setupAdapter.schemaFingerprint();
    await pool.query(read('db/migrations/017_job_runtime_workloads.down.sql'));
    await pool.query('DELETE FROM schema_migrations WHERE version = $1', [migration]);
    await runMigrations(pool, { baseDir: root });
    assert.deepEqual(await workloadMigrationSnapshot(client), before);
    assert.deepEqual(before, {
      tasks: 1, checkpoints: 1, audit_events: 1, projection_queue: 1, outbox: 1, factory_queue: 1,
    });
    assert.equal(await setupAdapter.schemaFingerprint(), graphileFingerprint);
    const schema = await pool.query(`SELECT
      to_regclass('job_runtime.job_effect_ledger') IS NOT NULL AS effect_ledger,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'job_runtime' AND table_name = 'job_delivery_registry'
          AND column_name = 'handler_version'
      ) AS handler_version`);
    assert.deepEqual(schema.rows[0], { effect_ledger: true, handler_version: true });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

pgTest('workload rollback refuses to discard populated effect evidence', async () => {
  await pool.query(`INSERT INTO job_runtime.job_effect_ledger (
    tenant_id, effect_key, task_identifier, effect_category, canonical_resource_type,
    canonical_resource_id, effect_version, owner_token, lease_expires_at
  ) VALUES (
    'tenant-one', 'effect:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'maintenance.factory.reconcile.v1', 'factory_queue_recovery', 'factory_tenant', 'tenant-one', 1760000000000,
    '00000000-0000-4000-8000-000000000287', NOW() + INTERVAL '1 minute'
  )`);
  try {
    await assert.rejects(() => pool.query(read('db/migrations/017_job_runtime_workloads.down.sql')), /not empty/);
  } finally {
    await pool.query(`DELETE FROM job_runtime.job_effect_ledger
      WHERE tenant_id = 'tenant-one' AND canonical_resource_id = 'tenant-one'`);
  }
});

pgTest('delivery registry persists retry state with the live database constraints', async () => {
  const deliveryId = '00000000-0000-4000-8000-000000000288';
  await pool.query(`INSERT INTO job_runtime.job_delivery_registry (
    delivery_id, tenant_id, workload_id, semantic_job_key, task_identifier, task_name,
    payload_version, catalog_version, named_queue, max_attempts, priority,
    canonical_resource_type, canonical_resource_id, ordering_key, correlation_id, payload_size_bytes,
    scheduled_for, status, graphile_job_id, attempt_count
  ) VALUES ($1, 'tenant-one', 'probe-registry-live', 'jr:v1:registry-live',
    'job_runtime.synthetic.v1', 'job_runtime.synthetic', 1, 1, 'job-runtime-synthetic',
    3, 0, 'synthetic', 'probe-registry-live', 'tenant-one:synthetic:probe-registry-live', 'corr-registry-live', 200, NOW(),
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

pgTest('operator retry is tenant-bound, audited, versioned, and exactly-once in Postgres', async () => {
  const deliveryId = '00000000-0000-4000-8000-000000000389';
  const actionId = '00000000-0000-4000-8000-000000000390';
  await pool.query(`INSERT INTO job_runtime.job_delivery_registry (
    delivery_id, tenant_id, workload_id, semantic_job_key, task_identifier, task_name,
    payload_version, catalog_version, named_queue, max_attempts, priority,
    canonical_resource_type, canonical_resource_id, ordering_key, correlation_id, payload_size_bytes,
    scheduled_for, status, graphile_job_id, attempt_count
  ) VALUES ($1, 'tenant-operator-live', 'probe-operator-live', 'jr:v1:operator-live',
    'job_runtime.synthetic.v1', 'job_runtime.synthetic', 1, 1, 'job-runtime-synthetic',
    3, 0, 'synthetic', 'probe-operator-live', 'tenant-operator-live:synthetic:probe-operator-live',
    'corr-operator-live', 200, NOW(), 'delivery_failed', '389', 1)`, [deliveryId]);
  const adapterCalls = [];
  const registry = createDeliveryRegistry(pool);
  const service = createJobOperatorService({
    registry,
    adapter: { async retry(...args) { adapterCalls.push(args); }, async cancel() {} },
    idGenerator: () => actionId,
  });
  const input = {
    tenantId: 'tenant-operator-live', deliveryId, actorId: 'sre-live', requestId: 'req-live',
    action: 'retry', reason: 'recover live job', expectedVersion: 0, idempotencyKey: 'retry-live-1',
  };
  try {
    const first = await service.act(input);
    const replay = await service.act(input);
    assert.equal(first.replayed, false);
    assert.equal(first.resultingVersion, 1);
    assert.equal(replay.replayed, true);
    assert.equal(replay.resultingVersion, 1);
    assert.equal(adapterCalls.length, 1);
    assert.equal((await service.get('tenant-operator-live', deliveryId)).history.length, 1);
    await assert.rejects(() => service.get('tenant-attacker', deliveryId), { code: 'job_not_found' });
    const stored = await pool.query(`SELECT outcome, expected_version, resulting_version, actor_id
      FROM job_runtime.job_operator_actions WHERE action_id = $1`, [actionId]);
    assert.deepEqual(stored.rows[0], {
      outcome: 'succeeded', expected_version: '0', resulting_version: '1', actor_id: 'sre-live',
    });
  } finally {
    await pool.query('DELETE FROM job_runtime.job_operator_actions WHERE delivery_id = $1', [deliveryId]);
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
    config: { claimsEnabled: true, concurrency: 4, reservedConnections: 4, pollIntervalMs: 100, shutdownDeadlineMs: 5000 },
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
    await waitUntil(() => hasCounter(metrics, 'job_runtime_retry_total'), 2_000);
    const snapshot = metrics.snapshot();
    const readyMetric = metricValues(snapshot, 'job_runtime_ready_to_start_ms');
    assert.equal(readyMetric.length, 3);
    assert.ok(Math.max(...readyMetric) < 2_000, `ready-to-start metrics exceeded budget: ${JSON.stringify(readyMetric)}`);
  } finally {
    await infrastructure.runtime.drain('integration complete');
  }
});

function fairnessFixture() {
  const releases = [];
  let resolveFactoryStarted;
  const waitForFactory = new Promise((resolve) => { resolveFactoryStarted = resolve; });
  const canonical = {
    async lookup(input) {
      if (input.resourceType === 'factory_run') {
        return { tenantId: input.tenantId, taskId: `TSK-${input.resourceId}`, threadId: `thread-${input.resourceId}` };
      }
      return { tenantId: input.tenantId };
    },
    async authorize() { return true; },
  };
  const infrastructure = createJobRuntimeInfrastructure({
    pool, logger, canonical,
    config: { claimsEnabled: true, concurrency: 4, reservedConnections: 4, shutdownDeadlineMs: 5000 },
    workloads: {
      langGraph: {
        async lookupEffect() { return { completed: false }; },
        async start() {
          resolveFactoryStarted();
          await new Promise((resolve) => releases.push(resolve));
          return { code: 'started' };
        },
      },
      auditStore: {
        async processProjectionQueue() { return { processed: 1 }; },
        async processOutbox() { return { processed: 0 }; },
        async processExpiredSreMonitoring() { return { processed: 0 }; },
      },
      outbox: {
        async lookupEffect() { return { completed: false }; },
        async publish() { return { code: 'published' }; },
      },
      async factoryRecovery() { return { code: 'recovered' }; },
    },
  });
  return { infrastructure, releases, waitForFactory };
}

async function enqueueProtectedClasses(infrastructure, context) {
  const projection = await infrastructure.producers.auditProjection(context('projection'), {
    occurrenceId: 'fairness-projection:287', batchSize: 100, runAt: new Date(),
  });
  const outbox = await infrastructure.producers.auditOutbox(context('outbox'), {
    occurrenceId: 'fairness-outbox:287', batchSize: 100, runAt: new Date(),
  });
  const maintenance = await infrastructure.producers.factoryReconciliation(context('maintenance'), {
    occurrenceId: 'fairness-maintenance:287', runAt: new Date(),
  });
  return [projection, outbox, maintenance];
}

pgTest('reserved worker classes prevent long factory runs from starving projection outbox or maintenance', { timeout: 30_000 }, async () => {
  const { infrastructure, releases, waitForFactory } = fairnessFixture();
  try {
    await infrastructure.runtime.start();
    const context = (suffix) => ({ tenantId: 'tenant-one', correlationId: `fairness-${suffix}` });
    const factory = await infrastructure.producers.factoryStart(context('run-a'), {
      runId: 'run-a', taskId: 'TSK-run-a', threadId: 'thread-run-a', workflowVersion: 1,
    });
    await Promise.race([waitForFactory, new Promise((_, reject) => setTimeout(() => reject(new Error('factory start timeout')), 5000))]);
    const protectedDeliveries = await enqueueProtectedClasses(infrastructure, context);
    await Promise.all(protectedDeliveries.map((record) => (
      waitForStatus(infrastructure.registry, record.deliveryId, 'delivery_acknowledged', 5000)
    )));
    assert.equal(releases.length, 1);
    releases.forEach((release) => release());
    await waitForStatus(infrastructure.registry, factory.deliveryId, 'delivery_acknowledged', 5000);
  } finally {
    releases.forEach((release) => release());
    await infrastructure.runtime.drain('fairness complete');
  }
});

pgTest('real effect ledger reconciles crash-after-effect replay to one canonical effect', async () => {
  const ledger = createEffectLedger(pool);
  let effects = 0;
  const input = {
    tenantId: 'tenant-one', taskIdentifier: 'factory.langgraph.start.v1', effectCategory: 'github',
    resourceType: 'factory_run', resourceId: 'run-effect-287', effectVersion: 1,
  };
  await pool.query(`DELETE FROM job_runtime.job_effect_ledger
    WHERE tenant_id = 'tenant-one' AND canonical_resource_id = 'run-effect-287'`);
  const first = createEffectGuard({
    ledger, logger, metrics: createMetricSink(),
    idGenerator: () => '00000000-0000-4000-8000-000000000287',
    faults: { async afterEffect() { throw new Error('crash after effect'); } },
  });
  await assert.rejects(() => first.execute({
    ...input, async lookup() { return { completed: false }; }, async perform() { effects += 1; },
  }), /crash after effect/);
  const retry = createEffectGuard({
    ledger, logger, metrics: createMetricSink(),
    idGenerator: () => '00000000-0000-4000-8000-000000000288',
  });
  try {
    const replay = await retry.execute({
      ...input, async lookup() { return { completed: true, code: 'github_effect_exists' }; },
      async perform() { effects += 1; },
    });
    assert.equal(replay.suppressed, true);
    assert.equal(effects, 1);
    assert.equal((await ledger.find(input.tenantId, replay.effectKey)).status, 'completed');
  } finally {
    await pool.query(`DELETE FROM job_runtime.job_effect_ledger
      WHERE tenant_id = 'tenant-one' AND canonical_resource_id = 'run-effect-287'`);
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
    config: { claimsEnabled: true, concurrency: 4, reservedConnections: 4, shutdownDeadlineMs: 5000 },
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
