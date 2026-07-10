const test = require('node:test');
const assert = require('node:assert/strict');
const {
  realEvidenceFactoryOptions,
  runMilestoneCAgentVerify,
} = require('../../lib/audit/milestone-c-agent-verify');

const STRICT_CHECKS = [{ name: 'Unit tests', conclusion: 'success' }];
const STRICT_REQUIRED_CHECKS = ['Unit tests', 'Merge readiness'];
const STRICT_BRANCH_PROTECTION = { branch: 'main', requiredChecks: STRICT_REQUIRED_CHECKS };
const STRICT_MERGE_READINESS = { name: 'Merge readiness', conclusion: 'success' };
const STRICT_GITHUB_SOURCE = { provider: 'github', apiBaseUrl: 'https://api.github.com' };
const STRICT_RELEASE_COMMANDS = {
  build: 'npm run build',
  compatibility: 'npm run test:unit',
  vulnerability: 'npm audit --audit-level=high',
  secret: 'npm run secrets:scan',
};

function strictMilestoneRuntime() {
  return {
    collectRealEvidence: true,
    requireRealEvidence: true,
    ciRepository: 'wiinc1/engineering-team',
    branchName: 'factory/strict-proof',
    implementationCommitSha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/417',
    prNumber: 417,
    autoMerge: true,
    githubToken: 'gh-token',
    checks: STRICT_CHECKS,
    requiredChecks: STRICT_REQUIRED_CHECKS,
    branchProtection: STRICT_BRANCH_PROTECTION,
    mergeReadiness: STRICT_MERGE_READINESS,
    githubEvidenceSource: STRICT_GITHUB_SOURCE,
    deploymentUrl: 'https://factory.example.test',
    realDeliveryRiskLevel: 'low',
    realDeliveryProductionSafe: true,
    realDeliveryTestCommands: ['node --test tests/unit/milestone-c-agent-verify.test.js'],
    productionSafetyEvidence: 'observability/release/production-safety.json',
    realDeliveryProductionSafetyEvidence: 'observability/release/production-safety.json',
    realDeliveryCandidateProofPath: 'observability/real-delivery-candidate-proof.json',
    realAutonomousDeliveryEvidencePath: 'observability/real-autonomous-delivery-evidence.json',
    realDeliveryHealthCheckPath: '/version',
    requireHealthCommit: true,
    rollbackTarget: 'release-previous',
    rollbackPlan: 'Revert the scoped PR and redeploy the previous release.',
    rollbackEvidence: 'observability/release/rollback-verification.json',
    realDeliveryRollbackEvidence: 'observability/release/rollback-verification.json',
    rollbackVerified: true,
    releaseArtifactDir: 'observability/release',
    releaseArtifactCommands: STRICT_RELEASE_COMMANDS,
    releaseArtifactCommandTimeoutMs: 120000,
    useExistingReleaseArtifacts: true,
    releaseEnv: 'prod',
    changeKind: 'bugfix',
    changedFiles: ['lib/audit/milestone-c-agent-verify.js'],
  };
}

function assertStrictMilestoneIdentity(options) {
  assert.equal(options.collectRealEvidence, true);
  assert.equal(options.requireRealEvidence, true);
  assert.equal(options.ciRepository, 'wiinc1/engineering-team');
  assert.equal(options.branchName, 'factory/strict-proof');
  assert.equal(options.implementationCommitSha, '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd');
  assert.equal(options.prUrl, 'https://github.com/wiinc1/engineering-team/pull/417');
  assert.equal(options.prNumber, 417);
  assert.equal(options.autoMerge, true);
  assert.equal(options.githubToken, 'gh-token');
}

function assertStrictMilestoneGithubProof(options) {
  assert.deepEqual(options.checks, STRICT_CHECKS);
  assert.deepEqual(options.requiredChecks, STRICT_REQUIRED_CHECKS);
  assert.deepEqual(options.branchProtection, STRICT_BRANCH_PROTECTION);
  assert.deepEqual(options.mergeReadiness, STRICT_MERGE_READINESS);
  assert.deepEqual(options.githubEvidenceSource, STRICT_GITHUB_SOURCE);
}

function assertStrictMilestoneReleaseProof(options) {
  assert.equal(options.deploymentUrl, 'https://factory.example.test');
  assert.equal(options.productionSafetyEvidence, 'observability/release/production-safety.json');
  assert.equal(options.realDeliveryProductionSafetyEvidence, 'observability/release/production-safety.json');
  assert.equal(options.realDeliveryCandidateProofPath, 'observability/real-delivery-candidate-proof.json');
  assert.equal(options.realAutonomousDeliveryEvidencePath, 'observability/real-autonomous-delivery-evidence.json');
  assert.equal(options.realDeliveryHealthCheckPath, '/version');
  assert.equal(options.requireHealthCommit, true);
  assert.equal(options.releaseArtifactDir, 'observability/release');
  assert.equal(options.releaseArtifactCommands.secret, 'npm run secrets:scan');
  assert.equal(options.releaseArtifactCommandTimeoutMs, 120000);
  assert.equal(options.useExistingReleaseArtifacts, true);
}

function assertStrictMilestoneRiskAndRollback(options) {
  assert.equal(options.realDeliveryRiskLevel, 'low');
  assert.equal(options.realDeliveryProductionSafe, true);
  assert.deepEqual(options.realDeliveryTestCommands, ['node --test tests/unit/milestone-c-agent-verify.test.js']);
  assert.equal(options.rollbackTarget, 'release-previous');
  assert.equal(options.rollbackPlan, 'Revert the scoped PR and redeploy the previous release.');
  assert.equal(options.rollbackEvidence, 'observability/release/rollback-verification.json');
  assert.equal(options.realDeliveryRollbackEvidence, 'observability/release/rollback-verification.json');
  assert.equal(options.rollbackVerified, true);
  assert.equal(options.releaseEnv, 'prod');
  assert.equal(options.changeKind, 'bugfix');
  assert.deepEqual(options.changedFiles, ['lib/audit/milestone-c-agent-verify.js']);
}

test('milestone C verify module exports agent autonomy verifier', () => {
  assert.equal(typeof runMilestoneCAgentVerify, 'function');
});

test('milestone C agent verify preflights real proof before queue work', async () => {
  await assert.rejects(
    () => runMilestoneCAgentVerify({
      baseUrl: 'https://staging.example',
      jwtSecret: 'secret',
      factoryQueueDatabaseUrl: 'postgres://queue/unused',
    }),
    /Milestone C agent verify preflight failed: .*pull request target.*deployment-url.*rollback-target.*rollback-verified/s,
  );
});

test('milestone C local coordinated-stack path skips hosted real-evidence preflight', async () => {
  // Should fail later on network/queue work, not on hosted release evidence fields.
  await assert.rejects(
    () => runMilestoneCAgentVerify({
      baseUrl: 'http://127.0.0.1:13000',
      jwtSecret: 'golden-path-local-dev-secret',
      // Force file queue so unit test does not require postgres SSL wiring.
      allowFileQueue: true,
      queueBackend: 'file',
      fetchImpl: async () => {
        throw new Error('local-stack-fetch-blocked-in-unit-test');
      },
    }),
    /local-stack-fetch-blocked-in-unit-test|ECONNREFUSED|fetch failed|queue|Factory|ENOENT/i,
  );
});

test('milestone C factory options carry strict real-evidence fields', () => {
  const options = realEvidenceFactoryOptions(strictMilestoneRuntime());
  assertStrictMilestoneIdentity(options);
  assertStrictMilestoneGithubProof(options);
  assertStrictMilestoneReleaseProof(options);
  assertStrictMilestoneRiskAndRollback(options);
});
