const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeOutboxEvent,
  resolveForgeLifecycleTaskId,
  handleEtForgeDispatchEvent,
  createCombinedOutboxPublisher,
} = require('../../lib/task-platform/et-forge-dispatch-bridge');

test('normalizeOutboxEvent unwraps nested audit event payloads', () => {
  const normalized = normalizeOutboxEvent({
    event: {
      event_id: 'evt-1',
      task_id: 'TSK-1',
      event_type: 'task.qa_result_recorded',
      payload: { outcome: 'fail', runKind: 'initial' },
    },
  });
  assert.equal(normalized.eventId, 'evt-1');
  assert.equal(normalized.taskId, 'TSK-1');
  assert.equal(normalized.eventType, 'task.qa_result_recorded');
  assert.equal(normalized.payload.outcome, 'fail');
});

test('contract approval routes to forge start when execution-ready', async () => {
  const calls = [];
  const config = {
    enabled: true,
    forgeAdapterBaseUrl: 'http://forge.local',
    engineeringTeamBaseUrl: 'http://et.local',
    forgeAdapterToken: 'fa-token',
    forgeServiceToken: 'et-token',
    lifecycleTaskId: null,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      if (url.endsWith('/forge-execution-readiness')) {
        return { ok: true, status: 200, json: async () => ({ taskId: 'TSK-GOLDEN001' }) };
      }
      if (url.endsWith('/start')) {
        return { ok: true, status: 202, json: async () => ({ jobId: 'job_0001' }) };
      }
      throw new Error(`unexpected url ${url}`);
    },
  };

  const result = await handleEtForgeDispatchEvent({
    event_type: 'task.execution_contract_approved',
    task_id: 'TSK-GOLDEN001',
    payload: { version: 1 },
  }, config);

  assert.equal(result.handled, true);
  assert.equal(result.bridge, 'contract_approved_to_forge_start');
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /forge-execution-readiness$/);
  assert.match(calls[1].url, /\/tasks\/TSK-GOLDEN001\/start$/);
});

test('initial QA fail routes to forge resume with lifecycle task override', async () => {
  const calls = [];
  const config = {
    enabled: true,
    forgeAdapterBaseUrl: 'http://forge.local',
    engineeringTeamBaseUrl: 'http://et.local',
    forgeAdapterToken: 'fa-token',
    forgeServiceToken: 'et-token',
    lifecycleTaskId: 'TSK-GOLDEN001',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      if (url.endsWith('/resume')) {
        return { ok: true, status: 202, json: async () => ({ jobId: 'job_0004' }) };
      }
      throw new Error(`unexpected url ${url}`);
    },
  };

  const result = await handleEtForgeDispatchEvent({
    event_type: 'task.qa_result_recorded',
    task_id: 'TSK-D54F1849',
    payload: { outcome: 'fail', run_kind: 'initial' },
  }, config);

  assert.equal(result.handled, true);
  assert.equal(result.bridge, 'qa_fail_to_forge_resume');
  assert.equal(result.taskId, 'TSK-GOLDEN001');
  assert.equal(resolveForgeLifecycleTaskId(config, 'TSK-D54F1849'), 'TSK-GOLDEN001');
  assert.match(calls[0].url, /\/tasks\/TSK-GOLDEN001\/resume$/);
});

test('combined outbox publisher invokes forge dispatch before external webhook', async () => {
  const order = [];
  const forgePublisher = async () => { order.push('forge'); };
  const webhookPublisher = async () => { order.push('webhook'); };
  const combined = createCombinedOutboxPublisher([forgePublisher, webhookPublisher]);
  await combined({ event_type: 'task.created', task_id: 'TSK-1' });
  assert.deepEqual(order, ['forge', 'webhook']);
});