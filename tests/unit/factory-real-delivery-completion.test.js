const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { advanceFactoryItem } = require('../../lib/task-platform/factory-delivery');
const {
  createGithubEvidenceFetchMock,
  jsonResponse,
} = require('../helpers/github-evidence-mock');
const {
  buildFactoryRealDeliveryCompletionEvidence,
  completeFactoryRealDeliveryProof,
  factoryCompletionCandidateProofPath,
  factoryCompletionFinalEvidencePath,
  factoryCompletionReleaseEnv,
  factoryCompletionSourceEvidencePath,
  requiresFactoryFinalProof,
  verifyFactoryRealDeliveryCompletion,
} = require('../../lib/task-platform/factory-real-delivery-completion');
const { savePilotEvidence } = require('../../lib/task-platform/golden-path-shared');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const MERGE_COMMIT_SHA = '5a7e3c9d1b2f4a6c8e0d3b5f7a9c1e2d4f678901';
const PR_NUMBER = 417;
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';
const BRANCH_NAME = 'feat/factory-real-delivery-proof';
const CHANGED_FILES = [
  'lib/task-platform/factory-real-delivery-completion.js',
  'tests/unit/factory-real-delivery-completion.test.js',
];
const REQUIRED_CHECKS = ['build', 'unit tests', 'Merge readiness', 'Secret scan', 'Dependency vulnerability scan'];
const GITHUB_CHECKS = REQUIRED_CHECKS.map((name) => ({
  name,
  status: 'completed',
  conclusion: 'success',
  source: 'github_check_run',
}));

function phase6Evidence(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  savePilotEvidence({
    schemaVersion: '1.0',
    status: 'phase6_complete',
    engineeringTeam: { taskId: 'TSK-FINAL', projectId: 'PRJ-FINAL' },
  }, filePath);
}

function phase6Item(evidencePath) {
  return {
    id: 'factory-final',
    title: 'Final proof',
    requirements: 'Verify strict final delivery evidence before completion.',
    stage: 'phase6_complete',
    taskId: 'TSK-FINAL',
    projectId: 'PRJ-FINAL',
    evidencePath,
  };
}

function rollbackEvidence() {
  return {
    environment: 'staging',
    commit_sha: COMMIT_SHA,
    rollback_target: 'release-previous',
    verification_status: 'verified',
    verified_at: '2026-07-05T00:00:00.000Z',
  };
}

function candidateProof() {
  return {
    schemaVersion: 'real-delivery-candidate-proof.v1',
    ok: true,
    branch: BRANCH_NAME,
    commitSha: COMMIT_SHA,
    prUrl: PR_URL,
    prNumber: PR_NUMBER,
    checks: GITHUB_CHECKS,
    requiredChecks: REQUIRED_CHECKS,
    branchProtection: { branch: 'main', requiredChecks: REQUIRED_CHECKS, source: 'github_branch_protection' },
    mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
    githubEvidenceSource: { provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-05T00:00:00.000Z' },
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    deploymentHealth: { ok: true, url: DEPLOYMENT_URL, status: 200, commitVerified: true },
    requireHealthCommit: true,
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    rollbackEvidence: rollbackEvidence(),
    riskLevel: 'low',
    productionSafe: true,
    productionSafetyEvidence: productionSafetyEvidence({ deploymentUrl: DEPLOYMENT_URL, commitSha: COMMIT_SHA }),
    changedFiles: CHANGED_FILES,
    implementationFiles: ['lib/task-platform/factory-real-delivery-completion.js'],
    testFiles: ['tests/unit/factory-real-delivery-completion.test.js'],
    testCommands: ['node --test tests/unit/factory-real-delivery-completion.test.js'],
    testCommandResults: [{
      command: 'node --test tests/unit/factory-real-delivery-completion.test.js',
      ok: true,
      exitCode: 0,
    }],
    localGit: { branch: BRANCH_NAME, commitSha: COMMIT_SHA, workingTreeClean: true, dirtyFileCount: 0, dirtyFiles: [] },
    sourceIntegrity: { checkedFiles: 2, nodeCheckedFiles: 2, failureCount: 0, failures: [] },
    failures: [],
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

function writeRealPhase6Evidence(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  savePilotEvidence({
    schemaVersion: '1.0',
    status: 'phase6_complete',
    engineeringTeam: { taskId: 'TSK-FINAL', projectId: 'PRJ-FINAL', templateTier: 'Standard' },
    change: { kind: 'bugfix' },
    phase6: {
      api: {
        autoMerge: {
          ok: true,
          skipped: false,
          simulated: false,
          reason: 'merged',
          merged: true,
          mergeCommitSha: MERGE_COMMIT_SHA,
          mergedAt: '2026-07-05T00:30:00.000Z',
          prUrl: PR_URL,
          prNumber: PR_NUMBER,
        },
      },
    },
  }, filePath);
}

function writeExistingReleaseArtifacts(outDir) {
  for (const [artifactName, fileName] of [
    ['build', 'build.json'],
    ['compatibility-report', 'compatibility-report.json'],
    ['vulnerability-scan', 'vulnerability-scan.json'],
    ['secret-scan', 'secret-scan.json'],
  ]) {
    writeJson(path.join(outDir, fileName), {
      schema_version: '1.0',
      generated_by: 'release-artifact-evidence-builder',
      generated_at: '2026-07-05T00:00:00.000Z',
      artifact_name: artifactName,
      commit_sha: MERGE_COMMIT_SHA,
      environment: 'staging',
      source_system: 'command',
      status: 'passed',
    });
  }
}

async function withNodeEnv(value, callback) {
  const previous = process.env.NODE_ENV;
  try {
    if (value == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
    return await callback();
  } finally {
    if (previous == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

function completionFetchMock() {
  const githubFetch = createGithubEvidenceFetchMock({
    prNumber: PR_NUMBER,
    branchName: BRANCH_NAME,
    commitSha: COMMIT_SHA,
    merged: true,
    mergeCommitSha: MERGE_COMMIT_SHA,
    mergedAt: '2026-07-05T00:30:00.000Z',
    changedFiles: CHANGED_FILES,
    requiredChecks: REQUIRED_CHECKS,
    checks: GITHUB_CHECKS,
  });
  return async (url, options) => {
    if (String(url).startsWith(DEPLOYMENT_URL)) {
      return jsonResponse({ commit: MERGE_COMMIT_SHA });
    }
    return githubFetch(url, options);
  };
}

test('factory final proof is required for real-evidence completion or item metadata', () => {
  assert.equal(requiresFactoryFinalProof({}), false);
  assert.equal(requiresFactoryFinalProof({ requireRealEvidence: true }), true);
  assert.equal(requiresFactoryFinalProof({ collectRealEvidence: true }), true);
  assert.equal(requiresFactoryFinalProof({ agentDrivenPhases: true }), true);
  assert.equal(requiresFactoryFinalProof({}, { metadata: { realDelivery: {} } }), false);
  assert.equal(requiresFactoryFinalProof({}, {
    metadata: { realDelivery: { candidateProofPath: 'proof.json' } },
  }), true);
});

test('factory completion resolves and requires candidate proof continuity', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-final-candidate-proof-'));
  const evidencePath = path.join(tmp, 'factory-final.json');
  const candidateProofPath = path.join(tmp, 'candidate-proof.json');
  phase6Evidence(evidencePath);
  let captured = null;

  const result = verifyFactoryRealDeliveryCompletion({
    repoRoot: process.cwd(),
    requireRealEvidence: true,
    releaseEnv: 'staging',
    realDeliveryCandidateProofPath: candidateProofPath,
    realAutonomousDeliveryVerifier: (options) => {
      captured = options;
      return { ok: true, releaseEnv: 'staging', failures: [] };
    },
  }, phase6Item(evidencePath));

  assert.equal(result.ok, true);
  assert.equal(captured.candidateProofPath, candidateProofPath);
  assert.equal(captured.requireCandidateProof, true);
  assert.equal(factoryCompletionCandidateProofPath({ deliveryDir: path.join(tmp, 'delivery') }, { id: 'factory-final' }), path.join(tmp, 'delivery', 'factory-final-real-delivery-candidate-proof.json'));
});

test('factory completion honors item-level release metadata over global config', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-final-item-proof-'));
  const evidencePath = path.join(tmp, 'factory-final.json');
  const itemCandidateProofPath = path.join(tmp, 'item-candidate-proof.json');
  const globalCandidateProofPath = path.join(tmp, 'global-candidate-proof.json');
  phase6Evidence(evidencePath);
  let captured = null;
  const item = {
    ...phase6Item(evidencePath),
    metadata: {
      realDelivery: {
        releaseEnv: 'staging',
        candidateProofPath: itemCandidateProofPath,
      },
    },
  };

  const result = verifyFactoryRealDeliveryCompletion({
    repoRoot: process.cwd(),
    requireRealEvidence: false,
    releaseEnv: 'prod',
    realDeliveryCandidateProofPath: globalCandidateProofPath,
    realAutonomousDeliveryVerifier: (options) => {
      captured = options;
      return { ok: true, releaseEnv: options.releaseEnv, failures: [] };
    },
  }, item);

  assert.equal(result.ok, true);
  assert.equal(factoryCompletionReleaseEnv({ releaseEnv: 'prod' }, item), 'staging');
  assert.equal(factoryCompletionCandidateProofPath({
    realDeliveryCandidateProofPath: globalCandidateProofPath,
  }, item), itemCandidateProofPath);
  assert.equal(captured.releaseEnv, 'staging');
  assert.equal(captured.candidateProofPath, itemCandidateProofPath);
});

test('factory real-delivery completion builds final evidence before verification', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-final-build-'));
  const evidencePath = path.join(tmp, 'factory-final.json');
  const finalEvidencePath = path.join(tmp, 'final-real-delivery.json');
  const candidateProofPath = path.join(tmp, 'candidate-proof.json');
  phase6Evidence(evidencePath);
  let builderOptions = null;
  let verifierOptions = null;

  const result = await completeFactoryRealDeliveryProof({
    repoRoot: tmp,
    requireRealEvidence: true,
    releaseEnv: 'staging',
    deploymentUrl: 'https://factory-staging.openclaw.app',
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    realDeliveryCandidateProofPath: candidateProofPath,
    realAutonomousDeliveryEvidencePath: finalEvidencePath,
    realAutonomousDeliveryBuilder: async (options) => {
      builderOptions = options;
      return {
        evidence: { status: 'phase6_complete' },
        verification: { ok: true, candidateProofPath },
      };
    },
    realAutonomousDeliveryVerifier: (options) => {
      verifierOptions = options;
      return { ok: true, releaseEnv: options.releaseEnv, failures: [] };
    },
  }, phase6Item(evidencePath));

  assert.equal(result.ok, true);
  assert.equal(result.evidencePath, finalEvidencePath);
  assert.equal(builderOptions.candidateProofPath, candidateProofPath);
  assert.equal(builderOptions.deploymentUrl, 'https://factory-staging.openclaw.app');
  assert.equal(builderOptions.sourceEvidencePath, evidencePath);
  assert.equal(verifierOptions.evidencePath, finalEvidencePath);
  assert.equal(fs.existsSync(finalEvidencePath), true);
  assert.equal(factoryCompletionFinalEvidencePath({ realAutonomousDeliveryEvidencePath: finalEvidencePath }, phase6Item(evidencePath)), finalEvidencePath);
  assert.equal(factoryCompletionSourceEvidencePath({}, phase6Item(evidencePath)), evidencePath);
});

test('factory final proof rejects injected hooks outside test mode', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-final-injection-'));
  const evidencePath = path.join(tmp, 'factory-final.json');
  const item = phase6Item(evidencePath);
  phase6Evidence(evidencePath);

  await withNodeEnv(null, async () => {
    await assert.rejects(
      () => buildFactoryRealDeliveryCompletionEvidence({
        repoRoot: tmp,
        requireRealEvidence: true,
        realAutonomousDeliveryBuilder: async () => ({ evidence: { status: 'phase6_complete' } }),
      }, item),
      /realAutonomousDeliveryBuilder custom factory final proof hooks are only allowed in test mode/,
    );
    await assert.rejects(
      () => buildFactoryRealDeliveryCompletionEvidence({
        repoRoot: tmp,
        requireRealEvidence: true,
        realAutonomousDeliveryEvidenceWriter: () => {},
      }, item),
      /realAutonomousDeliveryEvidenceWriter custom factory final proof hooks are only allowed in test mode/,
    );
    assert.throws(
      () => verifyFactoryRealDeliveryCompletion({
        repoRoot: tmp,
        requireRealEvidence: true,
        realAutonomousDeliveryVerifier: () => ({ ok: true, failures: [] }),
      }, item),
      /realAutonomousDeliveryVerifier custom factory final proof hooks are only allowed in test mode/,
    );
    await assert.rejects(
      () => buildFactoryRealDeliveryCompletionEvidence({
        repoRoot: tmp,
        requireRealEvidence: true,
        env: { NODE_ENV: 'test' },
        realAutonomousDeliveryBuilder: async () => ({ evidence: { status: 'phase6_complete' } }),
      }, item),
      /realAutonomousDeliveryBuilder custom factory final proof hooks are only allowed in test mode/,
    );
  });
});

test('factory completion can build and verify final evidence through the real builder', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-final-real-builder-'));
  const sourceEvidencePath = path.join(tmp, 'source-phase6.json');
  const candidateProofPath = path.join(tmp, 'candidate-proof.json');
  const finalEvidencePath = path.join(tmp, 'final-real-delivery.json');
  writeRealPhase6Evidence(sourceEvidencePath);
  writeJson(candidateProofPath, candidateProof());
  writeExistingReleaseArtifacts(path.join(tmp, 'release-artifacts'));

  const result = await completeFactoryRealDeliveryProof({
    repoRoot: tmp,
    requireRealEvidence: true,
    releaseEnv: 'staging',
    changeKind: 'bugfix',
    templateTier: 'Standard',
    operatorUrl: DEPLOYMENT_URL,
    deploymentUrl: DEPLOYMENT_URL,
    ciRepository: 'wiinc1/engineering-team',
    branchName: BRANCH_NAME,
    implementationCommitSha: COMMIT_SHA,
    prUrl: PR_URL,
    prNumber: PR_NUMBER,
    githubToken: 'test-token',
    rollbackTarget: 'release-previous',
    rollbackEvidence: rollbackEvidence(),
    rollbackVerified: true,
    realDeliveryCandidateProofPath: candidateProofPath,
    realAutonomousDeliveryEvidencePath: finalEvidencePath,
    releaseArtifactDir: 'release-artifacts',
    useExistingReleaseArtifacts: true,
    healthCheckPath: '/version',
    requireHealthCommit: true,
    allowMockGitHubEvidence: true,
    allowTestGitHubEvidenceInjection: true,
    env: { NODE_ENV: 'test' },
    fetchImpl: completionFetchMock(),
    releaseEvidenceBuilder: () => ({ ok: true, stdout: 'PASS release evidence' }),
  }, phase6Item(sourceEvidencePath));

  const finalEvidence = JSON.parse(fs.readFileSync(finalEvidencePath, 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(result.result.ok, true);
  assert.equal(finalEvidence.github.prNumber, PR_NUMBER);
  assert.equal(finalEvidence.github.mergeCommitSha, MERGE_COMMIT_SHA);
  assert.equal(finalEvidence.releaseEvidence.validation.ok, true);
  assert.equal(finalEvidence.phase6.api.autoMerge.simulated, false);
});

test('factory completion verifier fails closed on incomplete phase6 evidence', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-final-proof-'));
  const evidencePath = path.join(tmp, 'factory-final.json');
  phase6Evidence(evidencePath);

  assert.throws(
    () => verifyFactoryRealDeliveryCompletion({
      repoRoot: process.cwd(),
      requireRealEvidence: true,
      releaseEnv: 'staging',
    }, phase6Item(evidencePath)),
    /Factory real-delivery completion proof failed/,
  );
});

test('advanceFactoryItem blocks item-level real-delivery completion proof failures', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-final-block-'));
  const evidencePath = path.join(tmp, 'factory-final.json');
  phase6Evidence(evidencePath);

  const item = {
    ...phase6Item(evidencePath),
    metadata: { realDelivery: { candidateProofPath: path.join(tmp, 'candidate-proof.json') } },
  };
  const outcome = await advanceFactoryItem(item, {
    jwtSecret: 'factory-test-secret',
    requireRealEvidence: false,
    releaseEnv: 'staging',
    realAutonomousDeliveryBuilder: async () => ({
      evidence: { status: 'phase6_complete' },
      verification: { ok: true },
    }),
    realAutonomousDeliveryVerifier: () => ({ ok: false, failures: ['final proof mismatch'] }),
  });

  assert.equal(outcome.action, 'error');
  assert.equal(outcome.item.stage, 'failed');
  assert.match(outcome.item.lastError, /Factory real-delivery completion proof failed/);
});

test('advanceFactoryItem completes phase6 work after final real-delivery proof passes', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-final-pass-'));
  const evidencePath = path.join(tmp, 'factory-final.json');
  phase6Evidence(evidencePath);

  const outcome = await advanceFactoryItem(phase6Item(evidencePath), {
    jwtSecret: 'factory-test-secret',
    requireRealEvidence: true,
    releaseEnv: 'staging',
    realAutonomousDeliveryBuilder: async () => ({
      evidence: { status: 'phase6_complete' },
      verification: { ok: true, candidateProofPath: path.join(tmp, 'candidate-proof.json') },
    }),
    realAutonomousDeliveryVerifier: () => ({ ok: true, releaseEnv: 'staging', failures: [] }),
  });

  assert.equal(outcome.action, 'complete');
  assert.equal(outcome.item.stage, 'completed');
  assert.ok(outcome.item.completedAt);
  assert.equal(outcome.item.lastAction, 'complete');
  assert.match(outcome.item.metadata.realDelivery.finalEvidencePath, /real-autonomous-delivery-evidence\.json$/);
});
