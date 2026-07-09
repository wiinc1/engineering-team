const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  REAL_DELIVERY_CANDIDATE_SCHEMA_VERSION,
  verifyRealDeliveryCandidate,
} = require('../../lib/task-platform/real-delivery-candidate');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const DEPLOYMENT_URL = 'https://factory-staging.engineering-team.io';
const ROLLBACK_EVIDENCE = Object.freeze({ environment: 'staging', commit_sha: COMMIT_SHA, rollback_target: 'release-previous', verification_status: 'verified', verified_at: '2026-07-05T00:00:00.000Z' });
const PRODUCTION_SAFETY_EVIDENCE = Object.freeze(productionSafetyEvidence({ deploymentUrl: DEPLOYMENT_URL, commitSha: COMMIT_SHA }));
const CHANGED_FILES = [
  'lib/task-platform/factory-delivery-queue-status.js',
  'src/app/routes/AutonomyMetricsRoute.jsx',
  'tests/unit/factory-queue-status.test.js',
];
const GITHUB_PROOF = {
  checks: [
    { name: 'Unit tests', conclusion: 'success', source: 'github_check_run' },
    { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
  ],
  requiredChecks: ['Unit tests', 'Merge readiness'],
  branchProtection: {
    branch: 'main',
    requiredChecks: ['Unit tests', 'Merge readiness'],
    source: 'github_branch_protection',
  },
  mergeReadiness: { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
  evidenceSource: { provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-05T00:00:00.000Z' },
};

function gitState() {
  return {
    branch: 'feat/queue-status-real-delivery',
    commitSha: COMMIT_SHA,
    changedFiles: CHANGED_FILES,
    workingTreeClean: true,
    dirtyFileCount: 0,
    dirtyFiles: [],
  };
}

function baseCandidate(overrides = {}) {
  return {
    branch: 'feat/queue-status-real-delivery',
    commitSha: COMMIT_SHA,
    prUrl: PR_URL,
    prNumber: 417,
    checks: GITHUB_PROOF.checks,
    requiredChecks: GITHUB_PROOF.requiredChecks,
    branchProtection: GITHUB_PROOF.branchProtection,
    mergeReadiness: GITHUB_PROOF.mergeReadiness,
    githubEvidenceSource: GITHUB_PROOF.evidenceSource,
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    requireHealthCommit: true,
    productionSafetyEvidence: PRODUCTION_SAFETY_EVIDENCE,
    rollbackTarget: 'release-previous',
    riskLevel: 'low',
    productionSafe: true,
    testCommands: ['node --test tests/unit/factory-queue-status.test.js'],
    changedFiles: CHANGED_FILES,
    ...overrides,
  };
}

test('real delivery candidate final proof rejects boolean rollback verification without an artifact', () => {
  const result = verifyRealDeliveryCandidate(baseCandidate({
    requireFinalReleaseProof: true,
    rollbackVerified: true,
    verifyDeploymentHealth: true,
    gitState: gitState(),
  }));

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /rollback-verification artifact is required/);
});

test('real delivery candidate final proof requires rollback evidence for the candidate commit', () => {
  const missingCommit = verifyRealDeliveryCandidate(baseCandidate({
    requireFinalReleaseProof: true,
    rollbackVerified: true,
    rollbackEvidence: { ...ROLLBACK_EVIDENCE, commit_sha: undefined },
    verifyDeploymentHealth: true,
    gitState: gitState(),
  }));
  const mismatchedCommit = verifyRealDeliveryCandidate(baseCandidate({
    requireFinalReleaseProof: true,
    rollbackVerified: true,
    rollbackEvidence: { ...ROLLBACK_EVIDENCE, commit_sha: '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210' },
    verifyDeploymentHealth: true,
    gitState: gitState(),
  }));

  assert.match(missingCommit.failures.join('\n'), /rollback-verification\.commit_sha is required/);
  assert.match(mismatchedCommit.failures.join('\n'), /rollback-verification\.commit_sha must match implementation commit SHA/);
});

test('real delivery candidate final proof loads rollback evidence from a manifest path', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-rollback-evidence-'));
  fs.writeFileSync(path.join(tmp, 'rollback-verification.json'), `${JSON.stringify(ROLLBACK_EVIDENCE, null, 2)}\n`);
  fs.writeFileSync(path.join(tmp, 'production-safety.json'), `${JSON.stringify(PRODUCTION_SAFETY_EVIDENCE, null, 2)}\n`);
  const result = verifyRealDeliveryCandidate({
    root: tmp,
    manifestData: {
      schemaVersion: REAL_DELIVERY_CANDIDATE_SCHEMA_VERSION,
      source: { branchName: gitState().branch, commitSha: COMMIT_SHA, prUrl: PR_URL, prNumber: 417, ...GITHUB_PROOF },
      release: { environment: 'staging', deploymentUrl: DEPLOYMENT_URL, requireHealthCommit: true, productionSafe: true, productionSafetyEvidence: 'production-safety.json' },
      rollback: { target: 'release-previous', verified: true, evidence: 'rollback-verification.json' },
      risk: { level: 'low', productionSafe: true },
      scope: { changedFiles: CHANGED_FILES },
      tests: { commands: ['node --test tests/unit/factory-queue-status.test.js'] },
    },
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    gitState: gitState(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.rollbackEvidence.verification_status, 'verified');
});
