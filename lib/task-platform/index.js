const { resolveAuditBackend } = require('../audit/config');
const { createFileTaskPlatformService } = require('./service');
const { createPostgresTaskPlatformService } = require('./postgres');
const { withProjects } = require('./projects');
const { applyMergeReadinessEnforcementInput } = require('./merge-readiness-enforcement');
const { applyMergeReadinessBranchProtectionPolicy } = require('./merge-readiness-branch-protection');
const {
  applyMergeReadinessFindingPolicy,
  classifyMergeReadinessFinding,
  evaluateBlockingFindingDeferral,
  evaluateMergeReadinessDeferralPolicy,
  evaluateMergeReadinessFindingPolicy,
  evaluateMergeReadinessGate,
} = require('./merge-readiness-gate');
const {
  evaluateMergeReadinessSummaryPrecedence,
  renderMergeReadinessPrSummary,
} = require('./merge-readiness-pr-summary');
const { applyMergeReadinessSourcePolicy } = require('./merge-readiness-source-policy');
const {
  MERGE_READINESS_GITHUB_CHECK_VERSION,
  createGitHubCheckRunClient,
  emitMergeReadinessCheckRun,
  evidenceFingerprint,
} = require('./merge-readiness-github-check');
const {
  PROJECT_ID_PATTERN,
  PROJECT_STATUSES,
  makeProjectId,
  normalizeProjectId,
  normalizeProjectStatus,
} = require('./projects');

function cloneJson(value, fallback) {
  if (value === undefined) return fallback;
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function sourcePolicyReview(input = {}) {
  return {
    review_status: input.reviewStatus || input.review_status,
    source_inventory: cloneJson(input.sourceInventory ?? input.source_inventory, {}),
    required_check_inventory: cloneJson(input.requiredCheckInventory ?? input.required_check_inventory, []),
    reviewed_log_sources: cloneJson(input.reviewedLogSources ?? input.reviewed_log_sources, []),
    findings: cloneJson(input.findings, []),
    classification: cloneJson(input.classification, null),
    metadata: cloneJson(input.metadata, {}),
  };
}

function applySourcePolicyToCreateInput(input = {}, options = {}) {
  const policyInput = applyMergeReadinessEnforcementInput(input, options);
  const review = sourcePolicyReview(policyInput);
  applyMergeReadinessSourcePolicy(review, policyInput);
  applyMergeReadinessBranchProtectionPolicy(review, policyInput);
  applyMergeReadinessFindingPolicy(review);
  return {
    ...policyInput,
    reviewStatus: review.review_status,
    sourceInventory: review.source_inventory,
    requiredCheckInventory: review.required_check_inventory,
    reviewedLogSources: review.reviewed_log_sources,
    findings: review.findings,
    classification: review.classification,
    metadata: review.metadata,
  };
}

function applyFindingPolicyToRecord(service, review) {
  if (!review || typeof review !== 'object') return review;
  const policyReview = sourcePolicyReview(review);
  applyMergeReadinessFindingPolicy(policyReview);
  if (policyReview.review_status === review.reviewStatus
    && JSON.stringify(policyReview.classification) === JSON.stringify(review.classification)
    && JSON.stringify(policyReview.metadata) === JSON.stringify(review.metadata)) {
    return review;
  }
  return service.updateMergeReadinessReview({
    tenantId: review.tenantId,
    taskId: review.taskId,
    reviewId: review.reviewId,
    recordVersion: review.recordVersion,
    reviewStatus: policyReview.review_status,
    classification: policyReview.classification,
    metadata: policyReview.metadata,
    findings: policyReview.findings,
  });
}

function withMergeReadinessSourcePolicy(service, options = {}) {
  if (!service || typeof service.createMergeReadinessReview !== 'function') return service;
  const wrapped = {
    ...service,
    createMergeReadinessReview(input = {}) {
      return service.createMergeReadinessReview(applySourcePolicyToCreateInput(input, options));
    },
  };
  if (typeof service.updateMergeReadinessReview === 'function') {
    wrapped.updateMergeReadinessReview = function updateMergeReadinessReview(input = {}) {
      const review = service.updateMergeReadinessReview(input);
      if (review && typeof review.then === 'function') {
        return review.then(record => applyFindingPolicyToRecord(service, record));
      }
      return applyFindingPolicyToRecord(service, review);
    };
  }
  return wrapped;
}

function resolveCheckRunClient(options = {}) {
  if (options.mergeReadinessCheckRunClient) return options.mergeReadinessCheckRunClient;
  if (options.githubCheckRunClient) return options.githubCheckRunClient;
  if (options.githubToken) return createGitHubCheckRunClient({ token: options.githubToken, fetch: options.fetch });
  return null;
}

function reviewEvidence(input = {}) {
  return {
    requiredChecks: input.requiredChecks || input.required_checks || input.requiredCheckInventory || [],
    blockingSignals: input.blockingSignals || input.blocking_signals || [],
    previewDeployment: input.previewDeployment || input.preview_deployment || null,
    deployment: input.deployment || null,
  };
}

function mergeGateMetadata(review, input, checkRun) {
  return {
    ...cloneJson(review.metadata, {}),
    github_merge_readiness_gate: {
      policy_version: MERGE_READINESS_GITHUB_CHECK_VERSION,
      evidence_fingerprint: evidenceFingerprint(reviewEvidence(input)),
      check_run_id: checkRun?.id || review.githubCheckRunId || null,
      refreshed_at: new Date().toISOString(),
    },
  };
}

async function emitAndPersistCheckRun(service, client, review, input = {}) {
  const checkRun = await emitMergeReadinessCheckRun({
    github: client,
    review,
    repository: review.repository,
    commitSha: review.commitSha,
    evidence: reviewEvidence(input),
    detailsUrl: input.detailsUrl || input.details_url,
  });
  if (!checkRun?.id && review.githubCheckRunId) return review;
  return service.updateMergeReadinessReview({
    tenantId: review.tenantId,
    taskId: review.taskId,
    reviewId: review.reviewId,
    recordVersion: review.recordVersion,
    githubCheckRunId: checkRun?.id || review.githubCheckRunId,
    metadata: mergeGateMetadata(review, input, checkRun),
  });
}

function withMergeReadinessGitHubChecks(service, options = {}) {
  const client = resolveCheckRunClient(options);
  if (!client || !service || typeof service.createMergeReadinessReview !== 'function') return service;
  return {
    ...service,
    async createMergeReadinessReview(input = {}) {
      const review = await service.createMergeReadinessReview(input);
      return emitAndPersistCheckRun(service, client, review, input);
    },
    async updateMergeReadinessReview(input = {}) {
      const review = await service.updateMergeReadinessReview(input);
      if (input.skipGitHubCheckRun) return review;
      return emitAndPersistCheckRun(service, client, review, input);
    },
  };
}

function createTaskPlatformService(options = {}) {
  const backend = options.taskPlatformBackend || resolveAuditBackend(options);
  const wrap = service => withProjects(withMergeReadinessGitHubChecks(withMergeReadinessSourcePolicy(service, options), options), options);
  if (backend === 'postgres') {
    return wrap(createPostgresTaskPlatformService(options));
  }
  return wrap(createFileTaskPlatformService(options));
}

module.exports = {
  applySourcePolicyToCreateInput,
  applyMergeReadinessFindingPolicy,
  classifyMergeReadinessFinding,
  createTaskPlatformService,
  evaluateBlockingFindingDeferral,
  evaluateMergeReadinessDeferralPolicy,
  evaluateMergeReadinessFindingPolicy,
  evaluateMergeReadinessGate,
  evaluateMergeReadinessSummaryPrecedence,
  renderMergeReadinessPrSummary,
  withMergeReadinessGitHubChecks,
  PROJECT_ID_PATTERN,
  PROJECT_STATUSES,
  makeProjectId,
  normalizeProjectId,
  normalizeProjectStatus,
};
