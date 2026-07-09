const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveStagingRuntime,
  assertStagingRuntimeReady,
} = require('../../lib/task-platform/staging-runtime');

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

function strictRuntimeOptions() {
  return {
    collectRealEvidence: true,
    ciRepository: 'wiinc1/engineering-team',
    branchName: 'factory/strict-evidence',
    implementationCommitSha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/417',
    prNumber: 417,
    checks: STRICT_CHECKS,
    requiredChecks: STRICT_REQUIRED_CHECKS,
    branchProtection: STRICT_BRANCH_PROTECTION,
    mergeReadiness: STRICT_MERGE_READINESS,
    githubEvidenceSource: STRICT_GITHUB_SOURCE,
    deploymentUrl: 'https://factory.example.test',
    candidateProofPath: 'observability/real-delivery-candidate-proof.json',
    finalEvidencePath: 'observability/real-autonomous-delivery-evidence.json',
    healthCheckPath: '/version',
    releaseArtifactCommands: STRICT_RELEASE_COMMANDS,
    releaseArtifactDir: 'observability/release',
    useExistingReleaseArtifacts: true,
    requireHealthCommit: true,
    riskLevel: 'low',
    productionSafe: true,
    testCommands: ['node --test tests/unit/staging-runtime.test.js'],
    rollbackTarget: 'release-previous',
    rollbackPlan: 'Revert the scoped PR and redeploy the previous release.',
    rollbackEvidence: 'observability/release/rollback-verification.json',
    releaseEnv: 'staging',
    changeKind: 'bugfix',
    changedFiles: ['lib/task-platform/staging-runtime.js'],
  };
}

function assertStrictRuntimeIdentity(runtime) {
  assert.equal(runtime.collectRealEvidence, true);
  assert.equal(runtime.requireRealEvidence, true);
  assert.equal(runtime.ciRepository, 'wiinc1/engineering-team');
  assert.equal(runtime.branchName, 'factory/strict-evidence');
  assert.equal(runtime.implementationCommitSha, '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd');
  assert.equal(runtime.prUrl, 'https://github.com/wiinc1/engineering-team/pull/417');
  assert.equal(runtime.prNumber, 417);
}

function assertStrictRuntimeGithubProof(runtime) {
  assert.deepEqual(runtime.checks, STRICT_CHECKS);
  assert.deepEqual(runtime.requiredChecks, STRICT_REQUIRED_CHECKS);
  assert.deepEqual(runtime.branchProtection, STRICT_BRANCH_PROTECTION);
  assert.deepEqual(runtime.mergeReadiness, STRICT_MERGE_READINESS);
  assert.deepEqual(runtime.githubEvidenceSource, STRICT_GITHUB_SOURCE);
}

function assertStrictRuntimeReleaseProof(runtime) {
  assert.equal(runtime.deploymentUrl, 'https://factory.example.test');
  assert.equal(runtime.realDeliveryCandidateProofPath, 'observability/real-delivery-candidate-proof.json');
  assert.equal(runtime.realAutonomousDeliveryEvidencePath, 'observability/real-autonomous-delivery-evidence.json');
  assert.equal(runtime.realDeliveryHealthCheckPath, '/version');
  assert.equal(runtime.releaseArtifactCommands.secret, 'npm run secrets:scan');
  assert.equal(runtime.releaseArtifactDir, 'observability/release');
  assert.equal(runtime.useExistingReleaseArtifacts, true);
  assert.equal(runtime.requireHealthCommit, true);
}

function assertStrictRuntimeRiskAndRollback(runtime) {
  assert.equal(runtime.realDeliveryRiskLevel, 'low');
  assert.equal(runtime.realDeliveryProductionSafe, true);
  assert.deepEqual(runtime.realDeliveryTestCommands, ['node --test tests/unit/staging-runtime.test.js']);
  assert.equal(runtime.rollbackTarget, 'release-previous');
  assert.equal(runtime.rollbackPlan, 'Revert the scoped PR and redeploy the previous release.');
  assert.equal(runtime.rollbackEvidence, 'observability/release/rollback-verification.json');
  assert.equal(runtime.releaseEnv, 'staging');
  assert.equal(runtime.changeKind, 'bugfix');
  assert.deepEqual(runtime.changedFiles, ['lib/task-platform/staging-runtime.js']);
}

test('resolveStagingRuntime prefers STAGING_BASE_URL over local factory default', () => {
  const runtime = resolveStagingRuntime({
    env: undefined,
  });
  const original = process.env.STAGING_BASE_URL;
  process.env.STAGING_BASE_URL = 'https://staging.example';
  try {
    const resolved = resolveStagingRuntime();
    assert.equal(resolved.baseUrl, 'https://staging.example');
    assert.equal(resolved.profile, 'hosted-staging');
    assert.equal(resolved.useVersionedTaskApi, true);
    assert.equal(resolved.skipForgePhases, true);
  } finally {
    if (original == null) delete process.env.STAGING_BASE_URL;
    else process.env.STAGING_BASE_URL = original;
  }
  assert.equal(runtime.profile, 'coordinated-stack');
});

test('resolveStagingRuntime defaults to golden-path local stack endpoints', () => {
  const keys = ['STAGING_BASE_URL', 'AUTH_JWT_SECRET', 'GOLDEN_PATH_JWT_SECRET', 'FACTORY_QUEUE_BACKEND'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    const runtime = resolveStagingRuntime({});
    assert.equal(runtime.baseUrl, 'http://127.0.0.1:13000');
    assert.equal(runtime.forgeAdapterUrl, 'http://127.0.0.1:14010');
    assert.equal(runtime.jwtSecret, 'golden-path-local-dev-secret');
    assert.equal(runtime.useVersionedTaskApi, false);
    assert.equal(runtime.skipValidation, false);
    assert.equal(runtime.queueBackend, 'postgres');
  } finally {
    for (const key of keys) {
      if (saved[key] == null) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test('resolveStagingRuntime gates file queue behind explicit local smoke opt-in', () => {
  const savedBackend = process.env.FACTORY_QUEUE_BACKEND;
  const savedAllow = process.env.FACTORY_ALLOW_FILE_QUEUE;
  delete process.env.FACTORY_QUEUE_BACKEND;
  delete process.env.FACTORY_ALLOW_FILE_QUEUE;
  try {
    assert.throws(
      () => resolveStagingRuntime({ queueBackend: 'file' }),
      /FACTORY_ALLOW_FILE_QUEUE=true/,
    );
    const runtime = resolveStagingRuntime({ queueBackend: 'file', allowFileQueue: true });
    assert.equal(runtime.queueBackend, 'file');
    assert.equal(runtime.allowFileQueue, true);
    assert.throws(
      () => resolveStagingRuntime({ queueBackend: 'memory' }),
      /Unsupported FACTORY_QUEUE_BACKEND/,
    );
  } finally {
    if (savedBackend == null) delete process.env.FACTORY_QUEUE_BACKEND;
    else process.env.FACTORY_QUEUE_BACKEND = savedBackend;
    if (savedAllow == null) delete process.env.FACTORY_ALLOW_FILE_QUEUE;
    else process.env.FACTORY_ALLOW_FILE_QUEUE = savedAllow;
  }
});

test('resolveStagingRuntime carries strict real-evidence options into factory runtime', () => {
  const runtime = resolveStagingRuntime(strictRuntimeOptions());
  assertStrictRuntimeIdentity(runtime);
  assertStrictRuntimeGithubProof(runtime);
  assertStrictRuntimeReleaseProof(runtime);
  assertStrictRuntimeRiskAndRollback(runtime);
});

test('resolveStagingRuntime only skips validation by explicit option or env', () => {
  const original = process.env.STAGING_SKIP_VALIDATION;
  try {
    delete process.env.STAGING_SKIP_VALIDATION;
    assert.equal(resolveStagingRuntime().skipValidation, false);
    assert.equal(resolveStagingRuntime({ skipValidation: true }).skipValidation, true);
    process.env.STAGING_SKIP_VALIDATION = 'true';
    assert.equal(resolveStagingRuntime().skipValidation, true);
  } finally {
    if (original == null) delete process.env.STAGING_SKIP_VALIDATION;
    else process.env.STAGING_SKIP_VALIDATION = original;
  }
});

test('resolveWorkflowRoute maps legacy task paths to /api/v1 on hosted URLs', () => {
  const { resolveWorkflowRoute } = require('../../lib/task-platform/golden-path-shared');
  assert.equal(
    resolveWorkflowRoute('/tasks/TSK-001/events', { useVersionedTaskApi: true }),
    '/api/v1/tasks/TSK-001/events',
  );
  assert.equal(
    resolveWorkflowRoute('/tasks/TSK-001/events', { useVersionedTaskApi: false }),
    '/tasks/TSK-001/events',
  );
});

test('resolveStagingRuntime honors explicit skipValidation false', () => {
  const runtime = resolveStagingRuntime({ skipValidation: false });
  assert.equal(runtime.skipValidation, false);
});

test('assertStagingRuntimeReady fails closed when base URL explicitly cleared', () => {
  assert.throws(
    () => assertStagingRuntimeReady(resolveStagingRuntime({ baseUrl: ' ', jwtSecret: 'secret' })),
    /FACTORY_STACK_BASE_URL/,
  );
});
