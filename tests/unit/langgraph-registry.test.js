'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createThreadRegistry } = require('../../lib/software-factory/langgraph');

function queuedPool(results) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      const next = results.shift();
      return typeof next === 'function' ? next(sql, values) : (next || { rows: [] });
    },
  };
}

function leaseInput() {
  return { tenantId: 'tenant_alpha', threadId: 'lg_thread', owner: 'worker-a', leaseMs: 1_000 };
}

test('registry registration and binding distinguish success absence and tenant mismatch', async () => {
  const input = {
    tenantId: 'tenant_alpha', factoryRunId: 'run:1', threadId: 'lg_thread', namespace: 'factory',
    graphVersion: 'factory-v1', stateSchemaVersion: 1, retentionExpiresAt: 'later',
  };
  const registered = { thread_id: input.threadId };
  const pool = queuedPool([{ rows: [registered] }, { rows: [registered] }, { rows: [] }, { rows: [] }]);
  const registry = createThreadRegistry(pool);
  assert.equal(await registry.register(input), registered);
  assert.equal(await registry.get(input.tenantId, input.threadId), registered);
  assert.equal(await registry.get(input.tenantId, 'missing'), null);
  assert.deepEqual(pool.calls[0].values, [
    input.tenantId, input.factoryRunId, input.threadId, input.namespace,
    input.graphVersion, input.stateSchemaVersion, input.retentionExpiresAt,
  ]);

  await assert.rejects(createThreadRegistry(queuedPool([{ rows: [] }])).register(input), {
    code: 'langgraph_tenant_mismatch',
  });
  await assert.rejects(createThreadRegistry(queuedPool([{ rows: [] }, { rows: [{ exists: 1 }] }]))
    .get(input.tenantId, input.threadId), { code: 'langgraph_tenant_mismatch' });
  await assert.rejects(createThreadRegistry(queuedPool([{ rows: [] }, { rows: [] }]))
    .assertBinding(input.tenantId, input.threadId), {
    code: 'langgraph_checkpoint_unavailable', safeDetails: { reason: 'thread_not_found' },
  });
});

test('registry checkpoint acceptance and leases are owner conditional', async () => {
  const accepted = { thread_id: 'lg_thread' };
  const checkpoint = {
    tenantId: 'tenant_alpha', threadId: 'lg_thread', checkpointId: 'cp-1',
    node: '', sizeBytes: 128, owner: 'worker-a',
  };
  const pool = queuedPool([
    { rows: [accepted] }, { rows: [accepted] }, { rows: [] }, { rows: [accepted] },
    { rows: [accepted] }, { rows: [accepted] }, { rows: [accepted] },
  ]);
  const registry = createThreadRegistry(pool, { schema: 'custom_schema' });
  assert.equal(await registry.recordCheckpoint(checkpoint), accepted);
  assert.equal(await registry.acquireLease(leaseInput()), accepted);
  await registry.releaseLease(leaseInput());
  assert.equal(await registry.renewLease(leaseInput()), accepted);
  assert.equal(await registry.updateStatus('tenant_alpha', 'lg_thread', 'paused'), accepted);
  assert.equal(await registry.updateStatusWithLease({ ...leaseInput(), status: 'completed' }), accepted);
  assert.match(pool.calls[0].sql, /"custom_schema"\.factory_threads/);
  assert.deepEqual(pool.calls[0].values, ['tenant_alpha', 'lg_thread', 'cp-1', null, 128, 'worker-a']);

  const conflict = queuedPool([{ rows: [] }, { rows: [accepted] }]);
  await assert.rejects(createThreadRegistry(conflict).recordCheckpoint(checkpoint), {
    code: 'langgraph_concurrency_conflict',
  });
  await assert.rejects(createThreadRegistry(queuedPool([{ rows: [] }])).recordCheckpoint({
    ...checkpoint, owner: null,
  }), { code: 'langgraph_tenant_mismatch' });
});

test('registry accepted-checkpoint lookup follows only the tenant root parent chain', async () => {
  const pool = queuedPool([{ rows: [{ accepted: true }] }, { rows: [{ accepted: false }] }, { rows: [] }]);
  const registry = createThreadRegistry(pool, { schema: 'custom_schema' });
  const input = {
    tenantId: 'tenant_alpha', threadId: 'lg_thread', namespace: '', checkpointId: 'cp-1',
  };
  assert.equal(await registry.isAcceptedCheckpoint(input), true);
  assert.equal(await registry.isAcceptedCheckpoint({ ...input, checkpointId: 'stale' }), false);
  assert.equal(await registry.isAcceptedCheckpoint({ ...input, checkpointId: 'missing' }), false);
  assert.match(pool.calls[0].sql, /WITH RECURSIVE accepted_chain/);
  assert.match(pool.calls[0].sql, /registry\.last_checkpoint_id/);
  assert.match(pool.calls[0].sql, /"custom_schema"\.checkpoints/);
  assert.deepEqual(pool.calls[0].values, ['tenant_alpha', 'lg_thread', '', 'cp-1']);
});

test('registry lease and status conflicts preserve binding semantics', async () => {
  const bound = { thread_id: 'lg_thread' };
  const leaseConflict = createThreadRegistry(queuedPool([{ rows: [] }, { rows: [bound] }]));
  await assert.rejects(leaseConflict.acquireLease(leaseInput()), { code: 'langgraph_concurrency_conflict' });
  await assert.rejects(createThreadRegistry(queuedPool([{ rows: [] }])).renewLease(leaseInput()), {
    code: 'langgraph_concurrency_conflict',
  });
  await assert.rejects(createThreadRegistry(queuedPool([{ rows: [] }]))
    .updateStatus('tenant_alpha', 'lg_thread', 'failed'), { code: 'langgraph_tenant_mismatch' });
  const statusConflict = createThreadRegistry(queuedPool([{ rows: [] }, { rows: [bound] }]));
  await assert.rejects(statusConflict.updateStatusWithLease({ ...leaseInput(), status: 'failed' }), {
    code: 'langgraph_concurrency_conflict',
  });
});

test('registry summary statistics retention and removal queries clamp inputs', async () => {
  const summary = [{ thread_id: 'one' }];
  const stats = { active: 2, stale: 1, checkpoint_bytes: '20' };
  const expired = [{ tenant_id: 'tenant_alpha', thread_id: 'one' }];
  const pool = queuedPool([
    { rows: summary }, { rows: summary }, { rows: summary }, { rows: [stats] },
    { rows: expired }, { rows: expired }, { rows: expired }, { rows: [{ thread_id: 'one' }] }, { rows: [] },
  ]);
  const registry = createThreadRegistry(pool);
  assert.equal(await registry.summaries('tenant_alpha'), summary);
  await registry.summaries('tenant_alpha', { status: 'paused', limit: -10 });
  await registry.summaries('tenant_alpha', { limit: 1_000 });
  assert.deepEqual(pool.calls.slice(0, 3).map((call) => call.values[2]), [25, 1, 100]);
  assert.equal(await registry.stats(), stats);
  assert.equal(await registry.expired(), expired);
  await registry.expired(-1);
  await registry.expired(10_000);
  assert.deepEqual(pool.calls.slice(4, 7).map((call) => call.values[0]), [100, 1, 1_000]);
  assert.equal(await registry.remove('tenant_alpha', 'one'), true);
  assert.equal(await registry.remove('tenant_alpha', 'missing'), false);
});
