const fs = require('node:fs');
const { hydratePrDiscoveryReportOptions } = require('./real-delivery-pr-discovery-report');

const REAL_EVIDENCE_FLAG_ARGS = [
  '--collect-real-evidence', '--require-real-evidence', '--rollback-verified',
  '--agent-driven-phases', '--auto-merge', '--use-existing-release-artifacts',
  '--require-health-commit', '--generate-candidate-proof', '--production-safe',
  '--use-pr-discovery-report',
];
const REAL_EVIDENCE_VALUE_ARGS = [
  '--repository',
  '--ci-repository',
  '--branch',
  '--branch-name',
  '--implementation-commit-sha',
  '--commit-sha',
  '--pr-url',
  '--pr-number',
  '--pr-discovery-report',
  '--checks-json',
  '--checks-file',
  '--required-checks-json',
  '--required-checks-file',
  '--branch-protection-json',
  '--branch-protection-file',
  '--merge-readiness-json',
  '--merge-readiness-file',
  '--changed-files-json',
  '--changed-files-file',
  '--github-token',
  '--github-api-base-url',
  '--deployment-url',
  '--production-url',
  '--rollback-target',
  '--rollback-evidence',
  '--candidate-proof',
  '--candidate-test-command',
  '--release-artifact-dir',
  '--release-build-command',
  '--release-compatibility-command',
  '--release-vulnerability-command',
  '--release-secret-command',
  '--release-artifact-timeout-ms',
  '--health-check-path',
  '--release-env',
  '--change-kind',
  '--template-tier',
  '--change-reversibility',
  '--merge-commit-sha',
  '--production-safety-evidence',
  '--risk-level',
  '--max-changed-files',
];

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function readArg(argv, name, fallback = '') {
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
}

function readArgs(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length - 1; index += 1) {
    if (argv[index] === name) values.push(argv[index + 1]);
  }
  return values.filter(Boolean);
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function readJsonArg(argv, name) {
  const raw = readArg(argv, name);
  if (!raw) return undefined;
  const content = raw.startsWith('@')
    ? fs.readFileSync(raw.slice(1), 'utf8')
    : raw;
  return JSON.parse(content);
}

function readJsonFileArg(argv, name) {
  const filePath = readArg(argv, name);
  return filePath ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : undefined;
}

function readJsonEvidenceCliOptions(argv) {
  const checks = readJsonArg(argv, '--checks-json') || readJsonFileArg(argv, '--checks-file');
  const requiredChecks = readJsonArg(argv, '--required-checks-json') || readJsonFileArg(argv, '--required-checks-file');
  const branchProtection = readJsonArg(argv, '--branch-protection-json') || readJsonFileArg(argv, '--branch-protection-file');
  const mergeReadiness = readJsonArg(argv, '--merge-readiness-json') || readJsonFileArg(argv, '--merge-readiness-file');
  const changedFiles = readJsonArg(argv, '--changed-files-json') || readJsonFileArg(argv, '--changed-files-file');
  return {
    checks,
    checksProvided: Boolean(checks),
    requiredChecks,
    requiredChecksProvided: Boolean(requiredChecks),
    branchProtection,
    branchProtectionProvided: Boolean(branchProtection),
    mergeReadiness,
    mergeReadinessProvided: Boolean(mergeReadiness),
    changedFiles,
  };
}

function readReleaseArtifactCliOptions(argv, env) {
  return {
    releaseArtifactDir: readArg(argv, '--release-artifact-dir', env.RELEASE_ARTIFACT_DIR || ''),
    useExistingReleaseArtifacts: hasFlag(argv, '--use-existing-release-artifacts')
      || parseBooleanEnv(env.USE_EXISTING_RELEASE_ARTIFACTS, false),
    releaseArtifactCommands: {
      build: readArg(argv, '--release-build-command', env.RELEASE_BUILD_COMMAND || ''),
      compatibility: readArg(argv, '--release-compatibility-command', env.RELEASE_COMPATIBILITY_COMMAND || ''),
      vulnerability: readArg(argv, '--release-vulnerability-command', env.RELEASE_VULNERABILITY_COMMAND || ''),
      secret: readArg(argv, '--release-secret-command', env.RELEASE_SECRET_COMMAND || ''),
    },
    releaseArtifactCommandTimeoutMs: Number(readArg(argv, '--release-artifact-timeout-ms', env.RELEASE_ARTIFACT_COMMAND_TIMEOUT_MS || '')),
    healthCheckPath: readArg(argv, '--health-check-path', env.RELEASE_HEALTH_CHECK_PATH || env.REAL_DELIVERY_HEALTH_CHECK_PATH || ''),
    requireHealthCommit: hasFlag(argv, '--require-health-commit')
      || parseBooleanEnv(env.REQUIRE_HEALTH_COMMIT, false),
  };
}

function readGitHubIdentityCliOptions(argv, env) {
  return {
    ciRepository: readArg(argv, '--repository') || readArg(argv, '--ci-repository', env.CI_REPOSITORY || env.GITHUB_REPOSITORY || ''),
    branchName: readArg(argv, '--branch') || readArg(argv, '--branch-name', env.BRANCH_NAME || env.GITHUB_HEAD_REF || ''),
    implementationCommitSha: readArg(argv, '--implementation-commit-sha') || readArg(argv, '--commit-sha', env.IMPLEMENTATION_COMMIT_SHA || env.COMMIT_SHA || env.GITHUB_SHA || ''),
    commitSha: readArg(argv, '--commit-sha', env.COMMIT_SHA || env.GITHUB_SHA || ''),
    prUrl: readArg(argv, '--pr-url', env.PR_URL || env.GITHUB_PR_URL || ''),
    prNumber: Number(readArg(argv, '--pr-number', env.PR_NUMBER || env.GITHUB_PR_NUMBER || '')) || undefined,
    usePrDiscoveryReport: hasFlag(argv, '--use-pr-discovery-report')
      || parseBooleanEnv(env.USE_REAL_DELIVERY_PR_DISCOVERY_REPORT, false),
    prDiscoveryReportPath: readArg(argv, '--pr-discovery-report', env.REAL_DELIVERY_PR_DISCOVERY_REPORT || ''),
  };
}

function readHostedReleaseCliOptions(argv, env) {
  return {
    githubToken: readArg(argv, '--github-token', env.GITHUB_TOKEN || env.GH_TOKEN || ''),
    githubApiBaseUrl: readArg(argv, '--github-api-base-url', env.GITHUB_API_BASE_URL || ''),
    deploymentUrl: readArg(argv, '--deployment-url', env.DEPLOYMENT_URL || ''),
    productionUrl: readArg(argv, '--production-url', env.PRODUCTION_URL || ''),
    rollbackTarget: readArg(argv, '--rollback-target', env.ROLLBACK_TARGET || ''),
    rollbackEvidence: readArg(argv, '--rollback-evidence', env.ROLLBACK_EVIDENCE || env.ROLLBACK_EVIDENCE_PATH || ''),
    candidateProofPath: readArg(argv, '--candidate-proof', env.REAL_DELIVERY_CANDIDATE_PROOF_PATH || ''),
    generateCandidateProof: hasFlag(argv, '--generate-candidate-proof')
      || parseBooleanEnv(env.GENERATE_REAL_DELIVERY_CANDIDATE_PROOF, false),
    candidateTestCommands: readArgs(argv, '--candidate-test-command'),
    riskLevel: readArg(argv, '--risk-level', env.REAL_DELIVERY_RISK_LEVEL || ''),
    productionSafe: hasFlag(argv, '--production-safe')
      || parseBooleanEnv(env.REAL_DELIVERY_PRODUCTION_SAFE, false),
    productionSafetyEvidence: readArg(argv, '--production-safety-evidence', env.PRODUCTION_SAFETY_EVIDENCE || env.PRODUCTION_SAFETY_EVIDENCE_PATH || ''),
    rollbackVerified: hasFlag(argv, '--rollback-verified')
      || parseBooleanEnv(env.ROLLBACK_VERIFIED, false),
    requireHealthyDeployment: !hasFlag(argv, '--allow-unhealthy-deployment'),
  };
}

function readReleaseScopeCliOptions(argv, env) {
  return {
    releaseEnv: readArg(argv, '--release-env', env.RELEASE_ENV || ''),
    changeKind: readArg(argv, '--change-kind', env.CHANGE_KIND || ''),
    templateTier: readArg(argv, '--template-tier', env.FACTORY_TEMPLATE_TIER || ''),
    changeReversibility: readArg(argv, '--change-reversibility', env.CHANGE_REVERSIBILITY || ''),
    mergeCommitSha: readArg(argv, '--merge-commit-sha', env.MERGE_COMMIT_SHA || ''),
  };
}

function readGoldenPathRealEvidenceCliOptions(argv = process.argv, env = process.env) {
  const collectRealEvidence = hasFlag(argv, '--collect-real-evidence');
  const requireRealEvidence = hasFlag(argv, '--require-real-evidence') || collectRealEvidence;
  const options = {
    collectRealEvidence,
    requireRealEvidence,
    agentDrivenPhases: hasFlag(argv, '--agent-driven-phases'),
    autoMerge: hasFlag(argv, '--auto-merge') || parseBooleanEnv(env.FF_FACTORY_AUTO_MERGE, false),
    ...readGitHubIdentityCliOptions(argv, env),
    ...readJsonEvidenceCliOptions(argv),
    ...readHostedReleaseCliOptions(argv, env),
    ...readReleaseArtifactCliOptions(argv, env),
    ...readReleaseScopeCliOptions(argv, env),
  };
  return hydratePrDiscoveryReportOptions(options);
}

function collectGoldenPathRealEvidenceCliArgs(argv = process.argv) {
  const args = [];
  for (const flag of REAL_EVIDENCE_FLAG_ARGS) {
    if (hasFlag(argv, flag)) args.push(flag);
  }
  for (const name of REAL_EVIDENCE_VALUE_ARGS) {
    const value = readArg(argv, name);
    if (value) args.push(name, value);
  }
  for (const value of readArgs(argv, '--candidate-test-command').slice(1)) args.push('--candidate-test-command', value);
  return args;
}

module.exports = {
  collectGoldenPathRealEvidenceCliArgs,
  readGoldenPathRealEvidenceCliOptions,
};
