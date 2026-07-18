'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PostgresSaver } = require('@langchain/langgraph-checkpoint-postgres');
const {
  checkpointState, createPoolBudget, GRAPH_VERSION, GuardedPostgresSaver, LangGraphRuntimeError,
} = require('../../lib/software-factory/langgraph');
const {
  createLeaseGuard, currentTenantBinding, requireTenantBinding, withTenantBinding,
} = require('../../lib/software-factory/langgraph/binding');
const { state } = require('../fixtures/langgraph/v1');

const ACCEPTED_ID = '00000000-0000-6000-8000-000000000001';
const PARENT_ID = '00000000-0000-6000-8000-000000000000';
const STALE_ID = '00000000-0000-6000-8000-000000000002';
const OWNER_A = '00000000-0000-4000-8000-000000000001';
const OWNER_B = '00000000-0000-4000-8000-000000000002';

function leaseRecord(value, owner = OWNER_A) {
  return {
    factory_run_id: value.factoryRunId, graph_version: GRAPH_VERSION, state_schema_version: 1,
    last_checkpoint_id: ACCEPTED_ID, lease_owner: owner,
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

function guardedSaver(pool, registry) {
  return new GuardedPostgresSaver(pool, {
    logger: { info() {} }, maxStateBytes: 262144,
    metrics: { increment() {}, observe() {} }, registry, schema: 'langgraph_checkpoint',
  });
}

function checkpoint(value) {
  const versions = Object.fromEntries(Object.keys(value).map((key) => [key, '1']));
  return {
    versions,
    value: {
      v: 4, id: STALE_ID, ts: new Date().toISOString(), channel_values: value,
      channel_versions: versions, versions_seen: {},
    },
  };
}

test('physically finished stale put cannot advance the accepted registry head', async (t) => {
  const value = state();
  const record = leaseRecord(value);
  let recordCalls = 0;
  const saver = guardedSaver({}, {
    async assertBinding() { return record; },
    async recordCheckpoint() { recordCalls += 1; },
  });
  let finish;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  t.mock.method(PostgresSaver.prototype, 'put', async () => {
    entered();
    await new Promise((resolve) => { finish = resolve; });
    return { configurable: { thread_id: value.threadId, checkpoint_ns: '', checkpoint_id: STALE_ID } };
  });
  const guard = createLeaseGuard(OWNER_A);
  const pending = withTenantBinding({ tenantId: value.tenantId, threadId: value.threadId, leaseGuard: guard }, () => (
    saver.put({ configurable: { thread_id: value.threadId, checkpoint_ns: '', checkpoint_id: ACCEPTED_ID } }, { channel_values: value }, {}, {})
  ));
  await started;
  guard.fail(new LangGraphRuntimeError('langgraph_concurrency_conflict'));
  finish();
  await assert.rejects(pending, { code: 'langgraph_concurrency_conflict' });
  assert.equal(recordCalls, 0);
  assert.equal(record.last_checkpoint_id, ACCEPTED_ID);
});

test('new owner loads and exposes only the accepted checkpoint parent chain', async (t) => {
  const value = state();
  const record = leaseRecord(value, OWNER_B);
  const saver = guardedSaver({}, { async assertBinding() { return record; } });
  const queried = [];
  t.mock.method(PostgresSaver.prototype, 'getTuple', async (requested) => {
    const id = requested.configurable.checkpoint_id;
    queried.push(id);
    return {
      config: { configurable: { thread_id: value.threadId, checkpoint_ns: '', checkpoint_id: id } },
      checkpoint: { channel_values: value }, metadata: {},
      parentConfig: id === ACCEPTED_ID
        ? { configurable: { thread_id: value.threadId, checkpoint_ns: '', checkpoint_id: PARENT_ID } }
        : undefined,
    };
  });
  let pendingWrites = 0;
  t.mock.method(PostgresSaver.prototype, 'putWrites', async () => { pendingWrites += 1; });
  const guard = createLeaseGuard(OWNER_B);
  await withTenantBinding({ tenantId: value.tenantId, threadId: value.threadId, leaseGuard: guard }, async () => {
    const loaded = await saver.getTuple({ configurable: { thread_id: value.threadId, checkpoint_ns: '' } });
    assert.equal(loaded.config.configurable.checkpoint_id, ACCEPTED_ID);
    const history = [];
    for await (const tuple of saver.list({ configurable: { thread_id: value.threadId, checkpoint_ns: '' } })) {
      history.push(tuple.config.configurable.checkpoint_id);
    }
    assert.deepEqual(history, [ACCEPTED_ID, PARENT_ID]);
    await saver.putWrites({ configurable: {
      thread_id: value.threadId, checkpoint_ns: '', checkpoint_id: ACCEPTED_ID,
    } }, [['channel', 'value']], 'task-1');
  });
  assert.equal(pendingWrites, 1);
  assert.doesNotMatch(queried.join(','), new RegExp(STALE_ID));
});

test('fenced saver exposes the read-only pool budget and observes concurrent activity', async () => {
  const client = { async query() { return { rows: [] }; }, release() {} };
  const basePool = {
    async connect() { return client; },
    async query() { return { rows: [] }; },
  };
  const saver = guardedSaver(createPoolBudget(basePool, 2), { async assertBinding() {} });
  assert.equal(saver.pool.langGraphBudget.limit, 2);
  const clients = await Promise.all([saver.pool.connect(), saver.pool.connect()]);
  assert.equal(saver.pool.langGraphBudget.active(), 2);
  assert.ok(saver.pool.langGraphBudget.active() > 0);
  clients.forEach((connected) => connected.release());
  assert.equal(saver.pool.langGraphBudget.active(), 0);
  assert.equal(saver.pool.langGraphBudget.waiting(), 0);
});

function transactionHarness(outcome) {
  const value = state();
  const record = leaseRecord(value);
  const counts = { begun: 0, commits: 0, rollbacks: 0, releases: 0, open: 0, writes: 0 };
  let changed = false;
  const client = {
    release() { counts.releases += 1; },
    async query(sql, values) {
      const normalized = String(sql).trim().toUpperCase();
      if (normalized === 'BEGIN') { counts.begun += 1; counts.open += 1; }
      else if (normalized === 'COMMIT') { counts.commits += 1; counts.open -= 1; }
      else if (normalized === 'ROLLBACK') { counts.rollbacks += 1; counts.open -= 1; }
      else if (normalized.startsWith('SELECT 1 FROM')) {
        const valid = record.lease_owner === values[2] && Date.parse(record.lease_expires_at) > Date.now();
        return { rows: valid ? [{ '?column?': 1 }] : [] };
      } else if (counts.open > 0) {
        counts.writes += 1;
        if (!changed) {
          changed = true;
          if (outcome === 'lost') record.lease_owner = OWNER_B;
          if (outcome === 'expired') record.lease_expires_at = new Date(Date.now() - 1_000).toISOString();
        }
      }
      return { rows: [] };
    },
  };
  let recordCalls = 0;
  const pool = { async connect() { return client; }, async query() { return { rows: [] }; } };
  const registry = {
    async assertBinding() { return record; },
    async recordCheckpoint() { recordCalls += 1; },
  };
  return { counts, get recordCalls() { return recordCalls; }, saver: guardedSaver(pool, registry), value };
}

async function exerciseTransaction(operation, outcome) {
  const harness = transactionHarness(outcome);
  const { versions, value: candidate } = checkpoint(harness.value);
  const config = { configurable: {
    thread_id: harness.value.threadId, checkpoint_ns: '', checkpoint_id: ACCEPTED_ID,
  } };
  const execute = () => withTenantBinding({
    tenantId: harness.value.tenantId, threadId: harness.value.threadId, leaseGuard: createLeaseGuard(OWNER_A),
  }, () => operation === 'put'
    ? harness.saver.put(config, candidate, {}, versions)
    : harness.saver.putWrites(config, [['custom_channel', { ok: true }]], 'task-1'));
  if (outcome === 'valid') await execute();
  else await assert.rejects(execute(), { code: 'langgraph_concurrency_conflict' });
  assert.ok(harness.counts.writes > 0, `${operation}/${outcome} must enter its transaction`);
  const expected = outcome === 'valid'
    ? { begun: 1, commits: 1, rollbacks: 0, releases: 1, open: 0 }
    : { begun: 1, commits: 0, rollbacks: 1, releases: 1, open: 0 };
  const { begun, commits, rollbacks, releases, open } = harness.counts;
  assert.deepEqual({ begun, commits, rollbacks, releases, open }, expected);
  assert.equal(harness.recordCalls, operation === 'put' && outcome === 'valid' ? 1 : 0);
}

test('commit fence closes put and pending-write transactions for valid lost and expired leases', async () => {
  for (const operation of ['put', 'putWrites']) {
    for (const outcome of ['valid', 'lost', 'expired']) await exerciseTransaction(operation, outcome);
  }
});

test('checkpoint extraction rejects missing channels and supports start and flattened shapes', () => {
  const value = state();
  assert.throws(() => checkpointState(), {
    code: 'langgraph_state_invalid', safeDetails: { reason: 'checkpoint_channels' },
  });
  assert.throws(() => checkpointState({ channel_values: null }), { code: 'langgraph_state_invalid' });
  assert.equal(checkpointState({ channel_values: { __start__: value } }), value);
  assert.deepEqual(checkpointState({ channel_values: value }), value);
});

async function assertBindingFailure(overrides, expected) {
  const value = state();
  const record = { ...leaseRecord(value), ...overrides };
  const saver = guardedSaver({}, { async assertBinding() { return record; } });
  const guard = createLeaseGuard(OWNER_A);
  await assert.rejects(withTenantBinding({
    tenantId: value.tenantId, threadId: value.threadId, leaseGuard: guard,
  }, () => saver.assertBound({ configurable: { thread_id: value.threadId } })), expected);
}

test('guarded saver rejects lost expired and incompatible registry bindings', async () => {
  await assertBindingFailure({ lease_owner: OWNER_B }, { code: 'langgraph_concurrency_conflict' });
  await assertBindingFailure({ lease_expires_at: null }, { code: 'langgraph_concurrency_conflict' });
  await assertBindingFailure({ lease_expires_at: new Date(0).toISOString() }, { code: 'langgraph_concurrency_conflict' });
  await assertBindingFailure({ graph_version: 'factory-v2' }, { code: 'langgraph_version_unsupported' });
  await assertBindingFailure({ state_schema_version: 2 }, { code: 'langgraph_version_unsupported' });
});

test('guarded saver rejects checkpoint identity mismatch and a non-head parent', async (t) => {
  const value = state();
  const record = leaseRecord(value);
  const metrics = { errors: 0, increment(name) { if (name.includes('errors')) this.errors += 1; }, observe() {} };
  const saver = new GuardedPostgresSaver({}, {
    logger: { info() {} }, maxStateBytes: 262144, metrics,
    registry: { async assertBinding() { return record; } }, schema: 'langgraph_checkpoint',
  });
  const guard = createLeaseGuard(OWNER_A);
  await assert.rejects(withTenantBinding({
    tenantId: value.tenantId, threadId: value.threadId, leaseGuard: guard,
  }, () => saver.assertBound({ configurable: { thread_id: value.threadId } }, {
    channel_values: state({ factoryRunId: 'other-run' }),
  })), { code: 'langgraph_tenant_mismatch' });
  const basePut = t.mock.method(PostgresSaver.prototype, 'put', async () => ({}));
  await assert.rejects(withTenantBinding({
    tenantId: value.tenantId, threadId: value.threadId, leaseGuard: guard,
  }, () => saver.put({ configurable: {
    thread_id: value.threadId, checkpoint_id: PARENT_ID,
  } }, { channel_values: value }, {}, {})), { code: 'langgraph_concurrency_conflict' });
  assert.equal(basePut.mock.callCount(), 0);
  assert.equal(metrics.errors, 1);
});

test('guarded pending writes require the exact accepted registry head', async (t) => {
  const value = state();
  const record = leaseRecord(value);
  const saver = guardedSaver({}, {
    async assertBinding() { return record; }, async isAcceptedCheckpoint() { return false; },
  });
  const delegated = t.mock.method(PostgresSaver.prototype, 'putWrites', async () => undefined);
  const guard = createLeaseGuard(OWNER_A);
  const run = (checkpointId) => withTenantBinding({
    tenantId: value.tenantId, threadId: value.threadId, leaseGuard: guard,
  }, () => saver.putWrites({ configurable: {
    thread_id: value.threadId, checkpoint_ns: '', checkpoint_id: checkpointId,
  } }, [['channel', 'value']], 'task-1'));
  await assert.rejects(run(undefined), { code: 'langgraph_concurrency_conflict' });
  await assert.rejects(run(STALE_ID), { code: 'langgraph_concurrency_conflict' });
  await run(ACCEPTED_ID);
  assert.equal(delegated.mock.callCount(), 1);
});

test('late pending writes allow accepted ancestors but reject physical stale branches', async (t) => {
  const value = state();
  const record = { ...leaseRecord(value), last_checkpoint_id: STALE_ID };
  const acceptedLookups = [];
  const saver = guardedSaver({}, {
    async assertBinding() { return record; },
    async isAcceptedCheckpoint(input) {
      acceptedLookups.push(input);
      return input.checkpointId === ACCEPTED_ID;
    },
  });
  const delegated = t.mock.method(PostgresSaver.prototype, 'putWrites', async () => undefined);
  const guard = createLeaseGuard(OWNER_A);
  const run = (checkpointId) => withTenantBinding({
    tenantId: value.tenantId, threadId: value.threadId, leaseGuard: guard,
  }, () => saver.putWrites({ configurable: {
    thread_id: value.threadId, checkpoint_ns: '', checkpoint_id: checkpointId,
  } }, [['channel', 'value']], 'task-1'));
  await run(ACCEPTED_ID);
  await assert.rejects(run(PARENT_ID), { code: 'langgraph_concurrency_conflict' });
  assert.equal(delegated.mock.callCount(), 1);
  assert.deepEqual([...new Set(acceptedLookups.map((input) => input.checkpointId))], [ACCEPTED_ID, PARENT_ID]);
});

test('pending writes wait for their in-flight checkpoint to become the exact accepted head', async (t) => {
  const value = state();
  const record = leaseRecord(value);
  let releasePut;
  const putBlocked = new Promise((resolve) => { releasePut = resolve; });
  let putEntered;
  const entered = new Promise((resolve) => { putEntered = resolve; });
  t.mock.method(PostgresSaver.prototype, 'put', async () => {
    putEntered();
    await putBlocked;
    return { configurable: { thread_id: value.threadId, checkpoint_ns: '', checkpoint_id: STALE_ID } };
  });
  const delegated = t.mock.method(PostgresSaver.prototype, 'putWrites', async () => undefined);
  const saver = guardedSaver({}, {
    async assertBinding() { return record; },
    async recordCheckpoint(input) { record.last_checkpoint_id = input.checkpointId; },
    async isAcceptedCheckpoint() { return false; },
  });
  const guard = createLeaseGuard(OWNER_A);
  const binding = { tenantId: value.tenantId, threadId: value.threadId, leaseGuard: guard };
  const { value: candidate, versions } = checkpoint(value);
  let writesSettled = false;
  const writes = withTenantBinding(binding, () => saver.putWrites({ configurable: {
    thread_id: value.threadId, checkpoint_ns: '', checkpoint_id: STALE_ID,
  } }, [['channel', 'value']], 'task-1')).finally(() => { writesSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  const put = withTenantBinding(binding, () => saver.put({ configurable: {
    thread_id: value.threadId, checkpoint_ns: '', checkpoint_id: ACCEPTED_ID,
  } }, candidate, {}, versions));
  await entered;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writesSettled, false);
  assert.equal(delegated.mock.callCount(), 0);
  releasePut();
  await Promise.all([put, writes]);
  assert.equal(record.last_checkpoint_id, STALE_ID);
  assert.equal(delegated.mock.callCount(), 1);
});

test('guarded saver pins explicit reads to accepted ancestry and normalizes read failures', async (t) => {
  const value = state();
  const record = leaseRecord(value);
  const metrics = { errors: 0, increment(name) { if (name.includes('errors')) this.errors += 1; }, observe() {} };
  const saver = new GuardedPostgresSaver({}, {
    logger: { info() {} }, maxStateBytes: 262144, metrics,
    registry: { async assertBinding() { return record; } }, schema: 'langgraph_checkpoint',
  });
  const ids = [];
  t.mock.method(PostgresSaver.prototype, 'getTuple', async (config) => {
    const id = config.configurable.checkpoint_id;
    ids.push(id);
    if (id === ACCEPTED_ID) return {
      config: { configurable: { thread_id: value.threadId, checkpoint_id: id } },
      checkpoint: { channel_values: value }, metadata: {},
      parentConfig: { configurable: { thread_id: value.threadId, checkpoint_id: PARENT_ID } },
    };
    return id === PARENT_ID ? {
      config: { configurable: { thread_id: value.threadId, checkpoint_id: id } },
      checkpoint: { channel_values: value }, metadata: {},
    } : undefined;
  });
  const guard = createLeaseGuard(OWNER_A);
  const loaded = await withTenantBinding({ tenantId: value.tenantId, threadId: value.threadId, leaseGuard: guard }, () => (
    saver.getTuple({ configurable: { thread_id: value.threadId, checkpoint_id: PARENT_ID } })
  ));
  assert.equal(loaded.config.configurable.checkpoint_id, PARENT_ID);
  assert.deepEqual(ids, [ACCEPTED_ID, PARENT_ID]);
  t.mock.restoreAll();
  t.mock.method(PostgresSaver.prototype, 'getTuple', async () => { throw new Error('database detail'); });
  await assert.rejects(withTenantBinding({ tenantId: value.tenantId, threadId: value.threadId, leaseGuard: guard }, () => (
    saver.getTuple({ configurable: { thread_id: value.threadId } })
  )), { code: 'langgraph_checkpoint_unavailable' });
  assert.equal(metrics.errors, 1);
});

test('guarded history applies nested filters before cursors and limits', async (t) => {
  const value = state();
  const record = leaseRecord(value);
  const saver = guardedSaver({}, { async assertBinding() { return record; } });
  t.mock.method(PostgresSaver.prototype, 'getTuple', async (config) => {
    const id = config.configurable.checkpoint_id;
    if (id !== ACCEPTED_ID) return undefined;
    return {
      config: { configurable: { thread_id: value.threadId, checkpoint_id: id } },
      checkpoint: { channel_values: value }, metadata: { source: 'loop', nested: { accepted: true } },
      parentConfig: { configurable: { thread_id: value.threadId, checkpoint_id: PARENT_ID } },
    };
  });
  const binding = { tenantId: value.tenantId, threadId: value.threadId };
  const matching = [];
  await withTenantBinding(binding, async () => {
    for await (const tuple of saver.list({ configurable: { thread_id: value.threadId } }, {
      filter: { nested: { accepted: true } }, before: { configurable: { checkpoint_id: STALE_ID } }, limit: 1,
    })) matching.push(tuple.config.configurable.checkpoint_id);
  });
  assert.deepEqual(matching, [ACCEPTED_ID]);
  const zero = [];
  await withTenantBinding(binding, async () => {
    for await (const tuple of saver.list({ configurable: { thread_id: value.threadId } }, { limit: 0 })) zero.push(tuple);
  });
  assert.deepEqual(zero, []);
});

test('guarded delete requires binding and delegates only with server context', async (t) => {
  const value = state();
  let tenant = value.tenantId;
  const saver = guardedSaver({}, {
    async assertBinding(inputTenant) {
      if (inputTenant !== tenant) throw new LangGraphRuntimeError('langgraph_tenant_mismatch');
      return leaseRecord(value);
    },
  });
  const delegated = t.mock.method(PostgresSaver.prototype, 'deleteThread', async (threadId) => threadId);
  await assert.rejects(saver.deleteThread(value.threadId), { code: 'langgraph_tenant_mismatch' });
  tenant = 'tenant_other';
  await assert.rejects(withTenantBinding({ tenantId: value.tenantId, threadId: value.threadId }, () => (
    saver.deleteThread(value.threadId)
  )), { code: 'langgraph_tenant_mismatch' });
  assert.equal(delegated.mock.callCount(), 0);
  tenant = value.tenantId;
  const result = await withTenantBinding({ tenantId: value.tenantId, threadId: value.threadId }, () => (
    saver.deleteThread(value.threadId)
  ));
  assert.equal(result, value.threadId);
  assert.equal(delegated.mock.callCount(), 1);
});

test('binding guard retains its first failure and rejects incomplete server context', async () => {
  const value = state();
  assert.equal(currentTenantBinding(), null);
  await withTenantBinding({ threadId: value.threadId }, async () => {
    assert.throws(() => requireTenantBinding(value.threadId), { code: 'langgraph_tenant_mismatch' });
  });
  const first = new LangGraphRuntimeError('langgraph_concurrency_conflict');
  const guard = createLeaseGuard(OWNER_A);
  assert.doesNotThrow(() => guard.assertActive());
  guard.fail(first);
  guard.fail(new LangGraphRuntimeError('langgraph_checkpoint_unavailable'));
  assert.throws(() => guard.assertActive(), (error) => error === first);
});

test('unguarded maintenance put commits without a lease fence and records a null owner', async () => {
  const value = state();
  const record = { ...leaseRecord(value), last_checkpoint_id: null };
  const queries = [];
  const client = {
    release() {},
    async query(sql) {
      queries.push(String(sql).trim());
      return { rows: String(sql).trim().startsWith('SELECT 1 FROM') ? [{ ok: 1 }] : [] };
    },
  };
  const pool = { async connect() { return client; }, async query(sql) { queries.push(sql); return { rows: [] }; } };
  let accepted;
  const saver = guardedSaver(pool, {
    async assertBinding() { return record; }, async recordCheckpoint(input) { accepted = input; },
  });
  const { value: candidate, versions } = checkpoint(value);
  const result = await withTenantBinding({ tenantId: value.tenantId, threadId: value.threadId }, () => (
    saver.put({ configurable: { thread_id: value.threadId } }, candidate, null, versions)
  ));
  assert.equal(result.configurable.checkpoint_id, STALE_ID);
  assert.equal(accepted.owner, null);
  assert.ok(queries.some((sql) => sql === 'COMMIT'));
  assert.ok(queries.some((sql) => String(sql).includes('factory_threads')));
  assert.ok(!queries.some((sql) => String(sql).includes('lease_owner = $3')));
});

test('empty registry head avoids saver reads and history stops on missing accepted tuple', async (t) => {
  const value = state();
  const record = { ...leaseRecord(value), last_checkpoint_id: null };
  const saver = guardedSaver({}, { async assertBinding() { return record; } });
  const getTuple = t.mock.method(PostgresSaver.prototype, 'getTuple', async () => undefined);
  await withTenantBinding({ tenantId: value.tenantId, threadId: value.threadId }, async () => {
    assert.equal(await saver.getTuple({ configurable: { thread_id: value.threadId } }), undefined);
    record.last_checkpoint_id = ACCEPTED_ID;
    const history = [];
    for await (const tuple of saver.list({ configurable: { thread_id: value.threadId } })) {
      history.push(tuple);
    }
    assert.deepEqual(history, []);
  });
  assert.equal(getTuple.mock.callCount(), 1);
});

test('history filters reject nonmatching nested array and cursor branches', async (t) => {
  const value = state();
  const record = leaseRecord(value);
  const saver = guardedSaver({}, { async assertBinding() { return record; } });
  t.mock.method(PostgresSaver.prototype, 'getTuple', async () => ({
    config: { configurable: { thread_id: value.threadId, checkpoint_id: ACCEPTED_ID } },
    checkpoint: { channel_values: value }, metadata: { nested: { accepted: true }, tags: ['one'] },
  }));
  const binding = { tenantId: value.tenantId, threadId: value.threadId };
  for (const options of [
    { filter: { nested: { accepted: false } } },
    { filter: { tags: ['one'] } },
    { before: { configurable: { checkpoint_id: PARENT_ID } } },
  ]) {
    const history = [];
    await withTenantBinding(binding, async () => {
      for await (const tuple of saver.list({ configurable: { thread_id: value.threadId } }, options)) history.push(tuple);
    });
    assert.deepEqual(history, []);
  }
});
