'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, createJobOperatorService, replayOperatorAction } = require('../../lib/job-runtime/operator-service');
const { jobRuntimeRoute, normalizeRoutePath } = require('../../lib/audit/job-runtime-http');
const { createDeliveryRegistry, normalizeRecord } = require('../../lib/job-runtime/registry');

const base = Object.freeze({
  deliveryId: '00000000-0000-4000-8000-000000000288',
  tenantId: 'tenant-one', graphileJobId: '42', status: 'delivery_failed', operatorVersion: 3,
});
const operatorInput = Object.freeze({
  tenantId: 'tenant-one', deliveryId: base.deliveryId, actorId: 'sre-1',
  reason: 'recover', expectedVersion: 3, idempotencyKey: 'operation-1', requestId: 'req-1',
});

function fixture(overrides = {}) {
  const calls = [];
  const registry = {
    async findForTenant(tenantId, deliveryId) { calls.push(['get', tenantId, deliveryId]); return overrides.job === null ? null : { ...base, ...overrides.job }; },
    async listOperatorHistory() { return overrides.history || []; },
    async claimOperatorAction(input) {
      calls.push(['claim', input]);
      return overrides.claim || { replay: false, action: { action_id: input.actionId }, delivery: { ...base, ...overrides.job } };
    },
    async completeOperatorAction(input) { calls.push(['complete', input]); return { ...base, status: input.status, operatorVersion: 4 }; },
    async failOperatorAction(...args) { calls.push(['fail', ...args]); },
  };
  const adapter = {
    async retry(...args) { calls.push(['retry', ...args]); if (overrides.retryError) throw overrides.retryError; },
    async cancel(...args) { calls.push(['cancel', ...args]); },
  };
  const runtime = overrides.runtime || { async drain(reason) { calls.push(['drain', reason]); return { state: 'draining' }; } };
  return { calls, service: createJobOperatorService({
    registry, adapter, runtime, logger: overrides.logger, metrics: overrides.metrics,
    idGenerator: overrides.defaultId ? undefined : () => '00000000-0000-4000-8000-000000000001',
  }) };
}

test('operator detail lookup is tenant-scoped and returns sanitized history', async () => {
  const { service, calls } = fixture({ history: [{ action: 'retry' }] });
  const result = await service.get('tenant-one', base.deliveryId);
  assert.equal(result.job.tenantId, 'tenant-one');
  assert.deepEqual(result.history, [{ action: 'retry' }]);
  assert.deepEqual(calls[0], ['get', 'tenant-one', base.deliveryId]);
  await assert.rejects(() => fixture({ job: null }).service.get('tenant-two', base.deliveryId), { code: 'job_not_found' });
});

test('retry is idempotent, versioned, and uses only the adapter public operation', async () => {
  const { service, calls } = fixture();
  const result = await service.act({
    tenantId: 'tenant-one', deliveryId: base.deliveryId, actorId: 'sre-1', requestId: 'req-1',
    action: 'retry', reason: 'recover transient dependency', expectedVersion: 3, idempotencyKey: 'retry-1',
  });
  assert.equal(result.job.status, 'redelivery_pending');
  assert.equal(result.resultingVersion, 4);
  assert.equal(calls.filter(([name]) => name === 'retry').length, 1);
  assert.equal(calls.filter(([name]) => name === 'complete').length, 1);
  assert.deepEqual(calls.find(([name]) => name === 'claim')[1], {
    tenantId: 'tenant-one', deliveryId: base.deliveryId, actorId: 'sre-1', requestId: 'req-1',
    action: 'retry', reason: 'recover transient dependency', expectedVersion: 3,
    idempotencyKey: 'retry-1', actionId: '00000000-0000-4000-8000-000000000001',
  });
  const retry = calls.find(([name]) => name === 'retry');
  assert.equal(retry[1], '42');
  assert.ok(retry[2].runAt instanceof Date);
  assert.deepEqual(calls.find(([name]) => name === 'complete')[1], {
    tenantId: 'tenant-one', deliveryId: base.deliveryId, expectedVersion: 3,
    actionId: '00000000-0000-4000-8000-000000000001', status: 'redelivery_pending',
  });
  assert.equal(result.replayed, false);
  assert.equal(result.actionId, '00000000-0000-4000-8000-000000000001');
  assert.equal(JSON.stringify(calls).includes('payload'), false);
});

test('cancel supports pending application records and failed actions remain audited', async () => {
  const pending = fixture({ job: { graphileJobId: null, status: 'pending_enqueue' } });
  const cancelled = await pending.service.act({
    tenantId: 'tenant-one', deliveryId: base.deliveryId, actorId: 'admin-1', action: 'cancel',
    reason: 'duplicate request', expectedVersion: 3, idempotencyKey: 'cancel-1', requestId: 'req-2',
  });
  assert.equal(cancelled.job.status, 'delivery_cancelled');
  assert.equal(pending.calls.some(([name]) => name === 'cancel'), false);

  const conflict = fixture({ job: { status: 'running' } });
  await assert.rejects(() => conflict.service.act({
    tenantId: 'tenant-one', deliveryId: base.deliveryId, actorId: 'sre-1', action: 'cancel',
    reason: 'unsafe while locked', expectedVersion: 3, idempotencyKey: 'cancel-2', requestId: 'req-3',
  }), { code: 'job_action_conflict' });
  assert.equal(conflict.calls.some(([name]) => name === 'fail'), true);
});

test('action input fails closed and replay preserves prior outcomes', async () => {
  const service = fixture().service;
  assert.deepEqual(ACTIONS, { RETRY: 'retry', REQUEUE: 'requeue', CANCEL: 'cancel' });
  for (const input of [
    { action: 'unknown', reason: 'x', idempotencyKey: 'x', expectedVersion: 0 },
    { action: 'retry', reason: '', idempotencyKey: 'x', expectedVersion: 0 },
    { action: 'retry', reason: 'x', idempotencyKey: '', expectedVersion: 0 },
    { action: 'retry', reason: 'x', idempotencyKey: 'x', expectedVersion: Number.NaN },
    { action: 'retry', reason: 'x', idempotencyKey: 'x', expectedVersion: -1 },
  ]) await assert.rejects(() => service.act(input), { code: 'job_action_conflict' });
  assert.throws(() => replayOperatorAction({ outcome: 'failed', error_code: 'job_action_conflict' }), { code: 'job_action_conflict' });
  assert.throws(() => replayOperatorAction({ outcome: 'failed' }), { code: 'job_action_conflict' });
  assert.throws(() => replayOperatorAction({ outcome: 'pending' }), (error) => error.safeDetails.reason === 'action_in_progress');
  assert.deepEqual(replayOperatorAction({
    action_id: 'a', delivery_id: 'd', action: 'retry', outcome: 'succeeded', resulting_version: 4,
  }), { actionId: 'a', deliveryId: 'd', action: 'retry', outcome: 'succeeded', resultingVersion: 4, replayed: true });

  const normalized = fixture();
  await normalized.service.act({
    tenantId: 'tenant-one', deliveryId: base.deliveryId, actorId: 'sre-1', action: ' RETRY ',
    reason: `  ${'r'.repeat(510)}  `, expectedVersion: 0, idempotencyKey: `  ${'i'.repeat(140)}  `,
  });
  const claim = normalized.calls.find(([name]) => name === 'claim')[1];
  assert.equal(claim.action, 'retry');
  assert.equal(claim.reason.length, 500);
  assert.equal(claim.idempotencyKey.length, 128);
});

test('drain requires a reason and delegates to runtime lifecycle', async () => {
  const { service, calls } = fixture();
  await assert.rejects(() => service.drain({ reason: '' }), { code: 'job_action_conflict' });
  assert.deepEqual(await service.drain({ reason: 'planned maintenance' }), { state: 'draining' });
  assert.deepEqual(calls.at(-1), ['drain', 'planned maintenance']);
  await assert.rejects(() => fixture({ runtime: {} }).service.drain({ reason: 'stop' }), { code: 'job_runtime_unavailable' });
});

test('operator route matching accepts only the explicit API surface', () => {
  assert.deepEqual(jobRuntimeRoute(normalizeRoutePath('/api/v1/job-runtime/jobs/abc/retry')), {
    kind: 'action', deliveryId: 'abc', action: 'retry',
  });
  assert.deepEqual(jobRuntimeRoute('/v1/job-runtime/drain'), { kind: 'drain' });
  assert.equal(jobRuntimeRoute('/v1/job-runtime/jobs/abc/delete'), null);
  assert.equal(jobRuntimeRoute('prefix/v1/job-runtime/jobs/abc/retry'), null);
  assert.equal(normalizeRoutePath(), '/');
  assert.equal(normalizeRoutePath('/api'), '/api');
  assert.deepEqual(jobRuntimeRoute('/v1/job-runtime/jobs/%E0%A4%A/retry'), {
    kind: 'action', deliveryId: '%E0%A4%A', action: 'retry',
  });
});

function deliveryRow(overrides = {}) {
  return {
    delivery_id: base.deliveryId, tenant_id: 'tenant-one', workload_id: 'probe-1',
    semantic_job_key: 'jr:v1:key', task_identifier: 'job_runtime.synthetic.v1',
    task_name: 'job_runtime.synthetic', payload_version: 1, handler_version: 1,
    graphile_job_id: '42', named_queue: 'job-runtime-synthetic',
    ordering_key: 'tenant-one:synthetic:probe-1', status: 'delivery_failed',
    attempt_count: 2, max_attempts: 3, scheduled_for: '2026-07-18T12:00:00.000Z',
    correlation_id: 'corr-1', trace_id: null, last_error_code: 'job_runtime_unavailable',
    canonical_resource_type: 'synthetic', canonical_resource_id: 'probe-1',
    operator_version: 3, created_at: '2026-07-18T11:00:00.000Z',
    updated_at: '2026-07-18T12:00:00.000Z', ...overrides,
  };
}

function transactionalPool(results) {
  const calls = [];
  const client = {
    released: false,
    async query(sql, values) {
      calls.push({ sql, values });
      const next = results.shift();
      if (next instanceof Error) throw next;
      return next || { rows: [] };
    },
    release() { this.released = true; },
  };
  return { calls, client, async connect() { return client; }, query: client.query.bind(client) };
}

test('delivery registry persists and replays operator actions transactionally', async () => {
  const action = { action_id: 'action-1', delivery_id: base.deliveryId, action: 'retry', outcome: 'pending' };
  const input = {
    actionId: 'action-1', tenantId: 'tenant-one', deliveryId: base.deliveryId,
    idempotencyKey: 'retry-1', action: 'retry', actorId: 'sre-1', reason: 'recover',
    requestId: 'req-1', expectedVersion: 3,
  };
  const pool = transactionalPool([
    { rows: [] }, { rows: [] }, { rows: [deliveryRow()] }, { rows: [action] }, { rows: [] },
  ]);
  const claim = await createDeliveryRegistry(pool).claimOperatorAction(input);
  assert.equal(claim.replay, false);
  assert.equal(claim.delivery.operatorVersion, 3);
  assert.equal(pool.client.released, true);
  assert.deepEqual(pool.calls.at(-1).sql, 'COMMIT');

  const replayPool = transactionalPool([{ rows: [] }, { rows: [{ ...action, outcome: 'succeeded' }] }, { rows: [] }]);
  const replay = await createDeliveryRegistry(replayPool).claimOperatorAction(input);
  assert.equal(replay.replay, true);
  assert.equal(replay.action.outcome, 'succeeded');
});

test('delivery registry fails stale or missing operator claims closed and rolls back', async () => {
  const input = {
    actionId: 'action-1', tenantId: 'tenant-one', deliveryId: base.deliveryId,
    idempotencyKey: 'retry-1', action: 'retry', actorId: 'sre-1', reason: 'recover',
    requestId: 'req-1', expectedVersion: 3,
  };
  const missing = transactionalPool([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
  await assert.rejects(() => createDeliveryRegistry(missing).claimOperatorAction(input), { code: 'job_not_found' });
  assert.equal(missing.calls.at(-1).sql, 'ROLLBACK');

  const stale = transactionalPool([
    { rows: [] }, { rows: [] }, { rows: [deliveryRow({ operator_version: 4 })] }, { rows: [] },
  ]);
  await assert.rejects(() => createDeliveryRegistry(stale).claimOperatorAction(input), {
    code: 'job_action_conflict', safeDetails: { reason: 'stale_version' },
  });
});

test('delivery registry completes and audits operator action outcomes', async () => {
  const updated = deliveryRow({ status: 'redelivery_pending', operator_version: 4 });
  const pool = transactionalPool([{ rows: [] }, { rows: [updated] }, { rows: [] }, { rows: [] }]);
  const registry = createDeliveryRegistry(pool);
  const result = await registry.completeOperatorAction({
    tenantId: 'tenant-one', deliveryId: base.deliveryId, expectedVersion: 3,
    actionId: 'action-1', status: 'redelivery_pending',
  });
  assert.equal(result.operatorVersion, 4);
  assert.equal(pool.client.released, true);

  const conflict = transactionalPool([{ rows: [] }, { rows: [] }, { rows: [] }]);
  await assert.rejects(() => createDeliveryRegistry(conflict).completeOperatorAction({
    tenantId: 'tenant-one', deliveryId: base.deliveryId, expectedVersion: 3,
    actionId: 'action-1', status: 'delivery_cancelled',
  }), { code: 'job_action_conflict' });

  const direct = transactionalPool([{ rows: [] }]);
  await createDeliveryRegistry(direct).failOperatorAction('action-1', 'job_runtime_unavailable');
  assert.deepEqual(direct.calls[0].values, ['action-1', 'job_runtime_unavailable']);
});

test('delivery registry maps bounded operator history and tenant detail', async () => {
  const history = {
    action_id: 'action-1', delivery_id: base.deliveryId, action: 'retry', actor_id: 'sre-1',
    reason: 'recover', request_id: 'req-1', expected_version: 3, resulting_version: null,
    outcome: 'failed', error_code: 'job_runtime_unavailable', created_at: '2026-07-18T12:00:00.000Z',
  };
  const pool = transactionalPool([{ rows: [deliveryRow()] }, { rows: [history] }]);
  const registry = createDeliveryRegistry(pool);
  assert.equal((await registry.findForTenant('tenant-one', base.deliveryId)).deliveryId, base.deliveryId);
  const rows = await registry.listOperatorHistory('tenant-one', base.deliveryId, 10);
  assert.deepEqual(rows[0], {
    actionId: 'action-1', deliveryId: base.deliveryId, action: 'retry', actorId: 'sre-1',
    reason: 'recover', requestId: 'req-1', expectedVersion: 3, resultingVersion: null,
    outcome: 'failed', errorCode: 'job_runtime_unavailable', createdAt: '2026-07-18T12:00:00.000Z',
  });
  const completedHistory = { ...history, resulting_version: 4, error_code: null };
  const completed = await createDeliveryRegistry(transactionalPool([{ rows: [completedHistory] }]))
    .listOperatorHistory('tenant-one', base.deliveryId);
  assert.equal(completed[0].resultingVersion, 4);
  assert.equal(completed[0].errorCode, null);
  const minimal = normalizeRecord({
    delivery_id: 'minimal', tenant_id: 'tenant-one', workload_id: 'probe', semantic_job_key: 'key',
    task_identifier: 'job_runtime.synthetic.v1', task_name: 'job_runtime.synthetic', payload_version: 1,
    graphile_job_id: null, named_queue: 'queue', ordering_key: null, status: 'pending_enqueue',
    attempt_count: 0, scheduled_for: '2026-07-18T12:00:00.000Z', correlation_id: 'corr', trace_id: null,
  });
  assert.equal(minimal.handlerVersion, 1);
  assert.equal('maxAttempts' in minimal, false);
  const nullable = normalizeRecord(deliveryRow({
    last_error_code: null, canonical_resource_type: null, canonical_resource_id: null,
    created_at: null, updated_at: null,
  }));
  assert.equal(nullable.createdAt, null);
  assert.equal(nullable.updatedAt, null);
});

test('operator service covers requeue, enqueued cancellation, and success telemetry', async () => {
  const messages = [];
  const metrics = { increment(...args) { messages.push(['metric', ...args]); } };
  const logger = {
    info(...args) { messages.push(['info', ...args]); },
    error(...args) { messages.push(['error', ...args]); },
  };
  const calls = [];
  const service = createJobOperatorService({
    registry: {
      async claimOperatorAction(input) { return { replay: false, delivery: { ...base, status: 'delivery_failed' }, action: { action_id: input.actionId } }; },
      async completeOperatorAction(input) { return { ...base, operatorVersion: 4, status: input.status }; },
      async failOperatorAction(...args) { calls.push(['fail', ...args]); },
    },
    adapter: {
      async retry(...args) { calls.push(['retry', ...args]); },
      async cancel(...args) { calls.push(['cancel', ...args]); },
    }, logger, metrics, idGenerator: () => 'action-1',
  });
  assert.equal((await service.act({ ...operatorInput, action: 'requeue' })).outcome, 'succeeded');
  assert.equal((await service.act({ ...operatorInput, action: 'cancel' })).outcome, 'succeeded');
  assert.equal(calls.some(([name]) => name === 'cancel'), true);
  assert.deepEqual(messages.find(([kind]) => kind === 'info'), ['info', 'job_runtime_operator_action', {
    action_id: 'action-1', action: 'requeue', outcome: 'succeeded', tenant_id: 'tenant-one',
    delivery_id: base.deliveryId, actor_id: 'sre-1', request_id: 'req-1',
  }]);
  assert.deepEqual(messages.find(([kind]) => kind === 'metric'), ['metric', 'job_runtime_operator_actions_total', {
    action: 'requeue', outcome: 'succeeded',
  }]);
  await assert.rejects(() => createJobOperatorService({ registry: {}, adapter: {} }).drain({ reason: 'stop' }), {
    code: 'job_runtime_unavailable',
  });
});

test('operator service audits normalized action failures', async () => {
  const failure = fixture({ retryError: new Error('private adapter failure') });
  await assert.rejects(() => failure.service.act({ ...operatorInput, action: 'retry' }), { code: 'job_runtime_unavailable' });
  assert.equal(failure.calls.some(([name]) => name === 'fail'), true);

  const messages = [];
  const metrics = { increment(...args) { messages.push(['metric', ...args]); } };
  const logger = {
    info(...args) { messages.push(['info', ...args]); },
    error(...args) { messages.push(['error', ...args]); },
  };
  const loggedFailure = createJobOperatorService({
    registry: {
      async claimOperatorAction(input) { return { replay: false, delivery: base, action: { action_id: input.actionId } }; },
      async failOperatorAction() {},
    },
    adapter: { async retry() { throw new Error('private'); } }, logger, metrics,
    idGenerator: () => 'action-failed',
  });
  await assert.rejects(() => loggedFailure.act({ ...operatorInput, action: 'retry' }), { code: 'job_runtime_unavailable' });
  assert.deepEqual(messages.find(([kind]) => kind === 'error'), ['error', 'job_runtime_operator_action', {
    action_id: 'action-failed', action: 'retry', outcome: 'failed', error_code: 'job_runtime_unavailable',
    tenant_id: 'tenant-one', delivery_id: base.deliveryId, actor_id: 'sre-1', request_id: 'req-1',
  }]);

});

test('operator service covers action conflicts, replay, default drain, and generated ids', async () => {
  const notEnqueued = fixture({ job: { graphileJobId: null, status: 'delivery_failed' } });
  await assert.rejects(() => notEnqueued.service.act({ ...operatorInput, action: 'retry' }), { code: 'job_action_conflict' });
  await assert.rejects(() => fixture().service.act({ ...operatorInput, action: 'unknown' }), { code: 'job_action_conflict' });
  const replay = fixture({ claim: { replay: true, action: {
    action_id: 'action-replay', delivery_id: base.deliveryId, action: 'retry', outcome: 'succeeded', resulting_version: null,
  } } });
  assert.equal((await replay.service.act({ ...operatorInput, action: 'retry' })).resultingVersion, null);

  const defaultDrain = createJobOperatorService({
    registry: {}, adapter: {}, runtime: { async drain() { return {}; } },
  });
  assert.deepEqual(await defaultDrain.drain({ ...operatorInput, reason: 'stop' }), { state: 'draining' });

  const generated = fixture({ defaultId: true });
  const generatedResult = await generated.service.act({ ...operatorInput, action: 'retry' });
  assert.match(generatedResult.actionId, /^[0-9a-f-]{36}$/);
});

test('delivery registry supports direct clients and preserves the original transactional error', async () => {
  const directResults = [
    { rows: [] }, { rows: [] }, { rows: [deliveryRow()] },
    { rows: [{ action_id: 'action-direct' }] }, { rows: [] },
  ];
  const direct = {
    async query() { return directResults.shift() || { rows: [] }; },
  };
  const claimed = await createDeliveryRegistry(direct).claimOperatorAction({
    actionId: 'action-direct', tenantId: 'tenant-one', deliveryId: base.deliveryId,
    idempotencyKey: 'direct-1', action: 'retry', actorId: 'sre-1', reason: 'recover',
    requestId: null, expectedVersion: 3,
  });
  assert.equal(claimed.replay, false);

  let rollback = false;
  const failing = {
    async query(sql) {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql === 'ROLLBACK') { rollback = true; throw new Error('rollback also failed'); }
      throw Object.assign(new Error('primary failure'), { code: 'primary' });
    },
  };
  await assert.rejects(() => createDeliveryRegistry(failing).claimOperatorAction({}), { code: 'primary' });
  assert.equal(rollback, true);
});
