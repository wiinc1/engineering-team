'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  authorizedForInterrupt,
  createLangGraphOperatorService,
  interruptFromSnapshot,
  langGraphOperatorRoute,
  mutationEnabled,
  operatorStatus,
  sanitizeEdits,
  validateDecision,
} = require('../../lib/software-factory/langgraph');

const pending = Object.freeze({
  interrupt_id: 'interrupt-1', interrupt_type: 'execution_contract_approval',
  authorized_roles: ['pm', 'admin'], checkpoint_id: 'checkpoint-7', state: 'pending', version: 2,
});

function fixture(overrides = {}) {
  const calls = [];
  const runtime = {
    registry: null,
    async runStatus(input) { calls.push(['status', input]); return { threadId: input.threadId, status: 'paused' }; },
    async resumeDecision(input) { calls.push(['resume', input]); if (overrides.resumeError) throw overrides.resumeError; return { lifecycleStatus: 'running' }; },
    async retryNode(input) { calls.push(['retry', input]); return { lifecycleStatus: 'running' }; },
    async cancel(input) { calls.push(['cancel', input]); return { lifecycleStatus: 'cancelled' }; },
  };
  const registry = {
    async interruptHistory() { return [{ interrupt_id: 'interrupt-0', interrupt_type: 'review', state: 'resolved', resolution_action: 'accept' }]; },
    async pendingInterrupt() { return overrides.pending === null ? null : { ...pending, ...overrides.pending }; },
    async claimInterruptDecision(input) { calls.push(['claimDecision', input]); return overrides.decisionClaim || { replay: false, interrupt: pending }; },
    async completeInterruptDecision(input) { calls.push(['completeDecision', input]); return {}; },
    async releaseInterruptDecision(input) { calls.push(['releaseDecision', input]); },
    async claimRunAction(input) { calls.push(['claimAction', input]); return overrides.actionClaim || { replay: false, action: { action_id: input.actionId } }; },
    async completeRunAction(input) { calls.push(['completeAction', input]); },
    async failRunAction(...input) { calls.push(['failAction', ...input]); },
  };
  runtime.registry = registry;
  return { calls, service: createLangGraphOperatorService({
    runtime, registry, mutationsEnabled: overrides.mutationsEnabled ?? true,
    idGenerator: () => '00000000-0000-4000-8000-000000000282',
  }) };
}

test('interrupt contract validates allowlisted decisions and role policy', () => {
  assert.deepEqual(validateDecision({ action: 'accept' }), { action: 'accept', edits: null });
  assert.deepEqual(sanitizeEdits({ summary: 'bounded edit' }), { summary: 'bounded edit' });
  assert.throws(() => validateDecision({ action: 'delete' }), { code: 'langgraph_decision_invalid' });
  assert.throws(() => validateDecision({ action: 'edit', edits: {} }), { code: 'langgraph_decision_invalid' });
  assert.equal(authorizedForInterrupt({ authorizedRoles: ['pm'] }, ['pm']), true);
  assert.equal(authorizedForInterrupt({ authorizedRoles: ['pm'] }, ['sre']), false);
  assert.equal(authorizedForInterrupt({ authorizedRoles: ['pm'] }, ['admin']), true);
});

test('status is server-derived and includes bounded durable interrupt history', async () => {
  const { service } = fixture();
  const result = await service.status({ tenantId: 'tenant-one', threadId: 'thread-1' });
  assert.equal(result.status, 'paused');
  assert.deepEqual(result.interruptHistory[0], {
    interruptId: 'interrupt-0', type: 'review', state: 'resolved', action: 'accept',
    actorId: null, createdAt: undefined, resolvedAt: null,
  });
});

test('authorized fresh decision claims and resumes the exact checkpoint once', async () => {
  const { service, calls } = fixture();
  const result = await service.decide({
    tenantId: 'tenant-one', threadId: 'thread-1', interruptId: 'interrupt-1',
    checkpointId: 'checkpoint-7', expectedVersion: 2, action: 'edit', edits: { summary: 'clarified' },
    actorId: 'pm-1', roles: ['pm'], idempotencyKey: 'decision-1', requestId: 'req-1',
  });
  assert.equal(result.replayed, false);
  assert.equal(calls.filter(([name]) => name === 'resume').length, 1);
  assert.equal(calls.filter(([name]) => name === 'completeDecision').length, 1);
  assert.equal(calls.find(([name]) => name === 'resume')[1].checkpointId, 'checkpoint-7');
});

test('unauthorized, missing, duplicate, and disabled decisions fail closed', async () => {
  const denied = fixture();
  await assert.rejects(() => denied.service.decide({
    tenantId: 'tenant-one', threadId: 'thread-1', interruptId: 'interrupt-1', checkpointId: 'checkpoint-7',
    expectedVersion: 2, action: 'accept', actorId: 'sre-1', roles: ['sre'], idempotencyKey: 'd-1',
  }), { code: 'langgraph_decision_forbidden' });
  assert.equal(denied.calls.length, 0);
  await assert.rejects(() => fixture({ pending: null }).service.decide({
    tenantId: 'tenant-one', threadId: 'thread-1', interruptId: 'interrupt-1', action: 'accept', roles: ['pm'],
  }), { code: 'langgraph_interrupt_not_found' });
  const duplicate = fixture({ decisionClaim: { replay: true, interrupt: { ...pending, state: 'resolved' } } });
  assert.equal((await duplicate.service.decide({
    tenantId: 'tenant-one', threadId: 'thread-1', interruptId: 'interrupt-1', checkpointId: 'checkpoint-7',
    expectedVersion: 2, action: 'accept', actorId: 'pm-1', roles: ['pm'], idempotencyKey: 'd-2',
  })).replayed, true);
  assert.equal(duplicate.calls.some(([name]) => name === 'resume'), false);
  await assert.rejects(() => fixture({ mutationsEnabled: false }).service.decide({}), { code: 'langgraph_mutations_disabled' });
});

test('resume failure releases the decision claim for safe recovery', async () => {
  const { service, calls } = fixture({ resumeError: Object.assign(new Error('private detail'), { code: 'langgraph_checkpoint_unavailable' }) });
  await assert.rejects(() => service.decide({
    tenantId: 'tenant-one', threadId: 'thread-1', interruptId: 'interrupt-1', checkpointId: 'checkpoint-7',
    expectedVersion: 2, action: 'accept', actorId: 'pm-1', roles: ['pm'], idempotencyKey: 'd-3',
  }), { code: 'langgraph_checkpoint_unavailable' });
  assert.equal(calls.some(([name]) => name === 'releaseDecision'), true);
});

test('retry and cancellation require operator role reason and idempotency', async () => {
  const { service, calls } = fixture();
  await service.retry({ tenantId: 'tenant-one', threadId: 'thread-1', node: 'qa', reason: 'recover', actorId: 'sre-1', roles: ['sre'], idempotencyKey: 'retry-1' });
  await service.cancel({ tenantId: 'tenant-one', threadId: 'thread-1', reason: 'stop', actorId: 'admin-1', roles: ['admin'], idempotencyKey: 'cancel-1' });
  assert.equal(calls.some(([name]) => name === 'retry'), true);
  assert.equal(calls.some(([name]) => name === 'cancel'), true);
  await assert.rejects(() => service.retry({ roles: ['pm'], reason: 'x', idempotencyKey: 'x', node: 'qa' }), { code: 'langgraph_decision_forbidden' });
});

test('snapshot projection and public routes expose no raw checkpoint state', () => {
  const item = interruptFromSnapshot({
    config: { configurable: { checkpoint_id: 'cp-1' } },
    tasks: [{ interrupts: [{ id: 'int-1', value: {
      type: 'review_gate', version: 1, node: 'review', factoryRunId: 'run-1', threadId: 'thread-1',
      authorizedRoles: ['pm'], waitReason: 'Review.', nextAction: 'Decide.', secret: 'not copied',
    } }] }],
  });
  assert.equal(item.payload.secret, undefined);
  assert.deepEqual(langGraphOperatorRoute('/v1/langgraph/runs/thread-1'), { kind: 'status', threadId: 'thread-1' });
  assert.equal(langGraphOperatorRoute('/v1/langgraph/runs/thread-1/raw'), null);
  assert.equal(mutationEnabled({ ffLangGraphControls: 'true' }), true);
  assert.equal(mutationEnabled({}), false);
  assert.equal(operatorStatus({ code: 'langgraph_decision_conflict' }), 409);
});
