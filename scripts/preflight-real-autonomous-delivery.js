#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  assertGoldenPathRealEvidencePreflight,
  hasPullRequestTarget,
  readGoldenPathRealEvidenceCliOptions,
} = require('../lib/task-platform/golden-path-real-evidence-preflight');
const { discoverGitHubPullRequestTarget } = require('../lib/task-platform/github-pr-target-discovery');
const {
  localGitProofDefaults,
  localGitWorktreeFailure,
} = require('../lib/task-platform/local-git-proof-inputs');
const { hydratePrDiscoveryReportOptions } = require('../lib/task-platform/real-delivery-pr-discovery-report');

const HOSTED_RELEASE_ENVIRONMENTS = new Set(['staging', 'prod']);
const PREFLIGHT_REPORT_SCHEMA_VERSION = 'real-autonomous-delivery-preflight-report.v1';

function readArg(name, fallback = '', argv = process.argv) {
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
}

function hasFlag(name, argv = process.argv) {
  return argv.includes(name);
}

function shouldPrintHelp(argv = process.argv) {
  return hasFlag('--help', argv) || hasFlag('-h', argv);
}

function numberArg(name, fallback, argv = process.argv) {
  const raw = readArg(name, String(fallback), argv);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function usageText() {
  return `${[
    'Usage: node scripts/preflight-real-autonomous-delivery.js [options]',
    '',
    'Checks that a real hosted autonomous delivery run has the required PR, GitHub, deployment, rollback, candidate proof, and release-artifact inputs before attempting hosted Phase 6.',
    '',
    'Common hosted Phase 6 inputs:',
    '  --base-url <url>                       Hosted API base URL',
    '  --operator-url <url>                   Hosted operator app URL',
    '  --forgeadapter-url <url>               Hosted forge adapter URL, when needed',
    '  --repository <owner/repo>              GitHub repository',
    '  --pr-url <url> | --pr-number <n>       Pull request target',
    '  --use-pr-discovery-report             Load PR target from --pr-discovery-report',
    '  --pr-discovery-report <path>           Report from npm run autonomy:discover-real-delivery-pr',
    '  --discover-pr-target                  Discover the PR target from GitHub by repository, branch, and commit',
    '  --auto-merge                          Required for hosted Phase 6 real evidence',
    '  --github-token <token>                 GitHub token, or use GITHUB_TOKEN/GH_TOKEN',
    '  --deployment-url <url>                 Hosted deployment URL',
    '  --rollback-target <target>             Rollback target',
    '  --rollback-evidence <path>             Rollback verification artifact',
    '  --rollback-verified                   Assert rollback verification is complete',
    '  --candidate-proof <path>               Readable candidate proof from npm run autonomy:verify-real-delivery-candidate',
    '  --require-health-commit               Require health evidence to prove the deployed commit',
    '  --health-check-path <path>             Health endpoint path',
    '  --release-build-command <command>      Build proof command',
    '  --release-compatibility-command <cmd>  Compatibility proof command',
    '  --release-vulnerability-command <cmd>  Vulnerability proof command',
    '  --release-secret-command <command>     Secret-scan proof command',
    '  --release-env <staging|prod>           Hosted release environment',
    '  --json                                Print a machine-readable readiness report',
    '  --report <path>                       Write the machine-readable readiness report',
    'Example:',
    '  node scripts/preflight-real-autonomous-delivery.js \\',
    '    --base-url https://<hosted-api> --operator-url https://<hosted-app> \\',
    '    --repository wiinc1/engineering-team --discover-pr-target \\',
    '    --auto-merge --github-token "$GITHUB_TOKEN" --deployment-url https://<hosted-app> \\',
    '    --rollback-target <last-known-good> --rollback-evidence observability/release/rollback-verification.json \\',
    '    --rollback-verified --candidate-proof observability/real-delivery-candidate-proof.json \\',
    '    --require-health-commit --health-check-path /version --release-build-command "npm run build" \\',
    '    --release-compatibility-command "npm run test:unit" --release-vulnerability-command "npm audit --audit-level=high" \\',
    '    --release-secret-command "npm run secrets:scan" --release-env staging',
  ].join('\n')}\n`;
}

function printUsage(stream = process.stdout) {
  stream.write(usageText());
}

function normalizeReleaseEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'production') return 'prod';
  return normalized;
}

function explicitReleaseEnvFailures(options = {}) {
  const releaseEnv = normalizeReleaseEnv(options.releaseEnv);
  if (!releaseEnv) return ['hosted release evidence requires --release-env staging or prod'];
  if (!HOSTED_RELEASE_ENVIRONMENTS.has(releaseEnv)) {
    return ['hosted release evidence requires --release-env staging or prod'];
  }
  return [];
}

function standaloneCandidateProofFailures(options = {}) {
  if (options.generateCandidateProof !== true) return [];
  return [
    'standalone real-delivery preflight requires an existing --candidate-proof; generate it with npm run autonomy:verify-real-delivery-candidate first',
  ];
}

function buildPreflightOptions(argv = process.argv, env = process.env) {
  const repoRoot = readArg('--repo-root', process.cwd(), argv);
  const localGitDefaultsUsed = !hasFlag('--no-git-defaults', argv);
  const git = localGitDefaultsUsed ? localGitProofDefaults(repoRoot) : {};
  const realEvidenceOptions = readGoldenPathRealEvidenceCliOptions(argv, env);
  return {
    ...realEvidenceOptions,
    repoRoot,
    localGitDefaultsUsed,
    ciRepository: realEvidenceOptions.ciRepository || git.repository || '',
    branchName: realEvidenceOptions.branchName || git.branchName || '',
    implementationCommitSha: realEvidenceOptions.implementationCommitSha || git.implementationCommitSha || '',
    commitSha: realEvidenceOptions.commitSha || git.implementationCommitSha || '',
    collectRealEvidence: true,
    requireRealEvidence: true,
    requireReadableCandidateProof: true,
    fromPhase: numberArg('--from', 6, argv),
    toPhase: numberArg('--to', 6, argv),
    baseUrl: readArg('--base-url', env.FACTORY_STAGING_BASE_URL || env.STAGING_BASE_URL || '', argv),
    operatorUrl: readArg('--operator-url', env.FACTORY_OPERATOR_URL || env.OPERATOR_URL || '', argv),
    forgeAdapterBaseUrl: readArg('--forgeadapter-url', env.FORGEADAPTER_BASE_URL || '', argv),
    headOwner: readArg('--head-owner', env.GITHUB_HEAD_OWNER || '', argv),
    usePrDiscoveryReport: hasFlag('--use-pr-discovery-report', argv),
    prDiscoveryReportPath: readArg('--pr-discovery-report', env.REAL_DELIVERY_PR_DISCOVERY_REPORT || '', argv),
    discoverPrTarget: hasFlag('--discover-pr-target', argv),
    fetchImpl: globalThis.fetch,
    skipValidation: hasFlag('--skip-validation', argv),
    allowSreWaiver: hasFlag('--allow-sre-waiver', argv),
    workingTreeClean: localGitDefaultsUsed ? git.workingTreeClean : null,
    dirtyFileCount: localGitDefaultsUsed ? git.dirtyFileCount : null,
    dirtyFiles: localGitDefaultsUsed ? git.dirtyFiles || [] : [],
    env,
  };
}

function shouldDiscoverPullRequestTarget(options = {}) {
  return options.discoverPrTarget === true && !hasPullRequestTarget(options);
}

function applyDiscoveredPullRequestTarget(options = {}, target = {}) {
  return {
    ...options,
    ciRepository: target.repository || options.ciRepository,
    repository: target.repository || options.repository,
    branchName: target.branchName || options.branchName,
    implementationCommitSha: target.implementationCommitSha || options.implementationCommitSha,
    commitSha: options.commitSha || target.implementationCommitSha || '',
    prNumber: target.prNumber,
    prUrl: target.prUrl,
    prDiscovery: {
      requested: true,
      ok: true,
      source: target.source || null,
    },
  };
}

async function resolvePreflightOptions(options = {}, env = process.env) {
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
      prDiscoveryFailure: error?.message || String(error),
      prDiscovery: {
        requested: true,
        ok: false,
        source: null,
      },
    };
  }
}

function failureLines(error) {
  const message = error?.message || String(error);
  const prefixMatch = message.match(/preflight failed: (.*)$/s);
  const detail = prefixMatch ? prefixMatch[1] : message;
  return detail.split(/;\s+/).filter(Boolean);
}

function evaluatePreflight(options = {}) {
  const worktreeFailure = localGitWorktreeFailure(options);
  const failures = [
    ...(options.prDiscoveryFailure ? [`PR target discovery failed: ${options.prDiscoveryFailure}`] : []),
    ...(worktreeFailure ? [worktreeFailure] : []),
    ...explicitReleaseEnvFailures(options),
    ...standaloneCandidateProofFailures(options),
  ];
  let result = null;
  try {
    result = assertGoldenPathRealEvidencePreflight(options, {
      context: 'Real autonomous delivery',
    });
  } catch (error) {
    failures.push(...failureLines(error));
  }
  return {
    ok: failures.length === 0,
    result,
    failures,
  };
}

function redactedPreflightInputs(options = {}) {
  return {
    releaseEnv: options.releaseEnv || null,
    fromPhase: options.fromPhase || null,
    toPhase: options.toPhase || null,
    repository: options.ciRepository || null,
    branchName: options.branchName || options.branch || null,
    implementationCommitSha: options.implementationCommitSha || null,
    commitSha: options.commitSha || null,
    prUrl: options.prUrl || null,
    prNumber: options.prNumber || null,
    prDiscovery: {
      requested: options.discoverPrTarget === true,
      ok: options.prDiscovery?.ok === true,
      reportPath: options.prDiscovery?.reportPath || options.prDiscoveryReportPath || null,
      source: options.prDiscovery?.source ? {
        provider: options.prDiscovery.source.provider || null,
        apiBaseUrl: options.prDiscovery.source.apiBaseUrl || null,
        collectedAt: options.prDiscovery.source.collectedAt || null,
      } : null,
    },
    localGitDefaultsUsed: options.localGitDefaultsUsed === true,
    workingTreeClean: typeof options.workingTreeClean === 'boolean' ? options.workingTreeClean : null,
    dirtyFileCount: Number.isInteger(options.dirtyFileCount) ? options.dirtyFileCount : null,
    deploymentUrl: options.deploymentUrl || options.productionUrl || null,
    rollbackTarget: options.rollbackTarget || null,
    rollbackEvidence: options.rollbackEvidence || null,
    candidateProofPath: options.candidateProofPath || options.realDeliveryCandidateProofPath || null,
    releaseArtifactDir: options.releaseArtifactDir || null,
    autoMerge: options.autoMerge === true,
    hasGithubToken: Boolean(options.githubToken),
    requireHealthCommit: options.requireHealthCommit === true,
    useExistingReleaseArtifacts: options.useExistingReleaseArtifacts === true,
  };
}

function buildPreflightReport(evaluation = {}, options = {}) {
  const failures = Array.isArray(evaluation.failures) ? evaluation.failures : [];
  return {
    schemaVersion: PREFLIGHT_REPORT_SCHEMA_VERSION,
    ok: failures.length === 0,
    releaseEnv: options.releaseEnv || null,
    failureCount: failures.length,
    failures,
    inputs: redactedPreflightInputs(options),
  };
}

function writeJsonReport(reportPath, report, cwd = process.cwd()) {
  if (!reportPath) return null;
  const resolved = path.resolve(cwd, reportPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
  return resolved;
}

async function main(argv = process.argv, env = process.env) {
  if (shouldPrintHelp(argv)) {
    printUsage();
    return { ok: true, help: true };
  }

  const options = await resolvePreflightOptions(buildPreflightOptions(argv, env), env);
  const evaluation = evaluatePreflight(options);
  const report = buildPreflightReport(evaluation, options);
  const reportPath = readArg('--report', readArg('--report-path', '', argv), argv);
  writeJsonReport(reportPath, report);
  if (hasFlag('--json', argv)) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  if (evaluation.ok) {
    if (!hasFlag('--json', argv)) {
      process.stdout.write(`PASS  real-autonomous-delivery-preflight: ${options.releaseEnv || 'release-env'} hosted phase6 inputs ready\n`);
    }
    return { ok: true, result: evaluation.result, options, report };
  }

  if (!hasFlag('--json', argv)) {
    for (const failure of evaluation.failures) {
      process.stderr.write(`FAIL  real-autonomous-delivery-preflight: ${failure}\n`);
    }
    process.stderr.write(`real autonomous delivery preflight failed: ${evaluation.failures.length} findings\n`);
  }
  process.exitCode = 1;
  return { ok: false, failures: evaluation.failures, options, report };
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  PREFLIGHT_REPORT_SCHEMA_VERSION,
  applyDiscoveredPullRequestTarget,
  buildPreflightReport,
  buildPreflightOptions,
  evaluatePreflight,
  explicitReleaseEnvFailures,
  failureLines,
  hasFlag,
  main,
  printUsage,
  readArg,
  redactedPreflightInputs,
  resolvePreflightOptions,
  shouldDiscoverPullRequestTarget,
  shouldPrintHelp,
  standaloneCandidateProofFailures,
  usageText,
  writeJsonReport,
};
