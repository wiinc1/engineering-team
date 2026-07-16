'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createLangGraphRuntime,
  createMetricSink,
  createPoolBudget,
  LangGraphRuntimeError,
  timeout,
} = require('../lib/software-factory/langgraph');
const { requireTenantBinding } = require('../lib/software-factory/langgraph/binding');
const { state } = require('../tests/fixtures/langgraph/v1');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function inMemoryRegistry() {
  let record;
  let lease;
  const counters = { releases: 0, renewals: 0, removes: 0 };
  return {
    counters,
    get record() { return record; },
    async register(input) { record = { ...input, factory_run_id: input.factoryRunId, status: 'active' }; return record; },
    async assertBinding() { return record; },
    async acquireLease(input) {
      if (lease && lease.expiresAt > Date.now() && lease.owner !== input.owner) throw new LangGraphRuntimeError('langgraph_concurrency_conflict');
      lease = { ...input, expiresAt: Date.now() + input.leaseMs };
    },
    async renewLease(input) {
      if (!lease || lease.owner !== input.owner) throw new LangGraphRuntimeError('langgraph_concurrency_conflict');
      lease.expiresAt = Date.now() + input.leaseMs;
      counters.renewals += 1;
    },
    async releaseLease(input) { if (lease?.owner === input.owner) lease = null; counters.releases += 1; },
    async updateStatus(_tenantId, _threadId, status) { record.status = status; return record; },
    async updateStatusWithLease(input) {
      if (!lease || lease.owner !== input.owner || lease.expiresAt <= Date.now()) {
        throw new LangGraphRuntimeError('langgraph_concurrency_conflict');
      }
      record.status = input.status;
      return record;
    },
    async stats() { return { active: 1, stale: 0, checkpoint_bytes: 0 }; },
    async remove() { counters.removes += 1; return true; },
  };
}

function runtimeHarness(options = {}) {
  const registry = options.registry || inMemoryRegistry();
  const pool = {
    query: options.query || (async () => ({ rows: [{ registry: 'factory_threads', checkpoints: 'checkpoints', saver_version: 1 }] })),
    end: options.end || (async () => {}),
  };
  const checkpointer = {
    setup: options.setup || (async () => {}),
    getTuple: options.getTuple || (async () => null),
    put: options.put || (async () => ({})),
    deleteThread: options.deleteThread || (async () => {}),
  };
  const graph = options.graph || { async invoke(input) { return input; }, async getState() { return { next: [] }; } };
  const runtime = createLangGraphRuntime({
    pool, runtimePool: pool, ownsPool: options.ownsPool, registry, checkpointer, graph,
    nodes: [{ name: 'slow_node', execute: () => ({ attempt: 1 }) }],
    logger: { info() {}, error() {} }, metrics: createMetricSink(),
    config: {
      enabled: true, operationTimeoutMs: 100, resumeLeaseMs: 1_000, poolBudget: 1,
      ...(options.config || {}),
    },
  });
  return { checkpointer, pool, registry, runtime };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Condition did not settle.');
    await delay(10);
  }
}

test('database interruption fails closed with stable availability error', async () => {
  const metrics = createMetricSink();
  const pool = createPoolBudget({
    async connect() { throw Object.assign(new Error('connection terminated'), { code: '57P01' }); },
    async query() {},
  }, 1, metrics);
  await assert.rejects(pool.query('SELECT 1'), { code: 'langgraph_checkpoint_unavailable' });
});

test('pool saturation queues work and stays within configured connection limit', async () => {
  const metrics = createMetricSink();
  let active = 0;
  let peak = 0;
  const shared = {
    async connect() {
      active += 1;
      peak = Math.max(peak, active);
      return {
        async query() { await new Promise((resolve) => setTimeout(resolve, 15)); return { rows: [] }; },
        release() { active -= 1; },
      };
    },
    async query() {},
  };
  const pool = createPoolBudget(shared, 1, metrics);
  await Promise.all([pool.query('SELECT 1'), pool.query('SELECT 1'), pool.query('SELECT 1')]);
  assert.equal(peak, 1);
  const counters = metrics.snapshot().counters;
  assert.ok(Object.entries(counters).some(([key, value]) => key.includes('langgraph_pool_saturation_total') && value >= 2));
});

test('hung database operation trips explicit timeout instead of falling back', async () => {
  await assert.rejects(timeout(new Promise(() => {}), 10), {
    code: 'langgraph_checkpoint_unavailable', safeDetails: { reason: 'operation_timeout' },
  });
});

test('timed-out graph remains lease-protected until its underlying writer settles', async () => {
  const registry = inMemoryRegistry();
  let resolveFirst;
  let invocations = 0;
  let active = 0;
  let peak = 0;
  let checkpointExists = false;
  let abortSeen = false;
  const completed = state({ lifecycleNode: 'slow_node', completedNodes: ['slow_node'], attempt: 1 });
  const graph = {
    invoke(_input, config) {
      invocations += 1;
      active += 1;
      peak = Math.max(peak, active);
      if (invocations > 1) return Promise.resolve(completed).finally(() => { active -= 1; });
      checkpointExists = true;
      config.signal.addEventListener('abort', () => { abortSeen = true; });
      return new Promise((resolve) => { resolveFirst = resolve; }).finally(() => { active -= 1; });
    },
    async getState() { return { next: [] }; },
  };
  const harness = runtimeHarness({ registry, graph, getTuple: async () => (checkpointExists ? {} : null) });
  await harness.runtime.setup();
  const started = Date.now();
  await assert.rejects(harness.runtime.invoke({ tenantId: completed.tenantId, factoryRunId: completed.factoryRunId }), {
    code: 'langgraph_checkpoint_unavailable', safeDetails: { reason: 'operation_timeout' },
  });
  assert.ok(Date.now() - started < 500);
  assert.equal(abortSeen, true);
  assert.equal(registry.record.status, 'active');
  await delay(1_050);
  await assert.rejects(harness.runtime.resume({ tenantId: completed.tenantId, threadId: completed.threadId }), {
    code: 'langgraph_concurrency_conflict',
  });
  assert.equal(invocations, 1);
  assert.equal(peak, 1);
  assert.ok(registry.counters.renewals >= 3);
  resolveFirst(completed);
  await waitFor(() => registry.counters.releases === 1);
  assert.equal(registry.record.status, 'completed');
  await harness.runtime.resume({ tenantId: completed.tenantId, threadId: completed.threadId });
  assert.equal(invocations, 2);
  assert.equal(peak, 1);
  assert.equal(registry.counters.releases, 2);
});

test('lost lease renewal aborts and fences a stale writer that ignores cancellation', async () => {
  const registry = inMemoryRegistry();
  registry.renewLease = async () => {
    throw new LangGraphRuntimeError('langgraph_concurrency_conflict');
  };
  let releaseGraph;
  let abortSeen = false;
  let active = 0;
  let peak = 0;
  let staleCheckpointCommits = 0;
  let staleFenceError;
  const input = state();
  const graph = {
    async invoke(_current, config) {
      active += 1;
      peak = Math.max(peak, active);
      config.signal.addEventListener('abort', () => { abortSeen = true; });
      await new Promise((resolve) => { releaseGraph = resolve; });
      try {
        requireTenantBinding(input.threadId).leaseGuard.assertActive();
        staleCheckpointCommits += 1;
        return state({ lifecycleNode: 'slow_node', completedNodes: ['slow_node'] });
      } catch (error) {
        staleFenceError = error;
        throw error;
      } finally {
        active -= 1;
      }
    },
    async getState() { return { next: [] }; },
  };
  const harness = runtimeHarness({ registry, graph, config: { operationTimeoutMs: 800 } });
  await harness.runtime.setup();

  const invocation = harness.runtime.invoke({ tenantId: input.tenantId, factoryRunId: input.factoryRunId });
  await assert.rejects(invocation, { code: 'langgraph_concurrency_conflict' });
  assert.equal(abortSeen, true);
  assert.equal(registry.record.status, 'active');
  await assert.rejects(harness.runtime.resume({ tenantId: input.tenantId, threadId: input.threadId }), {
    code: 'langgraph_concurrency_conflict',
  });
  assert.equal(peak, 1);

  releaseGraph();
  await waitFor(() => registry.counters.releases === 1);
  assert.equal(staleCheckpointCommits, 0);
  assert.equal(staleFenceError?.code, 'langgraph_concurrency_conflict');
  assert.equal(registry.record.status, 'active');
});

test('complete setup and shallow health operations enforce the stable timeout', async () => {
  const setup = runtimeHarness({ query: async () => new Promise(() => {}) });
  await assert.rejects(setup.runtime.setup(), { safeDetails: { reason: 'operation_timeout' } });

  const health = runtimeHarness();
  await health.runtime.setup();
  health.registry.stats = async () => new Promise(() => {});
  await assert.rejects(health.runtime.health(), { safeDetails: { reason: 'operation_timeout' } });
});

test('timed-out deep health removes its synthetic registry and schedules post-settlement cleanup', async () => {
  let deleteCalls = 0;
  const harness = runtimeHarness({
    put: async () => new Promise(() => {}),
    deleteThread: async () => { deleteCalls += 1; },
  });
  await harness.runtime.setup();
  await assert.rejects(harness.runtime.health({ deep: true }), { safeDetails: { reason: 'operation_timeout' } });
  await waitFor(() => harness.registry.counters.removes >= 1);
  assert.ok(deleteCalls >= 1);
});

test('owned pool close enforces the stable timeout instead of hanging forever', async () => {
  const harness = runtimeHarness({ ownsPool: true, end: async () => new Promise(() => {}) });
  await assert.rejects(harness.runtime.close(), { safeDetails: { reason: 'operation_timeout' } });
});

test('hung invoke registration and resume binding time out before acquiring a lease', async () => {
  let finishRegister;
  let registerAcquires = 0;
  let graphInvocations = 0;
  const invokeRegistry = inMemoryRegistry();
  invokeRegistry.register = async () => new Promise((resolve) => { finishRegister = resolve; });
  invokeRegistry.acquireLease = async () => { registerAcquires += 1; };
  const invoke = runtimeHarness({
    registry: invokeRegistry,
    graph: { async invoke(input) { graphInvocations += 1; return input; }, async getState() { return { next: [] }; } },
  });
  await invoke.runtime.setup();
  await assert.rejects(invoke.runtime.invoke({ tenantId: state().tenantId, factoryRunId: state().factoryRunId }), {
    safeDetails: { reason: 'operation_timeout' },
  });
  finishRegister({});
  await delay(20);
  assert.deepEqual({ registerAcquires, graphInvocations }, { registerAcquires: 0, graphInvocations: 0 });

  let finishBinding;
  let resumeAcquires = 0;
  const resumeRegistry = inMemoryRegistry();
  resumeRegistry.assertBinding = async () => new Promise((resolve) => { finishBinding = resolve; });
  resumeRegistry.acquireLease = async () => { resumeAcquires += 1; };
  const resume = runtimeHarness({ registry: resumeRegistry });
  await resume.runtime.setup();
  await assert.rejects(resume.runtime.resume({ tenantId: state().tenantId, threadId: state().threadId }), {
    safeDetails: { reason: 'operation_timeout' },
  });
  finishBinding({ factory_run_id: state().factoryRunId });
  await delay(20);
  assert.equal(resumeAcquires, 0);
});

test('hung summary history and prune database operations enforce the stable timeout', async () => {
  const summary = runtimeHarness();
  await summary.runtime.setup();
  summary.registry.summaries = async () => new Promise(() => {});
  await assert.rejects(summary.runtime.checkpointSummaries('tenant_alpha', {}), {
    safeDetails: { reason: 'operation_timeout' },
  });

  const history = runtimeHarness();
  await history.runtime.setup();
  history.registry.assertBinding = async () => new Promise(() => {});
  await assert.rejects(history.runtime.checkpointHistory({ tenantId: state().tenantId, threadId: state().threadId }), {
    safeDetails: { reason: 'operation_timeout' },
  });

  const prune = runtimeHarness();
  await prune.runtime.setup();
  prune.registry.expired = async () => new Promise(() => {});
  await assert.rejects(prune.runtime.pruneExpired(), { safeDetails: { reason: 'operation_timeout' } });
});

test('raw setup query and owned close rejections normalize to stable availability errors', async () => {
  const setup = runtimeHarness({ setup: async () => { throw Object.assign(new Error('password'), { code: '28P01' }); } });
  await assert.rejects(setup.runtime.setup(), { code: 'langgraph_checkpoint_unavailable' });

  const query = runtimeHarness({ query: async () => { throw Object.assign(new Error('connection'), { code: 'ECONNRESET' }); } });
  await assert.rejects(query.runtime.setup(), { code: 'langgraph_checkpoint_unavailable' });

  const close = runtimeHarness({ ownsPool: true, end: async () => { throw new Error('socket detail'); } });
  await assert.rejects(close.runtime.close(), { code: 'langgraph_checkpoint_unavailable' });
  await assert.rejects(timeout(Promise.reject(new LangGraphRuntimeError('langgraph_concurrency_conflict')), 100), {
    code: 'langgraph_concurrency_conflict',
  });
});
