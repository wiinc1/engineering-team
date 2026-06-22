const {
  deriveExecutionContractProjection,
  engineerAssigneeForTier,
  evaluateExecutionContractDispatchReadiness,
} = require('../audit/execution-contracts');

const WORK_CATEGORY_TO_TASK_TYPE = Object.freeze({
  feature: 'feature',
  docs: 'research',
  tests: 'feature',
  fixtures: 'feature',
  clear_refactor: 'feature',
});

const PRIORITY_ALIASES = Object.freeze({
  p0: 'critical',
  p1: 'high',
  p2: 'medium',
  p3: 'low',
});

function normalizeText(value) {
  return String(value || '').trim();
}

function findCreatedEvent(history = []) {
  return history.find((event) => event?.event_type === 'task.created') || null;
}

function findRefinementRequestedEvent(history = []) {
  return history.find((event) => event?.event_type === 'task.refinement_requested') || null;
}

function normalizePriority(priority) {
  const raw = normalizeText(priority);
  if (!raw) return null;
  const alias = PRIORITY_ALIASES[raw.toLowerCase()];
  return alias || raw.toLowerCase();
}

function normalizeTaskType(value, fallbackWorkCategory = null) {
  const raw = normalizeText(value);
  if (raw) return raw.toLowerCase();
  const mapped = WORK_CATEGORY_TO_TASK_TYPE[normalizeText(fallbackWorkCategory).toLowerCase()];
  return mapped || 'feature';
}

function normalizeAcceptanceCriteria(value, sectionTwoBody = '') {
  if (Array.isArray(value)) {
    const items = value.map((entry) => normalizeText(entry)).filter(Boolean);
    if (items.length) return items;
  }

  if (typeof value === 'string') {
    const trimmed = normalizeText(value);
    if (!trimmed) return normalizeAcceptanceCriteriaFromBody(sectionTwoBody);
    const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    return lines.length ? lines : [trimmed];
  }

  return normalizeAcceptanceCriteriaFromBody(sectionTwoBody);
}

function normalizeAcceptanceCriteriaFromBody(sectionTwoBody = '') {
  const lines = normalizeText(sectionTwoBody)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines;
}

function inferAffectsUi(contract = {}) {
  const roles = contract.reviewer_routing?.required_role_approvals
    || contract.reviewer_routing?.requiredRoleApprovals
    || [];
  return Array.isArray(roles) && roles.includes('ux');
}

function resolveRequestedOwner({ state = {}, createdPayload = {}, dispatchSignals = {} }) {
  const currentOwner = normalizeText(state.assignee);
  if (currentOwner) return currentOwner;

  const proposedTier = dispatchSignals.proposed_engineer_tier || dispatchSignals.proposedEngineerTier;
  return engineerAssigneeForTier(proposedTier) || null;
}

function buildAuditSummary(taskId, state = {}, history = []) {
  const created = findCreatedEvent(history);
  const refinement = findRefinementRequestedEvent(history);
  const createdPayload = created?.payload || {};
  const rawRequirements = refinement?.payload?.raw_requirements
    || createdPayload.raw_requirements
    || null;
  const intakeDraft = !!(
    createdPayload.intake_draft
    || refinement?.payload?.intake_draft
    || rawRequirements
  );

  return {
    task_id: taskId,
    title: normalizeText(createdPayload.title) || taskId,
    priority: state.priority || createdPayload.priority || null,
    current_stage: state.current_stage || createdPayload.initial_stage || null,
    current_owner: state.assignee || createdPayload.assignee || null,
    intake_draft: intakeDraft,
    acceptance_criteria: createdPayload.acceptance_criteria ?? null,
    task_type: createdPayload.task_type || null,
    execution_contract: deriveExecutionContractProjection(history),
  };
}

function evaluateForgeExecutionReadiness({ taskId, state = null, history = [] }) {
  if (!state && !history.length) {
    return {
      ready: false,
      statusCode: 404,
      code: 'task_not_found',
      message: 'Task not found.',
      details: { taskId },
    };
  }

  const summary = buildAuditSummary(taskId, state || {}, history);
  const contractProjection = summary.execution_contract || {};
  const contract = contractProjection.latest || null;
  const isDraft = String(summary.current_stage || '').toUpperCase() === 'DRAFT'
    || !contract
    || contract.status !== 'approved';

  if (isDraft) {
    return {
      ready: false,
      statusCode: 422,
      code: 'task_not_execution_ready',
      message: 'Task is not execution-ready for forge dispatch.',
      details: [{
        code: 'draft_or_unapproved_contract',
        message: 'Task requires an approved execution contract before forge dispatch.',
      }],
    };
  }

  const dispatchReadiness = evaluateExecutionContractDispatchReadiness({
    contract,
    verificationReport: contract.verification_report || contractProjection.verificationReport || null,
  });

  if (!dispatchReadiness.canDispatch) {
    return {
      ready: false,
      statusCode: 422,
      code: 'task_not_execution_ready',
      message: 'Task is not execution-ready for forge dispatch.',
      details: dispatchReadiness.missingRequiredArtifacts?.length
        ? dispatchReadiness.missingRequiredArtifacts.map((artifact) => ({
          code: artifact,
          message: 'Required artifact missing for dispatch.',
        }))
        : (dispatchReadiness.blockedReasons || []).map((reason) => ({
          code: reason.code || 'dispatch_blocked',
          message: reason.detail || 'Dispatch readiness gate failed.',
        })),
    };
  }

  const canonical = buildForgeCanonicalTask({
    taskId,
    summary,
    contract,
    taskPlatformProjectId: null,
  });

  if (!canonical.ok) {
    return {
      ready: false,
      statusCode: 422,
      code: 'task_not_execution_ready',
      message: 'Task is not execution-ready for forge dispatch.',
      details: canonical.details,
    };
  }

  return {
    ready: true,
    task: canonical.task,
  };
}

function buildForgeCanonicalTask({
  taskId,
  summary = {},
  contract = {},
  taskPlatformProjectId = null,
}) {
  const details = [];
  const forgeDispatch = contract.forge_dispatch || contract.forgeDispatch || {};
  const dispatchSignals = contract.dispatch_signals || contract.dispatchSignals || {};
  const sections = contract.sections || {};
  const sectionOneBody = normalizeText(sections['1']?.body);
  const sectionTwoBody = normalizeText(sections['2']?.body);

  const projectId = normalizeText(forgeDispatch.project_id ?? forgeDispatch.projectId)
    || normalizeText(taskPlatformProjectId)
    || null;
  const domain = normalizeText(forgeDispatch.domain) || 'runtime';
  const targetRepo = normalizeText(forgeDispatch.target_repo ?? forgeDispatch.targetRepo) || null;
  const taskType = normalizeTaskType(summary.task_type, dispatchSignals.work_category);
  const priority = normalizePriority(summary.priority) || 'medium';
  const summaryText = normalizeText(summary.title) || sectionOneBody || taskId;
  const acceptanceCriteria = normalizeAcceptanceCriteria(summary.acceptance_criteria, sectionTwoBody);
  const affectsUi = forgeDispatch.affects_ui != null || forgeDispatch.affectsUi != null
    ? Boolean(forgeDispatch.affects_ui ?? forgeDispatch.affectsUi)
    : inferAffectsUi(contract);
  const requestedOwner = resolveRequestedOwner({
    state: { assignee: summary.current_owner },
    dispatchSignals,
  });

  if (!projectId) {
    details.push({
      code: 'missing_forge_dispatch',
      path: 'projectId',
      message: 'forge_dispatch.project_id is required for forge execution readiness.',
    });
  }

  if (!targetRepo && !['analysis', 'planning', 'research', 'review'].includes(taskType)) {
    details.push({
      code: 'missing_forge_dispatch',
      path: 'targetRepo',
      message: 'forge_dispatch.target_repo is required for code task types.',
    });
  }

  if (!acceptanceCriteria.length) {
    details.push({
      code: 'missing_acceptance_criteria',
      path: 'acceptanceCriteria',
      message: 'At least one acceptance criterion is required.',
    });
  }

  if (!summaryText) {
    details.push({
      code: 'missing_summary',
      path: 'summary',
      message: 'Task summary is required.',
    });
  }

  if (details.length) {
    return { ok: false, details };
  }

  const task = {
    taskId,
    taskVersion: String(contract.version ?? summary.execution_contract?.latestVersion ?? '1'),
    projectId,
    domain,
    targetRepo,
    taskType,
    priority,
    acceptanceCriteria,
    summary: summaryText,
    affectsUi,
  };

  if (requestedOwner) {
    task.requestedOwner = requestedOwner;
  }

  return { ok: true, task };
}

module.exports = {
  buildAuditSummary,
  buildForgeCanonicalTask,
  evaluateForgeExecutionReadiness,
  normalizeAcceptanceCriteria,
  normalizePriority,
  normalizeTaskType,
};