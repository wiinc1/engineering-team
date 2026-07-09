const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION,
  buildRealDeliveryCandidateProof,
  verifyRealDeliveryCandidateReleaseProof,
  writeRealDeliveryCandidateProof,
} = require('../../lib/task-platform/real-delivery-candidate-proof');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const DEPLOYMENT_URL = 'https://factory-staging.engineering-team.io';
const VALID_CANDIDATE = Object.freeze({
  branch: 'feat/queue-status-real-delivery',
  commitSha: COMMIT_SHA,
  prUrl: PR_URL,
  prNumber: 417,
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
  githubEvidenceSource: { provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-05T00:00:00.000Z' },
  releaseEnv: 'staging',
  deploymentUrl: DEPLOYMENT_URL,
  requireHealthCommit: true,
  productionSafetyEvidence: productionSafetyEvidence({ deploymentUrl: DEPLOYMENT_URL, commitSha: COMMIT_SHA }),
  rollbackTarget: 'release-previous',
  rollbackEvidence: { environment: 'staging', commit_sha: COMMIT_SHA, rollback_target: 'release-previous', verification_status: 'verified', verified_at: '2026-07-05T00:00:00.000Z' },
  riskLevel: 'low',
  productionSafe: true,
  localGit: {
    branch: 'feat/queue-status-real-delivery',
    commitSha: COMMIT_SHA,
    workingTreeClean: true,
    dirtyFileCount: 0,
    dirtyFiles: [],
  },
  changedFiles: [
    'lib/task-platform/factory-delivery-queue-status.js',
    'src/app/routes/AutonomyMetricsRoute.jsx',
    'tests/unit/factory-queue-status.test.js',
  ],
});

function candidateGitState() {
  return {
    branch: VALID_CANDIDATE.branch,
    commitSha: COMMIT_SHA,
    changedFiles: VALID_CANDIDATE.changedFiles,
    workingTreeClean: true,
    dirtyFileCount: 0,
    dirtyFiles: [],
  };
}

test('real delivery candidate proof artifact preserves pass and failure evidence', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-proof-'));
  const result = await verifyRealDeliveryCandidateReleaseProof({
    ...VALID_CANDIDATE,
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackVerified: true,
    runTestCommands: true,
    testCommands: ['node -e "console.log(\\\"candidate proof\\\")"'],
    gitState: candidateGitState(),
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });

  writeRealDeliveryCandidateProof(tmp, 'candidate-proof.json', result);
  const proof = JSON.parse(fs.readFileSync(path.join(tmp, 'candidate-proof.json'), 'utf8'));

  assert.equal(proof.schemaVersion, REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION);
  assert.equal(proof.ok, false);
  assert.equal(proof.repository, 'wiinc1/engineering-team');
  assert.equal(proof.commitSha, COMMIT_SHA);
  assert.equal(proof.prUrl, PR_URL);
  assert.equal(proof.prNumber, 417);
  assert.equal(proof.branchProtection.source, 'github_branch_protection');
  assert.equal(proof.rollbackVerified, true);
  assert.equal(proof.rollbackEvidence.verification_status, 'verified');
  assert.equal(proof.deploymentHealth.status, 503);
  assert.match(proof.testCommandResults[0].stdout, /candidate proof/);
  assert.match(proof.failures.join('\n'), /deployment health check failed/);
});

test('buildRealDeliveryCandidateProof compacts source integrity evidence', () => {
  const proof = buildRealDeliveryCandidateProof({
    ok: false,
    sourceIntegrity: {
      checkedFiles: 3,
      nodeCheckedFiles: 2,
      failures: [{ path: 'lib/bad.js', line: 1 }],
    },
  });

  assert.equal(proof.sourceIntegrity.checkedFiles, 3);
  assert.equal(proof.sourceIntegrity.nodeCheckedFiles, 2);
  assert.equal(proof.sourceIntegrity.failureCount, 1);
});

test('buildRealDeliveryCandidateProof rejects final proof without passing deployment health evidence', () => {
  const missing = buildRealDeliveryCandidateProof({
    ...VALID_CANDIDATE,
    ok: true,
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackVerified: true,
    failures: [],
  });
  const failed = buildRealDeliveryCandidateProof({
    ...missing,
    ok: true,
    deploymentHealth: { ok: false, url: VALID_CANDIDATE.deploymentUrl, status: 503 },
    failures: [],
  });

  assert.equal(missing.ok, false);
  assert.match(missing.failures.join('\n'), /deployment health check result is required/);
  assert.equal(failed.ok, false);
  assert.match(failed.failures.join('\n'), /passing deployment health check is required/);
});

test('buildRealDeliveryCandidateProof rejects health evidence from another deployment origin', () => {
  const proof = buildRealDeliveryCandidateProof({
    ...VALID_CANDIDATE,
    ok: true,
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackVerified: true,
    deploymentHealth: {
      ok: true,
      url: 'https://unrelated-factory.openclaw.app/version',
      status: 200,
      commitVerified: true,
    },
    failures: [],
  });

  assert.equal(proof.ok, false);
  assert.match(proof.failures.join('\n'), /deployment health URL must match deployment URL origin/);
});

test('buildRealDeliveryCandidateProof rejects local deployment and health URLs', () => {
  const proof = buildRealDeliveryCandidateProof({
    ...VALID_CANDIDATE,
    ok: true,
    deploymentUrl: 'http://127.0.0.1:4173',
    productionSafetyEvidence: {
      ...VALID_CANDIDATE.productionSafetyEvidence,
      deployment_url: 'http://127.0.0.1:4173',
    },
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackVerified: true,
    deploymentHealth: {
      ok: true,
      url: 'http://127.0.0.1:4173/version',
      status: 200,
      commitVerified: true,
    },
    failures: [],
  });

  assert.equal(proof.ok, false);
  assert.match(proof.failures.join('\n'), /deploymentUrl must be hosted and non-local/);
  assert.match(proof.failures.join('\n'), /deployment health URL must be hosted and non-local/);
});

test('buildRealDeliveryCandidateProof rejects final proof without GitHub check evidence', () => {
  const proof = buildRealDeliveryCandidateProof({
    ...VALID_CANDIDATE,
    ok: true,
    checks: [],
    requiredChecks: [],
    mergeReadiness: null,
    githubEvidenceSource: null,
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackVerified: true,
    deploymentHealth: { ok: true, url: VALID_CANDIDATE.deploymentUrl, status: 200, commitVerified: true },
    failures: [],
  });

  assert.equal(proof.ok, false);
  assert.match(proof.failures.join('\n'), /GitHub checks are required/);
  assert.match(proof.failures.join('\n'), /GitHub candidate proof must be collected from GitHub API/);
});

test('buildRealDeliveryCandidateProof rejects repository drift from pull request URL', () => {
  const proof = buildRealDeliveryCandidateProof({
    ...VALID_CANDIDATE,
    ok: true,
    repository: 'wiinc1/other-repo',
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackVerified: true,
    deploymentHealth: { ok: true, url: VALID_CANDIDATE.deploymentUrl, status: 200, commitVerified: true },
    failures: [],
  });

  assert.equal(proof.ok, false);
  assert.match(proof.failures.join('\n'), /candidate repository must match pull request URL/);
});

test('buildRealDeliveryCandidateProof rejects mismatched test command results', () => {
  const command = 'node --test tests/unit/real-delivery-candidate-proof-artifact.test.js';
  const proof = buildRealDeliveryCandidateProof({
    ...VALID_CANDIDATE,
    ok: true,
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackVerified: true,
    deploymentHealth: { ok: true, url: VALID_CANDIDATE.deploymentUrl, status: 200, commitVerified: true },
    testCommands: [command],
    testCommandResults: [{
      command: 'node --test tests/unit/unrelated.test.js',
      ok: true,
      exitCode: 1,
    }],
    failures: [],
  });

  assert.equal(proof.ok, false);
  assert.match(proof.failures.join('\n'), /test command result must match a listed command/);
  assert.match(proof.failures.join('\n'), /test command exitCode must be 0/);
  assert.match(proof.failures.join('\n'), /must include executed result for listed test command/);
});
