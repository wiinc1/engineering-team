const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRealDeliveryCandidateProof,
  verifyRealDeliveryCandidateReleaseProof,
} = require('../../lib/task-platform/real-delivery-candidate-proof');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const DEPLOYMENT_URL = 'https://factory-staging.engineering-team.io';
const CHANGED_FILES = [
  'lib/task-platform/release-artifact-evidence.js',
  'tests/unit/release-artifact-evidence-cli.test.js',
];
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

function candidateOptions(fetchImpl) {
  return {
    branch: 'feat/low-risk-release-proof',
    releaseEnv: 'staging',
    commitSha: COMMIT_SHA,
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/417',
    prNumber: 417,
    checks: GITHUB_CHECKS,
    requiredChecks: REQUIRED_CHECKS,
    branchProtection: BRANCH_PROTECTION,
    mergeReadiness: MERGE_READINESS,
    githubEvidenceSource: GITHUB_EVIDENCE_SOURCE,
    deploymentUrl: DEPLOYMENT_URL,
    healthCheckPath: '/version',
    requireHealthCommit: true,
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    rollbackEvidence: {
      environment: 'staging',
      commit_sha: COMMIT_SHA,
      rollback_target: 'release-previous',
      verification_status: 'verified',
      verified_at: '2026-07-05T00:00:00.000Z',
    },
    productionSafetyEvidence: productionSafetyEvidence({ deploymentUrl: DEPLOYMENT_URL, commitSha: COMMIT_SHA }),
    changedFiles: CHANGED_FILES,
    testCommands: ['node --test tests/unit/release-artifact-evidence-cli.test.js'],
    runTestCommands: true,
    riskLevel: 'low',
    productionSafe: true,
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    sourceIntegrity: () => ({ checkedFiles: 1, nodeCheckedFiles: 1, failures: [] }),
    gitState: {
      branch: 'feat/low-risk-release-proof',
      commitSha: COMMIT_SHA,
      changedFiles: CHANGED_FILES,
      workingTreeClean: true,
      dirtyFileCount: 0,
      dirtyFiles: [],
    },
    fetchImpl,
  };
}

test('candidate proof can require deployed commit SHA in health response', async () => {
  const result = await verifyRealDeliveryCandidateReleaseProof(candidateOptions(async (url) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ url, commitSha: COMMIT_SHA }),
  })));

  assert.equal(result.ok, true, result.failures.join('\n'));
  assert.equal(result.deploymentHealth.url, `${DEPLOYMENT_URL}/version`);
  assert.equal(result.deploymentHealth.commitVerified, true);
  const proof = buildRealDeliveryCandidateProof(result);
  assert.equal(proof.ok, true);
  assert.equal(proof.requireHealthCommit, true);
});

test('candidate proof rejects health responses without deployed commit SHA', async () => {
  const result = await verifyRealDeliveryCandidateReleaseProof(candidateOptions(async () => ({
    ok: true,
    status: 200,
    text: async () => '{"ok":true}',
  })));

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /deployment health check failed/);
  const proof = buildRealDeliveryCandidateProof(result);
  assert.equal(proof.ok, false);
  assert.match(proof.failures.join('\n'), /deployment health check must prove the candidate commit SHA/);
});

test('candidate proof requires health commit mode for hosted final proof', async () => {
  const result = await verifyRealDeliveryCandidateReleaseProof({
    ...candidateOptions(async () => ({ ok: true, status: 200, text: async () => COMMIT_SHA })),
    requireHealthCommit: false,
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /health commit verification is required/);
});
