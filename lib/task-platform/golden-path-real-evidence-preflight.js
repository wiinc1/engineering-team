const { resolveReleaseEvidenceEnvironment } = require('./golden-path-real-evidence');
const {
  collectGoldenPathRealEvidenceCliArgs,
  readGoldenPathRealEvidenceCliOptions,
} = require('./golden-path-real-evidence-cli-options');
const { githubApiBaseUrlFailures, mockGitHubEvidenceEnvFailures } = require('./github-evidence-source-policy');
const { hostedUrlFailure } = require('./hosted-url-evidence');
const { realBranchEvidenceFailure } = require('./real-branch');
const { commitShaEvidenceFailure } = require('./real-commit-sha');
const { candidateProofPreflightFailures } = require('./real-delivery-candidate-proof-preflight');
const { existingReleaseArtifactFailures } = require('./release-artifact-preflight');

const DEFAULT_PILOT_PR_NUMBER = 271;
const HOSTED_RELEASE_ENVIRONMENTS = new Set(['staging', 'prod']);

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function realEvidencePreflightEnv(options = {}) {
  if (options.allowTestEnvInjection === true && process.env.NODE_ENV === 'test') {
    return { ...process.env, ...(options.env || {}) };
  }
  return process.env;
}

function prNumberFromUrl(prUrl) {
  const match = String(prUrl || '').match(/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : null;
}

function isRealEvidenceMode(options = {}, env = process.env) {
  return options.requireRealEvidence === true
    || options.collectRealEvidence === true
    || options.agentDrivenPhases === true
    || parseBooleanEnv(env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE, false)
    || parseBooleanEnv(env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE, false);
}

function shouldCollectRealEvidence(options = {}, env = process.env) {
  return options.collectRealEvidence === true
    || options.requireRealEvidence === true
    || options.agentDrivenPhases === true
    || parseBooleanEnv(env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE, false)
    || parseBooleanEnv(env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE, false);
}

function hasPullRequestTarget(options = {}) {
  return Boolean(prNumberFromUrl(options.prUrl))
    || (Boolean(options.ciRepository || options.repository) && Number(options.prNumber) > 0);
}

function hasGitHubCheckExecutionEvidence(options = {}) {
  return options.checksProvided === true || (Array.isArray(options.checks) && options.checks.length > 0);
}

function hasRequiredCheckInventory(options = {}) {
  return options.requiredChecksProvided === true || (Array.isArray(options.requiredChecks) && options.requiredChecks.length > 0);
}

function hasBranchProtectionEvidence(options = {}) {
  return options.branchProtectionProvided === true || Boolean(options.branchProtection || options.branch_protection);
}

function hasMergeReadinessEvidence(options = {}) {
  return options.mergeReadinessProvided === true || Boolean(options.mergeReadiness);
}

function includesPhase6(options = {}) {
  if (options.resumePhase6Only === true) return true;
  const fromPhase = Number(options.fromPhase || options.from || 2);
  const toPhase = Number(options.toPhase || options.to || 5);
  return Number.isFinite(fromPhase)
    && Number.isFinite(toPhase)
    && fromPhase <= 6
    && toPhase >= 6;
}

function autoMergeEnabled(options = {}, env = process.env) {
  return options.autoMerge === true || parseBooleanEnv(env.FF_FACTORY_AUTO_MERGE, false);
}

function hasGithubToken(options = {}, env = process.env) {
  return Boolean(options.githubToken || env.GITHUB_TOKEN || env.GH_TOKEN);
}

function explicitCommitShaFailures(options = {}) {
  const failures = [];
  const implementationCommitSha = options.implementationCommitSha || options.commitSha;
  const implementationFailure = commitShaEvidenceFailure(implementationCommitSha);
  if (implementationFailure) failures.push(`implementation commit SHA: ${implementationFailure}`);
  for (const [label, value] of [
    ['commit SHA', options.implementationCommitSha ? options.commitSha : null],
    ['merge commit SHA', options.mergeCommitSha],
  ]) {
    if (!value) continue;
    const failure = commitShaEvidenceFailure(value);
    if (failure) failures.push(`${label}: ${failure}`);
  }
  return failures;
}

function explicitBranchFailures(options = {}) {
  const branch = options.branchName || options.branch;
  const failure = realBranchEvidenceFailure(branch);
  return failure ? [failure] : [];
}

function defaultPilotPrFailures(options = {}) {
  const prNumberInUrl = prNumberFromUrl(options.prUrl);
  const prNumber = Number(options.prNumber);
  return prNumberInUrl === DEFAULT_PILOT_PR_NUMBER || prNumber === DEFAULT_PILOT_PR_NUMBER
    ? ['default pilot PR #271 is not valid real evidence']
    : [];
}

function releaseArtifactCommandFailures(options = {}) {
  return existingReleaseArtifactFailures(options);
}

function candidateProofReferenceFailures(options = {}, releaseEnv) {
  return candidateProofPreflightFailures(options, releaseEnv);
}

function candidateProofGenerationFailures(options = {}, releaseEnv, env = process.env) {
  if (options.generateCandidateProof !== true) return [];
  const failures = [];
  if (!(options.candidateProofPath || options.realDeliveryCandidateProofPath)) failures.push(`hosted ${releaseEnv} candidate proof generation requires --candidate-proof output path`);
  if (!hasGithubToken(options, env)) failures.push(`hosted ${releaseEnv} candidate proof generation requires GITHUB_TOKEN or GH_TOKEN for GitHub evidence collection`);
  if (!Array.isArray(options.candidateTestCommands) || options.candidateTestCommands.length === 0) failures.push(`hosted ${releaseEnv} candidate proof generation requires --candidate-test-command`);
  if (String(options.riskLevel || '').toLowerCase() !== 'low') failures.push(`hosted ${releaseEnv} candidate proof generation requires --risk-level low`);
  if (options.productionSafe !== true) failures.push(`hosted ${releaseEnv} candidate proof generation requires --production-safe`);
  if (!options.productionSafetyEvidence) failures.push(`hosted ${releaseEnv} candidate proof generation requires --production-safety-evidence`);
  return failures;
}

function hostedRuntimeUrlFailures(options = {}, releaseEnv) {
  if (!includesPhase6(options)) return [];
  const failures = [];
  const effectiveOperatorUrl = options.operatorUrl || options.baseUrl;
  if (!effectiveOperatorUrl) {
    failures.push(`hosted ${releaseEnv} phase 6 requires --operator-url or --base-url`);
  } else {
    const operatorFailure = hostedUrlFailure(`hosted ${releaseEnv} operator URL`, effectiveOperatorUrl);
    if (operatorFailure) failures.push(operatorFailure);
  }
  for (const [label, value] of [
    [`hosted ${releaseEnv} base URL`, options.baseUrl],
    [`hosted ${releaseEnv} forge adapter URL`, options.forgeAdapterBaseUrl || options.forgeAdapterUrl],
  ]) {
    if (!value) continue;
    const failure = hostedUrlFailure(label, value);
    if (failure) failures.push(failure);
  }
  return failures;
}

function hostedReleaseProofFailures(options = {}, releaseEnv) {
  const failures = [];
  const deploymentUrl = options.deploymentUrl || options.productionUrl;
  if (!deploymentUrl) failures.push(`hosted ${releaseEnv} release evidence requires --deployment-url`);
  else {
    const urlFailure = hostedUrlFailure(`hosted ${releaseEnv} deployment URL`, deploymentUrl);
    if (urlFailure) failures.push(urlFailure);
  }
  if (!options.rollbackTarget) failures.push(`hosted ${releaseEnv} release evidence requires --rollback-target`);
  if (options.rollbackVerified !== true) failures.push(`hosted ${releaseEnv} release evidence requires --rollback-verified`);
  if (!options.rollbackEvidence) failures.push(`hosted ${releaseEnv} release evidence requires --rollback-evidence`);
  failures.push(...candidateProofReferenceFailures(options, releaseEnv));
  failures.push(...hostedRuntimeUrlFailures(options, releaseEnv));
  if (options.requireHealthCommit !== true) failures.push(`hosted ${releaseEnv} release evidence requires --require-health-commit`);
  if (!options.healthCheckPath) failures.push(`hosted ${releaseEnv} release evidence requires --health-check-path`);
  failures.push(...releaseArtifactCommandFailures(options));
  return failures;
}

function usesFixtureDelegationRunner(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  return normalized.includes('tests/fixtures/specialist-runtime-runner.js');
}

function fixtureDelegationFailures(options = {}, env = process.env) {
  const failures = [];
  const fixtureDelegation = options.factoryUseFixtureDelegation ?? env.FACTORY_USE_FIXTURE_DELEGATION;
  if (parseBooleanEnv(fixtureDelegation, false)) {
    failures.push('FACTORY_USE_FIXTURE_DELEGATION cannot be true in real-evidence mode');
  }
  const runner = options.specialistDelegationRunner
    || options.delegationRunner
    || env.SPECIALIST_DELEGATION_RUNNER;
  if (usesFixtureDelegationRunner(runner)) {
    failures.push('fixture specialist delegation runner is not valid autonomous evidence');
  }
  return failures;
}

function assertGoldenPathRealEvidencePreflight(options = {}, { context = 'Golden-path real evidence' } = {}) {
  const env = realEvidencePreflightEnv(options);
  if (!isRealEvidenceMode(options, env)) return { required: false, failures: [] };
  const failures = [];
  failures.push(...fixtureDelegationFailures(options, env));
  failures.push(...mockGitHubEvidenceEnvFailures(options, env));
  failures.push(...githubApiBaseUrlFailures(options, env));
  if (options.prDiscoveryFailure) failures.push(`PR target discovery report failed: ${options.prDiscoveryFailure}`);
  failures.push(...explicitBranchFailures(options));
  failures.push(...explicitCommitShaFailures(options));
  failures.push(...defaultPilotPrFailures(options));
  if (options.skipValidation === true) failures.push('deploy validation cannot be skipped');
  if (options.allowSreWaiver === true) failures.push('SRE waiver is not valid autonomous evidence');
  if (options.requireHealthyDeployment === false) failures.push('post-deploy health validation cannot be disabled');
  if (includesPhase6(options)) {
    if (!autoMergeEnabled(options, env)) failures.push('real-evidence phase 6 requires --auto-merge or FF_FACTORY_AUTO_MERGE=true');
    if (!hasGithubToken(options, env)) failures.push('real-evidence phase 6 requires GITHUB_TOKEN or GH_TOKEN for GitHub auto-merge');
  }
  if (shouldCollectRealEvidence(options, env)) {
    if (!hasPullRequestTarget(options)) failures.push('actual pull request target is required (--pr-url or --repository/--pr-number)');
    const releaseEnv = resolveReleaseEvidenceEnvironment({ ...options, env });
    if (HOSTED_RELEASE_ENVIRONMENTS.has(releaseEnv)) {
      failures.push(...hostedReleaseProofFailures(options, releaseEnv));
      failures.push(...candidateProofGenerationFailures(options, releaseEnv, env));
    }
  } else {
    failures.push(...(options.branchName || options.branch ? [] : ['actual branch name is required']));
    const commitShaFailure = commitShaEvidenceFailure(options.implementationCommitSha || options.commitSha || options.mergeCommitSha);
    if (commitShaFailure) failures.push(commitShaFailure);
    if (!hasPullRequestTarget(options)) failures.push('actual pull request target is required (--pr-url or --repository/--pr-number)');
    if (!hasGitHubCheckExecutionEvidence(options)) failures.push('GitHub check execution evidence is required (--checks-json or --checks-file)');
    if (!hasRequiredCheckInventory(options)) failures.push('branch-protection required-check inventory is required (--required-checks-json or --required-checks-file)');
    if (!hasBranchProtectionEvidence(options)) failures.push('GitHub branch-protection evidence is required (--branch-protection-json or --branch-protection-file)');
    if (!hasMergeReadinessEvidence(options)) failures.push('Merge readiness evidence is required (--merge-readiness-json or --merge-readiness-file)');
  }
  if (failures.length) throw new Error(`${context} preflight failed: ${failures.join('; ')}`);
  return { required: true, failures: [] };
}

module.exports = {
  collectGoldenPathRealEvidenceCliArgs,
  assertGoldenPathRealEvidencePreflight,
  fixtureDelegationFailures,
  hasPullRequestTarget,
  realEvidencePreflightEnv,
  readGoldenPathRealEvidenceCliOptions,
};
