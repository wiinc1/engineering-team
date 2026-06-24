const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeOutboxEvent,
  resolveForgeLifecycleTaskId,
  resolveSubmissionVersion,
  handleEtForgeDispatchEvent,
  createCombinedOutboxPublisher,
} = require('../../lib/task-platform/et-forge-dispatch-bridge');

function createForgeFetchMock(handlers = {}) {
  const calls = [];
  const jobs = new Map();
  let jobCounter = 0;

  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const handler = handlers.match;
    if (handler) {
      const result = handler({ url, init, calls, jobs, jobCounter: () => {
        jobCounter += 1;
        return `job_${String(jobCounter).padStart(4, '0')}`;
      } });
      if (result) return result;
    }
    throw new Error(`unexpected url ${url}`);
  };

  return { fetchImpl, calls, jobs };
}

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

test('resolveSubmissionVersion reads canonical and camelCase payload keys', () => {
  assert.equal(resolveSubmissionVersion({ version: 2 }), 2);
  assert.equal(resolveSubmissionVersion({ submission_version: 3 }), 3);
  assert.equal(resolveSubmissionVersion({}), 0);
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

test('initial QA fail routes to forge QA reject with lifecycle task override', async () => {
  const { fetchImpl, calls } = createForgeFetchMock({
    match: ({ url, init, jobCounter }) => {
      if (url.endsWith('/review-requests/qa') && init.method === 'POST') {
        const jobId = jobCounter();
        return {
          ok: true,
          status: 202,
          json: async () => ({ jobId }),
        };
      }
      if (url.includes('/jobs/job_') && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'succeeded',
            result: { childSessionId: 'sess_qa_child' },
          }),
        };
      }
      if (url.endsWith('/review') && init.method === 'POST') {
        const jobId = jobCounter();
        return {
          ok: true,
          status: 202,
          json: async () => ({ jobId }),
        };
      }
      return null;
    },
  });

  const config = {
    enabled: true,
    forgeAdapterBaseUrl: 'http://forge.local',
    engineeringTeamBaseUrl: 'http://et.local',
    forgeAdapterToken: 'fa-token',
    forgeServiceToken: 'et-token',
    lifecycleTaskId: 'TSK-GOLDEN001',
    jobPollAttempts: 5,
    jobPollIntervalMs: 1,
    fetchImpl,
  };

  const result = await handleEtForgeDispatchEvent({
    event_type: 'task.qa_result_recorded',
    task_id: 'TSK-D54F1849',
    payload: { outcome: 'fail', run_kind: 'initial' },
  }, config);

  assert.equal(result.handled, true);
  assert.equal(result.bridge, 'qa_fail_to_forge_reject');
  assert.equal(result.action, 'qa_reject');
  assert.equal(result.taskId, 'TSK-GOLDEN001');
  assert.equal(resolveForgeLifecycleTaskId(config, 'TSK-D54F1849'), 'TSK-GOLDEN001');
  assert.ok(calls.some((call) => call.url.endsWith('/tasks/TSK-GOLDEN001/review-requests/qa')));
  assert.ok(calls.some((call) => call.url.endsWith('/tasks/TSK-GOLDEN001/review')));
});

test('engineer submission v2 routes to forge resume', async () => {
  const calls = [];
  const config = {
    enabled: true,
    forgeAdapterBaseUrl: 'http://forge.local',
    engineeringTeamBaseUrl: 'http://et.local',
    forgeAdapterToken: 'fa-token',
    forgeServiceToken: 'et-token',
    lifecycleTaskId: 'TSK-GOLDEN001',
    jobPollAttempts: 5,
    jobPollIntervalMs: 1,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      if (url.endsWith('/resume') && init.method === 'POST') {
        return { ok: true, status: 202, json: async () => ({ jobId: 'job_resume' }) };
      }
      if (url.endsWith('/jobs/job_resume')) {
        return { ok: true, status: 200, json: async () => ({ status: 'succeeded' }) };
      }
      throw new Error(`unexpected url ${url}`);
    },
  };

  const result = await handleEtForgeDispatchEvent({
    event_type: 'task.engineer_submission_recorded',
    task_id: 'TSK-D54F1849',
    payload: { version: 2 },
  }, config);

  assert.equal(result.handled, true);
  assert.equal(result.bridge, 'engineer_submission_v2_to_forge_resume');
  assert.match(calls[0].url, /\/tasks\/TSK-GOLDEN001\/resume$/);
});

test('QA retest pass routes to forge closeout and ET close recommendations when JWT configured', async () => {
  const { fetchImpl, calls } = createForgeFetchMock({
    match: ({ url, init, jobCounter }) => {
      if (url.includes('/review-requests/') && init.method === 'POST') {
        const jobId = jobCounter();
        return { ok: true, status: 202, json: async () => ({ jobId }) };
      }
      if (url.includes('/jobs/job_') && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'succeeded',
            result: { childSessionId: 'sess_child' },
          }),
        };
      }
      if (url.endsWith('/review') && init.method === 'POST') {
        const jobId = jobCounter();
        return { ok: true, status: 202, json: async () => ({ jobId }) };
      }
      if (url.endsWith('/complete') && init.method === 'POST') {
        const jobId = jobCounter();
        return { ok: true, status: 202, json: async () => ({ jobId }) };
      }
      if (url.includes('/close-review/cancellation-recommendation') && init.method === 'POST') {
        return { ok: true, status: 202, json: async () => ({ accepted: true }) };
      }
      return null;
    },
  });

  const config = {
    enabled: true,
    forgeAdapterBaseUrl: 'http://forge.local',
    engineeringTeamBaseUrl: 'http://et.local',
    forgeAdapterToken: 'fa-token',
    forgeServiceToken: 'et-token',
    jwtSecret: 'test-jwt-secret',
    tenantId: 'engineering-team',
    actorId: 'bridge-test',
    lifecycleTaskId: 'TSK-GOLDEN001',
    jobPollAttempts: 5,
    jobPollIntervalMs: 1,
    fetchImpl,
  };

  const result = await handleEtForgeDispatchEvent({
    event_type: 'task.qa_result_recorded',
    task_id: 'TSK-D54F1849',
    payload: { outcome: 'pass', run_kind: 'retest' },
  }, config);

  assert.equal(result.handled, true);
  assert.equal(result.bridge, 'qa_retest_pass_to_forge_closeout');
  assert.equal(result.action, 'closeout');
  assert.equal(result.gates.length, 3);
  assert.ok(calls.some((call) => call.url.endsWith('/tasks/TSK-GOLDEN001/complete')));
  assert.equal(calls.filter((call) => call.url.includes('/close-review/cancellation-recommendation')).length, 2);
});

test('combined outbox publisher invokes forge dispatch before external webhook', async () => {
  const order = [];
  const forgePublisher = async () => { order.push('forge'); };
  const webhookPublisher = async () => { order.push('webhook'); };
  const combined = createCombinedOutboxPublisher([forgePublisher, webhookPublisher]);
  await combined({ event_type: 'task.created', task_id: 'TSK-1' });
  assert.deepEqual(order, ['forge', 'webhook']);
});