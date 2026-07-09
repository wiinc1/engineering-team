const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  readGitCandidateState,
  verifyRealDeliveryCandidate,
} = require('../../lib/task-platform/real-delivery-candidate');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const DEPLOYMENT_URL = 'https://factory-staging.engineering-team.io';
const CHANGED_FILES = [
  'lib/task-platform/factory-delivery-queue-status.js',
  'src/app/routes/AutonomyMetricsRoute.jsx',
  'tests/unit/factory-queue-status.test.js',
];
const GITHUB_CHECKS = [
  { name: 'Unit tests', conclusion: 'success', source: 'github_check_run' },
  { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
];
const REQUIRED_CHECKS = ['Unit tests', 'Merge readiness'];
const VALID_CANDIDATE = Object.freeze({
  branch: 'feat/queue-status-real-delivery',
  commitSha: COMMIT_SHA,
  prUrl: PR_URL,
  prNumber: 417,
  checks: GITHUB_CHECKS,
  requiredChecks: REQUIRED_CHECKS,
  branchProtection: {
    branch: 'main',
    requiredChecks: REQUIRED_CHECKS,
    source: 'github_branch_protection',
  },
  mergeReadiness: { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
  githubEvidenceSource: { provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-05T00:00:00.000Z' },
  releaseEnv: 'staging',
  deploymentUrl: DEPLOYMENT_URL,
  requireHealthCommit: true,
  productionSafetyEvidence: productionSafetyEvidence({ deploymentUrl: DEPLOYMENT_URL, commitSha: COMMIT_SHA }),
  rollbackTarget: 'release-previous',
  rollbackEvidence: {
    environment: 'staging',
    commit_sha: COMMIT_SHA,
    rollback_target: 'release-previous',
    verification_status: 'verified',
    verified_at: '2026-07-05T00:00:00.000Z',
  },
  riskLevel: 'low',
  productionSafe: true,
  testCommands: ['node --test tests/unit/factory-queue-status.test.js'],
  changedFiles: CHANGED_FILES,
});

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function candidateGitState(overrides = {}) {
  return {
    branch: VALID_CANDIDATE.branch,
    commitSha: COMMIT_SHA,
    changedFiles: CHANGED_FILES,
    workingTreeClean: true,
    dirtyFileCount: 0,
    dirtyFiles: [],
    ...overrides,
  };
}

function finalProofCandidate(overrides = {}) {
  return {
    ...VALID_CANDIDATE,
    requireFinalReleaseProof: true,
    rollbackVerified: true,
    verifyDeploymentHealth: true,
    ...overrides,
  };
}

test('readGitCandidateState records dirty local git state without dropping leading porcelain status', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-git-state-'));
  fs.mkdirSync(path.join(tmp, 'lib/task-platform'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'lib/task-platform/factory-delivery.js'), 'module.exports = {};\n');
  git(tmp, ['init']);
  git(tmp, ['config', 'user.name', 'Real Delivery Test']);
  git(tmp, ['config', 'user.email', 'real-delivery-test@example.test']);
  git(tmp, ['add', 'lib/task-platform/factory-delivery.js']);
  git(tmp, ['commit', '-m', 'initial']);
  fs.writeFileSync(path.join(tmp, 'lib/task-platform/factory-delivery.js'), 'module.exports = { changed: true };\n');
  fs.mkdirSync(path.join(tmp, 'tests/unit'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'tests/unit/factory-delivery.test.js'), 'test("ok", () => {});\n');

  const state = readGitCandidateState(tmp);

  assert.equal(state.workingTreeClean, false);
  assert.equal(state.dirtyFileCount, 2);
  assert.deepEqual(state.changedFiles.sort(), [
    'lib/task-platform/factory-delivery.js',
    'tests/unit/factory-delivery.test.js',
  ]);
  assert.deepEqual(state.dirtyFiles.sort(), state.changedFiles.sort());
});

test('final real delivery candidate proof rejects dirty local checkout evidence', () => {
  const result = verifyRealDeliveryCandidate(finalProofCandidate({
    gitState: candidateGitState({
      workingTreeClean: false,
      dirtyFileCount: 2,
      dirtyFiles: [
        'lib/task-platform/factory-delivery-queue-status.js',
        'tests/unit/factory-queue-status.test.js',
      ],
    }),
  }));

  assert.equal(result.ok, false);
  assert.equal(result.localGit.workingTreeClean, false);
  assert.match(result.failures.join('\n'), /worktree must be clean before final real delivery candidate proof \(2 dirty files\)/);
});

test('final real delivery candidate proof requires explicit clean local git evidence', () => {
  const result = verifyRealDeliveryCandidate(finalProofCandidate({
    gitState: {
      branch: VALID_CANDIDATE.branch,
      commitSha: COMMIT_SHA,
      changedFiles: CHANGED_FILES,
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.localGit.workingTreeClean, null);
  assert.match(result.failures.join('\n'), /requires local git worktree clean evidence/);
});
