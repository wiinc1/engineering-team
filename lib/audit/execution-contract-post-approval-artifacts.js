const {
  ARTIFACT_BUNDLE_REVIEW_ACTION,
  VERIFICATION_REPORT_GENERATED_ACTION,
  createExecutionContractArtifactBundle,
  createExecutionContractVerificationReportSkeleton,
  deriveExecutionContractProjection,
  evaluateExecutionContractDispatchReadiness,
  normalizeArtifactIdentity,
  verificationReportSkeletonRequired,
} = require('./execution-contracts');
const {
  evaluateUxImplementationDispatchGate,
  findLatestUxImplementationReview,
} = require('./execution-contract-ux-dispatch');
const {
  maybeStartArchitectEngineerAssignmentAfterPostApproval,
} = require('./execution-contract-architect-dispatch');

function createHttpError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function shouldAutoGeneratePostApprovalArtifacts(options = {}) {
  if (typeof options.autoGeneratePostApprovalArtifacts === 'boolean') {
    return options.autoGeneratePostApprovalArtifacts;
  }
  const env = options.env || process.env;
  if (['1', 'true', 'yes', 'on'].includes(String(env.GOLDEN_PATH_OPENCLAW_POST_APPROVAL_ARTIFACTS || '').trim().toLowerCase())) {
    return true;
  }
  if (env.PM_REFINEMENT_DELEGATE_WORK === 'openclaw') return true;
  if (['1', 'true', 'yes', 'on'].includes(String(env.GOLDEN_PATH_OPENCLAW_PM_REFINEMENT || '').trim().toLowerCase())) {
    return true;
  }
  if (['1', 'true', 'yes', 'on'].includes(String(env.GOLDEN_PATH_OPENCLAW_UX_IMPLEMENTATION_REVIEW || '').trim().toLowerCase())) {
    return true;
  }
  return false;
}

function shouldAutoGenerateArtifactBundle(options = {}) {
  if (typeof options.autoGenerateArtifactBundle === 'boolean') {
    return options.autoGenerateArtifactBundle;
  }
  const env = options.env || process.env;
  if (['0', 'false', 'no', 'off'].includes(String(env.GOLDEN_PATH_OPENCLAW_POST_APPROVAL_ARTIFACT_BUNDLE || '').trim().toLowerCase())) {
    return false;
  }
  return true;
}

function postApprovalArtifactGateSatisfied({ contract = {}, history = [] } = {}) {
  const approvedContract = { ...contract, status: 'approved' };
  const uxReview = findLatestUxImplementationReview(history, contract.version);
  const gate = evaluateUxImplementationDispatchGate({
    contract: approvedContract,
    uxImplementationReview: uxReview,
  });
  return gate.satisfied;
}

async function generateExecutionContractVerificationReportSkeletonEvent({
  store,
  taskId,
  tenantId,
  context,
  contract,
  body = {},
  source = 'http',
}) {
  const identity = normalizeArtifactIdentity({ taskId, contract, body });
  if (!identity.valid_for_committed_repo) {
    throw createHttpError(
      409,
      'invalid_artifact_display_id',
      'Verification report skeletons require a TSK-123-style display ID before implementation dispatch.',
      {
        task_id: taskId,
        requested_display_id: identity.requested_display_id,
        environment: identity.environment,
        collision_policy: identity.collision_policy,
      },
    );
  }

  const generatedAt = new Date().toISOString();
  const verificationReport = createExecutionContractVerificationReportSkeleton({
    taskId,
    contract,
    body,
    actorId: context.actorId,
    generatedAt,
  });
  const dispatchGate = evaluateExecutionContractDispatchReadiness({
    contract,
    verificationReport,
  });
  const result = await store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.execution_contract_verification_report_generated',
    actorId: context.actorId,
    actorType: body.actorType || 'agent',
    idempotencyKey: body.idempotencyKey
      || body.idempotency_key
      || `execution-contract-verification-report:${taskId}:v${contract.version}:${contract.material_hash}:${verificationReport.report_id}`,
    occurredAt: generatedAt,
    payload: {
      version: contract.version,
      report_id: verificationReport.report_id,
      verification_report: verificationReport,
      dispatch_gate: dispatchGate,
      waiting_state: 'verification_report_ready',
      next_required_action: VERIFICATION_REPORT_GENERATED_ACTION,
      auto_generated: true,
    },
    source,
  });

  return {
    result,
    verificationReport: result.event?.payload?.verification_report || verificationReport,
    dispatchGate: result.event?.payload?.dispatch_gate || dispatchGate,
  };
}

async function generateExecutionContractArtifactBundleEvent({
  store,
  taskId,
  tenantId,
  context,
  contract,
  history = [],
  approvalSummary = {},
  body = {},
  source = 'http',
}) {
  const identity = normalizeArtifactIdentity({ taskId, contract, body });
  if (!identity.valid_for_committed_repo) {
    throw createHttpError(
      409,
      'invalid_artifact_display_id',
      'Production repo artifacts require a TSK-123-style display ID; staging/local artifacts must use a non-production alias.',
      {
        task_id: taskId,
        requested_display_id: identity.requested_display_id,
        environment: identity.environment,
        collision_policy: identity.collision_policy,
      },
    );
  }

  const generatedAt = new Date().toISOString();
  const artifactBundle = createExecutionContractArtifactBundle({
    taskId,
    contract,
    history,
    body,
    actorId: context.actorId,
    approvalSummary,
    generatedAt,
  });
  const result = await store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.execution_contract_artifact_bundle_generated',
    actorId: context.actorId,
    actorType: body.actorType || 'agent',
    idempotencyKey: body.idempotencyKey
      || body.idempotency_key
      || `execution-contract-artifacts:${taskId}:v${contract.version}:${contract.material_hash}:${artifactBundle.bundle_id}`,
    occurredAt: generatedAt,
    payload: {
      version: contract.version,
      bundle_id: artifactBundle.bundle_id,
      artifact_bundle: artifactBundle,
      waiting_state: 'artifact_bundle_review',
      next_required_action: ARTIFACT_BUNDLE_REVIEW_ACTION,
      auto_generated: true,
    },
    source,
  });

  return {
    result,
    artifactBundle,
  };
}

async function maybeGeneratePostApprovalRepoArtifacts({
  store,
  context,
  taskId,
  tenantId,
  contract,
  options = {},
  body = {},
  source = 'http',
}) {
  if (!shouldAutoGeneratePostApprovalArtifacts(options)) {
    return { generated: false, reason: 'auto_generate_disabled' };
  }

  const history = await store.getTaskHistory(taskId, { tenantId });
  if (!postApprovalArtifactGateSatisfied({ contract, history })) {
    return { generated: false, reason: 'ux_gate_unsatisfied' };
  }

  const projection = deriveExecutionContractProjection(history);
  if (!projection.approval || Number(projection.approval.version) !== Number(contract.version)) {
    return { generated: false, reason: 'contract_not_approved' };
  }

  const approvedContract = { ...projection.latest, status: 'approved' };
  const pmContext = {
    ...context,
    actorId: context.actorId || 'pm',
    roles: context.roles || ['pm', 'reader'],
  };
  const artifactBody = { ...body, actorType: body.actorType || 'agent' };
  const outputs = {
    generated: false,
    verificationReport: null,
    artifactBundle: null,
    skipped: [],
  };

  const skeletonRequired = verificationReportSkeletonRequired(approvedContract);
  if (skeletonRequired && !projection.verificationReport) {
    outputs.verificationReport = await generateExecutionContractVerificationReportSkeletonEvent({
      store,
      taskId,
      tenantId,
      context: pmContext,
      contract: approvedContract,
      body: artifactBody,
      source,
    });
    outputs.generated = true;
  } else if (projection.verificationReport) {
    outputs.skipped.push('verification_report_already_generated');
  } else {
    outputs.skipped.push('verification_report_not_required');
  }

  if (shouldAutoGenerateArtifactBundle(options) && !projection.artifacts) {
    outputs.artifactBundle = await generateExecutionContractArtifactBundleEvent({
      store,
      taskId,
      tenantId,
      context: pmContext,
      contract: approvedContract,
      history,
      approvalSummary: projection.approval.approvalSummary || {},
      body: artifactBody,
      source,
    });
    outputs.generated = true;
  } else if (projection.artifacts) {
    outputs.skipped.push('artifact_bundle_already_generated');
  } else if (!shouldAutoGenerateArtifactBundle(options)) {
    outputs.skipped.push('artifact_bundle_auto_generate_disabled');
  }

  if (!outputs.generated) {
    outputs.reason = outputs.skipped[0] || 'nothing_to_generate';
  }

  const refreshedHistory = await store.getTaskHistory(taskId, { tenantId });
  if (outputs.generated || postApprovalArtifactGateSatisfied({ contract: approvedContract, history: refreshedHistory })) {
    outputs.architectEngineerAssignment = await maybeStartArchitectEngineerAssignmentAfterPostApproval({
      store,
      context,
      taskId,
      tenantId,
      contract: approvedContract,
      options,
      source,
    });
  }

  return outputs;
}

module.exports = {
  shouldAutoGeneratePostApprovalArtifacts,
  shouldAutoGenerateArtifactBundle,
  postApprovalArtifactGateSatisfied,
  generateExecutionContractVerificationReportSkeletonEvent,
  generateExecutionContractArtifactBundleEvent,
  maybeGeneratePostApprovalRepoArtifacts,
};