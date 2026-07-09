const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInlineRequirement, submittedItemSummary } = require('../../scripts/submit-factory-requirements');
const {
  submitFactoryRequirements,
  submitFactoryRequirementsForQueue,
} = require('../../lib/task-platform/factory-delivery');
const { buildFactoryQueueInsert } = require('../../lib/task-platform/factory-delivery-queue-postgres');
const { buildFactoryCandidateManifest } = require('../../lib/task-platform/factory-real-delivery-candidate');
const { factoryCompletionFinalEvidencePath } = require('../../lib/task-platform/factory-real-delivery-completion');
const { buildPhaseRunnerOptions } = require('../../lib/task-platform/factory-phase-runner-options');

const TEST_COMMAND = 'node --test tests/unit/factory-submit-real-delivery-metadata.test.js';
const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/418';
const CHECKS = [{ name: 'unit tests', status: 'completed', conclusion: 'success', source: 'github_check_run' }];
const REQUIRED_CHECKS = ['unit tests', 'Merge readiness'];
const BRANCH_PROTECTION = {
  branch: 'main',
  requiredChecks: REQUIRED_CHECKS,
  source: 'github_branch_protection',
};
const MERGE_READINESS = { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' };
const ROLLBACK_EVIDENCE_PATH = 'observability/release/rollback-verification.json';
const PRODUCTION_SAFETY_PATH = 'observability/release/production-safety.json';
const RELEASE_ARTIFACT_DIR = 'observability/release';
const FINAL_EVIDENCE_PATH = 'observability/factory-delivery/factory-item-real-autonomous-delivery-evidence.json';
const HOSTED_SUBMIT_CONFIG = {
  baseUrl: 'https://api.factory.openclaw.app',
  operatorUrl: 'https://operator.factory.openclaw.app',
  forgeAdapterUrl: 'https://forgeadapter.factory.openclaw.app',
  githubToken: 'test-github-token',
};

function inlineRealDeliveryArgs() {
  return [
    'node',
    'scripts/submit-factory-requirements.js',
    '--title', 'Refresh release evidence after merge',
    '--requirements', 'Keep phase 6 release artifacts keyed to the GitHub merge commit.',
    '--change-kind', 'bugfix',
    '--changed-file', 'lib/task-platform/golden-path-release-evidence-refresh.js',
    '--changed-file', 'tests/unit/golden-path-phase6-real-merge.test.js',
    '--repository', 'wiinc1/engineering-team',
    '--branch', 'factory/release-evidence-refresh',
    '--implementation-commit-sha', COMMIT_SHA,
    '--pr-url', PR_URL,
    '--pr-number', '418',
    '--auto-merge',
    '--checks-json', JSON.stringify(CHECKS),
    '--required-checks-json', JSON.stringify(REQUIRED_CHECKS),
    '--branch-protection-json', JSON.stringify(BRANCH_PROTECTION),
    '--merge-readiness-json', JSON.stringify(MERGE_READINESS),
    '--test-command', TEST_COMMAND,
    '--risk-level', 'low',
    '--production-safe',
    '--production-safety-evidence', PRODUCTION_SAFETY_PATH,
    '--rollback-target', 'release-previous',
    '--rollback-plan', 'Revert the PR and rerun phase 6 evidence collection.',
    '--rollback-evidence', ROLLBACK_EVIDENCE_PATH,
    '--rollback-verified',
    '--deployment-url', 'https://factory-staging.openclaw.app',
    '--release-env', 'staging',
    '--health-check-path', '/healthz',
    '--require-health-commit',
    '--release-build-command', 'npm run build',
    '--release-compatibility-command', 'npm run test:unit',
    '--release-vulnerability-command', 'npm audit --audit-level=high',
    '--release-secret-command', 'npm run secrets:scan',
    '--release-artifact-dir', RELEASE_ARTIFACT_DIR,
    '--use-existing-release-artifacts',
    '--candidate-proof', 'observability/factory-delivery/factory-item-real-delivery-candidate-proof.json',
    '--final-evidence', FINAL_EVIDENCE_PATH,
  ];
}

function assertInlineEntry(entry) {
  assert.equal(entry.templateTier, 'Standard');
  assert.equal(entry.ciRepository, 'wiinc1/engineering-team');
  assert.equal(entry.branchName, 'factory/release-evidence-refresh');
  assert.equal(entry.implementationCommitSha, COMMIT_SHA);
  assert.equal(entry.prUrl, PR_URL);
  assert.equal(entry.prNumber, 418);
  assert.equal(entry.autoMerge, true);
  assert.deepEqual(entry.checks, CHECKS);
  assert.deepEqual(entry.requiredChecks, REQUIRED_CHECKS);
  assert.deepEqual(entry.branchProtection, BRANCH_PROTECTION);
  assert.deepEqual(entry.mergeReadiness, MERGE_READINESS);
  assert.equal(entry.riskLevel, 'low');
  assert.equal(entry.productionSafe, true);
  assert.equal(entry.productionSafetyEvidence, PRODUCTION_SAFETY_PATH);
  assert.equal(entry.rollbackTarget, 'release-previous');
  assert.equal(entry.rollbackVerified, true);
  assert.equal(entry.rollbackEvidence, ROLLBACK_EVIDENCE_PATH);
  assert.equal(entry.deploymentUrl, 'https://factory-staging.openclaw.app');
  assert.equal(entry.releaseEnv, 'staging');
  assert.equal(entry.healthCheckPath, '/healthz');
  assert.equal(entry.requireHealthCommit, true);
  assert.equal(entry.releaseArtifactCommands.secret, 'npm run secrets:scan');
  assert.equal(entry.releaseArtifactDir, RELEASE_ARTIFACT_DIR);
  assert.equal(entry.useExistingReleaseArtifacts, true);
  assert.equal(entry.candidateProofPath, 'observability/factory-delivery/factory-item-real-delivery-candidate-proof.json');
  assert.equal(entry.finalEvidencePath, FINAL_EVIDENCE_PATH);
  assert.deepEqual(entry.testCommands, [TEST_COMMAND]);
}

function realDeliveryQueueInsert() {
  return buildFactoryQueueInsert({
    title: 'Refresh release evidence after merge',
    requirements: 'Keep phase 6 release artifacts keyed to the GitHub merge commit.',
    templateTier: 'Standard',
    changeKind: 'bugfix',
    changedFiles: [
      'lib/task-platform/golden-path-release-evidence-refresh.js',
      'tests/unit/golden-path-phase6-real-merge.test.js',
    ],
    ciRepository: 'wiinc1/engineering-team',
    branchName: 'factory/release-evidence-refresh',
    implementationCommitSha: COMMIT_SHA,
    prUrl: PR_URL,
    prNumber: 418,
    autoMerge: true,
    checks: CHECKS,
    requiredChecks: REQUIRED_CHECKS,
    branchProtection: BRANCH_PROTECTION,
    mergeReadiness: MERGE_READINESS,
    testCommands: [TEST_COMMAND],
    riskLevel: 'low',
    productionSafe: true,
    productionSafetyEvidence: PRODUCTION_SAFETY_PATH,
    rollbackTarget: 'release-previous',
    rollbackPlan: 'Revert the PR and rerun phase 6 evidence collection.',
    rollbackEvidence: ROLLBACK_EVIDENCE_PATH,
    rollbackVerified: true,
    deploymentUrl: 'https://factory-staging.openclaw.app',
    releaseEnv: 'staging',
    healthCheckPath: '/healthz',
    requireHealthCommit: true,
    releaseArtifactCommands: { build: 'npm run build', compatibility: 'npm run test:unit', vulnerability: 'npm audit --audit-level=high', secret: 'npm run secrets:scan' },
    releaseArtifactDir: RELEASE_ARTIFACT_DIR,
    useExistingReleaseArtifacts: true,
    candidateProofPath: 'observability/factory-delivery/factory-item-real-delivery-candidate-proof.json',
    finalEvidencePath: FINAL_EVIDENCE_PATH,
  }, 0, { tenantId: 'engineering-team' });
}

function assertQueuedRealDeliveryMetadata(metadata) {
  assert.equal(metadata.realDelivery.ciRepository, 'wiinc1/engineering-team');
  assert.equal(metadata.realDelivery.branchName, 'factory/release-evidence-refresh');
  assert.equal(metadata.realDelivery.implementationCommitSha, COMMIT_SHA);
  assert.equal(metadata.realDelivery.prUrl, PR_URL);
  assert.equal(metadata.realDelivery.prNumber, 418);
  assert.equal(metadata.realDelivery.autoMerge, true);
  assert.deepEqual(metadata.realDelivery.checks, CHECKS);
  assert.deepEqual(metadata.realDelivery.requiredChecks, REQUIRED_CHECKS);
  assert.deepEqual(metadata.realDelivery.branchProtection, BRANCH_PROTECTION);
  assert.deepEqual(metadata.realDelivery.mergeReadiness, MERGE_READINESS);
  assert.deepEqual(metadata.realDelivery.testCommands, [TEST_COMMAND]);
  assert.equal(metadata.realDelivery.productionSafe, true);
  assert.equal(metadata.realDelivery.productionSafetyEvidence, PRODUCTION_SAFETY_PATH);
  assert.equal(metadata.realDelivery.rollbackTarget, 'release-previous');
  assert.equal(metadata.realDelivery.rollbackVerified, true);
  assert.equal(metadata.realDelivery.rollbackEvidence, ROLLBACK_EVIDENCE_PATH);
  assert.equal(metadata.realDelivery.deploymentUrl, 'https://factory-staging.openclaw.app');
  assert.equal(metadata.realDelivery.releaseEnv, 'staging');
  assert.equal(metadata.realDelivery.healthCheckPath, '/healthz');
  assert.equal(metadata.realDelivery.requireHealthCommit, true);
  assert.equal(metadata.realDelivery.releaseArtifactCommands.secret, 'npm run secrets:scan');
  assert.equal(metadata.realDelivery.releaseArtifactDir, RELEASE_ARTIFACT_DIR);
  assert.equal(metadata.realDelivery.useExistingReleaseArtifacts, true);
  assert.equal(metadata.realDelivery.candidateProofPath, 'observability/factory-delivery/factory-item-real-delivery-candidate-proof.json');
  assert.equal(metadata.realDelivery.finalEvidencePath, FINAL_EVIDENCE_PATH);
}

function candidateManifestFromQueuedItem(item) {
  return buildFactoryCandidateManifest({
    ciRepository: 'fallback/repository',
    branchName: 'fallback/branch',
    implementationCommitSha: '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210',
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/419',
    prNumber: 419,
    releaseEnv: 'prod',
    deploymentUrl: 'https://fallback.openclaw.app',
    realDeliveryRiskLevel: 'medium',
    realDeliveryProductionSafe: false,
    rollbackPlan: 'Fallback rollback.',
    realDeliveryTestCommands: ['node -e "fallback"'],
  }, item);
}

function assertCandidateManifest(manifest) {
  assert.equal(manifest.source.repository, 'wiinc1/engineering-team');
  assert.equal(manifest.source.branchName, 'factory/release-evidence-refresh');
  assert.equal(manifest.source.commitSha, COMMIT_SHA);
  assert.equal(manifest.source.prUrl, PR_URL);
  assert.equal(manifest.source.prNumber, 418);
  assert.deepEqual(manifest.source.branchProtection, BRANCH_PROTECTION);
  assert.equal(manifest.release.environment, 'staging');
  assert.equal(manifest.release.deploymentUrl, 'https://factory-staging.openclaw.app');
  assert.equal(manifest.release.healthCheckPath, '/healthz');
  assert.equal(manifest.release.requireHealthCommit, true);
  assert.equal(manifest.release.productionSafetyEvidence, PRODUCTION_SAFETY_PATH);
  assert.equal(manifest.risk.level, 'low');
  assert.equal(manifest.risk.productionSafe, true);
  assert.equal(manifest.rollback.verified, true);
  assert.equal(manifest.rollback.evidence, ROLLBACK_EVIDENCE_PATH);
  assert.deepEqual(manifest.tests.commands, [TEST_COMMAND]);
}

test('inline factory submit captures real-delivery candidate metadata', () => {
  assertInlineEntry(buildInlineRequirement(inlineRealDeliveryArgs()));
});

test('postgres factory queue metadata feeds real-delivery candidate manifest', () => {
  const insert = realDeliveryQueueInsert();
  assertQueuedRealDeliveryMetadata(JSON.parse(insert.params[16]));
  assertCandidateManifest(candidateManifestFromQueuedItem(insert.item));
});

test('factory submit summary exposes queued real-delivery proof paths', () => {
  const summary = submittedItemSummary(realDeliveryQueueInsert().item, HOSTED_SUBMIT_CONFIG);
  assert.equal(summary.candidateProofPath, 'observability/factory-delivery/factory-item-real-delivery-candidate-proof.json');
  assert.equal(summary.finalEvidencePath, FINAL_EVIDENCE_PATH);
  assert.equal(summary.releaseArtifactDir, RELEASE_ARTIFACT_DIR);
  assert.equal(summary.useExistingReleaseArtifacts, true);
  assert.equal(summary.realDelivery.requested, true);
  assert.equal(summary.realDelivery.repository, 'wiinc1/engineering-team');
  assert.equal(summary.realDelivery.branchName, 'factory/release-evidence-refresh');
  assert.equal(summary.realDelivery.commitSha, COMMIT_SHA);
  assert.equal(summary.realDelivery.prUrl, PR_URL);
  assert.equal(summary.realDelivery.prNumber, 418);
  assert.equal(summary.realDelivery.autoMerge, true);
  assert.equal(summary.realDelivery.releaseEnv, 'staging');
  assert.equal(summary.realDelivery.deploymentUrl, 'https://factory-staging.openclaw.app');
  assert.equal(summary.realDelivery.rollbackTarget, 'release-previous');
  assert.equal(summary.realDelivery.rollbackVerified, true);
  assert.equal(summary.realDelivery.rollbackEvidenceProvided, true);
  assert.equal(summary.realDelivery.riskLevel, 'low');
  assert.equal(summary.realDelivery.productionSafe, true);
  assert.equal(summary.realDelivery.productionSafetyEvidenceProvided, true);
  assert.equal(summary.realDelivery.healthCheckPath, '/healthz');
  assert.equal(summary.realDelivery.requireHealthCommit, true);
  assert.equal(summary.realDelivery.releaseArtifactDir, RELEASE_ARTIFACT_DIR);
  assert.equal(summary.realDelivery.useExistingReleaseArtifacts, true);
  assert.equal(summary.realDelivery.releaseArtifactCommandsCount, 4);
  assert.equal(summary.realDelivery.checksCount, 1);
  assert.equal(summary.realDelivery.requiredChecksCount, 2);
  assert.equal(summary.realDelivery.branchProtectionProvided, true);
  assert.equal(summary.realDelivery.branchProtectionSource, 'github_branch_protection');
  assert.equal(summary.realDelivery.mergeReadinessProvided, true);
  assert.equal(summary.realDelivery.testCommandsCount, 1);
  assert.equal(summary.realDelivery.preflight.required, true);
  assert.equal(summary.realDelivery.preflight.ok, true);
  assert.deepEqual(summary.realDelivery.preflight.failures, []);
});

test('factory submit summary exposes default proof paths for real-delivery queue items', () => {
  const item = realDeliveryQueueInsert().item;
  const realDelivery = { ...item.metadata.realDelivery };
  delete realDelivery.candidateProofPath;
  delete realDelivery.realDeliveryCandidateProofPath;
  delete realDelivery.finalEvidencePath;
  delete realDelivery.realAutonomousDeliveryEvidencePath;
  delete realDelivery.realDeliveryFinalEvidencePath;
  const summary = submittedItemSummary({
    ...item,
    metadata: { ...item.metadata, realDelivery },
  }, { deliveryDir: 'observability/factory-delivery' });

  assert.equal(
    summary.candidateProofPath,
    `observability/factory-delivery/${item.id}-real-delivery-candidate-proof.json`,
  );
  assert.equal(
    summary.finalEvidencePath,
    `observability/factory-delivery/${item.id}-real-autonomous-delivery-evidence.json`,
  );
  assert.equal(
    summary.realDelivery.candidateProofPath,
    `observability/factory-delivery/${item.id}-real-delivery-candidate-proof.json`,
  );
  assert.equal(
    summary.realDelivery.finalEvidencePath,
    `observability/factory-delivery/${item.id}-real-autonomous-delivery-evidence.json`,
  );
});

test('factory phase runner receives queued branch-protection inventory', () => {
  const options = buildPhaseRunnerOptions({ deliveryDir: 'observability/factory-delivery' }, realDeliveryQueueInsert().item);
  assert.deepEqual(options.requiredChecks, REQUIRED_CHECKS);
  assert.deepEqual(options.branchProtection, BRANCH_PROTECTION);
  assert.equal(options.rollbackEvidence, ROLLBACK_EVIDENCE_PATH);
  assert.equal(options.productionSafetyEvidence, PRODUCTION_SAFETY_PATH);
  assert.equal(options.riskLevel, 'low');
  assert.equal(options.productionSafe, true);
  assert.deepEqual(options.candidateTestCommands, [TEST_COMMAND]);
  assert.equal(options.candidateProofPath, 'observability/factory-delivery/factory-item-real-delivery-candidate-proof.json');
  assert.equal(options.requireHealthCommit, true);
  assert.equal(options.releaseArtifactCommands.build, 'npm run build');
  assert.equal(options.releaseArtifactDir, RELEASE_ARTIFACT_DIR);
  assert.equal(options.useExistingReleaseArtifacts, true);
  assert.equal(factoryCompletionFinalEvidencePath({}, realDeliveryQueueInsert().item), FINAL_EVIDENCE_PATH);
});

test('factory phase runner defaults candidate proof path for real-delivery queue items', () => {
  const item = realDeliveryQueueInsert().item;
  const realDelivery = { ...item.metadata.realDelivery };
  delete realDelivery.candidateProofPath;
  delete realDelivery.realDeliveryCandidateProofPath;
  const options = buildPhaseRunnerOptions(
    { deliveryDir: 'observability/factory-delivery' },
    {
      ...item,
      realDeliveryCandidateProofPath: null,
      metadata: {
        ...item.metadata,
        realDelivery,
      },
    },
  );

  assert.equal(
    options.realDeliveryCandidateProofPath,
    `observability/factory-delivery/${item.id}-real-delivery-candidate-proof.json`,
  );
  assert.equal(options.candidateProofPath, options.realDeliveryCandidateProofPath);
});

test('file queue fallback rejects real-delivery candidate metadata', () => {
  assert.throws(
    () => submitFactoryRequirements([{
      title: 'Refresh release evidence after merge',
      requirements: 'Keep phase 6 release artifacts keyed to the GitHub merge commit.',
      templateTier: 'Standard',
      changeKind: 'bugfix',
      changedFiles: ['lib/task-platform/golden-path-release-evidence-refresh.js'],
      testCommands: [TEST_COMMAND],
      riskLevel: 'low',
      productionSafe: true,
      rollbackPlan: 'Revert the PR and rerun phase 6 evidence collection.',
      deploymentUrl: 'https://factory-staging.openclaw.app',
      releaseEnv: 'staging',
    }], { queueBackend: 'file', allowFileQueue: true, queuePath: 'observability/local-smoke/factory-delivery-queue.json' }),
    /real-delivery items require FACTORY_QUEUE_BACKEND=postgres/,
  );
});

test('postgres submit rejects unready real-delivery items before queue persistence', async () => {
  const calls = [];
  const queueStore = {
    async submit(requirements, config) {
      calls.push({ requirements, config });
      return { queueBackend: 'postgres', queueTable: 'factory_delivery_queue', created: [] };
    },
  };

  await assert.rejects(
    () => submitFactoryRequirementsForQueue([{
      title: 'Incomplete hosted delivery',
      requirements: 'Attempt a real delivery without enough GitHub and release proof.',
      templateTier: 'Standard',
      deploymentUrl: 'https://factory-staging.openclaw.app',
      releaseEnv: 'staging',
      riskLevel: 'low',
      productionSafe: true,
    }], {
      ...HOSTED_SUBMIT_CONFIG,
      queueStore,
      tenantId: 'engineering-team',
    }),
    /Factory delivery item preflight failed: .*actual pull request target.*rollback-target/s,
  );
  assert.equal(calls.length, 0);
});

test('postgres submit persists preflight-ready real-delivery items', async () => {
  const calls = [];
  const queueStore = {
    async submit(requirements, config) {
      calls.push({ requirements, config });
      return {
        queueBackend: 'postgres',
        queueTable: 'factory_delivery_queue',
        created: requirements.map((entry) => ({ ...entry, stage: 'queued' })),
      };
    },
  };

  const result = await submitFactoryRequirementsForQueue(
    [buildInlineRequirement(inlineRealDeliveryArgs())],
    {
      ...HOSTED_SUBMIT_CONFIG,
      queueStore,
      tenantId: 'engineering-team',
    },
  );

  assert.equal(result.created.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requirements[0].metadata.realDelivery.autoMerge, true);
  assert.equal(calls[0].requirements[0].metadata.realDelivery.rollbackTarget, 'release-previous');
});

test('derived postgres idempotency keys include real-delivery proof inputs', () => {
  const base = {
    title: 'Refresh release evidence after merge',
    requirements: 'Keep phase 6 release artifacts keyed to the GitHub merge commit.',
    templateTier: 'Standard',
    changeKind: 'bugfix',
    changedFiles: ['lib/task-platform/golden-path-release-evidence-refresh.js'],
    riskLevel: 'low',
    productionSafe: true,
  };

  const first = buildFactoryQueueInsert({ ...base, testCommands: [TEST_COMMAND] }, 0, { tenantId: 'engineering-team' });
  const retry = buildFactoryQueueInsert({ ...base, testCommands: [TEST_COMMAND] }, 0, { tenantId: 'engineering-team' });
  const differentProof = buildFactoryQueueInsert({ ...base, testCommands: ['node --test tests/unit/other.test.js'] }, 0, { tenantId: 'engineering-team' });

  assert.equal(first.params[2], retry.params[2]);
  assert.notEqual(first.params[2], differentProof.params[2]);
});
