#!/usr/bin/env node
const {
  assertRealAutonomousDeliveryBuildPreflight,
  buildRealAutonomousDeliveryEvidence,
  writeRealAutonomousDeliveryEvidence,
} = require('../lib/task-platform/real-autonomous-delivery-builder');

function readArg(name, fallback = '', argv = process.argv) {
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
}

function hasFlag(name, argv = process.argv) {
  return argv.includes(name);
}

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'verified'].includes(String(value).trim().toLowerCase());
}

function releaseArtifactCommands(argv = process.argv, env = process.env) {
  return {
    build: readArg('--release-build-command', env.RELEASE_BUILD_COMMAND || '', argv),
    compatibility: readArg('--release-compatibility-command', env.RELEASE_COMPATIBILITY_COMMAND || '', argv),
    vulnerability: readArg('--release-vulnerability-command', env.RELEASE_VULNERABILITY_COMMAND || '', argv),
    secret: readArg('--release-secret-command', env.RELEASE_SECRET_COMMAND || '', argv),
  };
}

function buildCliOptions(argv = process.argv, env = process.env) {
  const repoRoot = readArg('--repo-root', process.cwd(), argv);
  return {
    cwd: repoRoot,
    repoRoot,
    outPath: readArg('--out', env.REAL_AUTONOMOUS_DELIVERY_EVIDENCE || 'observability/real-autonomous-delivery-evidence.json', argv),
    baseUrl: readArg('--base-url', env.FACTORY_BASE_URL || '', argv),
    operatorUrl: readArg('--operator-url', env.OPERATOR_URL || '', argv),
    deploymentUrl: readArg('--deployment-url', env.DEPLOYMENT_URL || '', argv),
    productionUrl: readArg('--production-url', env.PRODUCTION_URL || '', argv),
    ciRepository: readArg('--repository', '', argv) || readArg('--ci-repository', env.CI_REPOSITORY || env.GITHUB_REPOSITORY || '', argv),
    branchName: readArg('--branch', '', argv) || readArg('--branch-name', env.BRANCH_NAME || env.GITHUB_HEAD_REF || '', argv),
    implementationCommitSha: readArg('--implementation-commit-sha', '', argv) || readArg('--commit-sha', env.IMPLEMENTATION_COMMIT_SHA || env.COMMIT_SHA || env.GITHUB_SHA || '', argv),
    prUrl: readArg('--pr-url', env.PR_URL || env.GITHUB_PR_URL || '', argv),
    prNumber: Number(readArg('--pr-number', env.PR_NUMBER || env.GITHUB_PR_NUMBER || '', argv)) || undefined,
    githubToken: readArg('--github-token', env.GITHUB_TOKEN || env.GH_TOKEN || '', argv),
    githubApiBaseUrl: readArg('--github-api-base-url', env.GITHUB_API_BASE_URL || '', argv),
    releaseEnv: readArg('--release-env', env.RELEASE_ENV || '', argv),
    changeKind: readArg('--change-kind', env.CHANGE_KIND || '', argv),
    templateTier: readArg('--template-tier', env.FACTORY_TEMPLATE_TIER || '', argv),
    changeReversibility: readArg('--change-reversibility', env.CHANGE_REVERSIBILITY || '', argv),
    rollbackTarget: readArg('--rollback-target', env.ROLLBACK_TARGET || '', argv),
    rollbackEvidence: readArg('--rollback-evidence', env.ROLLBACK_EVIDENCE || env.ROLLBACK_EVIDENCE_PATH || '', argv),
    rollbackVerified: hasFlag('--rollback-verified', argv) || parseBooleanEnv(env.ROLLBACK_VERIFIED, false),
    candidateProofPath: readArg('--candidate-proof', env.REAL_DELIVERY_CANDIDATE_PROOF_PATH || '', argv),
    sourceEvidencePath: readArg('--source-evidence', '', argv)
      || readArg('--golden-path-evidence', env.REAL_DELIVERY_SOURCE_EVIDENCE || env.GOLDEN_PATH_EVIDENCE || '', argv),
    preflightOnly: hasFlag('--preflight-only', argv),
    releaseArtifactDir: readArg('--release-artifact-dir', env.RELEASE_ARTIFACT_DIR || '', argv),
    useExistingReleaseArtifacts: hasFlag('--use-existing-release-artifacts', argv)
      || parseBooleanEnv(env.USE_EXISTING_RELEASE_ARTIFACTS, false),
    releaseArtifactCommands: releaseArtifactCommands(argv, env),
    releaseArtifactCommandTimeoutMs: Number(readArg('--release-artifact-timeout-ms', env.RELEASE_ARTIFACT_COMMAND_TIMEOUT_MS || '', argv)),
    healthCheckPath: readArg('--health-check-path', env.RELEASE_HEALTH_CHECK_PATH || env.REAL_DELIVERY_HEALTH_CHECK_PATH || '', argv),
    requireHealthCommit: hasFlag('--require-health-commit', argv)
      || parseBooleanEnv(env.REQUIRE_HEALTH_COMMIT, false),
  };
}

function printPreflightResult(options) {
  process.stdout.write([
    'PASS  real-autonomous-delivery-preflight',
    `pull request: ${options.prUrl || `${options.ciRepository}#${options.prNumber}`}`,
    `deployment: ${options.deploymentUrl || options.productionUrl}`,
    `source evidence: ${options.sourceEvidencePath}`,
    `release env: ${options.releaseEnv || 'prod'}`,
  ].join('\n'));
  process.stdout.write('\n');
}

function printResult(result, outPath) {
  process.stdout.write([
    `PASS  real-autonomous-delivery-build: ${outPath}`,
    `pull request: ${result.github.prUrl}`,
    `head commit: ${result.github.commitSha}`,
    `merge commit: ${result.github.mergeCommitSha}`,
    `release artifacts: ${Object.keys(result.releaseArtifacts || {}).length}`,
  ].join('\n'));
  process.stdout.write('\n');
}

async function main() {
  const options = buildCliOptions();
  if (options.preflightOnly) {
    assertRealAutonomousDeliveryBuildPreflight(options);
    printPreflightResult(options);
    return;
  }
  const result = await buildRealAutonomousDeliveryEvidence(options);
  const writtenPath = writeRealAutonomousDeliveryEvidence(options.cwd, options.outPath, result.evidence);
  printResult(result, writtenPath || options.outPath);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildCliOptions,
  hasFlag,
  main,
  parseBooleanEnv,
  readArg,
  releaseArtifactCommands,
};
