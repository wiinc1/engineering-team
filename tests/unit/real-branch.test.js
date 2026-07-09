const test = require('node:test');
const assert = require('node:assert/strict');
const { realBranchEvidenceFailure, isRealCandidateBranch } = require('../../lib/task-platform/real-branch');
const { candidateProofContentPreflightFailures } = require('../../lib/task-platform/real-delivery-candidate-proof-preflight');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const OTHER_COMMIT_SHA = '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210';

function candidateProof(overrides = {}) {
  return {
    schemaVersion: 'real-delivery-candidate-proof.v1',
    ok: true,
    branch: 'feat/real-delivery-proof',
    commitSha: COMMIT_SHA,
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/418',
    deploymentUrl: 'https://factory-staging.openclaw.app',
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    deploymentHealth: { ok: true, url: 'https://factory-staging.openclaw.app/version', commitVerified: true },
    releaseEnv: 'staging',
    riskLevel: 'low',
    productionSafe: true,
    rollbackVerified: true,
    ...overrides,
  };
}

test('real branch evidence rejects default branches and detached HEAD', () => {
  assert.equal(realBranchEvidenceFailure('main'), 'candidate branch must not be main');
  assert.equal(realBranchEvidenceFailure('master'), 'candidate branch must not be master');
  assert.equal(realBranchEvidenceFailure('HEAD'), 'candidate branch cannot be detached HEAD');
  assert.equal(realBranchEvidenceFailure('feat/real-delivery-proof'), null);
  assert.equal(isRealCandidateBranch('feat/real-delivery-proof'), true);
  assert.equal(isRealCandidateBranch('main'), false);
});

test('candidate proof preflight rejects default branch artifacts', () => {
  const failures = candidateProofContentPreflightFailures(candidateProof({ branch: 'main' }), {}, 'staging');

  assert.match(failures.join('\n'), /branch must not be main/);
});

test('candidate proof preflight rejects stale branch and commit artifacts', () => {
  const failures = candidateProofContentPreflightFailures(candidateProof({
    branch: 'feat/stale-proof',
    commitSha: OTHER_COMMIT_SHA,
  }), {
    branchName: 'feat/real-delivery-proof',
    implementationCommitSha: COMMIT_SHA,
  }, 'staging');

  assert.match(failures.join('\n'), /branch must match requested branch/);
  assert.match(failures.join('\n'), /commitSha must match requested implementation commit SHA/);
});
