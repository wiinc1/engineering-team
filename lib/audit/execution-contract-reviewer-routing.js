const { createSpecialistCoordinator } = require('../software-factory/delegation');
const { buildExecutionContractReviewerRoutingAction } = require('./execution-contracts');

const REVIEWER_ROUTING_POLICY_VERSION = 'execution-contract-reviewer-routing.v1';

const REVIEWER_ROLE_LABELS = Object.freeze({
  architect: 'Architect',
  ux: 'UX Designer',
  qa: 'QA',
  sre: 'SRE',
  principalEngineer: 'Principal Engineer',
});

const REVIEWER_PRIMARY_SECTIONS = Object.freeze({
  architect: ['6', '7', '5', '8', '9', '14'],
  ux: ['3', '10'],
  qa: ['4', '2'],
  sre: ['11', '12', '16'],
  principalEngineer: ['6', '14'],
});

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function shouldAutoDelegateSectionReviews(options = {}) {
  if (typeof options.autoDelegateSectionReviews === 'boolean') {
    return options.autoDelegateSectionReviews;
  }
  const env = options.env || process.env;
  if (parseBooleanEnv(env.GOLDEN_PATH_OPENCLAW_SECTION_REVIEWS, false)) return true;
  if (parseBooleanEnv(env.GOLDEN_PATH_OPENCLAW_PM_REFINEMENT, false)) return true;
  if (env.PM_REFINEMENT_DELEGATE_WORK === 'openclaw') return true;
  return false;
}

const APPROVED_REVIEWER_STATUSES = new Set([
  'approved',
  'accepted',
  'complete',
  'completed',
  'signed_off',
  'signed-off',
]);

function requiredApprovalRoles(contract = {}) {
  const routing = contract.reviewer_routing || {};
  const roles = routing.required_role_approvals || routing.requiredRoleApprovals || [];
  return roles.filter((role) => role && role !== 'pm');
}

function reviewerAlreadyApproved(contract = {}, role) {
  const reviewer = contract.reviewer_routing?.reviewers?.[role] || contract.reviewers?.[role];
  if (!reviewer) return false;
  if (reviewer.approved === true) return true;
  return APPROVED_REVIEWER_STATUSES.has(String(reviewer.status || '').toLowerCase());
}

function resolveReviewerSectionTargets(contract = {}, role) {
  const requiredSections = new Set(
    (contract.validation?.requiredSections || contract.required_sections || [])
      .map(String),
  );
  const candidates = REVIEWER_PRIMARY_SECTIONS[role] || [];
  const sectionIds = candidates.filter((sectionId) => {
    if (requiredSections.size && !requiredSections.has(sectionId)) return false;
    const section = contract.sections?.[sectionId];
    const body = typeof section?.body === 'string' && section.body.trim()
      ? section.body
      : (section?.payload_json?.body || section?.payloadJson?.body || '');
    return typeof body === 'string' && body.trim().length > 0;
  });
  return sectionIds.length ? [sectionIds[0]] : (candidates[0] ? [candidates[0]] : []);
}

function buildReviewerRoutingTargets(contract = {}) {
  return requiredApprovalRoles(contract).map((role) => ({
    role,
    label: REVIEWER_ROLE_LABELS[role] || role,
    sectionIds: resolveReviewerSectionTargets(contract, role),
    status: contract.reviewer_routing?.reviewers?.[role]?.status || 'pending',
  }));
}

function buildSectionReviewPrompt({
  taskId,
  role,
  sectionId,
  contract = {},
  summary = {},
} = {}) {
  const section = contract.sections?.[sectionId] || {};
  return [
    `You are the ${REVIEWER_ROLE_LABELS[role] || role} reviewer for task ${taskId}.`,
    `Review Execution Contract v${contract.version} section ${sectionId} (${section.title || `Section ${sectionId}`}).`,
    'Return ONLY valid JSON with this shape:',
    '{"status":"approved","comment":"Concise reviewer rationale.","sectionPatch":{"body":"Optional improved section body when material clarification is required."}}',
    'Use status "approved" when the section is credible for implementation planning.',
    'Use status "changes_requested" only when a blocking clarification is required.',
    '',
    `Task title: ${summary.title || taskId}`,
    `Template tier: ${contract.template_tier || contract.templateTier || 'Standard'}`,
    '',
    'Section body:',
    section.body || '(missing section body)',
  ].join('\n');
}

function parseSectionReviewAgentOutput(delegation = {}) {
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

function sectionReviewBodyFromAgentOutput(parsed = {}, delegation = {}) {
  const status = String(parsed.status || parsed.approvalStatus || 'approved').trim().toLowerCase();
  const comment = String(parsed.comment || parsed.summary || parsed.rationale || delegation.message || '').trim();
  const sectionPatch = parsed.sectionPatch || parsed.section_patch || parsed.section || {};
  return {
    status,
    comment: comment || 'Section review recorded via delegated reviewer agent.',
    approved: ['approved', 'accepted', 'complete', 'completed', 'signed_off'].includes(status),
    sectionPatch,
    actorType: 'agent',
  };
}

async function recordReviewerRoutingDecision({
  store,
  taskId,
  tenantId,
  context,
  contract,
  idempotencyKey,
  nextRequiredAction,
  source = 'pm_refinement',
}) {
  const targets = buildReviewerRoutingTargets(contract);
  return store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.control_plane_decision_recorded',
    actorId: context.actorId,
    actorType: 'system',
    idempotencyKey: `${idempotencyKey}:reviewer-routing:v${contract.version}`,
    payload: {
      policy_name: 'reviewer_routing',
      policy_version: REVIEWER_ROUTING_POLICY_VERSION,
      input: {
        contract_version: contract.version,
        template_tier: contract.template_tier || contract.templateTier || null,
        required_role_approvals: requiredApprovalRoles(contract),
      },
      output: {
        reviewer_routing: contract.reviewer_routing || null,
        reviewer_targets: targets,
      },
      waiting_state: 'execution_contract_review',
      next_required_action: nextRequiredAction,
      trigger: 'pm_refinement_completed',
    },
    source,
  });
}

async function resolveLatestContract(contract, loadLatestContract) {
  if (typeof loadLatestContract !== 'function') return contract;
  const latest = await loadLatestContract();
  return latest || contract;
}

async function delegateReviewerRequest({
  coordinator,
  options,
  context,
  taskId,
  target,
  sectionId,
  contract,
  summary,
}) {
  if (typeof options.reviewDelegate === 'function') {
    return options.reviewDelegate({ target, sectionId, contract, summary, taskId, context });
  }
  return coordinator.handleRequest(
    buildSectionReviewPrompt({
      taskId,
      role: target.role,
      sectionId,
      contract,
      summary,
    }),
    {
      coordinatorAgent: context.actorId,
      targetSpecialist: target.role,
      taskId,
      taskType: 'execution_contract_section_review',
    },
  );
}

async function persistDelegatedSectionReview({
  store,
  context,
  taskId,
  tenantId,
  target,
  sectionId,
  contract,
  delegation,
  recordSectionReview,
  idempotencyKey,
  source,
  loadLatestContract,
}) {
  const parsed = parseSectionReviewAgentOutput(delegation);
  const reviewBody = parsed
    ? sectionReviewBodyFromAgentOutput(parsed, delegation)
    : {
      status: 'approved',
      comment: String(delegation.message || delegation.output || '').trim()
        || `${target.label} acknowledged the PM draft contract.`,
      approved: true,
      actorType: 'agent',
    };

  const reviewContext = {
    ...context,
    actorId: delegation.agentId || target.role,
    roles: [target.role, 'reader'],
  };

  const latestContract = await resolveLatestContract(contract, loadLatestContract);
  const requestBody = {
    ...reviewBody,
    reviewerRole: target.role,
    idempotencyKey: `${idempotencyKey}:section-review:${target.role}:v${latestContract.version}:s${sectionId}`,
  };

  try {
    const reviewResult = await recordSectionReview({
      store,
      taskId,
      tenantId,
      context: reviewContext,
      version: latestContract.version,
      sectionId,
      body: requestBody,
      source,
    });
    return { ok: true, reviewResult, contractVersion: latestContract.version };
  } catch (error) {
    if (error?.code !== 'stale_execution_contract_review' || typeof loadLatestContract !== 'function') {
      throw error;
    }
    const retriedContract = await loadLatestContract();
    if (!retriedContract) throw error;
    const reviewResult = await recordSectionReview({
      store,
      taskId,
      tenantId,
      context: reviewContext,
      version: retriedContract.version,
      sectionId,
      body: {
        ...requestBody,
        idempotencyKey: `${idempotencyKey}:section-review:${target.role}:v${retriedContract.version}:s${sectionId}:retry`,
      },
      source,
    });
    return { ok: true, reviewResult, contractVersion: retriedContract.version, retried: true };
  }
}

async function delegateReviewerSectionReviews({
  store,
  context,
  taskId,
  contract,
  summary = {},
  options = {},
  recordSectionReview,
  loadLatestContract,
  idempotencyKey,
  source = 'pm_refinement',
}) {
  if (!shouldAutoDelegateSectionReviews(options)) {
    return { delegated: false, reviews: [], failures: [], reason: 'auto_delegate_disabled' };
  }

  const coordinator = createSpecialistCoordinator({
    ...options,
    baseDir: options.baseDir || process.cwd(),
    delegateWork: options.sectionReviewDelegateWork || options.pmRefinementDelegateWork || options.delegateWork,
  });

  const reviews = [];
  const failures = [];
  let currentContract = await resolveLatestContract(contract, loadLatestContract);

  for (const role of requiredApprovalRoles(currentContract)) {
    currentContract = await resolveLatestContract(currentContract, loadLatestContract);
    if (!currentContract) break;

    if (reviewerAlreadyApproved(currentContract, role)) {
      reviews.push({
        role,
        skipped: true,
        reason: 'already_approved',
        contractVersion: currentContract.version,
      });
      continue;
    }

    const sectionId = resolveReviewerSectionTargets(currentContract, role)[0];
    if (!sectionId) continue;

    const target = {
      role,
      label: REVIEWER_ROLE_LABELS[role] || role,
      sectionIds: [sectionId],
    };

    let delegation;
    try {
      delegation = await delegateReviewerRequest({
        coordinator,
        options,
        context,
        taskId,
        target,
        sectionId,
        contract: currentContract,
        summary,
      });
    } catch (error) {
      failures.push({
        role,
        sectionId,
        phase: 'delegation',
        code: error?.code || 'delegation_failed',
        message: error?.message || 'Reviewer delegation failed.',
      });
      continue;
    }

    try {
      const persisted = await persistDelegatedSectionReview({
        store,
        context,
        taskId,
        tenantId: context.tenantId,
        target,
        sectionId,
        contract: currentContract,
        delegation,
        recordSectionReview,
        idempotencyKey,
        source,
        loadLatestContract,
      });
      reviews.push({
        role: target.role,
        sectionId,
        skipped: false,
        delegated: delegation.attribution?.delegated === true,
        agentId: delegation.agentId || null,
        sessionId: delegation.metadata?.sessionId || null,
        review: persisted.reviewResult.review,
        contractVersion: persisted.reviewResult.contract?.version || persisted.contractVersion,
        retried: persisted.retried === true,
      });
      currentContract = persisted.reviewResult.contract || currentContract;
    } catch (error) {
      failures.push({
        role,
        sectionId,
        phase: 'persist',
        code: error?.code || 'section_review_failed',
        message: error?.message || 'Section review persistence failed.',
      });
    }
  }

  return {
    delegated: reviews.some((entry) => entry.delegated),
    reviews,
    failures,
    reason: failures.length
      ? (reviews.length ? 'section_reviews_partial' : 'section_reviews_failed')
      : (reviews.length ? 'section_reviews_recorded' : 'no_reviewer_targets'),
  };
}

async function startExecutionContractReviewerRouting({
  store,
  context,
  taskId,
  contract,
  summary = {},
  idempotencyKey,
  options = {},
  recordSectionReview,
  loadLatestContract,
  source = 'pm_refinement',
  logger = null,
}) {
  const nextRequiredAction = buildExecutionContractReviewerRoutingAction(contract);
  const routingDecision = await recordReviewerRoutingDecision({
    store,
    taskId,
    tenantId: context.tenantId,
    context,
    contract,
    idempotencyKey,
    nextRequiredAction,
    source,
  });

  const delegation = await delegateReviewerSectionReviews({
    store,
    context,
    taskId,
    contract,
    summary,
    options,
    recordSectionReview,
    loadLatestContract,
    idempotencyKey,
    source,
  });

  logger?.info?.({
    feature: 'execution_contract_reviewer_routing',
    action: 'start',
    outcome: delegation.reason,
    task_id: taskId,
    tenant_id: context.tenantId,
    contract_version: contract.version,
    reviewer_count: buildReviewerRoutingTargets(contract).length,
    delegated_reviews: delegation.reviews.filter((entry) => entry.delegated).length,
    failed_reviews: delegation.failures.length,
  });

  return {
    nextRequiredAction,
    routingDecision,
    delegation,
    reviewerTargets: buildReviewerRoutingTargets(contract),
  };
}

module.exports = {
  REVIEWER_PRIMARY_SECTIONS,
  buildReviewerRoutingTargets,
  buildSectionReviewPrompt,
  delegateReviewerSectionReviews,
  reviewerAlreadyApproved,
  shouldAutoDelegateSectionReviews,
  startExecutionContractReviewerRouting,
};