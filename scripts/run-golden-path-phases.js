#!/usr/bin/env node
const fs = require('node:fs');
const {
  withLocalPhases,
  withLocalPhase6,
  runGoldenPathPhases,
} = require('../lib/task-platform/golden-path-phases');
const {
  DEFAULT_FORGE_SERVICE_TOKEN,
  DEFAULT_FORGE_ADAPTER_TOKEN,
} = require('../lib/task-platform/golden-path-shared');
const {
  assertGoldenPathRealEvidencePreflight,
} = require('../lib/task-platform/golden-path-real-evidence-preflight');
const { hydratePrDiscoveryReportOptions } = require('../lib/task-platform/real-delivery-pr-discovery-report');
const { runSourceIntegrity } = require('./check-source-integrity');
const { resolveCandidateOptions } = require('./verify-real-delivery-candidate');
const {
  verifyRealDeliveryCandidateReleaseProof,
  writeRealDeliveryCandidateProof,
} = require('../lib/task-platform/real-delivery-candidate-proof');

function readArg(name, fallback = '', argv = process.argv) {
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
}

function hasFlag(name, argv = process.argv) {
  return argv.includes(name);
}

function readJsonArg(name, argv = process.argv) {
  const raw = readArg(name, '', argv);
  if (!raw) return undefined;
  const content = raw.startsWith('@')
    ? fs.readFileSync(raw.slice(1), 'utf8')
    : raw;
  return JSON.parse(content);
}

function readJsonFileArg(name, argv = process.argv) {
  const filePath = readArg(name, '', argv);
  return filePath ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : undefined;
}

function readArgs(name, argv = process.argv) {
  const values = [];
  for (let index = 0; index < argv.length - 1; index += 1) {
    if (argv[index] === name) values.push(argv[index + 1]);
  }
  return values.filter(Boolean);
}

function readCandidateProofGenerationOptions(argv = process.argv) {
  return {
    generateCandidateProof: hasFlag('--generate-candidate-proof', argv)
      || ['1', 'true', 'yes', 'on'].includes(String(process.env.GENERATE_REAL_DELIVERY_CANDIDATE_PROOF || '').toLowerCase()),
    candidateTestCommands: readArgs('--candidate-test-command', argv),
    riskLevel: readArg('--risk-level', process.env.REAL_DELIVERY_RISK_LEVEL || '', argv),
    productionSafe: hasFlag('--production-safe', argv)
      || ['1', 'true', 'yes', 'on'].includes(String(process.env.REAL_DELIVERY_PRODUCTION_SAFE || '').toLowerCase()),
    productionSafetyEvidence: readArg('--production-safety-evidence', process.env.PRODUCTION_SAFETY_EVIDENCE || process.env.PRODUCTION_SAFETY_EVIDENCE_PATH || '', argv),
    maxChangedFiles: readArg('--max-changed-files', process.env.MAX_REAL_DELIVERY_CHANGED_FILES || '', argv),
  };
}

function readRealEvidenceOptions(argv = process.argv) {
  const collectRealEvidence = hasFlag('--collect-real-evidence', argv);
  const options = {
    collectRealEvidence,
    requireRealEvidence: hasFlag('--require-real-evidence', argv) || collectRealEvidence,
    autoMerge: hasFlag('--auto-merge', argv)
      || ['1', 'true', 'yes', 'on'].includes(String(process.env.FF_FACTORY_AUTO_MERGE || '').toLowerCase()),
    ciRepository: readArg('--repository', '', argv) || readArg('--ci-repository', process.env.CI_REPOSITORY || process.env.GITHUB_REPOSITORY || '', argv),
    branchName: readArg('--branch', '', argv) || readArg('--branch-name', process.env.BRANCH_NAME || process.env.GITHUB_HEAD_REF || '', argv),
    implementationCommitSha: readArg('--implementation-commit-sha', '', argv) || readArg('--commit-sha', process.env.IMPLEMENTATION_COMMIT_SHA || process.env.COMMIT_SHA || process.env.GITHUB_SHA || '', argv),
    commitSha: readArg('--commit-sha', process.env.COMMIT_SHA || process.env.GITHUB_SHA || '', argv),
    prUrl: readArg('--pr-url', process.env.PR_URL || process.env.GITHUB_PR_URL || '', argv),
    prNumber: Number(readArg('--pr-number', process.env.PR_NUMBER || process.env.GITHUB_PR_NUMBER || '', argv)) || undefined,
    usePrDiscoveryReport: hasFlag('--use-pr-discovery-report', argv)
      || ['1', 'true', 'yes', 'on'].includes(String(process.env.USE_REAL_DELIVERY_PR_DISCOVERY_REPORT || '').toLowerCase()),
    prDiscoveryReportPath: readArg('--pr-discovery-report', process.env.REAL_DELIVERY_PR_DISCOVERY_REPORT || '', argv),
    githubToken: readArg('--github-token', process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '', argv),
    githubApiBaseUrl: readArg('--github-api-base-url', process.env.GITHUB_API_BASE_URL || '', argv),
    deploymentUrl: readArg('--deployment-url', process.env.DEPLOYMENT_URL || '', argv),
    productionUrl: readArg('--production-url', process.env.PRODUCTION_URL || '', argv),
    rollbackTarget: readArg('--rollback-target', process.env.ROLLBACK_TARGET || '', argv),
    rollbackEvidence: readArg('--rollback-evidence', process.env.ROLLBACK_EVIDENCE || process.env.ROLLBACK_EVIDENCE_PATH || '', argv),
    candidateProofPath: readArg('--candidate-proof', process.env.REAL_DELIVERY_CANDIDATE_PROOF_PATH || '', argv),
    ...readCandidateProofGenerationOptions(argv),
    requireReadableCandidateProof: true,
    rollbackVerified: hasFlag('--rollback-verified', argv)
      || ['1', 'true', 'yes', 'on'].includes(String(process.env.ROLLBACK_VERIFIED || '').toLowerCase()),
    requireHealthyDeployment: !hasFlag('--allow-unhealthy-deployment', argv),
    releaseArtifactDir: readArg('--release-artifact-dir', process.env.RELEASE_ARTIFACT_DIR || '', argv),
    useExistingReleaseArtifacts: hasFlag('--use-existing-release-artifacts', argv)
      || ['1', 'true', 'yes', 'on'].includes(String(process.env.USE_EXISTING_RELEASE_ARTIFACTS || '').toLowerCase()),
    releaseArtifactCommands: {
      build: readArg('--release-build-command', process.env.RELEASE_BUILD_COMMAND || '', argv),
      compatibility: readArg('--release-compatibility-command', process.env.RELEASE_COMPATIBILITY_COMMAND || '', argv),
      vulnerability: readArg('--release-vulnerability-command', process.env.RELEASE_VULNERABILITY_COMMAND || '', argv),
      secret: readArg('--release-secret-command', process.env.RELEASE_SECRET_COMMAND || '', argv),
    },
    releaseArtifactCommandTimeoutMs: Number(readArg('--release-artifact-timeout-ms', process.env.RELEASE_ARTIFACT_COMMAND_TIMEOUT_MS || '', argv)),
    healthCheckPath: readArg('--health-check-path', process.env.RELEASE_HEALTH_CHECK_PATH || process.env.REAL_DELIVERY_HEALTH_CHECK_PATH || '', argv),
    requireHealthCommit: hasFlag('--require-health-commit', argv)
      || ['1', 'true', 'yes', 'on'].includes(String(process.env.REQUIRE_HEALTH_COMMIT || '').toLowerCase()),
    releaseEnv: readArg('--release-env', process.env.RELEASE_ENV || '', argv),
    changeKind: readArg('--change-kind', process.env.CHANGE_KIND || '', argv),
    templateTier: readArg('--template-tier', process.env.FACTORY_TEMPLATE_TIER || '', argv),
    changeReversibility: readArg('--change-reversibility', process.env.CHANGE_REVERSIBILITY || '', argv),
    mergeCommitSha: readArg('--merge-commit-sha', process.env.MERGE_COMMIT_SHA || '', argv),
  };
  return hydratePrDiscoveryReportOptions(options);
}

async function runConfiguredGoldenPathPhases(options) {
  if (hasFlag('--local')) {
    if (options.fromPhase === 6 && options.toPhase === 6) {
      return withLocalPhase6(options);
    }
    return withLocalPhases(options);
  }
  return runGoldenPathPhases(options);
}

function candidateProofOptions(options = {}) {
  return {
    root: process.cwd(),
    collectGithubEvidence: true,
    repository: options.ciRepository || options.repository,
    githubToken: options.githubToken,
    githubApiBaseUrl: options.githubApiBaseUrl,
    branch: options.branchName || options.branch,
    implementationCommitSha: options.implementationCommitSha || options.commitSha,
    prUrl: options.prUrl,
    prNumber: options.prNumber,
    releaseEnv: options.releaseEnv,
    deploymentUrl: options.deploymentUrl || options.productionUrl,
    rollbackTarget: options.rollbackTarget,
    rollbackEvidence: options.rollbackEvidence,
    rollbackVerified: options.rollbackVerified,
    healthCheckPath: options.healthCheckPath,
    requireHealthCommit: options.requireHealthCommit,
    productionSafetyEvidence: options.productionSafetyEvidence,
    riskLevel: options.riskLevel,
    productionSafe: options.productionSafe,
    maxChangedFiles: options.maxChangedFiles,
    testCommands: options.candidateTestCommands,
    runTestCommands: true,
    verifyDeploymentHealth: true,
    requireFinalReleaseProof: true,
    sourceIntegrity: (root) => runSourceIntegrity({ root }),
  };
}

async function generateCandidateProofIfRequested(options = {}) {
  if (options.generateCandidateProof !== true) return null;
  const proofPath = options.candidateProofPath || options.realDeliveryCandidateProofPath;
  if (!proofPath) throw new Error('candidate proof generation requires --candidate-proof output path');
  const candidateOptions = await resolveCandidateOptions(candidateProofOptions(options));
  const result = await verifyRealDeliveryCandidateReleaseProof(candidateOptions);
  writeRealDeliveryCandidateProof(process.cwd(), proofPath, result);
  if (!result.ok) throw new Error(`generated real-delivery candidate proof failed: ${result.failures.join('; ')}`);
  return result;
}

function buildGoldenPathPhaseOptions() {
  const realEvidenceOptions = readRealEvidenceOptions();
  return {
    fromPhase: Number(readArg('--from', '2')),
    toPhase: Number(readArg('--to', '5')),
    outputPath: readArg('--out', 'observability/golden-path-pilot.json'),
    persistDir: readArg('--persist-dir'),
    baseUrl: readArg('--base-url'),
    forgeTaskId: readArg('--forge-task-id', 'TSK-GOLDEN001'),
    skipDelegationSmoke: hasFlag('--skip-delegation-smoke'),
    openclawUrl: readArg('--openclaw-url', process.env.OPENCLAW_BASE_URL || ''),
    hermesUrl: readArg('--hermes-url', process.env.HERMES_BASE_URL || ''),
    operatorUrl: readArg('--operator-url'),
    ciRepository: readArg('--repository') || readArg('--ci-repository', process.env.CI_REPOSITORY || process.env.GITHUB_REPOSITORY || ''),
    branchName: readArg('--branch') || readArg('--branch-name'),
    implementationCommitSha: readArg('--implementation-commit-sha') || readArg('--commit-sha'),
    prUrl: readArg('--pr-url'),
    prNumber: Number(readArg('--pr-number')) || undefined,
    checks: readJsonArg('--checks-json') || readJsonFileArg('--checks-file'),
    requiredChecks: readJsonArg('--required-checks-json') || readJsonFileArg('--required-checks-file'),
    branchProtection: readJsonArg('--branch-protection-json') || readJsonFileArg('--branch-protection-file'),
    mergeReadiness: readJsonArg('--merge-readiness-json') || readJsonFileArg('--merge-readiness-file'),
    changedFiles: readJsonArg('--changed-files-json') || readJsonFileArg('--changed-files-file'),
    ...realEvidenceOptions,
    releaseEnv: readArg('--release-env', process.env.RELEASE_ENV || ''),
    changeKind: readArg('--change-kind', process.env.CHANGE_KIND || ''),
    templateTier: readArg('--template-tier', process.env.FACTORY_TEMPLATE_TIER || ''),
    changeReversibility: readArg('--change-reversibility', process.env.CHANGE_REVERSIBILITY || ''),
    agentDrivenPhases: hasFlag('--agent-driven-phases'),
    autoMerge: realEvidenceOptions.autoMerge === true,
    allowSreWaiver: hasFlag('--allow-sre-waiver'),
    skipValidation: hasFlag('--skip-validation'),
    mergeCommitSha: readArg('--merge-commit-sha', process.env.MERGE_COMMIT_SHA || ''),
    productionUrl: readArg('--production-url', process.env.PRODUCTION_URL || ''),
    jwtSecret: readArg('--jwt-secret') || process.env.GOLDEN_PATH_JWT_SECRET || process.env.AUTH_JWT_SECRET,
    forgeServiceToken: readArg('--forge-service-token')
      || process.env.FORGE_SERVICE_TOKEN
      || DEFAULT_FORGE_SERVICE_TOKEN,
    forgeAdapterToken: readArg('--forge-adapter-token')
      || process.env.FORGEADAPTER_SERVICE_TOKEN
      || DEFAULT_FORGE_ADAPTER_TOKEN,
    forgeAdapterBaseUrl: readArg('--forgeadapter-url', process.env.FORGEADAPTER_BASE_URL || ''),
  };
}

async function main() {
  const options = buildGoldenPathPhaseOptions();

  assertGoldenPathRealEvidencePreflight(options, { context: 'Golden-path phase runner' });
  await generateCandidateProofIfRequested(options);
  if (options.generateCandidateProof === true) {
    assertGoldenPathRealEvidencePreflight({ ...options, generateCandidateProof: false }, { context: 'Golden-path phase runner' });
  }
  return runConfiguredGoldenPathPhases(options);
}

if (require.main === module) {
  main()
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: true,
        status: result.evidence.status,
        stepsCompleted: result.evidence.stepsCompleted,
        forgeTaskId: result.evidence.forgeadapter?.taskId,
        startJobId: result.evidence.forgeadapter?.startJobId,
        completeJobId: result.evidence.forgeadapter?.completeJobId,
        evidencePath: result.outputPath,
        phaseResults: result.phaseResults,
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildGoldenPathPhaseOptions,
  candidateProofOptions,
  generateCandidateProofIfRequested,
  hasFlag,
  readArg,
  readArgs,
  readJsonArg,
  readJsonFileArg,
  readRealEvidenceOptions,
};
