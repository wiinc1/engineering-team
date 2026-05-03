const { resolveAuditBackend } = require('../audit/config');
const { createFileTaskPlatformService } = require('./service');
const { createPostgresTaskPlatformService } = require('./postgres');
const { applyMergeReadinessSourcePolicy } = require('./merge-readiness-source-policy');

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

function applySourcePolicyToCreateInput(input = {}) {
  const review = sourcePolicyReview(input);
  applyMergeReadinessSourcePolicy(review, input);
  return {
    ...input,
    reviewStatus: review.review_status,
    sourceInventory: review.source_inventory,
    requiredCheckInventory: review.required_check_inventory,
    reviewedLogSources: review.reviewed_log_sources,
    findings: review.findings,
    classification: review.classification,
    metadata: review.metadata,
  };
}

function withMergeReadinessSourcePolicy(service) {
  if (!service || typeof service.createMergeReadinessReview !== 'function') return service;
  return {
    ...service,
    createMergeReadinessReview(input = {}) {
      return service.createMergeReadinessReview(applySourcePolicyToCreateInput(input));
    },
  };
}

function createTaskPlatformService(options = {}) {
  const backend = options.taskPlatformBackend || resolveAuditBackend(options);
  if (backend === 'postgres') {
    return withMergeReadinessSourcePolicy(createPostgresTaskPlatformService(options));
  }
  return withMergeReadinessSourcePolicy(createFileTaskPlatformService(options));
}

module.exports = {
  applySourcePolicyToCreateInput,
  createTaskPlatformService,
};
