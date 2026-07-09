const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildFactoryCandidateManifest,
  requiresFactoryCandidateProof,
  verifyFactoryRealDeliveryCandidate,
} = require('../../lib/task-platform/factory-real-delivery-candidate');
const { createGithubEvidenceFetchMock } = require('../helpers/github-evidence-mock');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');

const CHANGED_FILES = [
  'lib/task-platform/factory-delivery.js',
  'tests/unit/factory-delivery.test.js',
];
const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const DEPLOYMENT_URL = 'https://factory-staging.engineering-team.io';
const ITEM_DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';
const ROLLBACK_EVIDENCE = {
  environment: 'staging',
  commit_sha: COMMIT_SHA,
  rollback_target: 'release-previous',
  verification_status: 'verified',
  verified_at: '2026-07-05T00:00:00.000Z',
};
const PRODUCTION_SAFETY_EVIDENCE = productionSafetyEvidence({ deploymentUrl: DEPLOYMENT_URL, commitSha: COMMIT_SHA });
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
const ITEM_ROLLBACK_EVIDENCE = {
  environment: 'staging',
  commit_sha: COMMIT_SHA,
  rollback_target: 'item-release-previous',
  verification_status: 'verified',
  verified_at: '2026-07-05T00:00:00.000Z',
};

function baseConfig(tmp) {
  return {
    repoRoot: process.cwd(),
    requireRealEvidence: true,
    releaseEnv: 'staging',
    branchName: 'factory/real-candidate-proof',
    implementationCommitSha: COMMIT_SHA,
    prUrl: PR_URL,
    prNumber: 417,
    checks: GITHUB_CHECKS,
    requiredChecks: REQUIRED_CHECKS,
    branchProtection: BRANCH_PROTECTION,
    mergeReadiness: MERGE_READINESS,
    githubEvidenceSource: GITHUB_EVIDENCE_SOURCE,
    deploymentUrl: DEPLOYMENT_URL,
    realDeliveryHealthCheckPath: '/version',
    requireHealthCommit: true,
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    realDeliveryRollbackEvidence: ROLLBACK_EVIDENCE,
    realDeliveryRiskLevel: 'low',
    realDeliveryProductionSafe: true,
    realDeliveryProductionSafetyEvidence: PRODUCTION_SAFETY_EVIDENCE,
    realDeliveryTestCommands: ['node -e "process.exit(0)"'],
    realDeliveryCandidateProofPath: path.join(tmp, 'candidate-proof.json'),
    realDeliveryCandidateGitState: {
      branch: 'factory/real-candidate-proof',
      commitSha: COMMIT_SHA,
      changedFiles: CHANGED_FILES,
      workingTreeClean: true,
      dirtyFileCount: 0,
      dirtyFiles: [],
    },
    allowMockGitHubEvidence: true,
    allowTestGitHubEvidenceInjection: true,
    env: { NODE_ENV: 'test' },
    realDeliveryGithubFetchImpl: createGithubEvidenceFetchMock({
      prNumber: 417,
      prUrl: PR_URL,
      branchName: 'factory/real-candidate-proof',
      commitSha: COMMIT_SHA,
      changedFiles: CHANGED_FILES,
      requiredChecks: REQUIRED_CHECKS,
      checks: GITHUB_CHECKS,
    }),
    realDeliveryFetchImpl: async () => ({ ok: true, status: 200, text: async () => COMMIT_SHA }),
    realDeliverySourceIntegrity: () => ({ checkedFiles: 2, nodeCheckedFiles: 1, failures: [] }),
  };
}

function itemLevelCandidateConfig(tmp) {
  return {
    ...baseConfig(tmp),
    requireRealEvidence: false,
    ciRepository: null,
    branchName: null,
    implementationCommitSha: null,
    commitSha: null,
    prUrl: null,
    prNumber: null,
    releaseEnv: null,
    deploymentUrl: null,
    rollbackTarget: null,
    rollbackVerified: false,
    realDeliveryRiskLevel: null,
    realDeliveryProductionSafe: false,
    realDeliveryTestCommands: [],
    realDeliveryCandidateGitState: {
      branch: 'factory/item-candidate-proof',
      commitSha: COMMIT_SHA,
      changedFiles: CHANGED_FILES,
      workingTreeClean: true,
      dirtyFileCount: 0,
      dirtyFiles: [],
    },
    realDeliveryGithubFetchImpl: createGithubEvidenceFetchMock({
      prNumber: 417,
      prUrl: PR_URL,
      branchName: 'factory/item-candidate-proof',
      commitSha: COMMIT_SHA,
      changedFiles: CHANGED_FILES,
      requiredChecks: REQUIRED_CHECKS,
      checks: GITHUB_CHECKS,
    }),
  };
}

function itemLevelCandidate() {
  return {
    id: 'factory-candidate-item-proof',
    changedFiles: CHANGED_FILES,
    metadata: {
      realDelivery: {
        releaseEnv: 'staging',
        deploymentUrl: ITEM_DEPLOYMENT_URL,
        healthCheckPath: '/version',
        requireHealthCommit: true,
        ciRepository: 'wiinc1/engineering-team',
        branchName: 'factory/item-candidate-proof',
        implementationCommitSha: COMMIT_SHA,
        prUrl: PR_URL,
        prNumber: 417,
        checks: GITHUB_CHECKS,
        requiredChecks: REQUIRED_CHECKS,
        branchProtection: BRANCH_PROTECTION,
        mergeReadiness: MERGE_READINESS,
        githubEvidenceSource: GITHUB_EVIDENCE_SOURCE,
        rollbackPlan: 'Revert the candidate PR and rerun phase 6.',
        rollbackVerified: true,
        rollbackEvidence: ITEM_ROLLBACK_EVIDENCE,
        riskLevel: 'low',
        productionSafe: true,
        productionSafetyEvidence: ITEM_PRODUCTION_SAFETY_EVIDENCE,
        testCommands: ['node -e "process.exit(0)"'],
      },
    },
  };
}

function assertItemLevelCandidateProof(proof) {
  assert.equal(proof.branch, 'factory/item-candidate-proof');
  assert.equal(proof.commitSha, COMMIT_SHA);
  assert.equal(proof.repository, 'wiinc1/engineering-team');
  assert.equal(proof.prUrl, PR_URL);
  assert.equal(proof.prNumber, 417);
  assert.deepEqual(proof.requiredChecks, REQUIRED_CHECKS);
  assert.equal(proof.branchProtection.source, 'github_branch_protection');
  assert.equal(proof.mergeReadiness.name, 'Merge readiness');
  assert.equal(proof.githubEvidenceSource.provider, 'github');
  assert.equal(proof.rollbackVerified, true);
  assert.equal(proof.rollbackEvidence.rollback_target, 'item-release-previous');
  assert.equal(proof.deploymentUrl, ITEM_DEPLOYMENT_URL);
  assert.equal(proof.requireHealthCommit, true);
  assert.equal(proof.productionSafetyEvidence.validation_status, 'passed');
  assert.equal(proof.riskLevel, 'low');
  assert.deepEqual(proof.testCommands, ['node -e "process.exit(0)"']);
}

test('factory candidate proof is required for real-evidence execution or item metadata', () => {
  assert.equal(requiresFactoryCandidateProof({}), false);
  assert.equal(requiresFactoryCandidateProof({ requireRealEvidence: true }), true);
  assert.equal(requiresFactoryCandidateProof({ collectRealEvidence: true }), true);
  assert.equal(requiresFactoryCandidateProof({ agentDrivenPhases: true }), true);
  assert.equal(requiresFactoryCandidateProof({}, { metadata: { realDelivery: {} } }), false);
  assert.equal(requiresFactoryCandidateProof({}, {
    metadata: { realDelivery: { riskLevel: 'low' } },
  }), true);
  assert.equal(requiresFactoryCandidateProof({}, {
    metadata: { realDelivery: { prUrl: PR_URL } },
  }), true);
});

test('factory candidate manifest carries low-risk code scope, tests, rollback, and deploy proof inputs', () => {
  const manifest = buildFactoryCandidateManifest(baseConfig(os.tmpdir()), {
    id: 'factory-candidate',
    changedFiles: CHANGED_FILES,
  });

  assert.equal(manifest.schemaVersion, 'real-delivery-candidate.v1');
  assert.equal(manifest.source.commitSha, COMMIT_SHA);
  assert.equal(manifest.source.prUrl, PR_URL);
  assert.equal(manifest.source.prNumber, 417);
  assert.deepEqual(manifest.source.requiredChecks, REQUIRED_CHECKS);
  assert.equal(manifest.source.mergeReadiness.name, 'Merge readiness');
  assert.equal(manifest.source.evidenceSource.provider, 'github');
  assert.equal(manifest.release.environment, 'staging');
  assert.equal(manifest.release.deploymentUrl, DEPLOYMENT_URL);
  assert.equal(manifest.release.requireHealthCommit, true);
  assert.equal(manifest.release.productionSafetyEvidence.validation_status, 'passed');
  assert.equal(manifest.rollback.target, 'release-previous');
  assert.equal(manifest.rollback.verified, true);
  assert.equal(manifest.rollback.evidence.rollback_target, 'release-previous');
  assert.equal(manifest.risk.level, 'low');
  assert.equal(manifest.risk.productionSafe, true);
  assert.deepEqual(manifest.scope.changedFiles, CHANGED_FILES);
  assert.deepEqual(manifest.tests.commands, ['node -e "process.exit(0)"']);
});

test('factory candidate proof writes durable success evidence before real factory phases', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-candidate-proof-'));
  const result = await verifyFactoryRealDeliveryCandidate(baseConfig(tmp), {
    id: 'factory-candidate',
    changedFiles: CHANGED_FILES,
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  const proof = JSON.parse(fs.readFileSync(result.proofPath, 'utf8'));
  assert.equal(proof.ok, true);
  assert.equal(proof.commitSha, COMMIT_SHA);
  assert.equal(proof.repository, 'wiinc1/engineering-team');
  assert.equal(proof.prUrl, PR_URL);
  assert.equal(proof.githubEvidenceSource.apiBaseUrl, 'https://api.github.com');
  assert.equal(proof.rollbackVerified, true);
  assert.equal(proof.rollbackEvidence.verification_status, 'verified');
  assert.equal(proof.productionSafetyEvidence.production_safe, true);
  assert.equal(proof.deploymentHealth.status, 200);
  assert.equal(proof.testCommandResults[0].ok, true);
});

test('factory candidate proof honors item-level final proof metadata', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-candidate-item-proof-'));
  const result = await verifyFactoryRealDeliveryCandidate(
    itemLevelCandidateConfig(tmp),
    itemLevelCandidate(),
  );

  assert.equal(result.ok, true);
  assertItemLevelCandidateProof(JSON.parse(fs.readFileSync(result.proofPath, 'utf8')));
});

test('factory candidate proof fails closed and still writes rejection evidence', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-candidate-reject-'));
  const config = {
    ...baseConfig(tmp),
    realDeliveryRiskLevel: null,
    realDeliveryProductionSafe: false,
    realDeliveryTestCommands: [],
  };

  await assert.rejects(
    () => verifyFactoryRealDeliveryCandidate(config, {
      id: 'factory-candidate',
      changedFiles: CHANGED_FILES,
    }),
    /Factory real-delivery candidate proof failed/,
  );
  const proof = JSON.parse(fs.readFileSync(config.realDeliveryCandidateProofPath, 'utf8'));
  assert.equal(proof.ok, false);
  assert.match(proof.failures.join('\n'), /risk level must be low/);
  assert.match(proof.failures.join('\n'), /productionSafe true/);
  assert.match(proof.failures.join('\n'), /must list executable test commands/);
});

test('factory candidate proof fails closed without GitHub check evidence', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-candidate-github-reject-'));
  const config = {
    ...baseConfig(tmp),
    realDeliveryGithubFetchImpl: createGithubEvidenceFetchMock({
      prNumber: 417,
      prUrl: PR_URL,
      branchName: 'factory/real-candidate-proof',
      commitSha: COMMIT_SHA,
      changedFiles: CHANGED_FILES,
      requiredChecks: [],
      checks: [],
    }),
  };

  await assert.rejects(
    () => verifyFactoryRealDeliveryCandidate(config, {
      id: 'factory-candidate',
      changedFiles: CHANGED_FILES,
    }),
    /GitHub checks are required/,
  );
  const proof = JSON.parse(fs.readFileSync(config.realDeliveryCandidateProofPath, 'utf8'));
  assert.equal(proof.ok, false);
  assert.match(proof.failures.join('\n'), /GitHub mergeReadiness proof is required/);
  assert.doesNotMatch(proof.failures.join('\n'), /GitHub candidate proof must be collected from GitHub API/);
});

test('factory candidate proof does not fall back to manual GitHub evidence when collection fails', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-candidate-github-collection-'));
  const config = {
    ...baseConfig(tmp),
    realDeliveryGithubFetchImpl: async () => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ message: 'GitHub unavailable' }),
    }),
  };

  await assert.rejects(
    () => verifyFactoryRealDeliveryCandidate(config, {
      id: 'factory-candidate',
      changedFiles: CHANGED_FILES,
      checks: GITHUB_CHECKS,
      requiredChecks: REQUIRED_CHECKS,
      branchProtection: BRANCH_PROTECTION,
      mergeReadiness: MERGE_READINESS,
      githubEvidenceSource: GITHUB_EVIDENCE_SOURCE,
    }),
    /GitHub candidate proof collection failed/,
  );
  const proof = JSON.parse(fs.readFileSync(config.realDeliveryCandidateProofPath, 'utf8'));
  assert.equal(proof.ok, false);
  assert.deepEqual(proof.checks, []);
  assert.deepEqual(proof.requiredChecks, []);
  assert.equal(proof.branchProtection, null);
  assert.match(proof.failures.join('\n'), /GitHub candidate proof collection failed/);
});

test('factory candidate proof fails closed on source-integrity findings', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-candidate-source-'));
  const config = {
    ...baseConfig(tmp),
    realDeliverySourceIntegrity: () => ({
      checkedFiles: 2,
      nodeCheckedFiles: 1,
      failures: [{
        path: 'lib/task-platform/factory-delivery.js',
        line: 1,
        rule: 'source-integrity:patch-marker',
        message: 'patch marker is checked into source',
      }],
    }),
  };

  await assert.rejects(
    () => verifyFactoryRealDeliveryCandidate(config, {
      id: 'factory-candidate',
      changedFiles: CHANGED_FILES,
    }),
    /source integrity gate failed/,
  );
  const proof = JSON.parse(fs.readFileSync(config.realDeliveryCandidateProofPath, 'utf8'));
  assert.equal(proof.ok, false);
  assert.equal(proof.sourceIntegrity.failureCount, 1);
  assert.match(proof.failures.join('\n'), /source integrity gate failed/);
});
