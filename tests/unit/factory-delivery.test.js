const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeRequirement,
  resolveDeliveryStage,
  submitFactoryRequirements,
  loadFactoryQueue,
  advanceFactoryItem,
  runFactoryOrchestratorTick,
  resolveFactoryExecutionPhaseRange,
  assertFactoryItemRealEvidencePreflight,
} = require('../../lib/task-platform/factory-delivery');
const { resolveGoldenPathStackPersistDir } = require('../../lib/task-platform/golden-path-phases');
const { persistDirForItem, resolveFactoryConfig } = require('../../lib/task-platform/factory-delivery-shared');
const { writeIntakeEvidence } = require('../../lib/task-platform/factory-intake');
const { buildInlineRequirement } = require('../../scripts/submit-factory-requirements');

test('resolveFactoryConfig defaults to live delegation and validation enabled', () => {
  const previousBackend = process.env.FACTORY_QUEUE_BACKEND;
  delete process.env.FACTORY_QUEUE_BACKEND;
  try {
    const config = resolveFactoryConfig({});
    assert.equal(config.requireDelegationSmoke, true);
    assert.equal(config.skipValidation, false);
    assert.equal(config.queueBackend, 'postgres');
    assert.throws(
      () => resolveFactoryConfig({ queueBackend: 'file' }),
      /FACTORY_ALLOW_FILE_QUEUE=true/,
    );
    const skipped = resolveFactoryConfig({
      skipDelegationSmoke: true,
      skipValidation: true,
      queueBackend: 'file',
      allowFileQueue: true, queuePath: path.join(os.tmpdir(), 'factory-config-file-queue.json'),
    });
    assert.equal(skipped.requireDelegationSmoke, false);
    assert.equal(skipped.skipValidation, true);
    assert.equal(skipped.queueBackend, 'file');
    assert.throws(
      () => resolveFactoryConfig({ queueBackend: 'memory' }),
      /Unsupported FACTORY_QUEUE_BACKEND/,
    );
  } finally {
    if (previousBackend == null) delete process.env.FACTORY_QUEUE_BACKEND;
    else process.env.FACTORY_QUEUE_BACKEND = previousBackend;
  }
});

test('resolveFactoryConfig fails closed on invalid durable queue numeric settings', () => {
  assert.throws(
    () => resolveFactoryConfig({ factoryQueueLeaseSeconds: 0 }),
    /factoryQueueLeaseSeconds must be a positive integer/,
  );
  assert.throws(
    () => resolveFactoryConfig({ factoryQueueRetryBaseSeconds: -1 }),
    /factoryQueueRetryBaseSeconds must be a positive integer/,
  );
  assert.throws(
    () => resolveFactoryConfig({ factoryQueueMaxAttempts: Number.NaN }),
    /factoryQueueMaxAttempts must be a positive integer/,
  );

  const config = resolveFactoryConfig({
    factoryQueueLeaseSeconds: 60,
    factoryQueueRetryBaseSeconds: 10,
    factoryQueueMaxAttempts: 2,
  });
  assert.equal(config.factoryQueueLeaseSeconds, 60);
  assert.equal(config.factoryQueueRetryBaseSeconds, 10);
  assert.equal(config.factoryQueueMaxAttempts, 2);
});

test('resolveFactoryConfig makes factory real-evidence collection strict', () => {
  const previousCollect = process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE;
  const previousRequire = process.env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE;
  const previousAgentDriven = process.env.FF_FACTORY_AGENT_DRIVEN_PHASES;
  try {
    delete process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE;
    delete process.env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE;
    delete process.env.FF_FACTORY_AGENT_DRIVEN_PHASES;

    const collected = resolveFactoryConfig({
      queueBackend: 'postgres',
      collectRealEvidence: true,
    });
    assert.equal(collected.collectRealEvidence, true);
    assert.equal(collected.requireRealEvidence, true);
    assert.throws(
      () => resolveFactoryConfig({ queueBackend: 'file', allowFileQueue: true, collectRealEvidence: true }),
      /real-evidence runs require FACTORY_QUEUE_BACKEND=postgres/,
    );

    const agentDriven = resolveFactoryConfig({
      queueBackend: 'postgres',
      agentDrivenPhases: true,
    });
    assert.equal(agentDriven.collectRealEvidence, true);
    assert.equal(agentDriven.requireRealEvidence, true);

    process.env.FF_FACTORY_AGENT_DRIVEN_PHASES = 'true';
    const envAgentDriven = resolveFactoryConfig({ queueBackend: 'postgres' });
    assert.equal(envAgentDriven.collectRealEvidence, true);
    assert.equal(envAgentDriven.requireRealEvidence, true);
    delete process.env.FF_FACTORY_AGENT_DRIVEN_PHASES;

    process.env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE = 'true';
    const required = resolveFactoryConfig({ queueBackend: 'postgres' });
    assert.equal(required.collectRealEvidence, false);
    assert.equal(required.requireRealEvidence, true);
  } finally {
    if (previousCollect == null) delete process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE;
    else process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE = previousCollect;
    if (previousRequire == null) delete process.env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE;
    else process.env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE = previousRequire;
    if (previousAgentDriven == null) delete process.env.FF_FACTORY_AGENT_DRIVEN_PHASES;
    else process.env.FF_FACTORY_AGENT_DRIVEN_PHASES = previousAgentDriven;
  }
});

test('resolveFactoryConfig carries real PR target evidence for strict factory runs', () => {
  const config = resolveFactoryConfig({
    queueBackend: 'postgres',
    collectRealEvidence: true,
    ciRepository: 'wiinc1/engineering-team',
    branchName: 'factory/real-change',
    implementationCommitSha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/312',
    prNumber: 312,
    fixCommitSha: '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210',
    mergeCommitSha: '5a7e3c9d1b2f4a6c8e0d3b5f7a9c1e2d4f678901',
  });

  assert.equal(config.requireRealEvidence, true);
  assert.equal(config.ciRepository, 'wiinc1/engineering-team');
  assert.equal(config.branchName, 'factory/real-change');
  assert.equal(config.implementationCommitSha, '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd');
  assert.equal(config.prUrl, 'https://github.com/wiinc1/engineering-team/pull/312');
  assert.equal(config.prNumber, 312);
  assert.equal(config.fixCommitSha, '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210');
  assert.equal(config.mergeCommitSha, '5a7e3c9d1b2f4a6c8e0d3b5f7a9c1e2d4f678901');
});

function realDeliveryPreflightItem(overrides = {}) {
  const realDelivery = {
    ciRepository: 'wiinc1/engineering-team',
    branchName: 'factory/real-row',
    implementationCommitSha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/312',
    prNumber: 312,
    autoMerge: true,
    releaseEnv: 'staging',
    deploymentUrl: 'https://factory-staging.engineering-team.io',
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    rollbackEvidence: 'observability/release/rollback-verification.json',
    candidateProofPath: 'observability/factory-delivery/factory-real-row-candidate-proof.json',
    riskLevel: 'low',
    productionSafe: true,
    productionSafetyEvidence: 'observability/release/production-safety.json',
    testCommands: ['node --test tests/unit/factory-delivery.test.js'],
    healthCheckPath: '/version',
    requireHealthCommit: true,
    releaseArtifactCommands: {
      build: 'npm run build',
      compatibility: 'npm run test:unit',
      vulnerability: 'npm audit --audit-level=high',
      secret: 'npm run secrets:scan',
    },
    ...(overrides.realDelivery || {}),
  };
  return {
    id: 'factory-real-row',
    title: 'Row-level real delivery',
    requirements: 'Run a real low-risk code change from durable queue metadata.',
    templateTier: 'Standard',
    changeKind: 'bugfix',
    changedFiles: ['lib/task-platform/factory-delivery.js'],
    ...(overrides.item || {}),
    metadata: { realDelivery },
  };
}

test('factory real-evidence preflight uses item metadata as authoritative proof inputs', () => {
  const config = resolveFactoryConfig({
    queueBackend: 'postgres',
    collectRealEvidence: true,
    baseUrl: 'https://api.factory.openclaw.app',
    operatorUrl: 'https://operator.factory.openclaw.app',
    forgeAdapterUrl: 'https://forgeadapter.factory.openclaw.app',
    githubToken: 'test-github-token',
  });
  const item = realDeliveryPreflightItem();

  assert.doesNotThrow(() => assertFactoryItemRealEvidencePreflight(config, item));
  assert.throws(
    () => assertFactoryItemRealEvidencePreflight(config, { ...item, metadata: {} }),
    /Factory delivery item preflight failed: .*actual pull request target.*rollback-target/s,
  );
});

test('normalizeRequirement requires body text', () => {
  assert.throws(
    () => normalizeRequirement({ title: 'Missing body' }),
    /missing requirements text/,
  );
  const normalized = normalizeRequirement({
    title: 'Add factory queue',
    requirements: 'Queue requirements and advance through SDLC phases.',
    changeKind: 'bugfix',
    changedFiles: ['lib/task-platform/factory-delivery.js'],
  });
  assert.equal(normalized.title, 'Add factory queue');
  assert.equal(normalized.templateTier, 'Simple');
  assert.equal(normalized.changeKind, 'bugfix');
  assert.deepEqual(normalized.changedFiles, ['lib/task-platform/factory-delivery.js']);
});

test('factory submit inline arguments carry code-change scope metadata', () => {
  const entry = buildInlineRequirement([
    'node',
    'scripts/submit-factory-requirements.js',
    '--title',
    'Low-risk code change',
    '--requirements',
    'Add focused unit coverage for factory submit scope handling.',
    '--change-kind',
    'bugfix',
    '--changed-file',
    'scripts/submit-factory-requirements.js',
    '--changed-files',
    'tests/unit/factory-delivery.test.js,docs/runbooks/golden-path-autonomous-delivery.md',
  ]);

  assert.equal(entry.templateTier, 'Standard');
  assert.equal(entry.changeKind, 'bugfix');
  assert.deepEqual(entry.changedFiles, [
    'scripts/submit-factory-requirements.js',
    'tests/unit/factory-delivery.test.js',
    'docs/runbooks/golden-path-autonomous-delivery.md',
  ]);
});

test('resolveDeliveryStage maps evidence status to orchestrator stage', () => {
  const item = { stage: 'phase1_complete', taskId: 'TSK-1', projectId: 'PRJ-1' };
  assert.equal(resolveDeliveryStage(item, { status: 'phase6_complete' }), 'phase6_complete');
  assert.equal(resolveDeliveryStage({ stage: 'completed' }, { status: 'phase6_complete' }), 'completed');
  assert.equal(resolveDeliveryStage({ stage: 'queued' }), 'queued');
  assert.equal(resolveDeliveryStage({ stage: 'queued', taskId: 'TSK-1', projectId: 'PRJ-1' }), 'intake_complete');
});

test('resolveFactoryExecutionPhaseRange resumes at phase6 after phase5 evidence', () => {
  const range = resolveFactoryExecutionPhaseRange({ status: 'phase5_complete' });
  assert.equal(range.fromPhase, 6);
  assert.equal(range.toPhase, 6);
  assert.equal(range.resumePhase6Only, true);
  const full = resolveFactoryExecutionPhaseRange({ status: 'phase1_complete' });
  assert.equal(full.fromPhase, 2);
  assert.equal(full.resumePhase6Only, false);
});

test('factory stack persistDir resolves before path.join forge seed', () => {
  const item = { id: 'factory-persist-test', taskId: 'TSK-PERSIST' };
  const deliveryDir = 'observability/factory-delivery';
  const stackPersistDir = persistDirForItem(item, deliveryDir);
  const resolved = resolveGoldenPathStackPersistDir(
    { persistDir: null },
    { phase0: { persistDir: stackPersistDir } },
    { persistDir: null, stackPersistDir },
  );
  assert.equal(resolved, path.resolve(process.cwd(), stackPersistDir));
});

test('submitFactoryRequirements appends queue entries', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-queue-'));
  const queuePath = path.join(tmp, 'queue.json');
  const result = submitFactoryRequirements([
    { title: 'Req A', requirements: 'Build orchestrator intake.' },
  ], {
    queuePath,
    queueBackend: 'file',
    allowFileQueue: true,
    deliveryDir: path.join(tmp, 'delivery'),
  });
  assert.equal(result.created.length, 1);
  const queue = loadFactoryQueue(queuePath);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].stage, 'queued');
  assert.equal(queue.items[0].title, 'Req A');
});

test('submitFactoryRequirements preserves code-change scope metadata on queued entries', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-queue-scope-'));
  const queuePath = path.join(tmp, 'queue.json');
  submitFactoryRequirements([
    {
      title: 'Req A',
      requirements: 'Build low-risk code path.',
      templateTier: 'Standard',
      changeKind: 'bugfix',
      changedFiles: ['lib/task-platform/factory-delivery.js'],
    },
  ], {
    queuePath,
    queueBackend: 'file',
    allowFileQueue: true,
    deliveryDir: path.join(tmp, 'delivery'),
  });
  const queue = loadFactoryQueue(queuePath);
  assert.equal(queue.items[0].templateTier, 'Standard');
  assert.equal(queue.items[0].changeKind, 'bugfix');
  assert.deepEqual(queue.items[0].changedFiles, ['lib/task-platform/factory-delivery.js']);
});

test('writeIntakeEvidence persists code-change scope for real proof validation', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-intake-scope-'));
  const item = {
    id: 'factory-scope',
    title: 'Scoped intake',
    requirements: 'Build low-risk code path.',
    templateTier: 'Standard',
    changeKind: 'bugfix',
    changedFiles: ['lib/task-platform/factory-delivery.js'],
    forgeTaskId: 'TSK-GOLDENSCOPE',
    createdAt: '2026-07-04T00:00:00.000Z',
  };
  const paths = writeIntakeEvidence({
    deliveryDir: path.join(tmp, 'delivery'),
    baseUrl: 'http://127.0.0.1:13000',
    tenantId: 'engineering-team',
    actorId: 'factory-test',
  }, item, {
    projectId: 'PRJ-SCOPE',
    taskId: 'TSK-SCOPE',
    projectName: 'Factory scope',
  });
  const evidence = JSON.parse(fs.readFileSync(paths.evidencePath, 'utf8'));
  assert.equal(evidence.engineeringTeam.changeKind, 'bugfix');
  assert.deepEqual(evidence.engineeringTeam.changedFiles, ['lib/task-platform/factory-delivery.js']);
  assert.deepEqual(evidence.change, {
    kind: 'bugfix',
    changedFiles: ['lib/task-platform/factory-delivery.js'],
  });
});

test('golden-path stack wires optional factory orchestrator process', () => {
  const stack = fs.readFileSync(
    path.join(__dirname, '../../scripts/dev-golden-path/stack.js'),
    'utf8',
  );
  assert.match(stack, /FF_FACTORY_ORCHESTRATOR_ENABLED/);
  assert.match(stack, /factory-orchestrator/);
});

function createFactoryIntakeFetchMock(calls) {
  return async function factoryIntakeFetch(url, options = {}) {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).endsWith('/api/v1/projects') && options.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ data: { projectId: 'PRJ-FACTORY1' } }) };
    }
    if (String(url).endsWith('/api/v1/tasks') && options.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ data: { taskId: 'TSK-FACTORY1', version: 1 } }) };
    }
    if (String(url).includes('/owner') && options.method === 'PATCH') {
      return { ok: true, status: 200, json: async () => ({ data: { taskId: 'TSK-FACTORY1', version: 2 } }) };
    }
    if (String(url).includes('/project') && options.method === 'PATCH') {
      return { ok: true, status: 200, json: async () => ({ data: { taskId: 'TSK-FACTORY1', version: 3 } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test('advanceFactoryItem performs factory intake against API', async () => {
  const calls = [];
  const fetchImpl = createFactoryIntakeFetchMock(calls);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-advance-'));
  const outcome = await advanceFactoryItem({
    id: 'factory-test-1',
    title: 'Factory intake',
    requirements: 'Create task and evidence for orchestrator.',
    templateTier: 'Simple',
    stage: 'queued',
    createdAt: new Date().toISOString(),
  }, {
    fetchImpl,
    jwtSecret: 'factory-test-secret',
    baseUrl: 'http://127.0.0.1:13000',
    deliveryDir: path.join(tmp, 'delivery'),
    skipPilotAgentsSeed: true,
  });

  assert.equal(outcome.action, 'intake', outcome.error?.message || outcome.item?.lastError);
  assert.equal(outcome.item.stage, 'intake_complete');
  assert.equal(outcome.item.taskId, 'TSK-FACTORY1');
  assert.ok(calls.some((entry) => entry.url.includes('/api/v1/projects')));
  assert.ok(fs.existsSync(path.join(tmp, 'delivery', 'factory-test-1.json')));
});
