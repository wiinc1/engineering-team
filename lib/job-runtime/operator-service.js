'use strict';

const crypto = require('node:crypto');
const { DELIVERY_STATUS } = require('./constants');
const { JobRuntimeError, asJobRuntimeError } = require('./errors');

const ACTIONS = Object.freeze({ RETRY: 'retry', REQUEUE: 'requeue', CANCEL: 'cancel' });
const ACTION_STATUS = Object.freeze({
  retry: new Set([DELIVERY_STATUS.RETRYING, DELIVERY_STATUS.FAILED]),
  requeue: new Set([DELIVERY_STATUS.RETRYING, DELIVERY_STATUS.FAILED, DELIVERY_STATUS.QUEUED]),
  cancel: new Set([DELIVERY_STATUS.PENDING, DELIVERY_STATUS.QUEUED, DELIVERY_STATUS.RETRYING, DELIVERY_STATUS.FAILED]),
});

function cleanText(value, max) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : '';
}

function actionResponse(row) {
  return Object.freeze({
    actionId: row.action_id,
    deliveryId: row.delivery_id,
    action: row.action,
    outcome: row.outcome,
    resultingVersion: row.resulting_version == null ? null : Number(row.resulting_version),
    replayed: true,
  });
}

function replayOperatorAction(row) {
  if (row.outcome === 'failed') throw new JobRuntimeError(row.error_code || 'job_action_conflict');
  if (row.outcome === 'pending') throw new JobRuntimeError('job_action_conflict', { safeDetails: { reason: 'action_in_progress' } });
  return actionResponse(row);
}

function validateAction(input) {
  const action = cleanText(input.action, 16).toLowerCase();
  const reason = cleanText(input.reason, 500);
  const idempotencyKey = cleanText(input.idempotencyKey, 128);
  if (!ACTION_STATUS[action]) throw new JobRuntimeError('job_action_conflict', { safeDetails: { reason: 'action_unknown' } });
  if (!reason || !idempotencyKey || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new JobRuntimeError('job_action_conflict', { safeDetails: { reason: 'action_contract_invalid' } });
  }
  return { action, reason, idempotencyKey };
}

async function invokeAdapter(adapter, action, delivery) {
  if (action === ACTIONS.CANCEL) {
    if (delivery.graphileJobId) await adapter.cancel(delivery.graphileJobId);
    return DELIVERY_STATUS.CANCELLED;
  }
  if (!delivery.graphileJobId) throw new JobRuntimeError('job_action_conflict', { safeDetails: { reason: 'not_enqueued' } });
  await adapter.retry(delivery.graphileJobId, { runAt: new Date() });
  return DELIVERY_STATUS.RETRYING;
}

async function executeClaim(deps, input, claim, actionId, action) {
  try {
    const status = await invokeAdapter(deps.adapter, action, claim.delivery);
    const job = await deps.registry.completeOperatorAction({
      tenantId: input.tenantId, deliveryId: input.deliveryId,
      expectedVersion: input.expectedVersion, actionId, status,
    });
    deps.metrics.increment('job_runtime_operator_actions_total', { action, outcome: 'succeeded' });
    deps.logger?.info?.('job_runtime_operator_action', {
      action_id: actionId, action, outcome: 'succeeded', tenant_id: input.tenantId,
      delivery_id: input.deliveryId, actor_id: input.actorId, request_id: input.requestId,
    });
    return Object.freeze({ actionId, deliveryId: input.deliveryId, action, outcome: 'succeeded', resultingVersion: job.operatorVersion, replayed: false, job });
  } catch (cause) {
    const error = asJobRuntimeError(cause, 'job_runtime_unavailable');
    await deps.registry.failOperatorAction(actionId, error.code);
    deps.metrics.increment('job_runtime_operator_actions_total', { action, outcome: 'failed', code: error.code });
    deps.logger?.error?.('job_runtime_operator_action', {
      action_id: actionId, action, outcome: 'failed', error_code: error.code,
      tenant_id: input.tenantId, delivery_id: input.deliveryId, actor_id: input.actorId, request_id: input.requestId,
    });
    throw error;
  }
}

function createJobOperatorService(options) {
  const { registry, adapter, runtime, logger, metrics = { increment() {} } } = options;

  async function get(tenantId, deliveryId) {
    const job = await registry.findForTenant(tenantId, deliveryId);
    if (!job) throw new JobRuntimeError('job_not_found');
    return Object.freeze({ job, history: await registry.listOperatorHistory(tenantId, deliveryId) });
  }

  async function act(input) {
    const { action, reason, idempotencyKey } = validateAction(input);
    const actionId = (options.idGenerator || crypto.randomUUID)();
    const claim = await registry.claimOperatorAction({ ...input, action, actionId, reason, idempotencyKey });
    if (claim.replay) return replayOperatorAction(claim.action);
    if (!ACTION_STATUS[action].has(claim.delivery.status)) {
      const error = new JobRuntimeError('job_action_conflict', { safeDetails: { reason: 'status', status: claim.delivery.status } });
      await registry.failOperatorAction(actionId, error.code);
      throw error;
    }
    return executeClaim({ registry, adapter, logger, metrics }, input, claim, actionId, action);
  }

  async function drain(input) {
    const reason = cleanText(input.reason, 500);
    if (!reason) throw new JobRuntimeError('job_action_conflict', { safeDetails: { reason: 'reason_required' } });
    if (!runtime || typeof runtime.drain !== 'function') throw new JobRuntimeError('job_runtime_unavailable');
    const result = await runtime.drain(reason);
    logger?.info?.('job_runtime_operator_drain', { actor_id: input.actorId, tenant_id: input.tenantId, request_id: input.requestId });
    return Object.freeze({ state: result?.state || 'draining' });
  }

  return Object.freeze({ get, act, drain });
}

module.exports = { ACTIONS, ACTION_STATUS, createJobOperatorService, replayOperatorAction };
