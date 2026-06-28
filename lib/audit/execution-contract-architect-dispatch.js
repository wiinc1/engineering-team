const {
  ENGINEER_TIERS,
  engineerAssigneeForTier,
  engineerTierFromAssigneeId,
  evaluateExecutionContractDispatchPolicy,
  evaluateExecutionContractDispatchReadiness,
} = require('./execution-contracts');
const {
  evaluateUxImplementationDispatchGate,
  findLatestUxImplementationReview,
} = require('./execution-contract-ux-dispatch');
const { createSpecialistCoordinator } = require('../software-factory/delegation');

const ARCHITECT_ENGINEER_ASSIGNMENT_POLICY_VERSION = 'execution-contract-architect-engineer-assignment.v1';
const ARCHITECT_ENGINEER_ASSIGNMENT_WAITING_STATE = 'architect_engineer_assignment';

const EXECUTION_CONTRACT_ARCHITECT_ASSIGNMENT_ACTION =
  'Architect must assign the appropriate engineer tier and owner before implementation dispatch.';

function createHttpError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeEngineerTier(value, fallback = null) {
  const tier = String(value || '').trim();
  return ENGINEER_TIERS.includes(tier) ? tier : fallback;
}

function findLatestArchitectHandoff(history = []) {
  return history.find((entry) => entry?.event_type === 'task.architect_handoff_recorded') || null;
}

function architectHandoffSatisfiesAssignment(event = null) {
  if (!event) return null;
  const payload = event.payload || {};
  if (!payload.ready_for_engineering) return null;
  const engineerTier = normalizeEngineerTier(payload.engineer_tier, null);
  const assignee = engineerTier ? engineerAssigneeForTier(engineerTier) : null;
  if (!engineerTier || !assignee) return null;
  return {
    source: 'architect_handoff',
    eventId: event.event_id || null,
    engineerTier,
    assignee,
    tierRationale: payload.tier_rationale || null,
    recordedAt: event.occurred_at || null,
    actorId: event.actor_id || null,
  };
}

function findLatestArchitectEngineerAssignment(history = [], contractVersion = null) {
  const handoff = architectHandoffSatisfiesAssignment(findLatestArchitectHandoff(history));
  if (handoff) return handoff;

  const event = history.find((entry) => entry?.event_type === 'task.architect_engineer_assignment_recorded') || null;
  if (!event) return null;
  const payload = event.payload || {};
  if (contractVersion != null && Number(payload.contract_version) !== Number(contractVersion)) return null;
  const engineerTier = normalizeEngineerTier(payload.engineer_tier, null);
  const assignee = String(payload.assignee || '').trim()
    || (engineerTier ? engineerAssigneeForTier(engineerTier) : null);
  if (!engineerTier || !assignee) return null;
  return {
    source: 'architect_engineer_assignment',
    eventId: event.event_id || null,
    contractVersion: Number(payload.contract_version) || null,
    engineerTier,
    assignee,
    tierRationale: payload.tier_rationale || payload.tierRationale || null,
    comment: payload.comment || null,
    recordedAt: event.occurred_at || null,
    actorId: event.actor_id || null,
    delegation: payload.delegation || null,
  };
}

function contractRequiresArchitectEngineerAssignment(contract = {}) {
  return !!(contract && contract.status === 'approved');
}

function postApprovalGatesSatisfied({ contract = {}, history = [] } = {}) {
  const { deriveExecutionContractProjection } = require('./execution-contracts');
  const projection = deriveExecutionContractProjection(history);
  const latest = projection.latest || contract;
  const verificationReport = projection.verificationReport || latest.verification_report || null;
  const uxGate = evaluateUxImplementationDispatchGate({
    contract: latest,
    uxImplementationReview: findLatestUxImplementationReview(history, latest.version),
  });
  if (uxGate.required && !uxGate.satisfied) return false;

  const readiness = evaluateExecutionContractDispatchReadiness({
    contract: latest,
    verificationReport,
  });
  return readiness.canDispatch === true;
}

function preArchitectDispatchGatesSatisfied({ contract = {}, history = [], readiness = null } = {}) {
  if (readiness) {
    const missing = (readiness.missingRequiredArtifacts || [])
      .filter((artifact) => artifact !== 'architect_engineer_assignment');
    return missing.length === 0;
  }
  return postApprovalGatesSatisfied({ contract, history });
}

function evaluateArchitectEngineerAssignmentGate({
  contract = {},
  architectEngineerAssignment = null,
  history = [],
  readiness = null,
} = {}) {
  const required = contractRequiresArchitectEngineerAssignment(contract)
    && preArchitectDispatchGatesSatisfied({ contract, history, readiness });
  const satisfied = required
    ? !!(architectEngineerAssignment?.assignee && architectEngineerAssignment?.engineerTier)
    : true;
  return {
    policy_version: ARCHITECT_ENGINEER_ASSIGNMENT_POLICY_VERSION,
    required,
    satisfied,
    assignee: 'architect',
    role: 'architect',
    mode: 'before_engineer_dispatch',
    reason: required
      ? 'Approved Execution Contract work requires Architect engineer tier selection and assignment before implementation dispatch.'
      : 'Architect engineer assignment is not required until post-approval dispatch gates are satisfied.',
    assignment: architectEngineerAssignment,
  };
}

function augmentDispatchReadinessWithArchitectGate(readiness = {}, {
  contract = {},
  architectEngineerAssignment = null,
  history = [],
} = {}) {
  const gate = evaluateArchitectEngineerAssignmentGate({
    contract,
    architectEngineerAssignment,
    history,
    readiness,
  });
  if (!gate.required) {
    return { ...readiness, architectEngineerAssignment: gate };
  }

  const blockedReasons = [...(readiness.blockedReasons || [])];
  const missingRequiredArtifacts = [...(readiness.missingRequiredArtifacts || [])];
  const dispatchPolicy = { ...(readiness.dispatchPolicy || evaluateExecutionContractDispatchPolicy({ contract })) };

  if (!gate.satisfied) {
    missingRequiredArtifacts.push('architect_engineer_assignment');
    blockedReasons.push({
      source: 'architect_gate',
      code: 'architect_engineer_assignment',
      detail: 'Implementation dispatch is blocked until Architect assigns the appropriate engineer.',
    });
    dispatchPolicy.blockingReasons = [
      ...(dispatchPolicy.blockingReasons || []),
      {
        source: 'architect_gate',
        code: 'architect_engineer_assignment_required',
        detail: 'Architect must select engineer tier and assign implementation owner.',
        signals: { assignee: gate.assignee, mode: gate.mode },
      },
    ];
    dispatchPolicy.canDispatch = false;
    dispatchPolicy.status = 'blocked';
  }

  dispatchPolicy.architectDispatch = {
    required: gate.required,
    satisfied: gate.satisfied,
    role: gate.role,
    assignee: gate.assignee,
    mode: gate.mode,
    reason: gate.reason,
    assignment: gate.assignment,
  };

  if (gate.required && !gate.satisfied) {
    dispatchPolicy.preDispatchAssignee = gate.assignee;
    dispatchPolicy.preDispatchRole = gate.role;
    dispatchPolicy.implementationAssignee = dispatchPolicy.selectedAssignee;
    dispatchPolicy.implementationRole = 'engineer';
  } else if (gate.assignment?.assignee) {
    dispatchPolicy.selectedAssignee = gate.assignment.assignee;
    dispatchPolicy.selectedEngineerTier = gate.assignment.engineerTier;
  }

  return {
    ...readiness,
    canDispatch: readiness.canDispatch === true && gate.satisfied && dispatchPolicy.canDispatch !== false,
    missingRequiredArtifacts,
    blockedReasons,
    dispatchPolicy,
    architectEngineerAssignment: gate,
    reason: !gate.satisfied
      ? gate.reason
      : readiness.reason,
  };
}

function buildArchitectEngineerAssignmentPrompt({ taskId, contract = {}, summary = {}, dispatchPolicy = {} } = {}) {
  const recommendation = dispatchPolicy.selectedEngineerTier
    ? `${dispatchPolicy.selectedEngineerTier} (${dispatchPolicy.selectedAssignee || engineerAssigneeForTier(dispatchPolicy.selectedEngineerTier)})`
    : 'Sr (engineer-sr)';
  const reasons = (dispatchPolicy.selectionReasons || [])
    .map((entry) => `- ${entry.detail}`)
    .join('\n');

  return [
    `You are the Architect implementation dispatcher for task ${taskId}.`,
    'Review the approved Execution Contract and assign the appropriate engineer tier and owner.',
    'Return ONLY valid JSON with this shape:',
    '{"engineerTier":"Sr","assignee":"engineer-sr","tierRationale":"Concise rationale tied to contract tier and risk.","readyForEngineering":true}',
    'Allowed engineerTier values: Jr, Sr, Principal.',
    'Allowed assignee values: engineer-jr, engineer-sr, engineer-principal.',
    '',
    `Task title: ${summary.title || taskId}`,
    `Contract version: ${contract.version}`,
    `Template tier: ${contract.template_tier || contract.templateTier || 'Standard'}`,
    `Dispatch policy recommendation: ${recommendation}`,
    reasons ? `Selection reasons:\n${reasons}` : '',
  ].filter(Boolean).join('\n');
}

function parseArchitectAssignmentOutput(delegation = {}) {
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

function normalizeArchitectAssignmentBody(body = {}, delegation = {}, dispatchPolicy = {}) {
  const parsed = body.parsed || parseArchitectAssignmentOutput(delegation) || {};
  let engineerTier = normalizeEngineerTier(
    body.engineerTier || body.engineer_tier || parsed.engineerTier || parsed.engineer_tier,
    null,
  );
  let assignee = String(
    body.assignee
    || parsed.assignee
    || (engineerTier ? engineerAssigneeForTier(engineerTier) : ''),
  ).trim();
  if (!engineerTier && dispatchPolicy?.selectedEngineerTier) {
    engineerTier = normalizeEngineerTier(dispatchPolicy.selectedEngineerTier, null);
  }
  if (!assignee && dispatchPolicy?.selectedAssignee) {
    assignee = String(dispatchPolicy.selectedAssignee).trim();
  }
  const tierFromAssignee = engineerTierFromAssigneeId(assignee);
  const resolvedTier = engineerTier || tierFromAssignee;
  const resolvedAssignee = assignee || (resolvedTier ? engineerAssigneeForTier(resolvedTier) : null);
  const tierRationale = String(
    body.tierRationale
    || body.tier_rationale
    || parsed.tierRationale
    || parsed.tier_rationale
    || delegation.message
    || '',
  ).trim();

  if (!resolvedTier || !ENGINEER_TIERS.includes(resolvedTier)) {
    throw createHttpError(400, 'invalid_engineer_tier', 'Architect engineer assignment requires a valid engineer tier.');
  }
  if (!resolvedAssignee) {
    throw createHttpError(400, 'invalid_engineer_assignee', 'Architect engineer assignment requires a valid engineer assignee.');
  }
  if (!tierRationale) {
    throw createHttpError(400, 'missing_tier_rationale', 'Architect engineer assignment requires tier rationale.');
  }
  if (engineerTierFromAssigneeId(resolvedAssignee) !== resolvedTier) {
    throw createHttpError(409, 'engineer_tier_assignee_mismatch', 'Engineer tier and assignee must match.', {
      engineer_tier: resolvedTier,
      assignee: resolvedAssignee,
    });
  }

  return {
    engineerTier: resolvedTier,
    assignee: resolvedAssignee,
    tierRationale,
    readyForEngineering: body.readyForEngineering !== false && parsed.readyForEngineering !== false,
    comment: String(body.comment || parsed.comment || tierRationale).trim(),
    actorType: body.actorType || 'user',
  };
}

function assignmentCompletionPayload(assignment = {}) {
  return {
    waiting_state: 'execution_contract_approved',
    next_required_action: `Assigned to ${assignment.assignee}. Implementation may begin.`,
    architect_engineer_assignment_required: false,
    architect_engineer_assignment_satisfied: true,
    ready_for_engineering: true,
  };
}

function shouldAutoDelegateArchitectEngineerAssignment(options = {}) {
  if (typeof options.autoDelegateArchitectEngineerAssignment === 'boolean') {
    return options.autoDelegateArchitectEngineerAssignment;
  }
  const env = options.env || process.env;
  if (['1', 'true', 'yes', 'on'].includes(String(env.GOLDEN_PATH_OPENCLAW_ARCHITECT_ENGINEER_ASSIGNMENT || '').trim().toLowerCase())) {
    return true;
  }
  if (env.PM_REFINEMENT_DELEGATE_WORK === 'openclaw') return true;
  if (['1', 'true', 'yes', 'on'].includes(String(env.GOLDEN_PATH_OPENCLAW_PM_REFINEMENT || '').trim().toLowerCase())) {
    return true;
  }
  return false;
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

function evaluateAssignmentDispatchPolicy(history, contract, assignment) {
  const { augmentDispatchReadinessWithUxGate, findLatestUxImplementationReview } = require('./execution-contract-ux-dispatch');
  return augmentDispatchReadinessWithUxGate(
    evaluateExecutionContractDispatchReadiness({
      contract,
      verificationReport: contract.verification_report || null,
      proposedEngineerTier: assignment.engineerTier,
      proposedAssignee: assignment.assignee,
    }),
    {
      contract,
      uxImplementationReview: findLatestUxImplementationReview(history, contract.version),
    },
  );
}

async function recordArchitectEngineerAssignment({
  store,
  taskId,
  tenantId,
  context,
  body = {},
  delegation = null,
  source = 'http',
}) {
  const { history, projection, summary } = await loadExecutionContractContext(store, taskId, tenantId);
  if (!projection.latest) {
    throw createHttpError(404, 'execution_contract_not_found', 'No Execution Contract version exists for this task.');
  }
  if (!projection.approval || Number(projection.approval.version) !== Number(projection.latest.version)) {
    throw createHttpError(409, 'execution_contract_not_approved', 'Architect engineer assignment requires an approved Execution Contract.', {
      task_id: taskId,
      latest_version: projection.latest.version,
    });
  }

  const contract = { ...projection.latest, status: 'approved' };
  if (!postApprovalGatesSatisfied({ contract, history })) {
    throw createHttpError(409, 'post_approval_gates_unsatisfied', 'Architect engineer assignment requires satisfied UX and artifact dispatch gates.', {
      task_id: taskId,
    });
  }

  if (findLatestArchitectEngineerAssignment(history, contract.version)) {
    throw createHttpError(409, 'architect_engineer_assignment_already_recorded', 'Architect engineer assignment is already recorded for this contract version.', {
      task_id: taskId,
      contract_version: contract.version,
    });
  }

  const dispatchPolicy = evaluateExecutionContractDispatchPolicy({ contract });
  const assignment = normalizeArchitectAssignmentBody(body, delegation || {}, dispatchPolicy);
  const dispatchReadiness = evaluateAssignmentDispatchPolicy(history, contract, assignment);
  if (!dispatchReadiness.canDispatch) {
    throw createHttpError(409, 'dispatch_policy_blocked', 'Architect engineer assignment is blocked by dispatch policy.', {
      dispatch_readiness: dispatchReadiness,
      blocking_reasons: dispatchReadiness.blockedReasons || [],
    });
  }

  const state = await store.getTaskCurrentState(taskId, { tenantId });
  const completion = assignmentCompletionPayload(assignment);
  const occurredAt = new Date().toISOString();
  const assignmentResult = await store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.architect_engineer_assignment_recorded',
    actorId: context.actorId,
    actorType: assignment.actorType,
    idempotencyKey: body.idempotencyKey
      || body.idempotency_key
      || `architect-engineer-assignment:${taskId}:v${contract.version}:${assignment.assignee}`,
    payload: {
      contract_version: contract.version,
      engineer_tier: assignment.engineerTier,
      assignee: assignment.assignee,
      tier_rationale: assignment.tierRationale,
      comment: assignment.comment,
      ready_for_engineering: assignment.readyForEngineering,
      dispatch_policy: dispatchReadiness.dispatchPolicy,
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

  const assignResult = await store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.assigned',
    actorId: context.actorId,
    actorType: assignment.actorType,
    idempotencyKey: body.assignmentIdempotencyKey
      || body.assignment_idempotency_key
      || `architect-assignment:${taskId}:v${contract.version}:${assignment.assignee}`,
    occurredAt,
    payload: {
      previous_assignee: state?.assignee || null,
      assignee: assignment.assignee,
      engineer_tier: assignment.engineerTier,
      tier_rationale: assignment.tierRationale,
      assigned_by_role: 'architect',
      dispatch_policy: dispatchReadiness.dispatchPolicy,
      architect_engineer_assignment_event_id: assignmentResult.event?.event_id || null,
    },
    source,
  });

  return {
    result: assignmentResult,
    assignResult,
    assignment,
    contract,
    dispatchReadiness,
    completion,
  };
}

async function delegateArchitectEngineerAssignment({
  store,
  context,
  taskId,
  contract,
  summary = {},
  options = {},
  body = {},
  source = 'http',
}) {
  if (!shouldAutoDelegateArchitectEngineerAssignment(options)) {
    return { delegated: false, reason: 'auto_delegate_disabled' };
  }

  const dispatchPolicy = evaluateExecutionContractDispatchPolicy({ contract });
  const coordinator = createSpecialistCoordinator({
    ...options,
    baseDir: options.baseDir || process.cwd(),
    delegateWork: options.architectEngineerAssignmentDelegateWork
      || options.sectionReviewDelegateWork
      || options.pmRefinementDelegateWork
      || options.delegateWork,
  });

  const delegation = await coordinator.handleRequest(
    buildArchitectEngineerAssignmentPrompt({ taskId, contract, summary, dispatchPolicy }),
    {
      coordinatorAgent: context.actorId,
      targetSpecialist: 'architect',
      taskId,
      taskType: 'architect_engineer_assignment',
    },
  );

  return recordArchitectEngineerAssignment({
    store,
    taskId,
    tenantId: context.tenantId,
    context: {
      ...context,
      actorId: delegation.agentId || 'architect',
      roles: ['architect', 'reader'],
    },
    body,
    delegation,
    source,
  });
}

async function maybeStartArchitectEngineerAssignmentAfterPostApproval({
  store,
  context,
  taskId,
  tenantId,
  contract,
  options = {},
  source = 'http',
}) {
  if (!shouldAutoDelegateArchitectEngineerAssignment(options)) {
    return { started: false, reason: 'auto_delegate_disabled' };
  }

  const history = await store.getTaskHistory(taskId, { tenantId });
  const approvedContract = { ...contract, status: 'approved' };
  if (!postApprovalGatesSatisfied({ contract: approvedContract, history })) {
    return { started: false, reason: 'post_approval_gates_unsatisfied' };
  }
  if (findLatestArchitectEngineerAssignment(history, contract.version)) {
    return { started: false, reason: 'already_recorded' };
  }

  const { summary } = await loadExecutionContractContext(store, taskId, tenantId);
  const result = await delegateArchitectEngineerAssignment({
    store,
    context: {
      ...context,
      actorId: context.actorId || 'architect',
      roles: context.roles || ['architect', 'reader'],
    },
    taskId,
    contract: approvedContract,
    summary,
    options,
    source,
  });

  return { started: true, result };
}

module.exports = {
  ARCHITECT_ENGINEER_ASSIGNMENT_POLICY_VERSION,
  ARCHITECT_ENGINEER_ASSIGNMENT_WAITING_STATE,
  EXECUTION_CONTRACT_ARCHITECT_ASSIGNMENT_ACTION,
  contractRequiresArchitectEngineerAssignment,
  findLatestArchitectEngineerAssignment,
  evaluateArchitectEngineerAssignmentGate,
  augmentDispatchReadinessWithArchitectGate,
  buildArchitectEngineerAssignmentPrompt,
  recordArchitectEngineerAssignment,
  delegateArchitectEngineerAssignment,
  maybeStartArchitectEngineerAssignmentAfterPostApproval,
  shouldAutoDelegateArchitectEngineerAssignment,
  postApprovalGatesSatisfied,
};