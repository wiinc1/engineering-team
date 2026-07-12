const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { advanceFactoryItem } = require('../../lib/task-platform/factory-delivery');
const { savePilotEvidence } = require('../../lib/task-platform/golden-path-shared');
const { createGithubEvidenceFetchMock } = require('../helpers/github-evidence-mock');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const ITEM_DEPLOYMENT_URL = 'https://factory-item-staging.openclaw.app';
const ITEM_ROLLBACK_EVIDENCE = {
  environment: 'staging',
  commit_sha: COMMIT_SHA,
  rollback_target: 'item-release-previous',
  verification_status: 'verified',
  verified_at: '2026-07-05T00:00:00.000Z',
};
const ITEM_PRODUCTION_SAFETY_EVIDENCE = productionSafetyEvidence({ deploymentUrl: ITEM_DEPLOYMENT_URL, commitSha: COMMIT_SHA });
const GITHUB_EVIDENCE_SOURCE = { provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-05T00:00:00.000Z' };
const GITHUB_CHECKS = [
  { name: 'Unit tests', conclusion: 'success', source: 'github_check_run' },
  { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
];
const REQUIRED_CHECKS = ['Unit tests', 'Merge readiness'];
const BRANCH_PROTECTION = {
  branch: 'main',
  requiredChecks: REQUIRED_CHECKS,
  source: 'github_branch_protection',
};
const MERGE_READINESS = { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' };
const PR_EVIDENCE = {
  ciRepository: 'wiinc1/engineering-team',
  branchName: 'factory/item-real-delivery',
  implementationCommitSha: COMMIT_SHA,
  prUrl: 'https://github.com/wiinc1/engineering-team/pull/418',
  prNumber: 418,
  checks: GITHUB_CHECKS,
  requiredChecks: REQUIRED_CHECKS,
  branchProtection: BRANCH_PROTECTION,
  mergeReadiness: MERGE_READINESS,
  githubEvidenceSource: GITHUB_EVIDENCE_SOURCE,
};

function writePhase1Evidence(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  savePilotEvidence({
    schemaVersion: '1.0',
    status: 'phase1_complete',
    engineeringTeam: { taskId: 'TSK-ITEMPROOF', projectId: 'PRJ-ITEMPROOF' },
  }, filePath);
}

function itemWithRealDelivery(evidencePath, changedFiles) {
  return {
    id: 'factory-item-proof',
    title: 'Item proof metadata',
    requirements: 'Use queued item release proof metadata during phase execution.',
    templateTier: 'Standard',
    changeKind: 'bugfix',
    changedFiles,
    stage: 'phase1_complete',
    taskId: 'TSK-ITEMPROOF',
    projectId: 'PRJ-ITEMPROOF',
    evidencePath,
    forgeTaskId: 'TSK-GOLDENITEMPROOF',
    metadata: {
      realDelivery: {
        ciRepository: 'wiinc1/engineering-team',
        branchName: PR_EVIDENCE.branchName,
        implementationCommitSha: COMMIT_SHA,
        prUrl: PR_EVIDENCE.prUrl,
        prNumber: PR_EVIDENCE.prNumber,
        checks: PR_EVIDENCE.checks,
        requiredChecks: PR_EVIDENCE.requiredChecks,
        branchProtection: PR_EVIDENCE.branchProtection,
        mergeReadiness: PR_EVIDENCE.mergeReadiness,
        githubEvidenceSource: PR_EVIDENCE.githubEvidenceSource,
        autoMerge: true,
        releaseEnv: 'staging',
        deploymentUrl: ITEM_DEPLOYMENT_URL,
        rollbackTarget: 'item-release-previous',
        rollbackPlan: 'Revert the item PR and rerun hosted phase 6 validation.',
        rollbackVerified: true,
        rollbackEvidence: ITEM_ROLLBACK_EVIDENCE,
        requireHealthCommit: true,
        releaseArtifactCommands: { build: 'npm run build', compatibility: 'npm run test:unit', vulnerability: 'npm audit --audit-level=high', secret: 'npm run secrets:scan' },
        riskLevel: 'low',
        productionSafe: true,
        productionSafetyEvidence: ITEM_PRODUCTION_SAFETY_EVIDENCE,
        testCommands: ['node -e "process.exit(0)"'],
        healthCheckPath: '/healthz',
      },
    },
  };
}

function realEvidenceConfig(tmp, deliveryDir, candidateProofPath, changedFiles, runPhasesFn) {
  return {
    jwtSecret: 'factory-test-secret',
    baseUrl: 'https://api.factory.openclaw.app',
    operatorUrl: 'https://operator.factory.openclaw.app',
    forgeAdapterUrl: 'https://forgeadapter.factory.openclaw.app',
    deliveryDir,
    collectRealEvidence: false,
    ciRepository: null,
    branchName: null,
    implementationCommitSha: null,
    prUrl: null,
    prNumber: null,
    githubToken: 'gh-token',
    releaseEnv: 'prod',
    deploymentUrl: 'https://global-deploy.openclaw.app',
    rollbackTarget: 'global-release-previous',
    rollbackPlan: 'Global rollback fallback.',
    rollbackVerified: false,
    realDeliveryRiskLevel: 'medium',
    realDeliveryProductionSafe: false,
    realDeliveryTestCommands: ['node -e "fallback"'],
    realDeliveryHealthCheckPath: '/fallback-health',
    realDeliveryCandidateProofPath: candidateProofPath,
    realDeliveryCandidateGitState: { branch: PR_EVIDENCE.branchName, commitSha: COMMIT_SHA, changedFiles, workingTreeClean: true, dirtyFileCount: 0, dirtyFiles: [] },
    allowMockGitHubEvidence: true,
    allowTestGitHubEvidenceInjection: true,
    env: { NODE_ENV: 'test' },
    realDeliveryGithubFetchImpl: createGithubEvidenceFetchMock({
      prNumber: PR_EVIDENCE.prNumber,
      prUrl: PR_EVIDENCE.prUrl,
      branchName: PR_EVIDENCE.branchName,
      commitSha: COMMIT_SHA,
      changedFiles,
      requiredChecks: REQUIRED_CHECKS,
      checks: GITHUB_CHECKS,
    }),
    realDeliveryFetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ commitSha: COMMIT_SHA }) }),
    realDeliverySourceIntegrity: () => ({ checkedFiles: 2, nodeCheckedFiles: 1, failures: [] }),
    runPhasesFn,
    skipForgeSeed: true,
      allowForgeSkip: true, // unit seed stub; Standard production remains forge-required
  };
}

function assertCapturedRealDeliveryOptions(options) {
  assert.equal(options.collectRealEvidence, true);
  assert.equal(options.requireRealEvidence, true);
  assert.equal(options.ciRepository, 'wiinc1/engineering-team');
  assert.equal(options.branchName, PR_EVIDENCE.branchName);
  assert.equal(options.implementationCommitSha, COMMIT_SHA);
  assert.equal(options.prUrl, PR_EVIDENCE.prUrl);
  assert.equal(options.prNumber, PR_EVIDENCE.prNumber);
  assert.deepEqual(options.requiredChecks, REQUIRED_CHECKS);
  assert.equal(options.branchProtection.source, 'github_branch_protection');
  assert.equal(options.mergeReadiness.name, 'Merge readiness');
  assert.equal(options.autoMerge, true);
  assert.equal(options.githubToken, 'gh-token');
  assert.equal(options.releaseEnv, 'staging');
  assert.equal(options.deploymentUrl, ITEM_DEPLOYMENT_URL);
  assert.equal(options.productionSafetyEvidence.validation_status, 'passed');
  assert.equal(options.rollbackTarget, 'item-release-previous');
  assert.equal(options.rollbackVerified, true);
  assert.equal(options.rollbackEvidence.rollback_target, 'item-release-previous');
  assert.equal(options.rollbackEvidence.commit_sha, COMMIT_SHA);
  assert.equal(options.riskLevel, 'low');
  assert.equal(options.realDeliveryRiskLevel, 'low');
  assert.equal(options.productionSafe, true);
  assert.equal(options.realDeliveryProductionSafe, true);
  assert.deepEqual(options.candidateTestCommands, ['node -e "process.exit(0)"']);
  assert.deepEqual(options.realDeliveryTestCommands, ['node -e "process.exit(0)"']);
  assert.equal(options.realDeliveryHealthCheckPath, '/healthz');
  assert.equal(options.requireHealthCommit, true);
  assert.equal(options.releaseArtifactCommands.secret, 'npm run secrets:scan');
}

function assertCandidateProof(candidateProofPath) {
  const proof = JSON.parse(fs.readFileSync(candidateProofPath, 'utf8'));
  assert.equal(proof.branch, PR_EVIDENCE.branchName);
  assert.equal(proof.commitSha, COMMIT_SHA);
  assert.equal(proof.prUrl, PR_EVIDENCE.prUrl);
  assert.equal(proof.prNumber, PR_EVIDENCE.prNumber);
  assert.deepEqual(proof.requiredChecks, REQUIRED_CHECKS);
  assert.equal(proof.branchProtection.source, 'github_branch_protection');
  assert.equal(proof.githubEvidenceSource.provider, 'github');
  assert.equal(proof.releaseEnv, 'staging');
  assert.equal(proof.deploymentUrl, ITEM_DEPLOYMENT_URL);
  assert.equal(proof.productionSafetyEvidence.risk_level, 'low');
  assert.equal(proof.rollbackTarget, 'item-release-previous');
  assert.equal(proof.rollbackVerified, true);
  assert.equal(proof.rollbackEvidence.rollback_target, 'item-release-previous');
  assert.equal(proof.rollbackEvidence.commit_sha, COMMIT_SHA);
}

test('factory execution carries item-level real-delivery metadata into phase runner', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-item-real-delivery-'));
  const deliveryDir = path.join(tmp, 'delivery');
  const evidencePath = path.join(deliveryDir, 'factory-item-proof.json');
  const candidateProofPath = path.join(tmp, 'candidate-proof.json');
  const changedFiles = [
    'lib/task-platform/factory-delivery.js',
    'tests/unit/factory-real-delivery-metadata-flow.test.js',
  ];
  writePhase1Evidence(evidencePath);
  let capturedOptions = null;

  const outcome = await advanceFactoryItem(
    itemWithRealDelivery(evidencePath, changedFiles),
    realEvidenceConfig(tmp, deliveryDir, candidateProofPath, changedFiles, async (options) => {
      capturedOptions = options;
      const evidence = { ...options.pilot, status: 'phase6_complete' };
      savePilotEvidence(evidence, options.outputPath);
      return { evidence };
    }),
  );

  assert.equal(outcome.action, 'phases_2_6', outcome.error?.message || outcome.item?.lastError);
  assert.equal(outcome.item.stage, 'phase6_complete');
  assertCapturedRealDeliveryOptions(capturedOptions);
  assertCandidateProof(candidateProofPath);
});
