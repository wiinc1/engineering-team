'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobOperatorService, replayOperatorAction } = require('../../lib/job-runtime/operator-service');
const { jobRuntimeRoute, normalizeRoutePath } = require('../../lib/audit/job-runtime-http');

const base = Object.freeze({
  deliveryId: '00000000-0000-4000-8000-000000000288',
  tenantId: 'tenant-one', graphileJobId: '42', status: 'delivery_failed', operatorVersion: 3,
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
  const runtime = { async drain(reason) { calls.push(['drain', reason]); return { state: 'draining' }; } };
  return { calls, service: createJobOperatorService({
    registry, adapter, runtime, idGenerator: () => '00000000-0000-4000-8000-000000000001',
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
  await assert.rejects(() => service.act({ action: 'retry', expectedVersion: Number.NaN }), { code: 'job_action_conflict' });
  assert.throws(() => replayOperatorAction({ outcome: 'failed', error_code: 'job_action_conflict' }), { code: 'job_action_conflict' });
  assert.throws(() => replayOperatorAction({ outcome: 'pending' }), { code: 'job_action_conflict' });
  assert.equal(replayOperatorAction({
    action_id: 'a', delivery_id: 'd', action: 'retry', outcome: 'succeeded', resulting_version: 4,
  }).replayed, true);
});

test('drain requires a reason and delegates to runtime lifecycle', async () => {
  const { service, calls } = fixture();
  await assert.rejects(() => service.drain({ reason: '' }), { code: 'job_action_conflict' });
  assert.deepEqual(await service.drain({ reason: 'planned maintenance' }), { state: 'draining' });
  assert.deepEqual(calls.at(-1), ['drain', 'planned maintenance']);
});

test('operator route matching accepts only the explicit API surface', () => {
  assert.deepEqual(jobRuntimeRoute(normalizeRoutePath('/api/v1/job-runtime/jobs/abc/retry')), {
    kind: 'action', deliveryId: 'abc', action: 'retry',
  });
  assert.deepEqual(jobRuntimeRoute('/v1/job-runtime/drain'), { kind: 'drain' });
  assert.equal(jobRuntimeRoute('/v1/job-runtime/jobs/abc/delete'), null);
});
