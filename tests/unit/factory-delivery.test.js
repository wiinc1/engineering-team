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
  resolveFactoryExecutionPhaseRange,
  summarizeFactoryPersonaProgression,
  assertRequiredFactoryPersonas,
} = require('../../lib/task-platform/factory-delivery');
const { savePilotEvidence } = require('../../lib/task-platform/golden-path-shared');
const { resolveGoldenPathStackPersistDir } = require('../../lib/task-platform/golden-path-phases');
const { persistDirForItem } = require('../../lib/task-platform/factory-delivery-shared');

test('normalizeRequirement requires body text', () => {
  assert.throws(
    () => normalizeRequirement({ title: 'Missing body' }),
    /missing requirements text/,
  );
  const normalized = normalizeRequirement({
    title: 'Add factory queue',
    requirements: 'Queue requirements and advance through SDLC phases.',
  });
  assert.equal(normalized.title, 'Add factory queue');
  assert.equal(normalized.templateTier, 'Simple');
});

test('resolveDeliveryStage maps evidence status to orchestrator stage', () => {
  const item = { stage: 'phase1_complete', taskId: 'TSK-1', projectId: 'PRJ-1' };
  assert.equal(resolveDeliveryStage(item, { status: 'phase6_complete' }), 'completed');
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
  ], { queuePath, deliveryDir: path.join(tmp, 'delivery') });
  assert.equal(result.created.length, 1);
  const queue = loadFactoryQueue(queuePath);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].stage, 'queued');
  assert.equal(queue.items[0].title, 'Req A');
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

test('advanceFactoryItem advances phase1_complete to phase6_complete via injected runPhasesFn', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-phases-'));
  const deliveryDir = path.join(tmp, 'delivery');
  const evidencePath = path.join(deliveryDir, 'factory-phase-stub.json');
  fs.mkdirSync(deliveryDir, { recursive: true });
  savePilotEvidence({
    schemaVersion: '1.0',
    status: 'phase1_complete',
    engineeringTeam: { taskId: 'TSK-STUB1', projectId: 'PRJ-STUB1' },
    phase0: { mode: 'factory_intake', actorId: 'factory-orchestrator' },
    phase1: {
      api: {
        pmRefinementMode: 'refinement_start',
        architectHandoffMode: 'embedded_in_execution_contract',
      },
      architectSpec: { engineerTier: 'Jr' },
    },
  }, evidencePath);

  const { buildEngineerPersonaRouting } = require('../../lib/task-platform/factory-persona-progression');
  const routing = buildEngineerPersonaRouting('Standard');

  const runPhasesFn = async (options) => {
    const evidence = options.pilot;
    evidence.status = 'phase6_complete';
    evidence.engineeringTeam = { ...evidence.engineeringTeam, templateTier: 'Standard' };
    evidence.phase2 = {
      personaRouting: routing,
      personas: { engineer: 'engineer-sr', engineerPersonas: routing.engineerPersonas, forge: 'main' },
    };
    evidence.phase3 = { personas: { qa: 'qa', qaOutcome: 'fail_intentional', engineer: 'engineer-sr' } };
    evidence.phase4 = {
      personas: { engineer: 'engineer-sr', qa: 'qa', qaOutcome: 'pass' },
      api: { qaPass: { ok: true } },
    };
    evidence.phase5 = {
      personas: { sre: 'sre', pm: 'pm', architect: 'architect', qa: 'qa' },
      api: { sreMonitoring: { start: { ok: true }, approve: { ok: true } } },
    };
    evidence.phase6 = {
      personas: { sre: 'sre', human: 'admin' },
      api: { humanClose: { ok: true }, taskClosed: { ok: true } },
    };
    savePilotEvidence(evidence, options.outputPath);
    return { evidence };
  };

  const outcome = await advanceFactoryItem({
    id: 'factory-phase-stub',
    title: 'Stub phases',
    requirements: 'Exercise persona routing.',
    templateTier: 'Standard',
    stage: 'phase1_complete',
    taskId: 'TSK-STUB1',
    projectId: 'PRJ-STUB1',
    evidencePath,
    forgeTaskId: 'TSK-GOLDENSTUB1',
    createdAt: new Date().toISOString(),
  }, {
    jwtSecret: 'factory-test-secret',
    baseUrl: 'http://127.0.0.1:13000',
    deliveryDir,
    runPhasesFn,
    skipForgeSeed: true,
  });

  assert.equal(outcome.action, 'phases_2_6');
  assert.equal(outcome.item.stage, 'phase6_complete');
  const progression = summarizeFactoryPersonaProgression(JSON.parse(fs.readFileSync(evidencePath, 'utf8')));
  const personaCheck = assertRequiredFactoryPersonas(progression);
  assert.equal(personaCheck.ok, true);
  assert.equal(progression.personas.engineer, 'engineer-sr');
  assert.equal(progression.engineerPersonas.principal, 'engineer-principal');
});

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
  });

  assert.equal(outcome.action, 'intake');
  assert.equal(outcome.item.stage, 'intake_complete');
  assert.equal(outcome.item.taskId, 'TSK-FACTORY1');
  assert.ok(calls.some((entry) => entry.url.includes('/api/v1/projects')));
  assert.ok(fs.existsSync(path.join(tmp, 'delivery', 'factory-test-1.json')));
});