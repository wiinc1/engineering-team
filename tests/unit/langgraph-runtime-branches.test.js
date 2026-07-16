'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createLangGraphRuntime, createMetricSink, LangGraphRuntimeError,
} = require('../../lib/software-factory/langgraph');
const { state } = require('../fixtures/langgraph/v1');

function runtimeHarness(options = {}) {
  const value = state();
  const statuses = [];
  const record = { factory_run_id: value.factoryRunId, status: 'active' };
  const registry = {
    async register() { return record; },
    async assertBinding() { return record; },
    async acquireLease(input) { record.lease_owner = input.owner; return record; },
    async renewLease() { return record; },
    async releaseLease() { record.lease_owner = null; },
    async updateStatusWithLease(input) { statuses.push(input.status); record.status = input.status; return record; },
    async stats() { return options.stats || { active: 0, stale: 0, checkpoint_bytes: 0 }; },
    async summaries() { return options.summaries || []; },
    async expired() { return options.expired || []; },
    async remove(tenantId, threadId) { return options.remove ? options.remove(tenantId, threadId) : true; },
    ...(options.registry || {}),
  };
  const pool = {
    async query() {
      return options.schemaResult || { rows: [{ registry: 'factory_threads', checkpoints: 'checkpoints', saver_version: 1 }] };
    },
    ...(options.pool || {}),
  };
  const checkpointer = {
    async setup() {},
    async getTuple() { return null; },
    async put() {},
    async deleteThread() {},
    async *list() {},
    ...(options.checkpointer || {}),
  };
  const graph = options.graph || {
    async invoke() { return value; },
    async getState() { return { next: [] }; },
  };
  const runtime = createLangGraphRuntime({
    pool, runtimePool: pool, registry, checkpointer, graph, ownsPool: options.ownsPool,
    logger: { info() {}, error() {} }, metrics: createMetricSink(),
    config: { enabled: true, operationTimeoutMs: 100, resumeLeaseMs: 1_000, poolBudget: 1, ...(options.config || {}) },
  });
  return { checkpointer, pool, record, registry, runtime, statuses, value };
}

test('runtime rejects every pre-setup operation and closed reinitialization', async () => {
  const harness = runtimeHarness();
  await assert.rejects(harness.runtime.health(), { safeDetails: { reason: 'not_ready' } });
  await assert.rejects(harness.runtime.invoke({
    tenantId: harness.value.tenantId, factoryRunId: harness.value.factoryRunId,
  }), { safeDetails: { reason: 'not_setup' } });
  await assert.rejects(harness.runtime.checkpointSummaries('tenant_alpha', {}), {
    code: 'langgraph_checkpoint_unavailable',
  });
  await assert.rejects(harness.runtime.checkpointHistory({ tenantId: 'tenant_alpha', threadId: harness.value.threadId }));
  await assert.rejects(harness.runtime.pruneExpired());
  await harness.runtime.close();
  await assert.rejects(harness.runtime.setup(), { safeDetails: { reason: 'closed' } });
  await assert.rejects(harness.runtime.invoke({
    tenantId: harness.value.tenantId, factoryRunId: harness.value.factoryRunId,
  }), { safeDetails: { reason: 'closed' } });
});

test('setup rejects each incomplete schema result and closes an owned pool', async () => {
  for (const row of [
    { checkpoints: 'checkpoints', saver_version: 1 },
    { registry: 'factory_threads', saver_version: 1 },
    { registry: 'factory_threads', checkpoints: 'checkpoints', saver_version: null },
  ]) {
    await assert.rejects(runtimeHarness({ schemaResult: { rows: [row] } }).runtime.setup(), {
      code: 'langgraph_migration_mismatch',
    });
  }
  let ended = 0;
  const owned = runtimeHarness({ ownsPool: true, pool: { async end() { ended += 1; } } });
  await owned.runtime.setup();
  await owned.runtime.close();
  assert.equal(ended, 1);
});

test('production runtime rejects an injected unguarded saver', () => {
  assert.throws(() => runtimeHarness({ config: { production: true } }), {
    code: 'langgraph_configuration_invalid', safeDetails: { reason: 'unguarded_checkpointer' },
  });
});

test('default runtime composition builds guarded saver registry pool budget and graph', async () => {
  const shared = {
    async query() { return { rows: [] }; },
    async connect() { return { async query() { return { rows: [] }; }, release() {} }; },
  };
  const runtime = createLangGraphRuntime({
    pool: shared, logger: { info() {}, error() {} }, metrics: createMetricSink(),
    config: { enabled: true, poolBudget: 1 }, nodes: [{ name: 'valid_node', execute: () => ({}) }],
  });
  assert.equal(runtime.pool, shared);
  assert.equal(typeof runtime.registry.acquireLease, 'function');
  assert.equal(typeof runtime.checkpointer.put, 'function');
  assert.equal(typeof runtime.graph.invoke, 'function');
  await runtime.close();
});

test('invoke rejects an existing checkpoint and records paused status', async () => {
  const harness = runtimeHarness({ checkpointer: { async getTuple() { return {}; } } });
  await harness.runtime.setup();
  await assert.rejects(harness.runtime.invoke({
    tenantId: harness.value.tenantId, factoryRunId: harness.value.factoryRunId,
  }), { code: 'langgraph_concurrency_conflict' });
  assert.deepEqual(harness.statuses, ['paused']);
});

test('invoke normalizes node failure after owner-conditional pause', async () => {
  const harness = runtimeHarness({ graph: {
    async invoke() { throw new Error('node detail'); }, async getState() { return { next: [] }; },
  } });
  await harness.runtime.setup();
  await assert.rejects(harness.runtime.invoke({
    tenantId: harness.value.tenantId, factoryRunId: harness.value.factoryRunId,
  }), { code: 'langgraph_checkpoint_unavailable' });
  assert.deepEqual(harness.statuses, ['paused']);
});

test('resume derives identity and rejects a missing accepted checkpoint', async () => {
  const harness = runtimeHarness();
  await harness.runtime.setup();
  await assert.rejects(harness.runtime.resume({
    tenantId: harness.value.tenantId, factoryRunId: harness.value.factoryRunId,
  }), { safeDetails: { reason: 'checkpoint_not_found' } });
  assert.deepEqual(harness.statuses, ['paused']);
});

test('completion supports graphs without getState and interrupted graphs', async () => {
  const completed = runtimeHarness({
    checkpointer: { async getTuple() { return {}; } }, graph: { async invoke() { return state(); } },
  });
  await completed.runtime.setup();
  await completed.runtime.resume({ tenantId: completed.value.tenantId, threadId: completed.value.threadId });
  assert.deepEqual(completed.statuses, ['completed']);

  const paused = runtimeHarness({
    checkpointer: { async getTuple() { return {}; } },
    graph: { async invoke() { return state(); }, async getState() { return { next: ['later'] }; } },
  });
  await paused.runtime.setup();
  await paused.runtime.resume({ tenantId: paused.value.tenantId, threadId: paused.value.threadId });
  assert.deepEqual(paused.statuses, ['paused']);
});

test('deep health accepts compatible synthetic checkpoints and reports numeric stats', async () => {
  const harness = runtimeHarness({
    stats: { active: '2', stale: '1', checkpoint_bytes: '40' },
    checkpointer: { async getTuple() { return { metadata: { graph_version: 'factory-v1', state_schema_version: 1 } }; } },
  });
  await harness.runtime.setup();
  const result = await harness.runtime.health({ deep: true });
  assert.deepEqual({
    status: result.status, active: result.activeThreads, stale: result.staleThreads,
    bytes: result.checkpointBytes, deep: result.deep,
  }, { status: 'ok', active: 2, stale: 1, bytes: 40, deep: true });
});

test('deep health rejects absent and incompatible probe reads', async () => {
  const missing = runtimeHarness();
  await missing.runtime.setup();
  await assert.rejects(missing.runtime.health({ deep: true }), { safeDetails: { reason: 'probe_read' } });
  for (const metadata of [
    { graph_version: 'factory-v2', state_schema_version: 1 },
    { graph_version: 'factory-v1', state_schema_version: 2 },
  ]) {
    const mismatch = runtimeHarness({ checkpointer: { async getTuple() { return { metadata }; } } });
    await mismatch.runtime.setup();
    await assert.rejects(mismatch.runtime.health({ deep: true }), { code: 'langgraph_version_unsupported' });
  }
});

test('summary history and retention methods expose only sanitized bounded results', async () => {
  const tuples = [
    {
      config: { configurable: { checkpoint_id: 'cp-2' } },
      parentConfig: { configurable: { checkpoint_id: 'cp-1' } },
      metadata: { source: 'loop', step: 2, graph_version: 'factory-v1', state_schema_version: 1 },
      checkpoint: { ts: '2026-07-16T00:00:00.000Z' },
    },
    { config: { configurable: { checkpoint_id: 'cp-1' } }, metadata: {}, checkpoint: { ts: 'earlier' } },
  ];
  let historyLimit;
  const removed = [];
  const harness = runtimeHarness({
    summaries: [{ thread_id: 'safe' }],
    expired: [{ tenant_id: 'tenant_alpha', thread_id: 'one' }, { tenant_id: 'tenant_alpha', thread_id: 'two' }],
    remove(_tenant, threadId) { removed.push(threadId); return threadId === 'one'; },
    checkpointer: {
      async *list(_config, options) { historyLimit = options.limit; yield* tuples; },
      async deleteThread() {},
    },
  });
  await harness.runtime.setup();
  assert.deepEqual(await harness.runtime.checkpointSummaries('tenant_alpha', {}), [{ thread_id: 'safe' }]);
  const history = await harness.runtime.checkpointHistory({
    tenantId: 'tenant_alpha', threadId: harness.value.threadId, limit: 1_000,
  });
  assert.equal(historyLimit, 100);
  assert.deepEqual(history.map((entry) => [entry.checkpointId, entry.parentCheckpointId, entry.source, entry.step]), [
    ['cp-2', 'cp-1', 'loop', 2], ['cp-1', null, null, null],
  ]);
  assert.deepEqual(await harness.runtime.pruneExpired({ limit: 10 }), { pruned: 1 });
  assert.deepEqual(removed, ['one', 'two']);
});
