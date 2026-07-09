const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { advanceFactoryItem } = require('../../lib/task-platform/factory-delivery');
const { savePilotEvidence } = require('../../lib/task-platform/golden-path-shared');
const { createGithubEvidenceFetchMock } = require('../helpers/github-evidence-mock');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');

const CHANGED_FILES = [
  'lib/task-platform/factory-delivery.js',
  'tests/unit/factory-real-delivery-execution.test.js',
];
const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const DEPLOYMENT_URL = 'https://factory-staging.engineering-team.io';
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
const ROLLBACK_EVIDENCE = {
  environment: 'staging',
  commit_sha: COMMIT_SHA,
  rollback_target: 'release-previous',
  verification_status: 'verified',
  verified_at: '2026-07-05T00:00:00.000Z',
};
const PRODUCTION_SAFETY_EVIDENCE = productionSafetyEvidence({ deploymentUrl: DEPLOYMENT_URL, commitSha: COMMIT_SHA });

function writePhase1Evidence(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  savePilotEvidence({
    schemaVersion: '1.0',
    status: 'phase1_complete',
    engineeringTeam: { taskId: 'TSK-SOURCE', projectId: 'PRJ-SOURCE' },
  }, filePath);
}

function realDeliveryGithubFetchImpl() {
  return createGithubEvidenceFetchMock({
    prNumber: 417,
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/417',
    branchName: 'factory/source-integrity',
    commitSha: COMMIT_SHA,
    changedFiles: CHANGED_FILES,
    requiredChecks: REQUIRED_CHECKS,
    checks: GITHUB_CHECKS,
  });
}

function realEvidenceConfig(tmp, evidencePath, runPhasesFn) {
  return {
    jwtSecret: 'factory-test-secret',
    baseUrl: 'https://api.factory.openclaw.app',
    operatorUrl: 'https://operator.factory.openclaw.app',
    forgeAdapterUrl: 'https://forgeadapter.factory.openclaw.app',
    deliveryDir: path.join(tmp, 'delivery'),
    collectRealEvidence: true,
    autoMerge: true,
    githubToken: 'test-github-token',
    branchName: 'factory/source-integrity',
    implementationCommitSha: COMMIT_SHA,
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/417',
    prNumber: 417,
    checks: GITHUB_CHECKS,
    requiredChecks: REQUIRED_CHECKS,
    branchProtection: BRANCH_PROTECTION,
    mergeReadiness: MERGE_READINESS,
    githubEvidenceSource: GITHUB_EVIDENCE_SOURCE,
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    rollbackEvidence: ROLLBACK_EVIDENCE,
    realDeliveryRollbackEvidence: ROLLBACK_EVIDENCE,
    healthCheckPath: '/version',
    realDeliveryHealthCheckPath: '/version',
    requireHealthCommit: true,
    releaseArtifactCommands: { build: 'npm run build', compatibility: 'npm run test:unit', vulnerability: 'npm audit --audit-level=high', secret: 'npm run secrets:scan' },
    realDeliveryRiskLevel: 'low',
    realDeliveryProductionSafe: true,
    realDeliveryProductionSafetyEvidence: PRODUCTION_SAFETY_EVIDENCE,
    realDeliveryTestCommands: ['node -e "process.exit(0)"'],
    realDeliveryCandidateProofPath: path.join(tmp, 'candidate-proof.json'),
    realDeliveryCandidateGitState: { branch: 'factory/source-integrity', commitSha: COMMIT_SHA, changedFiles: CHANGED_FILES, workingTreeClean: true, dirtyFileCount: 0, dirtyFiles: [] },
    allowMockGitHubEvidence: true,
    allowTestGitHubEvidenceInjection: true,
    env: { NODE_ENV: 'test' },
    realDeliveryGithubFetchImpl: realDeliveryGithubFetchImpl(),
    realDeliveryFetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ commitSha: COMMIT_SHA }) }),
    realDeliverySourceIntegrity: () => ({
      checkedFiles: 1,
      nodeCheckedFiles: 1,
      failures: [{ path: 'lib/task-platform/factory-delivery.js', line: 1, rule: 'source-integrity:patch-marker' }],
    }),
    runPhasesFn,
    skipForgeSeed: true,
    outputPath: evidencePath,
  };
}

test('factory execution blocks phases when real-delivery source integrity fails', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-source-block-'));
  const evidencePath = path.join(tmp, 'delivery', 'factory-source.json');
  writePhase1Evidence(evidencePath);
  let phaseRunnerCalled = false;

  const outcome = await advanceFactoryItem({
    id: 'factory-source',
    title: 'Source integrity block',
    requirements: 'Do not run phases with corrupted source.',
    templateTier: 'Standard',
    changeKind: 'bugfix',
    changedFiles: CHANGED_FILES,
    stage: 'phase1_complete',
    taskId: 'TSK-SOURCE',
    projectId: 'PRJ-SOURCE',
    evidencePath,
  }, realEvidenceConfig(tmp, evidencePath, async () => {
    phaseRunnerCalled = true;
  }));

  assert.equal(outcome.action, 'error');
  assert.equal(phaseRunnerCalled, false);
  assert.match(outcome.item.lastError, /source integrity gate failed/);
  const proof = JSON.parse(fs.readFileSync(path.join(tmp, 'candidate-proof.json'), 'utf8'));
  assert.equal(proof.sourceIntegrity.failureCount, 1);
});

test('factory execution blocks item-level real-evidence preflight before phases', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-preflight-block-'));
  const evidencePath = path.join(tmp, 'delivery', 'factory-preflight.json');
  writePhase1Evidence(evidencePath);
  let phaseRunnerCalled = false;

  const outcome = await advanceFactoryItem({
    id: 'factory-preflight',
    title: 'Preflight block',
    requirements: 'Do not run phases with invalid real-evidence options.',
    templateTier: 'Standard',
    changeKind: 'bugfix',
    changedFiles: CHANGED_FILES,
    stage: 'phase1_complete',
    taskId: 'TSK-PREFLIGHT',
    projectId: 'PRJ-PREFLIGHT',
    evidencePath,
  }, {
    ...realEvidenceConfig(tmp, evidencePath, async () => {
      phaseRunnerCalled = true;
    }),
    skipValidation: true,
    realDeliverySourceIntegrity: () => ({
      checkedFiles: 1,
      nodeCheckedFiles: 1,
      failures: [],
    }),
  });

  assert.equal(outcome.action, 'error');
  assert.equal(phaseRunnerCalled, false);
  assert.match(outcome.item.lastError, /Factory delivery item preflight failed: deploy validation cannot be skipped/);
});

test('factory execution preflights generated candidate proof prerequisites before collecting proof', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-candidate-preflight-'));
  const evidencePath = path.join(tmp, 'delivery', 'factory-candidate-preflight.json');
  const candidateProofPath = path.join(tmp, 'candidate-proof.json');
  writePhase1Evidence(evidencePath);
  let phaseRunnerCalled = false;

  const outcome = await advanceFactoryItem({
    id: 'factory-candidate-preflight',
    title: 'Candidate proof preflight block',
    requirements: 'Do not collect real delivery proof without executable candidate tests.',
    templateTier: 'Standard',
    changeKind: 'bugfix',
    changedFiles: CHANGED_FILES,
    stage: 'phase1_complete',
    taskId: 'TSK-CANDIDATE-PREFLIGHT',
    projectId: 'PRJ-CANDIDATE-PREFLIGHT',
    evidencePath,
  }, {
    ...realEvidenceConfig(tmp, evidencePath, async () => {
      phaseRunnerCalled = true;
    }),
    realDeliveryCandidateProofPath: candidateProofPath,
    realDeliveryTestCommands: [],
  });

  assert.equal(outcome.action, 'error');
  assert.equal(phaseRunnerCalled, false);
  assert.equal(fs.existsSync(candidateProofPath), false);
  assert.match(
    outcome.item.lastError,
    /Factory delivery item preflight failed: hosted staging candidate proof generation requires --candidate-test-command/,
  );
});
