const { isRealEvidenceRequired } = require('./golden-path-real-evidence');

const HOSTED_RELEASE_ENVIRONMENTS = new Set(['staging', 'prod']);

function hostedReleaseArtifactInputFailures(options = {}, environment) {
  if (!HOSTED_RELEASE_ENVIRONMENTS.has(environment) || !isRealEvidenceRequired(options)) return [];
  const failures = [];
  if (!(options.deploymentUrl || options.productionUrl)) failures.push(`hosted ${environment} release evidence requires deployment URL`);
  if (!options.rollbackTarget && !process.env.ROLLBACK_TARGET) failures.push(`hosted ${environment} release evidence requires rollback target`);
  if (options.rollbackVerified !== true) failures.push(`hosted ${environment} release evidence requires verified rollback proof`);
  if (!(options.rollbackEvidence || options.realDeliveryRollbackEvidence)) failures.push(`hosted ${environment} release evidence requires rollback evidence`);
  if (!(options.healthCheckPath || options.realDeliveryHealthCheckPath)) failures.push(`hosted ${environment} release evidence requires health check path`);
  if (options.requireHealthCommit !== true) failures.push(`hosted ${environment} release evidence requires deployed commit SHA health proof`);
  return failures;
}

function releaseEvidenceBuilderInjectionFailure(options = {}) {
  if (typeof options.releaseEvidenceBuilder !== 'function' || !isRealEvidenceRequired(options)) return null;
  if (process.env.NODE_ENV === 'test') return null;
  return 'custom releaseEvidenceBuilder is only allowed in test mode for real-evidence runs';
}

module.exports = {
  HOSTED_RELEASE_ENVIRONMENTS,
  hostedReleaseArtifactInputFailures,
  releaseEvidenceBuilderInjectionFailure,
};
