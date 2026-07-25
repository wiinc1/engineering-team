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

function transactionalPool(results) {
  const pool = queuedPool(results);
  const client = { ...pool, released: false, release() { this.released = true; } };
  return { ...pool, client, async connect() { return client; } };
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

test('registry persists and reads durable interrupt records', async () => {
  const interrupt = {
    interrupt_id: 'interrupt-1', thread_id: 'lg_thread', checkpoint_id: 'cp-1',
    interrupt_type: 'review_gate', interrupt_version: 1, authorized_roles: ['pm'],
    wait_reason: 'Review.', next_action: 'Decide.', state: 'pending', version: 0,
  };
  const pool = queuedPool([{ rows: [interrupt] }, { rows: [interrupt] }, { rows: [interrupt] }, { rows: [interrupt] }]);
  const registry = createThreadRegistry(pool);
  assert.equal((await registry.recordInterrupt({
    interruptId: 'interrupt-1', tenantId: 'tenant_alpha', threadId: 'lg_thread',
    checkpointId: 'cp-1', type: 'review_gate', version: 1, payload: { node: 'review' },
    authorizedRoles: ['pm'], waitReason: 'Review.', nextAction: 'Decide.',
  })).interrupt_id, 'interrupt-1');
  assert.equal((await registry.pendingInterrupt('tenant_alpha', 'lg_thread')).state, 'pending');
  assert.equal((await registry.interruptById('tenant_alpha', 'lg_thread', 'interrupt-1')).state, 'pending');
  assert.equal((await registry.interruptHistory('tenant_alpha', 'lg_thread', 500)).length, 1);
  assert.deepEqual(pool.calls[3].values, ['tenant_alpha', 'lg_thread', 100]);
  assert.deepEqual(await createThreadRegistry(queuedPool([{ rows: [] }])).interruptHistory('tenant_alpha', 'lg_thread'), []);
  await assert.rejects(createThreadRegistry(queuedPool([{ rows: [] }])).recordInterrupt({
    interruptId: 'interrupt-1', tenantId: 'tenant_alpha', threadId: 'lg_thread',
    checkpointId: 'cp-1', type: 'review_gate', version: 1, payload: {},
    authorizedRoles: ['pm'], waitReason: 'Review.', nextAction: 'Decide.',
  }), { code: 'langgraph_decision_conflict' });
  assert.equal(await createThreadRegistry(queuedPool([{ rows: [] }])).pendingInterrupt('tenant_alpha', 'lg_thread'), null);
  assert.equal(await createThreadRegistry(queuedPool([{ rows: [] }])).interruptById('tenant_alpha', 'lg_thread', 'missing'), null);
});

test('interrupt decisions claim once and distinguish replay conflict and absence', async () => {
  const interrupt = { interrupt_id: 'interrupt-1', state: 'resolving' };
  const input = {
    tenantId: 'tenant_alpha', threadId: 'lg_thread', interruptId: 'interrupt-1', checkpointId: 'cp-1',
    action: 'accept', edits: null, actorId: 'pm-1', idempotencyKey: 'decision-1', expectedVersion: 0,
  };
  const successPool = transactionalPool([
    { rows: [] }, { rows: [] }, { rows: [interrupt] }, { rows: [] },
  ]);
  assert.equal((await createThreadRegistry(successPool).claimInterruptDecision(input)).replay, false);
  assert.equal(successPool.client.released, true);

  const replayPool = transactionalPool([{ rows: [] }, { rows: [interrupt] }, { rows: [] }]);
  assert.equal((await createThreadRegistry(replayPool).claimInterruptDecision(input)).replay, true);

  const conflictPool = transactionalPool([
    { rows: [] }, { rows: [] }, { rows: [] }, { rows: [{ exists: 1 }] }, { rows: [] },
  ]);
  await assert.rejects(() => createThreadRegistry(conflictPool).claimInterruptDecision(input), {
    code: 'langgraph_decision_conflict',
  });
  const missingPool = transactionalPool([
    { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] },
  ]);
  await assert.rejects(() => createThreadRegistry(missingPool).claimInterruptDecision(input), {
    code: 'langgraph_interrupt_not_found',
  });
});

test('interrupt decision completion and release are state guarded', async () => {
  const resolved = { interrupt_id: 'interrupt-1', state: 'resolved' };
  const cancelled = { interrupt_id: 'interrupt-1', state: 'cancelled' };
  const pool = queuedPool([{ rows: [resolved] }, { rows: [cancelled] }, { rows: [] }, { rows: [] }]);
  const registry = createThreadRegistry(pool);
  const input = {
    tenantId: 'tenant_alpha', threadId: 'lg_thread', interruptId: 'interrupt-1', idempotencyKey: 'decision-1',
  };
  assert.equal((await registry.completeInterruptDecision(input)).state, 'resolved');
  assert.equal((await registry.completeInterruptDecision({ ...input, cancelled: true })).state, 'cancelled');
  await assert.rejects(() => registry.completeInterruptDecision(input), { code: 'langgraph_decision_conflict' });
  await registry.releaseInterruptDecision(input);
  assert.match(pool.calls.at(-1).sql, /state = 'pending'/);
});

test('run actions persist idempotently and record terminal outcomes', async () => {
  const action = { action_id: 'action-1', action: 'retry', outcome: 'pending' };
  const input = {
    actionId: 'action-1', tenantId: 'tenant_alpha', threadId: 'lg_thread',
    idempotencyKey: 'retry-1', action: 'retry', node: 'qa', actorId: 'sre-1', reason: 'recover',
  };
  const pool = queuedPool([
    { rows: [action] }, { rows: [] }, { rows: [action] }, { rows: [action] },
    { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] },
  ]);
  const registry = createThreadRegistry(pool);
  assert.equal((await registry.claimRunAction(input)).replay, false);
  assert.equal((await registry.claimRunAction(input)).replay, true);
  assert.equal((await registry.completeRunAction('action-1')).outcome, 'pending');
  await assert.rejects(() => registry.completeRunAction('action-1'), { code: 'langgraph_decision_conflict' });
  await registry.failRunAction('action-1', 'langgraph_checkpoint_unavailable');

  const missing = queuedPool([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
  await assert.rejects(() => createThreadRegistry(missing).claimRunAction(input), {
    code: 'langgraph_checkpoint_unavailable', safeDetails: { reason: 'thread_not_found' },
  });
  const boundButMissing = queuedPool([{ rows: [] }, { rows: [] }, { rows: [{ thread_id: 'lg_thread' }] }]);
  await assert.rejects(() => createThreadRegistry(boundButMissing).claimRunAction(input), {
    code: 'langgraph_checkpoint_unavailable',
  });
});
