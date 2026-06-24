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
} = require('../../lib/task-platform/factory-delivery');

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