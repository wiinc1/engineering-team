#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { discoverGitHubPullRequestTarget } = require('../lib/task-platform/github-pr-target-discovery');
const { hostedUrlFailure } = require('../lib/task-platform/hosted-url-evidence');
const {
  localGitProofDefaults,
  localGitWorktreeFailure,
} = require('../lib/task-platform/local-git-proof-inputs');
const { realBranchEvidenceFailure } = require('../lib/task-platform/real-branch');
const { commitShaEvidenceFailure } = require('../lib/task-platform/real-commit-sha');
const { hydratePrDiscoveryReportOptions } = require('../lib/task-platform/real-delivery-pr-discovery-report');
const { existingReleaseArtifactFailures } = require('../lib/task-platform/release-artifact-preflight');
const {
  buildPostMergeCommands,
  buildPreMergeCommands,
  commandLine,
  discoverPrTargetArgs,
} = require('../lib/task-platform/real-autonomous-delivery-plan-commands');

const PLAN_SCHEMA_VERSION = 'real-autonomous-delivery-plan.v1';
const HOSTED_RELEASE_ENVIRONMENTS = new Set(['staging', 'prod']);
const DEFAULT_CANDIDATE_PROOF = 'observability/real-delivery-candidate-proof.json', DEFAULT_PRODUCTION_SAFETY = 'observability/release/production-safety.json', DEFAULT_ROLLBACK_EVIDENCE = 'observability/release/rollback-verification.json', DEFAULT_RELEASE_ARTIFACT_DIR = 'observability/release/artifacts', DEFAULT_SOURCE_EVIDENCE = 'observability/golden-path-postgres-pilot.json', DEFAULT_FINAL_EVIDENCE = 'observability/real-autonomous-delivery-evidence.json', DEFAULT_FINAL_VERIFICATION_REPORT = 'observability/real-autonomous-delivery-verification-report.json', DEFAULT_PR_DISCOVERY_REPORT = 'observability/real-delivery-pr-target.json';

function readArg(name, fallback = '', argv = process.argv) {
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
}

function readArgs(name, argv = process.argv) {
  const values = [];
  for (let index = 0; index < argv.length - 1; index += 1) {
    if (argv[index] === name) values.push(argv[index + 1]);
  }
  return values.filter(Boolean);
}

function hasFlag(name, argv = process.argv) {
  return argv.includes(name);
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'verified'].includes(String(value).trim().toLowerCase());
}

function shouldPrintHelp(argv = process.argv) {
  return hasFlag('--help', argv) || hasFlag('-h', argv);
}

function prNumberFromUrl(prUrl) {
  const match = String(prUrl || '').match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : null;
}

function normalizeReleaseEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'production' ? 'prod' : normalized;
}

function releaseArtifactCommands(argv = process.argv, env = process.env) {
  return {
    build: readArg('--release-build-command', env.RELEASE_BUILD_COMMAND || '', argv),
    compatibility: readArg('--release-compatibility-command', env.RELEASE_COMPATIBILITY_COMMAND || '', argv),
    vulnerability: readArg('--release-vulnerability-command', env.RELEASE_VULNERABILITY_COMMAND || '', argv),
    secret: readArg('--release-secret-command', env.RELEASE_SECRET_COMMAND || '', argv),
  };
}

function optionsFromArgv(argv = process.argv, env = process.env) {
  const releaseEnv = normalizeReleaseEnv(readArg('--release-env', env.RELEASE_ENV || 'staging', argv));
  const repoRoot = readArg('--repo-root', process.cwd(), argv);
  const localGitDefaultsUsed = !hasFlag('--no-git-defaults', argv);
  const git = localGitDefaultsUsed ? localGitProofDefaults(repoRoot) : {};
  return {
    repoRoot,
    releaseEnv,
    localGitDefaultsUsed,
    baseUrl: readArg('--base-url', env.FACTORY_STAGING_BASE_URL || env.STAGING_BASE_URL || env.FACTORY_BASE_URL || '', argv),
    operatorUrl: readArg('--operator-url', env.FACTORY_OPERATOR_URL || env.OPERATOR_URL || env.DEPLOYMENT_URL || '', argv),
    repository: readArg('--repository', env.CI_REPOSITORY || env.GITHUB_REPOSITORY || git.repository || '', argv),
    branchName: readArg('--branch', '', argv) || readArg('--branch-name', env.BRANCH_NAME || env.GITHUB_HEAD_REF || git.branchName || '', argv),
    implementationCommitSha: readArg('--implementation-commit-sha', '', argv)
      || readArg('--commit-sha', env.IMPLEMENTATION_COMMIT_SHA || env.COMMIT_SHA || env.GITHUB_SHA || git.implementationCommitSha || '', argv),
    prUrl: readArg('--pr-url', env.PR_URL || env.GITHUB_PR_URL || '', argv),
    prNumber: Number(readArg('--pr-number', env.PR_NUMBER || env.GITHUB_PR_NUMBER || '', argv)) || undefined,
    githubToken: readArg('--github-token', env.GITHUB_TOKEN || env.GH_TOKEN || '', argv),
    githubApiBaseUrl: readArg('--github-api-base-url', env.GITHUB_API_BASE_URL || '', argv),
    headOwner: readArg('--head-owner', env.GITHUB_HEAD_OWNER || '', argv),
    discoverPrTarget: hasFlag('--discover-pr-target', argv) || parseBoolean(env.DISCOVER_REAL_DELIVERY_PR_TARGET, false),
    usePrDiscoveryReport: hasFlag('--use-pr-discovery-report', argv) || parseBoolean(env.USE_REAL_DELIVERY_PR_DISCOVERY_REPORT, false),
    prDiscoveryReportPath: readArg('--pr-discovery-report', env.REAL_DELIVERY_PR_DISCOVERY_REPORT || DEFAULT_PR_DISCOVERY_REPORT, argv),
    fetchImpl: globalThis.fetch,
    deploymentUrl: readArg('--deployment-url', env.DEPLOYMENT_URL || env.PRODUCTION_URL || '', argv),
    rollbackTarget: readArg('--rollback-target', env.ROLLBACK_TARGET || '', argv),
    rollbackEvidence: readArg('--rollback-evidence', env.ROLLBACK_EVIDENCE || env.ROLLBACK_EVIDENCE_PATH || DEFAULT_ROLLBACK_EVIDENCE, argv),
    productionSafetyEvidence: readArg('--production-safety-evidence', env.PRODUCTION_SAFETY_EVIDENCE || env.PRODUCTION_SAFETY_EVIDENCE_PATH || DEFAULT_PRODUCTION_SAFETY, argv),
    candidateProofPath: readArg('--candidate-proof', env.REAL_DELIVERY_CANDIDATE_PROOF_PATH || DEFAULT_CANDIDATE_PROOF, argv),
    releaseArtifactDir: readArg('--release-artifact-dir', env.RELEASE_ARTIFACT_DIR || DEFAULT_RELEASE_ARTIFACT_DIR, argv),
    sourceEvidencePath: readArg('--source-evidence', env.REAL_DELIVERY_SOURCE_EVIDENCE || env.GOLDEN_PATH_EVIDENCE || DEFAULT_SOURCE_EVIDENCE, argv),
    finalEvidencePath: readArg('--final-evidence', env.REAL_AUTONOMOUS_DELIVERY_EVIDENCE || DEFAULT_FINAL_EVIDENCE, argv),
    finalVerificationReportPath: readArg('--final-verification-report', env.REAL_AUTONOMOUS_DELIVERY_VERIFICATION_REPORT || DEFAULT_FINAL_VERIFICATION_REPORT, argv),
    healthCheckPath: readArg('--health-check-path', env.RELEASE_HEALTH_CHECK_PATH || env.REAL_DELIVERY_HEALTH_CHECK_PATH || '', argv),
    requireHealthCommit: hasFlag('--require-health-commit', argv) || parseBoolean(env.REQUIRE_HEALTH_COMMIT, false),
    useExistingReleaseArtifacts: hasFlag('--use-existing-release-artifacts', argv)
      || parseBoolean(env.USE_EXISTING_RELEASE_ARTIFACTS, false),
    releaseArtifactCommands: releaseArtifactCommands(argv, env),
    candidateTestCommands: readArgs('--candidate-test-command', argv),
    reportPath: readArg('--report', readArg('--report-path', '', argv), argv),
    workingTreeClean: localGitDefaultsUsed ? git.workingTreeClean : null,
    dirtyFileCount: localGitDefaultsUsed ? git.dirtyFileCount : null,
    dirtyFiles: localGitDefaultsUsed ? git.dirtyFiles || [] : [],
  };
}

function hasPullRequestTarget(options = {}) {
  return Boolean(prNumberFromUrl(options.prUrl))
    || (Boolean(options.repository) && Number(options.prNumber) > 0);
}

function shouldDiscoverPullRequestTarget(options = {}) {
  return options.discoverPrTarget === true && !hasPullRequestTarget(options);
}

function prDiscoveryFailureMessage(error) {
  return error?.message || String(error);
}

function applyDiscoveredPullRequestTarget(options = {}, target = {}) {
  return {
    ...options,
    repository: target.repository || options.repository,
    branchName: target.branchName || options.branchName,
    implementationCommitSha: target.implementationCommitSha || options.implementationCommitSha,
    prNumber: target.prNumber,
    prUrl: target.prUrl,
    prDiscovery: {
      requested: true,
      ok: true,
      source: target.source || null,
    },
  };
}

async function resolvePlanOptions(options = {}, env = process.env) {
  const reported = hydratePrDiscoveryReportOptions(options, options.repoRoot);
  if (reported.prDiscoveryFailure || hasPullRequestTarget(reported)) return reported;
  if (!shouldDiscoverPullRequestTarget(options)) {
    return {
      ...options,
      prDiscovery: {
        requested: options.discoverPrTarget === true || options.usePrDiscoveryReport === true,
        ok: hasPullRequestTarget(options),
        source: null,
      },
    };
  }
  try {
    const target = await discoverGitHubPullRequestTarget(options, env);
    return applyDiscoveredPullRequestTarget(options, target);
  } catch (error) {
    return {
      ...options,
      prDiscoveryFailure: prDiscoveryFailureMessage(error),
      prDiscovery: {
        requested: true,
        ok: false,
        source: null,
      },
    };
  }
}

function planInputFailures(options = {}) {
  const failures = [];
  if (options.prDiscoveryFailure) failures.push(`PR target discovery failed: ${options.prDiscoveryFailure}`);
  if (!HOSTED_RELEASE_ENVIRONMENTS.has(options.releaseEnv)) failures.push('release environment must be staging or prod');
  if (!options.baseUrl && !options.operatorUrl) failures.push('hosted phase 6 requires --base-url or --operator-url');
  for (const [label, value] of [
    ['hosted base URL', options.baseUrl],
    ['hosted operator URL', options.operatorUrl],
  ]) {
    if (!value) continue;
    const failure = hostedUrlFailure(label, value);
    if (failure) failures.push(failure);
  }
  if (!options.repository) failures.push('GitHub repository is required');
  const branchFailure = realBranchEvidenceFailure(options.branchName);
  if (branchFailure) failures.push(branchFailure);
  if (!options.implementationCommitSha) failures.push('implementation commit SHA is required');
  else {
    const shaFailure = commitShaEvidenceFailure(options.implementationCommitSha);
    if (shaFailure) failures.push(`implementation commit SHA: ${shaFailure}`);
  }
  const worktreeFailure = localGitWorktreeFailure(options);
  if (worktreeFailure) failures.push(worktreeFailure);
  if (!hasPullRequestTarget(options)) failures.push('actual pull request target is required');
  if (prNumberFromUrl(options.prUrl) === 271 || Number(options.prNumber) === 271) {
    failures.push('default pilot PR #271 is not valid real evidence');
  }
  if (!options.githubToken) failures.push('GITHUB_TOKEN or GH_TOKEN is required for GitHub evidence collection and auto-merge');
  if (!options.deploymentUrl) failures.push('hosted deployment URL is required');
  else {
    const urlFailure = hostedUrlFailure('hosted deployment URL', options.deploymentUrl);
    if (urlFailure) failures.push(urlFailure);
  }
  if (!options.rollbackTarget) failures.push('rollback target is required');
  if (!options.healthCheckPath) failures.push('health check path is required');
  if (options.requireHealthCommit !== true) failures.push('deployed commit SHA health proof must be required');
  if (!options.candidateTestCommands.length) failures.push('at least one --candidate-test-command is required');
  if (options.useExistingReleaseArtifacts) {
    if (!options.releaseArtifactDir) failures.push('release artifact directory is required when reusing artifacts');
    failures.push(...existingReleaseArtifactFailures(options));
  } else {
    for (const [name, value] of Object.entries(options.releaseArtifactCommands || {})) {
      if (!value) failures.push(`release ${name} command is required`);
    }
  }
  return failures;
}

function commandReadiness(commands = [], failures = []) {
  const ready = failures.length === 0;
  return commands.map((item) => ({
    ...item,
    ready,
    blockedBy: ready ? [] : failures,
  }));
}

function prDiscoverySummary(options = {}) {
  return {
    requested: options.discoverPrTarget === true || options.usePrDiscoveryReport === true,
    ok: options.prDiscovery?.ok === true,
    source: options.prDiscovery?.source ? {
      provider: options.prDiscovery.source.provider || null,
      apiBaseUrl: options.prDiscovery.source.apiBaseUrl || null,
      collectedAt: options.prDiscovery.source.collectedAt || null,
    } : null,
  };
}

function planInputs(options = {}) {
  return {
    releaseEnv: options.releaseEnv || null,
    baseUrl: options.baseUrl || null,
    operatorUrl: options.operatorUrl || null,
    repository: options.repository || null,
    branchName: options.branchName || null,
    implementationCommitSha: options.implementationCommitSha || null,
    prUrl: options.prUrl || null,
    prNumber: options.prNumber || null,
    prDiscovery: prDiscoverySummary(options),
    localGitDefaultsUsed: options.localGitDefaultsUsed === true,
    workingTreeClean: typeof options.workingTreeClean === 'boolean' ? options.workingTreeClean : null,
    dirtyFileCount: Number.isInteger(options.dirtyFileCount) ? options.dirtyFileCount : null,
    deploymentUrl: options.deploymentUrl || null,
    rollbackTarget: options.rollbackTarget || null,
    hasGithubToken: Boolean(options.githubToken),
    requireHealthCommit: options.requireHealthCommit === true,
    useExistingReleaseArtifacts: options.useExistingReleaseArtifacts === true,
    candidateTestCommandCount: options.candidateTestCommands?.length || 0,
  };
}

function planArtifacts(options = {}) {
  return {
    rollbackEvidence: options.rollbackEvidence,
    prDiscoveryReportPath: options.prDiscoveryReportPath,
    productionSafetyEvidence: options.productionSafetyEvidence,
    releaseArtifactDir: options.releaseArtifactDir,
    candidateProofPath: options.candidateProofPath,
    sourceEvidencePath: options.sourceEvidencePath,
    finalEvidencePath: options.finalEvidencePath,
    finalVerificationReportPath: options.finalVerificationReportPath,
  };
}

function buildPlanReport(options = {}) {
  const failures = planInputFailures(options);
  const blocked = failures.length > 0;
  const commands = commandReadiness(buildPreMergeCommands(options), failures);
  const postMergeCommands = commandReadiness(buildPostMergeCommands(options), failures);
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    ok: !blocked,
    blocked,
    blockedBy: blocked ? failures : [],
    failureCount: failures.length,
    failures,
    inputs: planInputs(options),
    artifacts: planArtifacts(options),
    commands,
    postMergeCommands,
  };
}

function writeJsonReport(reportPath, report, cwd = process.cwd()) {
  if (!reportPath) return null;
  const resolved = path.resolve(cwd, reportPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
  return resolved;
}

function usageText() {
  return `${[
    'Usage: node scripts/plan-real-autonomous-delivery.js [options]',
    'Builds a redacted ordered command plan for real hosted autonomous delivery proof.',
    'Required: hosted URLs, repository, branch, commit SHA, PR, GitHub token, deployment URL, rollback target, health path, candidate test command, and release evidence commands.',
    'Key flags: --base-url --operator-url --repository --branch --implementation-commit-sha --pr-url|--pr-number --discover-pr-target --use-pr-discovery-report --deployment-url --rollback-target --health-check-path --require-health-commit --candidate-test-command.',
    'Release flags: --release-build-command --release-compatibility-command --release-vulnerability-command --release-secret-command, or --use-existing-release-artifacts.',
    'Output flags: --json --report <path>. Use --no-git-defaults to disable local repository, branch, commit, and worktree defaults.',
  ].join('\n')}\n`;
}

function commandLabel(item = {}) {
  return item.ready ? item.id : `${item.id} [BLOCKED]`;
}

function printHumanReport(report) {
  if (report.ok) process.stdout.write('PASS  real-autonomous-delivery-plan: hosted proof inputs ready\n');
  else {
    for (const failure of report.failures) process.stderr.write(`FAIL  real-autonomous-delivery-plan: ${failure}\n`);
  }
  for (const item of report.commands) process.stdout.write(`${commandLabel(item)}: ${item.command}\n`);
  for (const item of report.postMergeCommands) process.stdout.write(`${commandLabel(item)}: ${item.command}\n`);
}

async function main(argv = process.argv, env = process.env) {
  if (shouldPrintHelp(argv)) {
    process.stdout.write(usageText());
    return { ok: true, help: true };
  }
  const options = await resolvePlanOptions(optionsFromArgv(argv, env), env);
  const report = buildPlanReport(options);
  writeJsonReport(options.reportPath, report);
  if (hasFlag('--json', argv)) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printHumanReport(report);
  if (!report.ok) process.exitCode = 1;
  return { ok: report.ok, report, options };
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  PLAN_SCHEMA_VERSION,
  applyDiscoveredPullRequestTarget,
  buildPlanReport,
  commandLabel,
  commandLine,
  commandReadiness,
  discoverPrTargetArgs,
  hasFlag,
  optionsFromArgv,
  planArtifacts,
  planInputs,
  planInputFailures,
  prDiscoveryFailureMessage,
  readArg,
  readArgs,
  resolvePlanOptions,
  shouldDiscoverPullRequestTarget,
  shouldPrintHelp,
  usageText,
  writeJsonReport,
};
