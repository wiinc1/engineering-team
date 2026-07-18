'use strict';

const crypto = require('node:crypto');
const { asRuntimeError, LangGraphRuntimeError } = require('./errors');
const { authorizedForInterrupt, validateDecision } = require('./interrupts');

function text(value, max) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, max) : '';
}

function assertMutation(options) {
  if (options.mutationsEnabled === false) throw new LangGraphRuntimeError('langgraph_mutations_disabled');
}

function assertOperator(roles = []) {
  const set = new Set(roles);
  if (!set.has('admin') && !set.has('sre')) throw new LangGraphRuntimeError('langgraph_decision_forbidden');
}

function replayResult(row) {
  if (row.outcome === 'failed') throw new LangGraphRuntimeError(row.error_code || 'langgraph_decision_conflict');
  if (row.outcome === 'pending' || row.state === 'resolving') throw new LangGraphRuntimeError('langgraph_decision_conflict');
  return Object.freeze({ actionId: row.action_id || row.interrupt_id, outcome: 'succeeded', replayed: true });
}

async function status(deps, input) {
  const data = await deps.runtime.runStatus(input);
  const rows = await deps.registry.interruptHistory(input.tenantId, input.threadId, input.limit);
  const interruptHistory = rows.map((row) => Object.freeze({
    interruptId: row.interrupt_id, type: row.interrupt_type, state: row.state,
    action: row.resolution_action || null, actorId: row.resolver_actor_id || null,
    createdAt: row.created_at, resolvedAt: row.resolved_at || null,
  }));
  return Object.freeze({ ...data, interruptHistory: Object.freeze(interruptHistory) });
}

async function finishDecision(deps, input, pending, decision, idempotencyKey) {
  try {
    const state = await deps.runtime.resumeDecision({
      tenantId: input.tenantId, threadId: input.threadId, checkpointId: input.checkpointId,
      action: decision.action, edits: decision.edits,
    });
    await deps.registry.completeInterruptDecision({ tenantId: input.tenantId, threadId: input.threadId, interruptId: input.interruptId, idempotencyKey });
    deps.metrics.increment('langgraph_interrupt_decisions_total', { type: pending.interrupt_type, action: decision.action, outcome: 'succeeded' });
    deps.logger?.info?.('langgraph_interrupt_decision', {
      tenant_id: input.tenantId, thread_id: input.threadId, interrupt_id: input.interruptId,
      actor_id: input.actorId, action: decision.action, outcome: 'succeeded', request_id: input.requestId,
    });
    return Object.freeze({ actionId: input.interruptId, outcome: 'succeeded', replayed: false, state });
  } catch (cause) {
    const error = asRuntimeError(cause);
    await deps.registry.releaseInterruptDecision({ tenantId: input.tenantId, threadId: input.threadId, interruptId: input.interruptId, idempotencyKey });
    deps.metrics.increment('langgraph_interrupt_decisions_total', { type: pending.interrupt_type, action: decision.action, outcome: 'failed', code: error.code });
    throw error;
  }
}

async function decide(deps, input) {
  assertMutation(deps.options);
  const decision = validateDecision({ action: input.action, edits: input.edits });
  const pending = await deps.registry.pendingInterrupt(input.tenantId, input.threadId);
  if (!pending || pending.interrupt_id !== input.interruptId) throw new LangGraphRuntimeError('langgraph_interrupt_not_found');
  if (!authorizedForInterrupt({ authorizedRoles: pending.authorized_roles }, input.roles)) {
    deps.metrics.increment('langgraph_interrupt_decisions_total', { type: pending.interrupt_type, outcome: 'failed', code: 'langgraph_decision_forbidden' });
    throw new LangGraphRuntimeError('langgraph_decision_forbidden');
  }
  const idempotencyKey = text(input.idempotencyKey, 128);
  if (!idempotencyKey || !Number.isInteger(input.expectedVersion) || !input.checkpointId) throw new LangGraphRuntimeError('langgraph_decision_invalid');
  const claim = await deps.registry.claimInterruptDecision({
    tenantId: input.tenantId, threadId: input.threadId, interruptId: input.interruptId,
    checkpointId: input.checkpointId, expectedVersion: input.expectedVersion,
    action: decision.action, edits: decision.edits, actorId: input.actorId, idempotencyKey,
  });
  return claim.replay ? replayResult(claim.interrupt) : finishDecision(deps, input, pending, decision, idempotencyKey);
}

async function finishRunAction(deps, input, action, actionId) {
  try {
    const state = action === 'retry'
      ? await deps.runtime.retryNode({ tenantId: input.tenantId, threadId: input.threadId, node: input.node })
      : await deps.runtime.cancel({ tenantId: input.tenantId, threadId: input.threadId, reasonCode: 'operator_cancelled' });
    await deps.registry.completeRunAction(actionId);
    deps.metrics.increment('langgraph_operator_actions_total', { action, outcome: 'succeeded' });
    deps.logger?.info?.('langgraph_operator_action', {
      action_id: actionId, tenant_id: input.tenantId, thread_id: input.threadId,
      actor_id: input.actorId, action, outcome: 'succeeded', request_id: input.requestId,
    });
    return Object.freeze({ actionId, action, outcome: 'succeeded', replayed: false, state });
  } catch (cause) {
    const error = asRuntimeError(cause);
    await deps.registry.failRunAction(actionId, error.code);
    deps.metrics.increment('langgraph_operator_actions_total', { action, outcome: 'failed', code: error.code });
    throw error;
  }
}

async function runAction(deps, input) {
  assertMutation(deps.options);
  assertOperator(input.roles);
  const action = input.action;
  if (!['retry', 'cancel'].includes(action)) throw new LangGraphRuntimeError('langgraph_decision_invalid');
  const reason = text(input.reason, 500);
  const idempotencyKey = text(input.idempotencyKey, 128);
  if (!reason || !idempotencyKey || (action === 'retry' && !/^[a-z][a-z0-9_]{1,63}$/.test(String(input.node || '')))) {
    throw new LangGraphRuntimeError('langgraph_decision_invalid');
  }
  const actionId = (deps.options.idGenerator || crypto.randomUUID)();
  const claim = await deps.registry.claimRunAction({
    actionId, tenantId: input.tenantId, threadId: input.threadId, idempotencyKey,
    action, node: input.node, actorId: input.actorId, reason,
  });
  return claim.replay ? replayResult(claim.action) : finishRunAction(deps, input, action, actionId);
}

function createLangGraphOperatorService(options = {}) {
  const { runtime, registry = runtime?.registry, logger, metrics = { increment() {} } } = options;
  if (!runtime || !registry) throw new TypeError('LangGraph runtime and registry are required.');
  const deps = { runtime, registry, logger, metrics, options };
  return Object.freeze({
    status: (input) => status(deps, input),
    decide: (input) => decide(deps, input),
    retry: (input) => runAction(deps, { ...input, action: 'retry' }),
    cancel: (input) => runAction(deps, { ...input, action: 'cancel' }),
  });
}

module.exports = { assertOperator, createLangGraphOperatorService, replayResult };
