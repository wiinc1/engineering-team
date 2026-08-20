'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { MemorySaver } = require('@langchain/langgraph');
const {
  LangGraphRuntimeError,
  FactoryStateAnnotation,
  asRuntimeError,
  appendObjectsReducer,
  assertFactoryRunId,
  assertInvocationAllowed,
  assertTenantId,
  assertThreadId,
  boolean,
  compileFactoryGraph,
  createLangGraphHttpHandler,
  createMetricSink,
  createThreadRegistry,
  deriveThreadId,
  errorEnvelope,
  graphRunnableConfig,
  initialState,
  integer,
  jsonBytes,
  normalizeRequestId,
  projectFactoryState,
  redactedFields,
  runtimeConfig,
  scanForSecrets,
  uniqueSortedReducer,
  validateFactoryState,
} = require('../../lib/software-factory/langgraph');
const { artifact, state } = require('../fixtures/langgraph/v1');

test('thread identity is deterministic, tenant-bound, and opaque', () => {
  const first = deriveThreadId({ tenantId: 'tenant_alpha', factoryRunId: 'run:1' });
  assert.equal(first, deriveThreadId({ tenantId: 'tenant_alpha', factoryRunId: 'run:1' }));
  assert.match(first, /^lg_[a-f0-9]{48}$/);
  assert.notEqual(first, deriveThreadId({ tenantId: 'tenant_beta', factoryRunId: 'run:1' }));
});

for (const input of [
  { tenantId: 'A', factoryRunId: 'run:1' },
  { tenantId: 'tenant', factoryRunId: 'run with spaces' },
]) {
  test(`thread identity rejects invalid input ${JSON.stringify(input)}`, () => {
    assert.throws(() => deriveThreadId(input), LangGraphRuntimeError);
  });
}

test('runtime config defaults dormant and pins schema/version/budgets', () => {
  const config = runtimeConfig({}, { NODE_ENV: 'test' });
  assert.deepEqual({ enabled: config.enabled, saver: config.saver, schema: config.schema, graphVersion: config.graphVersion }, {
    enabled: false, saver: 'postgres', schema: 'langgraph_checkpoint', graphVersion: 'factory-v1',
  });
  assert.equal(config.maxStateBytes, 262144);
});

test('runtime config parses feature controls and quotas', () => {
  const config = runtimeConfig({}, {
    FF_LANGGRAPH_RUNTIME: 'yes', LANGGRAPH_GLOBAL_KILL_SWITCH: '0', LANGGRAPH_MAX_STATE_BYTES: '8192',
    LANGGRAPH_POOL_BUDGET: '3', LANGGRAPH_RETENTION_DAYS: '7', NODE_ENV: 'test',
  });
  assert.equal(config.enabled, true);
  assert.equal(config.killSwitch, false);
  assert.equal(config.poolBudget, 3);
  assert.equal(config.retentionDays, 7);
});

for (const [name, input, env] of [
  ['memory saver in production', { production: true, saver: 'memory', pool: {} }, {}],
  ['file saver in production', { production: true, saver: 'file', pool: {} }, {}],
  ['alternate schema', { schema: 'public' }, {}],
  ['unknown saver', { saver: 'redis' }, {}],
  ['invalid boolean', {}, { FF_LANGGRAPH_RUNTIME: 'sometimes' }],
  ['invalid integer', {}, { LANGGRAPH_POOL_BUDGET: '0' }],
]) {
  test(`runtime config fails closed for ${name}`, () => {
    assert.throws(() => runtimeConfig(input, env), { code: 'langgraph_configuration_invalid' });
  });
}

test('runtime invocation honors enable flag and kill switch', () => {
  assert.doesNotThrow(() => assertInvocationAllowed({ enabled: true, killSwitch: false }));
  assert.throws(() => assertInvocationAllowed({ enabled: false, killSwitch: false }), { code: 'langgraph_configuration_invalid' });
  assert.throws(() => assertInvocationAllowed({ enabled: true, killSwitch: true }), { code: 'langgraph_configuration_invalid' });
});

test('configuration primitive parsers cover explicit true/false/default and all integer bounds', () => {
  for (const value of ['true', '1', 'yes', 'on']) assert.equal(boolean(value, false), true);
  for (const value of ['false', '0', 'no', 'off']) assert.equal(boolean(value, true), false);
  assert.equal(boolean(null, true), true);
  assert.equal(boolean('', false), false);
  assert.equal(integer(null, 5, 1, 10), 5);
  assert.equal(integer('', 6, 1, 10), 6);
  assert.equal(integer('1', 5, 1, 10), 1);
  assert.equal(integer('10', 5, 1, 10), 10);
  for (const value of ['1.5', '0', '11']) assert.throws(() => integer(value, 5, 1, 10));
});

test('production configuration requires database URL only for enabled runtime without injected pool', () => {
  assert.throws(() => runtimeConfig({ production: true, enabled: true }, {}), {
    code: 'langgraph_configuration_invalid', safeDetails: { reason: 'database_url_required' },
  });
  assert.throws(() => runtimeConfig({ production: true, enabled: true }, { DATABASE_URL: 'postgres://example' }), {
    code: 'langgraph_configuration_invalid', safeDetails: { reason: 'ownership_epoch_required' },
  });
  const ownershipEpoch = '98f48812-7aa6-4ce8-9e88-184ba4bcbb52';
  assert.equal(runtimeConfig({ production: true, enabled: true, ownershipEpoch }, { DATABASE_URL: 'postgres://example' }).production, true);
  assert.equal(runtimeConfig({ enabled: true, pool: {}, ownershipEpoch }, { NODE_ENV: 'production' }).production, true);
  assert.equal(runtimeConfig({ production: false, enabled: true }, {}).production, false);
});

test('runtime config accepts explicit limits and environment saver/schema selections', () => {
  const explicit = runtimeConfig({
    enabled: true, killSwitch: false, maxStateBytes: 4096, operationTimeoutMs: 100,
    poolBudget: 1, resumeLeaseMs: 1000, retentionDays: 1, saver: 'POSTGRES',
  }, {});
  assert.equal(explicit.maxStateBytes, 4096);
  assert.equal(explicit.operationTimeoutMs, 100);
  const fromEnv = runtimeConfig({}, {
    LANGGRAPH_CHECKPOINTER: 'postgres', LANGGRAPH_CHECKPOINT_SCHEMA: 'langgraph_checkpoint', NODE_ENV: 'test',
  });
  assert.equal(fromEnv.schema, 'langgraph_checkpoint');
});

test('stable error helpers normalize unknown errors and preserve existing runtime errors', () => {
  const existing = new LangGraphRuntimeError('langgraph_state_invalid', { retryable: true, safeDetails: { reason: 'x' } });
  assert.equal(existing.retryable, true);
  assert.equal(asRuntimeError(existing), existing);
  const fallback = asRuntimeError(new Error('internal'), 'langgraph_migration_mismatch');
  assert.equal(fallback.code, 'langgraph_migration_mismatch');
  const unknown = new LangGraphRuntimeError('not_a_code');
  assert.equal(unknown.code, 'langgraph_checkpoint_unavailable');
  assert.deepEqual(unknown.safeDetails, {});
  assert.equal(errorEnvelope(new Error('internal'), 'req-fallback').error.code, 'langgraph_checkpoint_unavailable');
});

test('identity assertions distinguish invalid types, invalid formats, and valid values', () => {
  assert.equal(assertTenantId('tenant_ok'), 'tenant_ok');
  assert.equal(assertFactoryRunId('RUN:ok'), 'RUN:ok');
  const thread = deriveThreadId({ tenantId: 'tenant_ok', factoryRunId: 'RUN:ok' });
  assert.equal(assertThreadId(thread), thread);
  for (const value of [null, 'A']) assert.throws(() => assertTenantId(value));
  for (const value of [null, 'run space']) assert.throws(() => assertFactoryRunId(value));
  for (const value of [null, 'lg_short']) assert.throws(() => assertThreadId(value));
});

test('state validator accepts the complete allowlisted v1 fixture', () => {
  const valid = validateFactoryState(state({ artifacts: [artifact()], decisions: [{ code: 'ship', outcome: 'approved' }] }));
  assert.equal(valid.schemaVersion, 1);
  assert.equal(valid.artifacts.length, 1);
  assert.ok(Object.isFrozen(valid));
});

for (const [name, mutate, code = 'langgraph_state_invalid'] of [
  ['unknown field', (value) => { value.extra = true; }],
  ['oversized state', (value) => { value.artifacts = [artifact()]; value.artifacts[0].reference = 'x'.repeat(5000); }],
  ['secret key', (value) => { value.api_token = 'hidden'; }],
  ['secret value', (value) => { value.decisions = [{ code: 'ship', outcome: 'Bearer abc.def.ghi' }]; }],
  ['duplicate node', (value) => { value.completedNodes = ['queue_claim', 'queue_claim']; }],
  ['invalid node', (value) => { value.lifecycleNode = '../escape'; }],
  ['invalid artifact', (value) => { value.artifacts = [{ kind: 'report', reference: 'x', checksum: 'nope' }]; }],
  ['invalid decision', (value) => { value.decisions = [{ code: 'ship', outcome: 'maybe' }]; }],
  ['invalid attempt', (value) => { value.attempt = -1; }],
  ['invalid time', (value) => { value.updatedAt = 'not-a-time'; }],
  ['unsupported state version', (value) => { value.schemaVersion = 2; }, 'langgraph_version_unsupported'],
  ['unsupported graph version', (value) => { value.graphVersion = 'factory-v2'; }, 'langgraph_version_unsupported'],
]) {
  test(`state validator rejects ${name}`, () => {
    const value = state();
    mutate(value);
    assert.throws(() => validateFactoryState(value, { maxBytes: name === 'oversized state' ? 4096 : 262144 }), { code });
  });
}

test('secret scanner rejects cycles and private keys without echoing values', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => scanForSecrets(cyclic), { safeDetails: { reason: 'cyclic_state', field: '$.self' } });
  assert.throws(() => scanForSecrets({ note: ['-----BEGIN ', 'PRIVATE KEY-----'].join('') }), { code: 'langgraph_state_invalid' });
});

test('state helpers cover JSON serialization, projection, primitives, and default reducers', () => {
  assert.equal(jsonBytes({ ok: true }), 11);
  assert.throws(() => jsonBytes(undefined), { code: 'langgraph_state_invalid' });
  assert.throws(() => jsonBytes({ value: 1n }), { code: 'langgraph_state_invalid' });
  assert.equal(projectFactoryState(null), null);
  assert.equal(projectFactoryState('value'), 'value');
  assert.deepEqual(projectFactoryState({ ...state(), internal: 'drop' }), state());
  scanForSecrets(null);
  scanForSecrets(12);
  scanForSecrets('ordinary value');
  assert.deepEqual(uniqueSortedReducer(), []);
  assert.deepEqual(uniqueSortedReducer(null, null), []);
  assert.deepEqual(appendObjectsReducer(), []);
  assert.deepEqual(appendObjectsReducer(null, null), []);
});

test('strict state shape rejects every structural edge case', () => {
  for (const value of [null, [], 'state', Object.create(null)]) {
    assert.throws(() => validateFactoryState(value), { code: 'langgraph_state_invalid' });
  }
  const cases = [
    ['artifacts not array', { artifacts: {} }],
    ['decisions not array', { decisions: {} }],
    ['artifact not object', { artifacts: [null] }],
    ['artifact unknown key', { artifacts: [{ ...artifact(), extra: true }] }],
    ['artifact kind', { artifacts: [{ ...artifact(), kind: 'A' }] }],
    ['artifact reference type', { artifacts: [{ ...artifact(), reference: 1 }] }],
    ['artifact reference empty', { artifacts: [{ ...artifact(), reference: '' }] }],
    ['artifact reference long', { artifacts: [{ ...artifact(), reference: 'x'.repeat(513) }] }],
    ['decision not object', { decisions: [null] }],
    ['decision unknown key', { decisions: [{ code: 'ship', outcome: 'approved', extra: true }] }],
    ['decision code', { decisions: [{ code: 'A', outcome: 'approved' }] }],
    ['completed not array', { completedNodes: {} }],
    ['completed too long', { completedNodes: Array.from({ length: 129 }, (_, index) => `node_${index}`) }],
    ['completed nonstring', { completedNodes: [1] }],
    ['attempt type', { attempt: '1' }],
    ['attempt high', { attempt: 1001 }],
    ['updated type', { updatedAt: 1 }],
  ];
  for (const [, overrides] of cases) assert.throws(() => validateFactoryState(state(overrides)), { code: 'langgraph_state_invalid' });
  for (const outcome of ['rejected', 'deferred']) {
    assert.equal(validateFactoryState(state({ decisions: [{ code: 'ship', outcome }] })).decisions[0].outcome, outcome);
  }
  assert.equal(validateFactoryState(state({ lifecycleNode: 'valid_node' })).lifecycleNode, 'valid_node');
});

test('annotation default factories and reducers are deterministic', () => {
  for (const channel of Object.values(FactoryStateAnnotation.spec)) {
    assert.doesNotThrow(() => channel.initialValueFactory());
  }
  assert.equal(FactoryStateAnnotation.spec.attempt.operator(undefined, 2), 2);
  assert.equal(FactoryStateAnnotation.spec.attempt.operator(3, 2), 3);
  assert.equal(FactoryStateAnnotation.spec.tenantId.operator('old', 'new'), 'new');
});

test('reducers are deterministic, unique, and order independent', () => {
  assert.deepEqual(uniqueSortedReducer(['b'], ['a', 'b']), ['a', 'b']);
  const first = appendObjectsReducer([{ code: 'b' }], [{ code: 'a' }, { code: 'b' }]);
  const second = appendObjectsReducer([{ code: 'a' }], [{ code: 'b' }]);
  assert.deepEqual(first, second);
});

test('initial state derives server-owned identity and ignores identity injection', () => {
  const config = runtimeConfig({ enabled: true }, { NODE_ENV: 'test' });
  const result = initialState({
    tenantId: 'tenant_alpha', factoryRunId: 'run:1',
    state: { tenantId: 'tenant_evil', threadId: 'lg_bad', artifacts: [artifact()] },
  }, config, { now: () => Date.parse('2026-07-15T12:00:00.000Z') });
  assert.equal(result.tenantId, 'tenant_alpha');
  assert.equal(result.threadId, deriveThreadId({ tenantId: 'tenant_alpha', factoryRunId: 'run:1' }));
  assert.deepEqual(graphRunnableConfig(result), {
    configurable: { thread_id: result.threadId, checkpoint_ns: '' },
  });
});

test('graph compilation is deterministic and domain nodes do not receive LangGraph types', async () => {
  const saver = new MemorySaver();
  const nodes = [
    { name: 'queue_claim', execute: (current) => ({ attempt: current.attempt + 1 }) },
    { name: 'checkpoint_audit', execute: () => ({ decisions: [{ code: 'persisted', outcome: 'approved' }] }) },
  ];
  const graph = compileFactoryGraph({ nodes, checkpointer: saver, maxStateBytes: 262144, clock: { now: () => Date.parse('2026-07-15T12:00:00Z') } });
  const input = state();
  const result = await graph.invoke(input, { configurable: { thread_id: input.threadId, checkpoint_ns: 'factory' } });
  assert.deepEqual(result.completedNodes, ['checkpoint_audit', 'queue_claim']);
  assert.equal(result.lifecycleNode, 'checkpoint_audit');
  assert.equal(result.attempt, 1);
});

test('graph rejects duplicate nodes and identity mutation from domain nodes', async () => {
  assert.throws(() => compileFactoryGraph({
    nodes: [{ name: 'same_node', execute() {} }, { name: 'same_node', execute() {} }],
    maxStateBytes: 262144, clock: { now: Date.now },
  }), /Duplicate/);
  const graph = compileFactoryGraph({
    nodes: [{ name: 'bad_node', execute: () => ({ tenantId: 'tenant_evil' }) }],
    maxStateBytes: 262144, clock: { now: Date.now },
  });
  await assert.rejects(graph.invoke(state()), { code: 'langgraph_state_invalid' });
});

test('metrics expose checkpoint counters, latencies, sizes and pool gauges', () => {
  const metrics = createMetricSink();
  metrics.increment('langgraph_checkpoint_writes_total');
  metrics.observe('langgraph_checkpoint_write_latency_ms', 10);
  metrics.gauge('langgraph_active_threads', 2);
  const snapshot = metrics.snapshot();
  assert.equal(Object.values(snapshot.counters)[0], 1);
  assert.deepEqual(Object.values(snapshot.histograms)[0], [10]);
  assert.equal(Object.values(snapshot.gauges)[0], 2);
  metrics.observe('langgraph_checkpoint_write_latency_ms', 20);
  assert.deepEqual(Object.values(snapshot.histograms)[0], [10]);
  assert.deepEqual(Object.values(metrics.snapshot().histograms)[0], [10, 20]);
});

test('logging field guard drops raw state and hashes are never required in contract', () => {
  assert.deepEqual(redactedFields({ thread_id: 'lg_safe', node: 'claim', raw_state: { token: 'no' } }), {
    thread_id: 'lg_safe', node: 'claim',
  });
});

test('stable errors use standard request-id envelope without causes', () => {
  const error = new LangGraphRuntimeError('langgraph_state_invalid', { cause: new Error('secret'), safeDetails: { reason: 'shape' } });
  const envelope = errorEnvelope(error, 'req-1');
  assert.equal(envelope.error.code, 'langgraph_state_invalid');
  assert.equal(envelope.error.request_id, 'req-1');
  assert.doesNotMatch(JSON.stringify(envelope), /secret/);
});

test('request ids preserve bounded safe values and rotate malformed inputs', () => {
  assert.equal(normalizeRequestId('request-280:attempt_1'), 'request-280:attempt_1');
  for (const input of ['bad\r\nid', 'x'.repeat(129), '', ['one', 'two'], null]) {
    assert.match(normalizeRequestId(input), /^[a-f0-9-]{36}$/);
  }
  const envelope = errorEnvelope(new Error('internal'), ['multi', 'value']);
  assert.match(envelope.error.request_id, /^[a-f0-9-]{36}$/);
  assert.equal(envelope.error.requestId, envelope.error.request_id);
});

test('lease renewal is owner-conditional and fails closed when ownership is lost', async () => {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: calls.length === 1 ? [{ thread_id: 'lg_thread' }] : [] };
    },
  };
  const registry = createThreadRegistry(pool, { schema: 'langgraph_checkpoint' });
  const input = { tenantId: 'tenant_alpha', threadId: 'lg_thread', owner: 'worker-a', leaseMs: 1_000 };

  assert.equal((await registry.renewLease(input)).thread_id, 'lg_thread');
  assert.match(calls[0].sql, /lease_owner = \$3/);
  assert.match(calls[0].sql, /\$4::integer \* INTERVAL '1 millisecond'/);
  assert.deepEqual(calls[0].values, ['tenant_alpha', 'lg_thread', 'worker-a', 1_000]);
  await assert.rejects(registry.renewLease(input), { code: 'langgraph_concurrency_conflict' });
});

test('internal HTTP contracts tenant-filter summaries and never return checkpoint values', async () => {
  const calls = [];
  const handler = createLangGraphHttpHandler({
    async health(input) { return { status: 'ok', deep: input.deep }; },
    async checkpointSummaries(tenantId, query) {
      calls.push({ tenantId, query });
      return [{
        thread_id: state().threadId, factory_run_id: 'run:1', checkpoint_namespace: 'factory',
        graph_version: 'factory-v1', state_schema_version: 1, status: 'paused', latest_node: 'queue_claim',
        checkpoint_size_bytes: 100, checkpointed_at: 'now', retention_expires_at: 'later', created_at: 'before', updated_at: 'now',
        checkpoint: { secret: true },
      }];
    },
  });
  const response = await handler({ method: 'GET', path: '/api/v1/internal/langgraph/checkpoints', context: { tenantId: 'tenant_alpha', roles: ['reader'] }, query: {} });
  assert.equal(response.status, 200);
  assert.equal(calls[0].tenantId, 'tenant_alpha');
  assert.doesNotMatch(JSON.stringify(response), /secret|checkpoint":/);
});

test('internal HTTP contracts enforce roles, stable unavailable envelope, and query allowlist', async () => {
  const handler = createLangGraphHttpHandler({
    async health() { throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable'); },
    async checkpointSummaries() { return []; },
  });
  const forbidden = await handler({ method: 'GET', path: '/api/v1/internal/langgraph/health', context: { roles: ['reader'] } });
  assert.equal(forbidden.status, 403);
  const unavailable = await handler({ method: 'GET', path: '/api/v1/internal/langgraph/health', context: { roles: ['sre'] }, requestId: 'req-2' });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.error.request_id, 'req-2');
  const invalid = await handler({ method: 'GET', path: '/api/v1/internal/langgraph/checkpoints', context: { tenantId: 'tenant_alpha', roles: ['reader'] }, query: { status: 'raw' } });
  assert.equal(invalid.status, 400);
});
