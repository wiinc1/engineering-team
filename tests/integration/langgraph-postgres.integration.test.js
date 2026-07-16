'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { Pool } = require('pg');
const { emptyCheckpoint } = require('@langchain/langgraph');
const {
  createLangGraphRuntime, createThreadRegistry, deriveThreadId, GuardedPostgresSaver,
} = require('../../lib/software-factory/langgraph');
const { createLeaseGuard, withTenantBinding } = require('../../lib/software-factory/langgraph/binding');
const { state } = require('../fixtures/langgraph/v1');

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? test : test.skip;
let pool;
let runtime;
let nodeExecutions;
const tenantId = 'langgraph_integration';
const factoryRunId = 'run:integration:280';
const threadId = deriveThreadId({ tenantId, factoryRunId });

function nodes() {
  return [
    { name: 'claimed_node', execute: () => { nodeExecutions.claim += 1; return { attempt: 1 }; } },
    { name: 'resumed_node', execute: () => { nodeExecutions.resume += 1; return { decisions: [{ code: 'resumed', outcome: 'approved' }] }; } },
  ];
}

function buildRuntime(extra = {}) {
  return createLangGraphRuntime({
    pool,
    nodes: nodes(),
    config: { enabled: true, operationTimeoutMs: 30_000, poolBudget: 2 },
    ...extra,
  });
}

async function cleanupThread() {
  await cleanupThreadById(threadId);
}

async function cleanupThreadById(targetThreadId) {
  await pool.query('DELETE FROM langgraph_checkpoint.checkpoint_writes WHERE thread_id = $1', [targetThreadId]);
  await pool.query('DELETE FROM langgraph_checkpoint.checkpoint_blobs WHERE thread_id = $1', [targetThreadId]);
  await pool.query('DELETE FROM langgraph_checkpoint.checkpoints WHERE thread_id = $1', [targetThreadId]);
  await pool.query('DELETE FROM langgraph_checkpoint.factory_threads WHERE thread_id = $1', [targetThreadId]);
}

function ownershipFlipPool(targetThreadId, replacementOwner, tracker) {
  return {
    query: (...args) => pool.query(...args),
    async connect() {
      const client = await pool.connect();
      return {
        release() { tracker.releases += 1; client.release(); },
        async query(sql, values) {
          if (!tracker.flipped && /INSERT INTO\s+"langgraph_checkpoint"\.checkpoints/i.test(String(sql))) {
            tracker.flipped = true;
            await pool.query(`UPDATE langgraph_checkpoint.factory_threads
              SET lease_owner = $2, lease_expires_at = NOW() + INTERVAL '1 minute'
              WHERE thread_id = $1`, [targetThreadId, replacementOwner]);
          }
          return client.query(sql, values);
        },
      };
    },
  };
}

async function physicalCheckpointCount(targetThreadId) {
  const result = await pool.query(`SELECT COUNT(*) FROM langgraph_checkpoint.checkpoints
    WHERE thread_id = $1`, [targetThreadId]);
  return Number(result.rows[0].count);
}

before(async () => {
  if (!connectionString) return;
  pool = new Pool({ connectionString, ssl: false, max: 6 });
  nodeExecutions = { claim: 0, resume: 0 };
  runtime = buildRuntime({ interruptAfter: ['claimed_node'] });
  await runtime.setup();
  await cleanupThread();
});

after(async () => {
  if (!pool) return;
  await cleanupThread().catch(() => {});
  await runtime?.close();
  await pool.end();
});

integration('setup reuses the existing pool and initializes dedicated saver schema', async () => {
  assert.equal(runtime.pool, pool);
  const result = await pool.query(`
    SELECT to_regclass('langgraph_checkpoint.factory_threads') AS registry,
           to_regclass('langgraph_checkpoint.checkpoints') AS checkpoints,
           to_regclass('langgraph_checkpoint.checkpoint_writes') AS writes,
           to_regclass('langgraph_checkpoint.checkpoint_blobs') AS blobs
  `);
  assert.deepEqual(Object.values(result.rows[0]).every(Boolean), true);
});

integration('checkpoint survives worker replacement and resume starts at next eligible node', async () => {
  const paused = await runtime.invoke({ tenantId, factoryRunId });
  assert.deepEqual(paused.completedNodes, ['claimed_node']);
  assert.deepEqual(nodeExecutions, { claim: 1, resume: 0 });
  const pausedRegistry = await runtime.registry.get(tenantId, threadId);
  assert.equal(pausedRegistry.status, 'paused');
  await runtime.close();

  runtime = buildRuntime();
  await runtime.setup();
  const completed = await runtime.resume({ tenantId, threadId });
  assert.deepEqual(completed.completedNodes, ['claimed_node', 'resumed_node']);
  assert.deepEqual(nodeExecutions, { claim: 1, resume: 1 });
  assert.equal((await runtime.registry.get(tenantId, threadId)).status, 'completed');
});

integration('checkpoint history is sanitized, versioned, durable, and queryable', async () => {
  const history = await runtime.checkpointHistory({ tenantId, threadId, limit: 100 });
  assert.ok(history.length >= 3);
  assert.ok(history.every((entry) => entry.checkpointId && entry.graphVersion === 'factory-v1' && entry.stateSchemaVersion === 1));
  assert.doesNotMatch(JSON.stringify(history), /channel_values|artifacts|decisions|tenant_id/);
  const summaries = await runtime.checkpointSummaries(tenantId, { limit: 10 });
  assert.equal(summaries[0].thread_id, threadId);
  assert.equal(summaries[0].graph_version, 'factory-v1');
  assert.ok(summaries[0].checkpointed_at);
});

integration('tenant mismatch and concurrent resume fail closed before graph invocation', async () => {
  await assert.rejects(runtime.resume({ tenantId: 'tenant_attacker', threadId }), { code: 'langgraph_tenant_mismatch' });
  const checkpointsBefore = await physicalCheckpointCount(threadId);
  await assert.rejects(withTenantBinding({ tenantId: 'tenant_attacker', threadId }, () => (
    runtime.checkpointer.deleteThread(threadId)
  )), { code: 'langgraph_tenant_mismatch' });
  assert.equal(await physicalCheckpointCount(threadId), checkpointsBefore);
  const owner = '59b91674-cdf4-4ef0-b9e0-79beed5f55ff';
  await runtime.registry.updateStatus(tenantId, threadId, 'paused');
  await runtime.registry.acquireLease({ tenantId, threadId, owner, leaseMs: 60_000 });
  await assert.rejects(runtime.resume({ tenantId, threadId }), { code: 'langgraph_concurrency_conflict' });
  await runtime.registry.releaseLease({ tenantId, threadId, owner });
  await runtime.registry.updateStatus(tenantId, threadId, 'completed');
});

integration('deep health performs synthetic write/read/delete and reports pool/thread gauges', async () => {
  async function rowCounts() {
    const result = await pool.query(`SELECT
      (SELECT COUNT(*)::integer FROM langgraph_checkpoint.factory_threads) AS registry,
      (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoints) AS checkpoints,
      (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoint_writes) AS writes,
      (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoint_blobs) AS blobs`);
    return result.rows[0];
  }
  const beforeCounts = await rowCounts();
  const health = await runtime.health({ deep: true });
  const afterCounts = await rowCounts();
  assert.equal(health.status, 'ok');
  assert.equal(health.deep, true);
  assert.equal(health.graphVersion, 'factory-v1');
  assert.equal(health.stateSchemaVersion, 1);
  assert.deepEqual(afterCounts, beforeCounts);
});

integration('commit fence atomically rolls back a stale writer and accepts the new owner', async () => {
  const identity = { tenantId: 'langgraph_fence_real', factoryRunId: 'run:fence-real:280' };
  const fencedThreadId = deriveThreadId(identity);
  const ownerA = '00000000-0000-4000-8000-000000000280';
  const ownerB = '00000000-0000-4000-8000-000000000281';
  const registry = createThreadRegistry(pool);
  await registry.register({
    ...identity, threadId: fencedThreadId, namespace: 'factory', graphVersion: 'factory-v1',
    stateSchemaVersion: 1, retentionExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  await registry.acquireLease({ ...identity, threadId: fencedThreadId, owner: ownerA, leaseMs: 60_000 });
  const tracker = { flipped: false, releases: 0 };
  const saver = new GuardedPostgresSaver(ownershipFlipPool(fencedThreadId, ownerB, tracker), {
    registry, schema: 'langgraph_checkpoint', maxStateBytes: 262144,
    metrics: { increment() {}, observe() {} }, logger: { info() {} },
  });
  const value = state({ ...identity, threadId: fencedThreadId });
  const versions = Object.fromEntries(Object.keys(value).map((key) => [key, '1']));
  const checkpoint = { ...emptyCheckpoint(), channel_values: value, channel_versions: versions, versions_seen: {} };
  const config = { configurable: { thread_id: fencedThreadId, checkpoint_ns: '' } };
  await assert.rejects(withTenantBinding({
    tenantId: identity.tenantId, threadId: fencedThreadId, leaseGuard: createLeaseGuard(ownerA),
  }, () => saver.put(config, checkpoint, {}, versions)), { code: 'langgraph_concurrency_conflict' });
  assert.equal((await registry.get(identity.tenantId, fencedThreadId)).last_checkpoint_id, null);
  assert.equal(await physicalCheckpointCount(fencedThreadId), 0);

  const accepted = await withTenantBinding({
    tenantId: identity.tenantId, threadId: fencedThreadId, leaseGuard: createLeaseGuard(ownerB),
  }, () => saver.put(config, checkpoint, {}, versions));
  assert.equal((await registry.get(identity.tenantId, fencedThreadId)).last_checkpoint_id, accepted.configurable.checkpoint_id);
  assert.equal(await physicalCheckpointCount(fencedThreadId), 1);
  assert.equal(tracker.releases, 2);
  await cleanupThreadById(fencedThreadId);
});

integration('018 applies, rolls back, and reapplies without changing canonical task/audit/queue data', async () => {
  await cleanupThread();
  const orphanCounts = await pool.query(`SELECT
    (SELECT COUNT(*)::integer FROM langgraph_checkpoint.factory_threads) AS registry,
    (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoints) AS checkpoints,
    (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoint_writes) AS writes,
    (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoint_blobs) AS blobs`);
  assert.deepEqual(orphanCounts.rows[0], { registry: 0, checkpoints: 0, writes: 0, blobs: 0 });
  await pool.query(`INSERT INTO tasks (tenant_id, task_id, title, status, metadata)
    VALUES ('tenant-langgraph-migration', 'TSK-LANGGRAPH-280', 'Canonical preservation sentinel', 'TODO', '{"issue":280}')`);
  await pool.query(`INSERT INTO audit_events (
    event_id, tenant_id, task_id, event_type, occurred_at, recorded_at,
    actor_type, actor_id, sequence_number, idempotency_key, source, payload
  ) VALUES (
    '00000000-0000-4000-8000-000000000280', 'tenant-langgraph-migration', 'TSK-LANGGRAPH-280',
    'task.created', NOW(), NOW(), 'system', 'langgraph-migration-test', 1,
    'langgraph-280-migration', 'integration', '{"preserve":true}'
  )`);
  await pool.query(`INSERT INTO audit_projection_queue (event_id, tenant_id, task_id)
    VALUES ('00000000-0000-4000-8000-000000000280', 'tenant-langgraph-migration', 'TSK-LANGGRAPH-280')`);
  await pool.query(`INSERT INTO audit_outbox (event_id, tenant_id, task_id, payload)
    VALUES ('00000000-0000-4000-8000-000000000280', 'tenant-langgraph-migration', 'TSK-LANGGRAPH-280', '{"preserve":true}')`);
  const canonicalTables = ['tasks', 'audit_events', 'audit_outbox', 'audit_projection_queue'];
  async function counts() {
    const output = {};
    for (const table of canonicalTables) {
      const exists = (await pool.query('SELECT to_regclass($1) AS name', [table])).rows[0].name;
      output[table] = exists ? Number((await pool.query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count) : null;
    }
    return output;
  }
  const beforeCounts = await counts();
  const migrations = path.join(process.cwd(), 'db', 'migrations');
  await pool.query(fs.readFileSync(path.join(migrations, '018_langgraph_runtime_persistence.down.sql'), 'utf8'));
  assert.equal((await pool.query("SELECT to_regnamespace('langgraph_checkpoint') AS schema")).rows[0].schema, null);
  await pool.query(fs.readFileSync(path.join(migrations, '018_langgraph_runtime_persistence.sql'), 'utf8'));
  const setupRuntime = buildRuntime();
  await setupRuntime.setup();
  await setupRuntime.close();
  assert.deepEqual(await counts(), beforeCounts);
});
