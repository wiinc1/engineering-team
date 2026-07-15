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

function assertReviewPermission(context) {
  if (canRecordPmArchitectHumanReview(context)) return;
  throw createHttpError(
    403,
    'forbidden',
    'Only PM, Architect, operator, stakeholder, or admin may record human PM/Architect acceptance.',
  );
}

function resolveReviewActor(body, context) {
  const actorType = String(body.actorType || body.actor_type || context.actorType || 'user').trim() || 'user';
  const actorId = String(body.actorId || body.actor_id || context.actorId || '').trim();
  if (!actorId) {
    throw createHttpError(400, 'missing_human_review_actor', 'actorId is required for human PM/Architect acceptance.');
  }
  return { actorId, actorType };
}

function applyReviews(contract, body, roles, actor) {
  try {
    return applyHumanPmArchitectReviewsToContract(contract, {
      roles,
      reviews: body.reviews,
      role: body.role,
      reason: body.reason || body.comment || body.summary,
      status: body.status,
      approved: body.approved !== false,
      ...actor,
    }, { ...actor, reason: body.reason || body.comment });
  } catch (error) {
    if (error.code === 'agent_cannot_record_human_review' || error.code === 'missing_human_review_actor') {
      throw createHttpError(error.statusCode || 403, error.code, error.message);
    }
    throw error;
  }
}

function buildReviewedContract({ projection, taskId, body, applied }) {
  const previousVersion = Number(projection.latest.version) || 1;
  const version = previousVersion + 1;
  const contract = {
    ...applied.contract,
    version,
    contract_id: `EC-${taskId}-v${version}`,
    status: projection.approval ? 'approved' : (projection.latest.status || 'draft'),
    material_change_reason: body.materialChangeReason || body.material_change_reason
      || 'Human PM/Architect acceptance recorded (Q6 / GitLab #275).',
    material_change_summary: 'Human PM/Architect acceptance of agent proposals (non-authority proposal clearance).',
  };
  try {
    const crypto = require('node:crypto');
    const { material_hash: _ignored, ...forHash } = contract;
    contract.material_hash = crypto.createHash('sha256').update(JSON.stringify(forHash)).digest('hex');
  } catch {
    contract.material_hash = projection.latest.material_hash || null;
  }
  return { contract, previousVersion };
}

function resolveWaitingState(gate, projection) {
  if (gate.required && !gate.satisfied) {
    return {
      waiting_state: PM_ARCHITECT_HUMAN_REVIEW_WAITING_STATE,
      next_required_action: gate.next_required_action || PM_ARCHITECT_HUMAN_REVIEW_ACTION,
    };
  }
  return {
    waiting_state: projection.approval ? 'execution_contract_approved' : 'execution_contract_refinement',
    next_required_action: projection.approval
      ? 'Approved Execution Contract is ready for future implementation dispatch.'
      : (gate.satisfied
        ? 'Human PM/Architect acceptance recorded; Operator Approval may proceed when other gates are green.'
        : gate.next_required_action || PM_ARCHITECT_HUMAN_REVIEW_ACTION),
  };
}

function reviewEventContext(input) {
  const { body, taskId, roles, actorId, actorType, contract } = input;
  return {
    actorId,
    actorType: actorType === 'human' ? 'user' : actorType,
    versionKey: body.idempotencyKey || body.idempotency_key
      || `pm-architect-human-review:version:${taskId}:v${contract.version}:${roles.join('+')}:${actorId}`,
    reviewKey: body.idempotencyKey
      ? `${body.idempotencyKey}:human-review-event`
      : `pm-architect-human-review:event:${taskId}:v${contract.version}:${roles.join('+')}:${actorId}`,
  };
}

async function appendReviewEvents(input) {
  const { store, taskId, tenantId, source, contract, previousVersion, applied, gate, waiting, roles } = input;
  const eventContext = reviewEventContext(input);
  const versionResult = await store.appendEvent({
    taskId, tenantId, source, eventType: 'task.execution_contract_version_recorded',
    actorId: eventContext.actorId, actorType: eventContext.actorType, idempotencyKey: eventContext.versionKey,
    payload: {
      version: contract.version, previous_version: previousVersion, material_change: false,
      material_hash: contract.material_hash, owner: contract.owner || 'pm', ...waiting,
      human_pm_architect_review: {
        roles, recorded: applied.recorded, policy_version: PM_ARCHITECT_HUMAN_REVIEW_POLICY_VERSION,
      },
      contract,
    },
  });
  const reviewResult = await store.appendEvent({
    taskId, tenantId, source, eventType: PM_ARCHITECT_HUMAN_REVIEW_EVENT,
    actorId: eventContext.actorId, actorType: eventContext.actorType, idempotencyKey: eventContext.reviewKey,
    payload: {
      contract_version: contract.version, roles, reviews: applied.human_reviews, recorded: applied.recorded,
      gate, policy_version: PM_ARCHITECT_HUMAN_REVIEW_POLICY_VERSION, issue: 275, ...waiting,
    },
  });
  return { versionResult, reviewResult };
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
  assertReviewPermission(context);
  const { projection } = await loadExecutionContractContext(store, taskId, tenantId);
  if (!projection.latest) {
    throw createHttpError(404, 'execution_contract_not_found', 'No Execution Contract version exists for this task.', {
      task_id: taskId,
    });
  }
  const roles = resolveRolesToRecord(body);
  const actor = resolveReviewActor(body, context);
  const applied = applyReviews(projection.latest, body, roles, actor);
  const { contract, previousVersion } = buildReviewedContract({ projection, taskId, body, applied });
  const gate = evaluatePmArchitectHumanReviewGate(contract);
  const waiting = resolveWaitingState(gate, projection);
  const results = await appendReviewEvents({
    store, taskId, tenantId, source, body, roles, ...actor,
    contract, previousVersion, applied, gate, waiting,
  });
  return {
    ...results,
    contract,
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
