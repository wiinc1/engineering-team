'use strict';

/**
 * Product path: record human PM/Architect acceptance for Q6 / GitLab #275.
 * Writes durable contract version + dedicated audit event; rejects agent actors.
 */

const {
  PM_ARCHITECT_HUMAN_REVIEW_POLICY_VERSION,
  applyHumanPmArchitectReviewsToContract,
  evaluatePmArchitectHumanReviewGate,
} = require('./pm-architect-human-review-gate');

const PM_ARCHITECT_HUMAN_REVIEW_EVENT = 'task.pm_architect_human_review_recorded';
const PM_ARCHITECT_HUMAN_REVIEW_WAITING_STATE = 'pm_architect_human_review';
const PM_ARCHITECT_HUMAN_REVIEW_ACTION =
  'Human Product Manager and human Architect must accept agent-authored proposals before contract approval or implementation dispatch.';

function createHttpError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function canRecordPmArchitectHumanReview(context = {}) {
  const roles = context.roles || [];
  return roles.includes('admin')
    || roles.includes('pm')
    || roles.includes('architect')
    || roles.includes('operator')
    || roles.includes('stakeholder')
    || roles.includes('user');
}

async function loadExecutionContractContext(store, taskId, tenantId) {
  const history = await store.getTaskHistory(taskId, { tenantId });
  const { deriveExecutionContractProjection } = require('./execution-contracts');
  const projection = deriveExecutionContractProjection(history);
  const created = history.find((entry) => entry?.event_type === 'task.created') || null;
  const summary = {
    task_id: taskId,
    title: created?.payload?.title || taskId,
    operator_intake_requirements: created?.payload?.raw_requirements
      || created?.payload?.operator_intake_requirements
      || '',
  };
  return { history, projection, summary };
}

function resolveRolesToRecord(body = {}) {
  const role = String(body.role || body.reviewerRole || body.reviewer_role || 'both').trim().toLowerCase();
  if (role === 'pm' || role === 'product_manager') return ['pm'];
  if (role === 'architect' || role === 'architecture') return ['architect'];
  if (body.reviews && typeof body.reviews === 'object') {
    return ['pm', 'architect'].filter((key) => body.reviews[key]);
  }
  return ['pm', 'architect'];
}

/**
 * Record human acceptance onto the latest Execution Contract.
 * - Appends task.execution_contract_version_recorded with human_reviews merged
 * - Appends task.pm_architect_human_review_recorded for audit trail
 */
async function recordPmArchitectHumanReviews({
  store,
  taskId,
  tenantId,
  context = {},
  body = {},
  source = 'http',
} = {}) {
  if (!canRecordPmArchitectHumanReview(context)) {
    throw createHttpError(
      403,
      'forbidden',
      'Only PM, Architect, operator, stakeholder, or admin may record human PM/Architect acceptance.',
    );
  }

  const { history, projection, summary } = await loadExecutionContractContext(store, taskId, tenantId);
  if (!projection.latest) {
    throw createHttpError(404, 'execution_contract_not_found', 'No Execution Contract version exists for this task.', {
      task_id: taskId,
    });
  }
  if (projection.approval) {
    // Allowed to re-record for audit after approval if gate was bypassed historically,
    // but prefer blocking ambiguous double-approval noise when already satisfied.
  }

  const roles = resolveRolesToRecord(body);
  const actorType = String(body.actorType || body.actor_type || context.actorType || 'user').trim() || 'user';
  const actorId = String(body.actorId || body.actor_id || context.actorId || '').trim();
  if (!actorId) {
    throw createHttpError(400, 'missing_human_review_actor', 'actorId is required for human PM/Architect acceptance.');
  }

  let applied;
  try {
    applied = applyHumanPmArchitectReviewsToContract(
      projection.latest,
      {
        roles,
        reviews: body.reviews,
        role: body.role,
        reason: body.reason || body.comment || body.summary,
        status: body.status,
        approved: body.approved !== false,
        actorId,
        actorType,
      },
      { actorId, actorType, reason: body.reason || body.comment },
    );
  } catch (error) {
    if (error.code === 'agent_cannot_record_human_review' || error.code === 'missing_human_review_actor') {
      throw createHttpError(error.statusCode || 403, error.code, error.message);
    }
    throw error;
  }

  // Preserve the existing contract body; only stamp human reviews + bump version.
  // Do not regenerate via createExecutionContractDraft (that rebuilds sections/tier).
  const previousVersion = Number(projection.latest.version) || 1;
  const nextVersion = previousVersion + 1;
  const nextContract = {
    ...applied.contract,
    version: nextVersion,
    contract_id: `EC-${taskId}-v${nextVersion}`,
    status: projection.approval ? 'approved' : (projection.latest.status || 'draft'),
    material_change_reason: body.materialChangeReason
      || body.material_change_reason
      || 'Human PM/Architect acceptance recorded (Q6 / GitLab #275).',
    material_change_summary: 'Human PM/Architect acceptance of agent proposals (non-authority proposal clearance).',
  };
  try {
    const crypto = require('node:crypto');
    const { material_hash: _ignored, ...forHash } = nextContract;
    nextContract.material_hash = crypto.createHash('sha256').update(JSON.stringify(forHash)).digest('hex');
  } catch {
    nextContract.material_hash = projection.latest.material_hash || null;
  }

  const gate = evaluatePmArchitectHumanReviewGate(nextContract);
  const waiting = gate.required && !gate.satisfied
    ? {
      waiting_state: PM_ARCHITECT_HUMAN_REVIEW_WAITING_STATE,
      next_required_action: gate.next_required_action || PM_ARCHITECT_HUMAN_REVIEW_ACTION,
    }
    : {
      waiting_state: projection.approval ? 'execution_contract_approved' : 'execution_contract_refinement',
      next_required_action: projection.approval
        ? 'Approved Execution Contract is ready for future implementation dispatch.'
        : (gate.satisfied
          ? 'Human PM/Architect acceptance recorded; Operator Approval may proceed when other gates are green.'
          : gate.next_required_action || PM_ARCHITECT_HUMAN_REVIEW_ACTION),
    };

  const versionResult = await store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.execution_contract_version_recorded',
    actorId,
    actorType: actorType === 'human' ? 'user' : actorType,
    idempotencyKey: body.idempotencyKey
      || body.idempotency_key
      || `pm-architect-human-review:version:${taskId}:v${nextContract.version}:${roles.join('+')}:${actorId}`,
    payload: {
      version: nextContract.version,
      previous_version: previousVersion,
      material_change: false,
      material_hash: nextContract.material_hash,
      owner: nextContract.owner || 'pm',
      waiting_state: waiting.waiting_state,
      next_required_action: waiting.next_required_action,
      human_pm_architect_review: {
        roles,
        recorded: applied.recorded,
        policy_version: PM_ARCHITECT_HUMAN_REVIEW_POLICY_VERSION,
      },
      contract: nextContract,
    },
    source,
  });

  const reviewResult = await store.appendEvent({
    taskId,
    tenantId,
    eventType: PM_ARCHITECT_HUMAN_REVIEW_EVENT,
    actorId,
    actorType: actorType === 'human' ? 'user' : actorType,
    idempotencyKey: body.idempotencyKey
      ? `${body.idempotencyKey}:human-review-event`
      : `pm-architect-human-review:event:${taskId}:v${nextContract.version}:${roles.join('+')}:${actorId}`,
    payload: {
      contract_version: nextContract.version,
      roles,
      reviews: applied.human_reviews,
      recorded: applied.recorded,
      gate,
      policy_version: PM_ARCHITECT_HUMAN_REVIEW_POLICY_VERSION,
      issue: 275,
      ...waiting,
    },
    source,
  });

  return {
    versionResult,
    reviewResult,
    contract: nextContract,
    human_reviews: applied.human_reviews,
    recorded: applied.recorded,
    gate,
    waiting,
    roles,
  };
}

module.exports = {
  PM_ARCHITECT_HUMAN_REVIEW_EVENT,
  PM_ARCHITECT_HUMAN_REVIEW_WAITING_STATE,
  PM_ARCHITECT_HUMAN_REVIEW_ACTION,
  canRecordPmArchitectHumanReview,
  recordPmArchitectHumanReviews,
  loadExecutionContractContext,
};
