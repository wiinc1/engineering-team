const { createSpecialistCoordinator } = require('../software-factory/delegation');

const EXECUTION_CONTRACT_APPROVED_ACTION = 'Approved Execution Contract is ready for future implementation dispatch.';

const UX_IMPLEMENTATION_REVIEW_POLICY_VERSION = 'execution-contract-ux-implementation-review.v1';

const EXECUTION_CONTRACT_UX_IMPLEMENTATION_REVIEW_WAITING_STATE = 'ux_implementation_review';

const UX_IMPLEMENTATION_REVIEW_RISK_FLAGS = new Set([
  'human_workflow',
  'design_system_compliance',
  'frontend_regression',
  'desktop_visual_validation',
  'ui',
  'ux',
  'accessibility',
]);

const UX_WORK_TEXT_PATTERN = /\b(ui|ux|user interface|user experience|command center|layout|design system|visual|screenshot|desktop ui|navigation|inspector|workspace|accessibility|wireframe|mockup|figma)\b/i;

const APPROVED_STATUSES = new Set([
  'approved',
  'accepted',
  'complete',
  'completed',
  'signed_off',
  'signed-off',
]);

function contractRiskFlagIds(contract = {}) {
  return (contract.risk_flags || []).map((entry) => entry?.id || entry).filter(Boolean);
}

function resolveSectionText(section = {}) {
  if (!section || typeof section !== 'object') return '';
  const direct = String(section.body || section.content || section.value || '').trim();
  if (direct) return direct;
  const payload = section.payload_json || section.payloadJson || {};
  return String(payload.body || payload.content || payload.value || '').trim();
}

function contractNarrative(contract = {}) {
  return [
    contract.title,
    contract.task_id,
    ...Object.values(contract.sections || {}).map((section) => resolveSectionText(section)),
  ].filter(Boolean).join('\n');
}

function uxReviewerRequired(contract = {}) {
  const reviewer = contract.reviewer_routing?.reviewers?.ux || contract.reviewers?.ux;
  return reviewer?.required === true || reviewer?.approvalRequired === true;
}

function contractRequiresUxImplementationReview(contract = {}) {
  if (!contract || contract.status !== 'approved') return false;
  const riskFlags = contractRiskFlagIds(contract);
  if (riskFlags.some((flag) => UX_IMPLEMENTATION_REVIEW_RISK_FLAGS.has(flag))) return true;
  if (uxReviewerRequired(contract)) return true;
  if (UX_WORK_TEXT_PATTERN.test(contractNarrative(contract))) return true;
  const workCategory = contract.dispatch_signals?.work_category
    || contract.dispatchSignals?.work_category
    || contract.dispatch_signals?.workCategory
    || contract.dispatchSignals?.workCategory;
  if (workCategory === 'ui_ux') return true;
  return false;
}

function findLatestUxImplementationReview(history = [], contractVersion = null) {
  const event = history.find((entry) => entry?.event_type === 'task.ux_implementation_review_recorded') || null;
  if (!event) return null;
  const payload = event.payload || {};
  if (contractVersion != null && Number(payload.contract_version) !== Number(contractVersion)) return null;
  return {
    eventId: event.event_id || null,
    contractVersion: Number(payload.contract_version) || null,
    status: String(payload.status || payload.review?.status || 'recorded').toLowerCase(),
    approved: payload.approved === true
      || APPROVED_STATUSES.has(String(payload.status || payload.review?.status || '').toLowerCase()),
    actorId: event.actor_id || payload.actor_id || null,
    comment: payload.comment || payload.review?.comment || null,
    recordedAt: event.occurred_at || null,
    review: payload.review || null,
    delegation: payload.delegation || null,
  };
}

function buildUxImplementationReviewAction() {
  return 'UX Designer must complete implementation review or request contract changes before engineer dispatch.';
}

function evaluateUxImplementationDispatchGate({ contract = {}, uxImplementationReview = null } = {}) {
  const required = contractRequiresUxImplementationReview(contract);
  const satisfied = required
    ? !!(uxImplementationReview?.approved || APPROVED_STATUSES.has(String(uxImplementationReview?.status || '').toLowerCase()))
    : true;
  return {
    policy_version: UX_IMPLEMENTATION_REVIEW_POLICY_VERSION,
    required,
    satisfied,
    assignee: 'ux-designer',
    role: 'ux',
    mode: 'before_engineer_dispatch',
    reason: required
      ? 'UI/UX-facing work requires UX Designer implementation review before Sr Engineer dispatch.'
      : 'UX implementation review is not required for this contract.',
    review: uxImplementationReview,
  };
}

function augmentDispatchReadinessWithUxGate(readiness = {}, { contract = {}, uxImplementationReview = null } = {}) {
  const gate = evaluateUxImplementationDispatchGate({ contract, uxImplementationReview });
  if (!gate.required) {
    return { ...readiness, uxImplementationReview: gate };
  }

  const { evaluateExecutionContractDispatchPolicy } = require('./execution-contracts');
  const dispatchPolicy = evaluateExecutionContractDispatchPolicy({ contract });
  const blockedReasons = [...(readiness.blockedReasons || [])];
  const missingRequiredArtifacts = [...(readiness.missingRequiredArtifacts || [])];

  if (!gate.satisfied) {
    missingRequiredArtifacts.push('ux_implementation_review');
    blockedReasons.push({
      source: 'ux_gate',
      code: 'ux_implementation_review',
      detail: 'Implementation dispatch is blocked until UX Designer records implementation review for UI/UX work.',
    });
    dispatchPolicy.blockingReasons = [
      ...(dispatchPolicy.blockingReasons || []),
      {
        source: 'ux_gate',
        code: 'ux_implementation_review_required',
        detail: 'UX Designer must review or request changes before engineer implementation dispatch.',
        signals: { assignee: gate.assignee, mode: gate.mode },
      },
    ];
    dispatchPolicy.canDispatch = false;
    dispatchPolicy.status = 'blocked';
  }

  dispatchPolicy.uxDispatch = {
    required: gate.required,
    satisfied: gate.satisfied,
    role: gate.role,
    assignee: gate.assignee,
    mode: gate.mode,
    reason: gate.reason,
    review: gate.review,
  };

  if (gate.required && !gate.satisfied) {
    dispatchPolicy.preDispatchAssignee = gate.assignee;
    dispatchPolicy.preDispatchRole = gate.role;
    dispatchPolicy.implementationAssignee = dispatchPolicy.selectedAssignee;
    dispatchPolicy.implementationRole = 'engineer';
  }

  return {
    ...readiness,
    canDispatch: readiness.canDispatch === true && gate.satisfied && dispatchPolicy.canDispatch !== false,
    missingRequiredArtifacts,
    blockedReasons,
    dispatchPolicy,
    uxImplementationReview: gate,
    reason: !gate.satisfied
      ? gate.reason
      : readiness.reason,
  };
}

function buildUxImplementationReviewPrompt({ taskId, contract = {}, summary = {} } = {}) {
  const sections = ['3', '10'];
  const sectionSummaries = sections
    .map((sectionId) => {
      const section = contract.sections?.[sectionId];
      if (!section) return null;
      return `Section ${sectionId} (${section.title || sectionId}):\n${resolveSectionText(section).slice(0, 1200)}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return [
    `You are the UX Designer implementation reviewer for task ${taskId}.`,
    'Review the approved Execution Contract before engineer implementation begins.',
    'Return ONLY valid JSON with this shape:',
    '{"status":"approved","comment":"Concise UX rationale.","changesRequested":false,"sectionPatches":{"10":"Optional revised UI/UX section body when material clarification is required."}}',
    'Use status "approved" when the contract is ready for engineer implementation.',
    'Use status "changes_requested" when UX must revise workflow, hierarchy, accessibility, or visual requirements before implementation.',
    '',
    `Task title: ${summary.title || taskId}`,
    `Contract version: ${contract.version}`,
    '',
    'UX-relevant sections:',
    sectionSummaries || '(no section bodies found)',
  ].join('\n');
}

function parseUxImplementationReviewOutput(delegation = {}) {
  const raw = String(delegation.message || delegation.output || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function normalizeUxReviewBody(body = {}, delegation = {}) {
  const parsed = body.parsed || parseUxImplementationReviewOutput(delegation) || {};
  const status = String(body.status || parsed.status || (body.approved === true ? 'approved' : 'approved'))
    .trim()
    .toLowerCase();
  const approved = body.approved === true
    || APPROVED_STATUSES.has(status)
    || parsed.changesRequested === false;
  const comment = String(
    body.comment
    || parsed.comment
    || delegation.message
    || '',
  ).trim() || 'UX implementation review recorded.';
  return {
    status: status === 'changes_requested' ? 'changes_requested' : (approved ? 'approved' : status),
    approved: approved && status !== 'changes_requested',
    comment,
    changesRequested: status === 'changes_requested' || parsed.changesRequested === true,
    sectionPatches: body.sectionPatches || body.section_patches || parsed.sectionPatches || parsed.section_patches || {},
    actorType: body.actorType || 'user',
  };
}

function approvalPayloadForContract(contract = {}) {
  const gate = evaluateUxImplementationDispatchGate({ contract, uxImplementationReview: null });
  if (gate.required) {
    return {
      waiting_state: EXECUTION_CONTRACT_UX_IMPLEMENTATION_REVIEW_WAITING_STATE,
      next_required_action: buildUxImplementationReviewAction(),
      ux_implementation_review_required: true,
    };
  }
  return {
    waiting_state: 'execution_contract_approved',
    next_required_action: EXECUTION_CONTRACT_APPROVED_ACTION,
    ux_implementation_review_required: false,
  };
}

function reviewCompletionPayload(contract = {}) {
  const { verificationReportSkeletonRequired } = require('./execution-contracts');
  const skeletonRequired = verificationReportSkeletonRequired(contract);
  return {
    waiting_state: skeletonRequired ? 'verification_report_ready' : 'execution_contract_approved',
    next_required_action: skeletonRequired
      ? 'Verification report skeleton is required before engineer implementation dispatch.'
      : EXECUTION_CONTRACT_APPROVED_ACTION,
    ux_implementation_review_required: false,
    ux_implementation_review_satisfied: true,
  };
}

function shouldAutoDelegateUxImplementationReview(options = {}) {
  if (typeof options.autoDelegateUxImplementationReview === 'boolean') {
    return options.autoDelegateUxImplementationReview;
  }
  const env = options.env || process.env;
  if (['1', 'true', 'yes', 'on'].includes(String(env.GOLDEN_PATH_OPENCLAW_UX_IMPLEMENTATION_REVIEW || '').trim().toLowerCase())) {
    return true;
  }
  if (env.PM_REFINEMENT_DELEGATE_WORK === 'openclaw') return true;
  if (['1', 'true', 'yes', 'on'].includes(String(env.GOLDEN_PATH_OPENCLAW_PM_REFINEMENT || '').trim().toLowerCase())) {
    return true;
  }
  return false;
}

async function recordUxImplementationReview({
  store,
  taskId,
  tenantId,
  context,
  body = {},
  delegation = null,
  source = 'http',
}) {
  const { projection, summary } = await loadExecutionContractContext(store, taskId, tenantId);
  if (!projection.latest) {
    throw createHttpError(404, 'execution_contract_not_found', 'No Execution Contract version exists for this task.');
  }
  if (!projection.approval || Number(projection.approval.version) !== Number(projection.latest.version)) {
    throw createHttpError(409, 'execution_contract_not_approved', 'UX implementation review requires an approved Execution Contract.', {
      task_id: taskId,
      latest_version: projection.latest.version,
    });
  }

  const contract = { ...projection.latest, status: 'approved' };
  const gate = evaluateUxImplementationDispatchGate({ contract, uxImplementationReview: null });
  if (!gate.required) {
    throw createHttpError(409, 'ux_implementation_review_not_required', 'This Execution Contract does not require UX implementation review.', {
      task_id: taskId,
    });
  }

  const review = normalizeUxReviewBody(body, delegation || {});
  const completion = review.approved ? reviewCompletionPayload(contract) : {
    waiting_state: EXECUTION_CONTRACT_UX_IMPLEMENTATION_REVIEW_WAITING_STATE,
    next_required_action: buildUxImplementationReviewAction(),
    ux_implementation_review_required: true,
    ux_implementation_review_satisfied: false,
  };

  const result = await store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.ux_implementation_review_recorded',
    actorId: context.actorId,
    actorType: review.actorType,
    idempotencyKey: body.idempotencyKey
      || body.idempotency_key
      || `ux-implementation-review:${taskId}:v${contract.version}:${review.status}`,
    payload: {
      contract_version: contract.version,
      status: review.status,
      approved: review.approved,
      comment: review.comment,
      changes_requested: review.changesRequested,
      section_patches: review.sectionPatches,
      review,
      delegation: delegation ? {
        delegated: delegation.attribution?.delegated === true,
        agentId: delegation.agentId || null,
        sessionId: delegation.metadata?.sessionId || null,
        artifactPath: delegation.metadata?.artifactPath || null,
      } : null,
      ...completion,
    },
    source,
  });

  return { result, review, contract, gate, completion };
}

async function delegateUxImplementationReview({
  store,
  context,
  taskId,
  contract,
  summary = {},
  options = {},
  body = {},
  source = 'http',
}) {
  if (!shouldAutoDelegateUxImplementationReview(options)) {
    return { delegated: false, reason: 'auto_delegate_disabled' };
  }

  const coordinator = createSpecialistCoordinator({
    ...options,
    baseDir: options.baseDir || process.cwd(),
    delegateWork: options.uxImplementationReviewDelegateWork
      || options.sectionReviewDelegateWork
      || options.pmRefinementDelegateWork
      || options.delegateWork,
  });

  const delegation = await coordinator.handleRequest(
    buildUxImplementationReviewPrompt({ taskId, contract, summary }),
    {
      coordinatorAgent: context.actorId,
      targetSpecialist: 'ux',
      taskId,
      taskType: 'ux_implementation_review',
    },
  );

  return recordUxImplementationReview({
    store,
    taskId,
    tenantId: context.tenantId,
    context: {
      ...context,
      actorId: delegation.agentId || 'ux-designer',
      roles: ['ux', 'reader'],
    },
    body,
    delegation,
    source,
  });
}

function createHttpError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

async function loadExecutionContractContext(store, taskId, tenantId) {
  const history = await store.getTaskHistory(taskId, { tenantId });
  const { deriveExecutionContractProjection } = require('./execution-contracts');
  const projection = deriveExecutionContractProjection(history);
  const created = history.find((entry) => entry?.event_type === 'task.created') || null;
  const summary = {
    task_id: taskId,
    title: created?.payload?.title || taskId,
    operator_intake_requirements: created?.payload?.raw_requirements || created?.payload?.operator_intake_requirements || '',
  };
  return { history, projection, summary };
}

module.exports = {
  UX_IMPLEMENTATION_REVIEW_POLICY_VERSION,
  EXECUTION_CONTRACT_UX_IMPLEMENTATION_REVIEW_WAITING_STATE,
  UX_IMPLEMENTATION_REVIEW_RISK_FLAGS,
  contractRequiresUxImplementationReview,
  findLatestUxImplementationReview,
  evaluateUxImplementationDispatchGate,
  augmentDispatchReadinessWithUxGate,
  buildUxImplementationReviewAction,
  buildUxImplementationReviewPrompt,
  approvalPayloadForContract,
  reviewCompletionPayload,
  recordUxImplementationReview,
  delegateUxImplementationReview,
  shouldAutoDelegateUxImplementationReview,
};