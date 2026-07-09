const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  REAL_DELIVERY_CANDIDATE_SCHEMA_VERSION,
  evaluateRealDeliveryCandidate,
  isCandidateChangedFile,
  isLocalOrPrivateDeploymentUrl,
  isPlaceholderDeploymentUrl,
  isTestFile,
  parsePorcelainStatus,
  runCandidateTestCommands,
  verifyRealDeliveryCandidate,
} = require('../../lib/task-platform/real-delivery-candidate');
const {
  checkDeploymentHealth,
  deploymentHealthUrl,
  verifyRealDeliveryCandidateReleaseProof,
} = require('../../lib/task-platform/real-delivery-candidate-proof');
const {
  buildCandidateOptions,
  rollbackVerifiedOption,
} = require('../../scripts/verify-real-delivery-candidate');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const DEPLOYMENT_URL = 'https://factory-staging.engineering-team.io';
const ROLLBACK_EVIDENCE = Object.freeze({ environment: 'staging', commit_sha: COMMIT_SHA, rollback_target: 'release-previous', verification_status: 'verified', verified_at: '2026-07-05T00:00:00.000Z' });
const PRODUCTION_SAFETY_EVIDENCE = Object.freeze(productionSafetyEvidence({ deploymentUrl: DEPLOYMENT_URL, commitSha: COMMIT_SHA }));
const GITHUB_EVIDENCE_SOURCE = Object.freeze({ provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-05T00:00:00.000Z' });
const GITHUB_CHECKS = Object.freeze([
  { name: 'Unit tests', conclusion: 'success', source: 'github_check_run' },
  { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
]);
const REQUIRED_CHECKS = Object.freeze(['Unit tests', 'Merge readiness']);
const BRANCH_PROTECTION = Object.freeze({
  branch: 'main',
  requiredChecks: REQUIRED_CHECKS,
  source: 'github_branch_protection',
});
const MERGE_READINESS = Object.freeze({ name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' });

const VALID_CANDIDATE = Object.freeze({
  branch: 'feat/queue-status-real-delivery',
  commitSha: COMMIT_SHA,
  prUrl: PR_URL,
  prNumber: 417,
  checks: GITHUB_CHECKS,
  requiredChecks: REQUIRED_CHECKS,
  branchProtection: BRANCH_PROTECTION,
  mergeReadiness: MERGE_READINESS,
  githubEvidenceSource: GITHUB_EVIDENCE_SOURCE,
  releaseEnv: 'staging',
  deploymentUrl: DEPLOYMENT_URL, requireHealthCommit: true,
  productionSafetyEvidence: PRODUCTION_SAFETY_EVIDENCE,
  rollbackTarget: 'release-previous',
  rollbackEvidence: ROLLBACK_EVIDENCE,
  riskLevel: 'low',
  productionSafe: true,
  testCommands: ['node --test tests/unit/factory-queue-status.test.js'],
  changedFiles: [
    'lib/task-platform/factory-delivery-queue-status.js',
    'src/app/routes/AutonomyMetricsRoute.jsx',
    'tests/unit/factory-queue-status.test.js',
  ],
});

function candidateGitState(overrides = {}) {
  return {
    branch: VALID_CANDIDATE.branch,
    commitSha: COMMIT_SHA,
    changedFiles: VALID_CANDIDATE.changedFiles,
    workingTreeClean: true,
    dirtyFileCount: 0,
    dirtyFiles: [],
    ...overrides,
  };
}

test('real delivery candidate accepts low-risk production-safe scope with executable tests', () => {
  const result = evaluateRealDeliveryCandidate(VALID_CANDIDATE);

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.implementationFiles, [
    'lib/task-platform/factory-delivery-queue-status.js',
    'src/app/routes/AutonomyMetricsRoute.jsx',
  ]);
  assert.deepEqual(result.testFiles, ['tests/unit/factory-queue-status.test.js']);
  assert.deepEqual(result.testCommands, ['node --test tests/unit/factory-queue-status.test.js']);
  assert.equal(result.commitSha, COMMIT_SHA);
  assert.equal(result.prUrl, PR_URL);
});

test('real delivery candidate CLI preserves manifest rollback verification unless explicitly overridden', () => {
  const argv = [
    'node',
    'scripts/verify-real-delivery-candidate.js',
    '--manifest',
    'candidate.json',
    '--branch',
    VALID_CANDIDATE.branch,
    '--skip-source-integrity',
  ];
  const options = buildCandidateOptions(process.cwd(), [], [], argv, {});

  assert.equal(Object.hasOwn(options, 'rollbackVerified'), false);
  assert.equal(options.branch, VALID_CANDIDATE.branch);
  assert.equal(rollbackVerifiedOption([...argv, '--rollback-verified'], {}), true);
  assert.equal(rollbackVerifiedOption(argv, { ROLLBACK_VERIFIED: 'false' }), false);

  const result = verifyRealDeliveryCandidate({
    ...options,
    manifestData: {
      schemaVersion: REAL_DELIVERY_CANDIDATE_SCHEMA_VERSION,
      source: {
        branchName: VALID_CANDIDATE.branch,
        commitSha: COMMIT_SHA,
        prUrl: PR_URL,
        prNumber: 417,
      },
      release: {
        environment: 'staging',
        deploymentUrl: VALID_CANDIDATE.deploymentUrl,
        productionSafe: true,
      },
      rollback: { target: 'release-previous', verified: true },
      risk: { level: 'low', productionSafe: true },
      scope: { changedFiles: VALID_CANDIDATE.changedFiles },
      tests: { commands: VALID_CANDIDATE.testCommands },
    },
    gitState: candidateGitState(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.rollbackVerified, true);
});

test('real delivery candidate rejects direct proof without low risk, production safety, and test commands', () => {
  const result = evaluateRealDeliveryCandidate({
    ...VALID_CANDIDATE,
    riskLevel: '',
    productionSafe: false,
    testCommands: [],
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /risk level must be low/);
  assert.match(result.failures.join('\n'), /productionSafe true/);
  assert.match(result.failures.join('\n'), /executable test commands/);
});

test('real delivery candidate rejects docs-only or testless changes', () => {
  const result = evaluateRealDeliveryCandidate({
    ...VALID_CANDIDATE,
    changedFiles: ['docs/runbooks/golden-path-autonomous-delivery.md'],
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /implementation code file/);
  assert.match(result.failures.join('\n'), /test file/);
});

test('real delivery candidate rejects default branches, local deploys, and missing rollback plans', () => {
  const result = evaluateRealDeliveryCandidate({
    ...VALID_CANDIDATE,
    branch: 'main',
    deploymentUrl: 'http://127.0.0.1:4173',
    rollbackTarget: '',
    rollbackPlan: '',
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /must not be main/);
  assert.match(result.failures.join('\n'), /non-local and non-private/);
  assert.match(result.failures.join('\n'), /rollback target or rollback plan/);
});

test('real delivery candidate rejects broad changes above the low-risk file limit', () => {
  const result = evaluateRealDeliveryCandidate({
    ...VALID_CANDIDATE,
    maxChangedFiles: 2,
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /above low-risk limit 2/);
});

test('real delivery candidate recognizes test files and local deployment URLs', () => {
  assert.equal(isTestFile('tests/unit/factory-queue-status.test.js'), true);
  assert.equal(isTestFile('src/app/routes/AutonomyMetricsRoute.jsx'), false);
  assert.equal(isLocalOrPrivateDeploymentUrl('https://engineering-team.example.test'), false);
  assert.equal(isLocalOrPrivateDeploymentUrl('http://localhost:4173'), true);
  assert.equal(isLocalOrPrivateDeploymentUrl('http://10.0.0.5'), true);
  assert.equal(isPlaceholderDeploymentUrl('https://factory.example.test'), true);
  assert.equal(isPlaceholderDeploymentUrl('https://factory-staging.engineering-team.io'), false);
  assert.equal(isCandidateChangedFile('observability/factory-delivery/result.json'), false);
  assert.equal(isCandidateChangedFile('lib/task-platform/factory-delivery.js'), true);
});

test('real delivery candidate rejects placeholder deployment domains', () => {
  const result = evaluateRealDeliveryCandidate({
    ...VALID_CANDIDATE,
    deploymentUrl: 'https://factory.example.test',
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /placeholder or reserved domains/);
});

test('real delivery candidate parses git porcelain output including renames and untracked files', () => {
  const entries = parsePorcelainStatus([
    ' M lib/task-platform/factory-delivery.js',
    'R  lib/old.js -> lib/new.js',
    '?? tests/unit/new-feature.test.js',
  ].join('\n'));

  assert.deepEqual(entries, [
    { status: ' M', path: 'lib/task-platform/factory-delivery.js' },
    { status: 'R ', path: 'lib/new.js' },
    { status: '??', path: 'tests/unit/new-feature.test.js' },
  ]);
});

test('real delivery candidate rejects branch and commit claims that do not match git state', () => {
  const result = verifyRealDeliveryCandidate({
    ...VALID_CANDIDATE,
    gitState: candidateGitState({
      branch: 'feat/current-branch',
      commitSha: '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210',
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /candidate branch must match current git branch/);
  assert.match(result.failures.join('\n'), /candidate commitSha must match current git HEAD/);
});

test('real delivery candidate incorporates source integrity failures', () => {
  const result = verifyRealDeliveryCandidate({
    ...VALID_CANDIDATE,
    gitState: candidateGitState(),
    sourceIntegrity: () => ({ failures: [{ path: 'lib/file.js' }] }),
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /source integrity gate failed with 1 findings/);
});

test('real delivery candidate manifest scopes a low-risk change inside a larger dirty worktree', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-candidate-'));
  const manifestPath = path.join(tmp, 'candidate.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    schemaVersion: REAL_DELIVERY_CANDIDATE_SCHEMA_VERSION,
    release: {
      environment: 'staging',
      deploymentUrl: VALID_CANDIDATE.deploymentUrl,
      productionSafe: true,
    },
    rollback: { target: 'release-previous', plan: 'Revert the candidate PR and redeploy the previous release.' },
    risk: { level: 'low', productionSafe: true },
    scope: { changedFiles: VALID_CANDIDATE.changedFiles, maxChangedFiles: 10 },
    tests: { commands: ['node --test tests/unit/factory-queue-status.test.js'] },
  }, null, 2)}\n`);

  const result = verifyRealDeliveryCandidate({
    root: tmp,
    manifestPath,
    releaseEnv: '',
    deploymentUrl: '',
    rollbackPlan: '',
    changedFiles: undefined,
    riskLevel: undefined,
    productionSafe: undefined,
    testCommands: undefined,
    gitState: candidateGitState({
      changedFiles: [
        ...VALID_CANDIDATE.changedFiles,
        'lib/unrelated-large-change.js',
        'tests/unit/unrelated-large-change.test.js',
      ],
    }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.changedFiles, VALID_CANDIDATE.changedFiles);
  assert.deepEqual(result.testCommands, ['node --test tests/unit/factory-queue-status.test.js']);
});

test('real delivery candidate manifest rejects missing risk, production safety, tests, and unmodified files', () => {
  const result = verifyRealDeliveryCandidate({
    manifestData: {
      schemaVersion: 'wrong',
      releaseEnv: 'staging',
      deploymentUrl: VALID_CANDIDATE.deploymentUrl,
      rollbackPlan: 'Revert the PR.',
      changedFiles: VALID_CANDIDATE.changedFiles,
    },
    gitState: candidateGitState({
      changedFiles: ['lib/task-platform/factory-delivery-queue-status.js'],
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /schemaVersion/);
  assert.match(result.failures.join('\n'), /risk level must be low/);
  assert.match(result.failures.join('\n'), /productionSafe true/);
  assert.match(result.failures.join('\n'), /test commands/);
  assert.match(result.failures.join('\n'), /not changed in the current git state/);
});

test('real delivery candidate executes manifest test commands when requested', () => {
  const result = verifyRealDeliveryCandidate({
    ...VALID_CANDIDATE,
    manifestData: {
      schemaVersion: REAL_DELIVERY_CANDIDATE_SCHEMA_VERSION,
      release: { environment: 'staging', deploymentUrl: VALID_CANDIDATE.deploymentUrl, productionSafe: true },
      rollback: { target: 'release-previous' },
      risk: { level: 'low', productionSafe: true },
      scope: { changedFiles: VALID_CANDIDATE.changedFiles },
      tests: { commands: ['node -e "process.exit(0)"'] },
    },
    gitState: candidateGitState(),
    runTestCommands: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.testCommandResults.length, 1);
  assert.equal(result.testCommandResults[0].ok, true);
});

test('real delivery candidate final proof requires rollback verification and live health check intent', () => {
  const result = verifyRealDeliveryCandidate({
    ...VALID_CANDIDATE,
    requireFinalReleaseProof: true,
    gitState: candidateGitState(),
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /verified rollback evidence/);
  assert.match(result.failures.join('\n'), /live deployment health verification/);
});

test('real delivery candidate final proof rejects missing or fake commit and PR identity', () => {
  const result = verifyRealDeliveryCandidate({
    ...VALID_CANDIDATE,
    commitSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/271',
    prNumber: 271,
    requireFinalReleaseProof: true,
    rollbackVerified: true,
    verifyDeploymentHealth: true,
    gitState: candidateGitState({ commitSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }),
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /non-fixture 40-character commit SHA/);
  assert.match(result.failures.join('\n'), /default pilot PR #271/);
});

test('real delivery candidate final proof rejects PR number mismatches', () => {
  const result = verifyRealDeliveryCandidate({
    ...VALID_CANDIDATE,
    prUrl: PR_URL,
    prNumber: 418,
    requireFinalReleaseProof: true,
    rollbackVerified: true,
    verifyDeploymentHealth: true,
    gitState: candidateGitState(),
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /pull request number must match/);
});

test('real delivery candidate final proof rejects non-GitHub PR URLs', () => {
  const result = verifyRealDeliveryCandidate({
    ...VALID_CANDIDATE,
    prUrl: 'https://git.example.com/wiinc1/engineering-team/pull/417',
    requireFinalReleaseProof: true,
    rollbackVerified: true,
    verifyDeploymentHealth: true,
    gitState: candidateGitState(),
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /GitHub pull request URL/);
});

test('real delivery candidate final proof requires GitHub checks and API provenance', () => {
  const result = verifyRealDeliveryCandidate({
    ...VALID_CANDIDATE,
    checks: [],
    requiredChecks: [],
    mergeReadiness: null,
    githubEvidenceSource: null,
    requireFinalReleaseProof: true,
    rollbackVerified: true,
    verifyDeploymentHealth: true,
    gitState: candidateGitState(),
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /GitHub checks are required/);
  assert.match(result.failures.join('\n'), /GitHub requiredChecks inventory is required/);
  assert.match(result.failures.join('\n'), /GitHub mergeReadiness proof is required/);
  assert.match(result.failures.join('\n'), /GitHub candidate proof must be collected from GitHub API/);
});

test('real delivery candidate final proof accepts healthy hosted deployment checks', async () => {
  const result = await verifyRealDeliveryCandidateReleaseProof({
    ...VALID_CANDIDATE,
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackVerified: true,
    gitState: candidateGitState(),
    fetchImpl: async (url) => {
      assert.equal(String(url), VALID_CANDIDATE.deploymentUrl);
      return { ok: true, status: 200, text: async () => COMMIT_SHA };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.deploymentHealth.ok, true);
  assert.equal(result.deploymentHealth.status, 200);
  assert.deepEqual(result.requiredChecks, REQUIRED_CHECKS);
  assert.equal(result.githubEvidenceSource.provider, 'github');
});

test('real delivery candidate final proof rejects unhealthy hosted deployment checks', async () => {
  const result = await verifyRealDeliveryCandidateReleaseProof({
    ...VALID_CANDIDATE,
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackVerified: true,
    gitState: candidateGitState(),
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /deployment health check failed/);
  assert.equal(result.deploymentHealth.status, 503);
});

test('real delivery candidate fails when an executed test command fails', () => {
  const result = verifyRealDeliveryCandidate({
    ...VALID_CANDIDATE,
    manifestData: {
      schemaVersion: REAL_DELIVERY_CANDIDATE_SCHEMA_VERSION,
      release: { environment: 'staging', deploymentUrl: VALID_CANDIDATE.deploymentUrl, productionSafe: true },
      rollback: { target: 'release-previous' },
      risk: { level: 'low', productionSafe: true },
      scope: { changedFiles: VALID_CANDIDATE.changedFiles },
      tests: { commands: ['node -e "process.exit(3)"'] },
    },
    testCommands: ['node -e "process.exit(3)"'],
    gitState: candidateGitState(),
    runTestCommands: true,
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /test command failed/);
  assert.equal(result.testCommandResults[0].exitCode, 3);
});

test('runCandidateTestCommands records command output tails', () => {
  const [result] = runCandidateTestCommands(process.cwd(), ['node -e "console.log(\\\"candidate-test-proof\\\")"']);
  assert.equal(result.ok, true);
  assert.match(result.stdout, /candidate-test-proof/);
});

test('deployment health helpers resolve health paths and capture fetch failures', async () => {
  assert.equal(
    deploymentHealthUrl('https://factory-staging.engineering-team.io', '/api/health'),
    'https://factory-staging.engineering-team.io/api/health',
  );
  const result = await checkDeploymentHealth({
    deploymentUrl: VALID_CANDIDATE.deploymentUrl,
    fetchImpl: async () => {
      throw new Error('network unavailable');
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /network unavailable/);
});
