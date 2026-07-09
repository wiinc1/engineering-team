const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeOutboxEvent,
  resolveForgeLifecycleTaskId,
  resolveForgeDispatchTaskId,
  resolveSubmissionVersion,
  resolveForgeCloseoutGates,
  resolveForgeReviewChildSessionId,
  maybeCompleteForgeUxReviewGate,
  maybeResumeForgeAfterUxReview,
  handleForgeUxDelegationCompletion,
  handleEtForgeDispatchEvent,
  createCombinedOutboxPublisher,
} = require('../../lib/task-platform/et-forge-dispatch-bridge');

function createUxHandoffFetchMock({
  uxGateStatus = 'required',
  lastAction = null,
  approveOnReview = true,
} = {}) {
  let uxApproved = uxGateStatus === 'approved';
  return createForgeFetchMock({
    match: ({ url, init, jobCounter }) => {
      if (url.endsWith('/runtime') && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastAction,
            reviewGates: [{
              gate: 'ux',
              status: uxApproved ? 'approved' : 'required',
              required: true,
            }],
            reviews: uxApproved
              ? [{ gate: 'ux', status: 'approved', childSessionId: 'child_TSK-001_ux_1' }]
              : [],
            sessions: {
              childSessions: [{ targetAgent: 'ux', childSessionId: 'child_TSK-001_ux_1' }],
            },
          }),
        };
      }
      if (url.endsWith('/review') && init.method === 'POST') {
        if (approveOnReview) uxApproved = true;
        const jobId = jobCounter();
        return { ok: true, status: 202, json: async () => ({ jobId }) };
      }
      if (url.endsWith('/resume') && init.method === 'POST') {
        const jobId = jobCounter();
        return { ok: true, status: 202, json: async () => ({ jobId }) };
      }
      if (url.includes('/jobs/job_') && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'succeeded', result: { childSessionId: 'child_TSK-001_ux_1' } }),
        };
      }
      return null;
    },
  });
}

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
      if (url.includes('/tasks/TSK-D54F1849/runtime') && (!init.method || init.method === 'GET')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (url.includes('/tasks/TSK-GOLDEN001/runtime') && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            executionState: 'running',
            reviewGates: [{ gate: 'qa', status: 'required', required: true }],
          }),
        };
      }
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
  assert.equal(
    await resolveForgeDispatchTaskId(config, 'TSK-D54F1849'),
    'TSK-GOLDEN001',
  );
  assert.ok(calls.some((call) => call.url.endsWith('/tasks/TSK-GOLDEN001/review-requests/qa')));
  assert.ok(calls.some((call) => call.url.endsWith('/tasks/TSK-GOLDEN001/review')));
});

test('resolveForgeDispatchTaskId prefers event task when it owns forge runtime', async () => {
  const config = {
    enabled: true,
    forgeAdapterBaseUrl: 'http://forge.local',
    engineeringTeamBaseUrl: 'http://et.local',
    forgeAdapterToken: 'fa-token',
    forgeServiceToken: 'et-token',
    lifecycleTaskId: 'TSK-GOLDEN001',
    fetchImpl: async (url) => {
      if (url.includes('/tasks/TSK-001/runtime')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            executionState: 'running',
            reviewGates: [{ gate: 'ux', status: 'approved', required: true }],
          }),
        };
      }
      if (url.includes('/tasks/TSK-GOLDEN001/runtime')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            executionState: 'running',
            reviewGates: [{ gate: 'qa', status: 'required', required: true }],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
  };

  assert.equal(await resolveForgeDispatchTaskId(config, 'TSK-001'), 'TSK-001');
});

test('architect engineer assignment routes to forge delegate for the event task id', async () => {
  const { fetchImpl, calls } = createForgeFetchMock({
    match: ({ url, init, jobCounter }) => {
      if (url.endsWith('/forge-execution-readiness') && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            taskId: 'TSK-001',
            projectId: 'engineering-team',
            targetRepo: 'wiinc1/engineering-team',
            affectsUi: true,
            summary: 'UI Update',
            acceptanceCriteria: ['queue-first layout'],
          }),
        };
      }
      if (url.endsWith('/runtime') && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            taskId: 'TSK-001',
            executionState: 'running',
            routedOwner: 'ux',
            sessions: {
              parentSessionId: 'sess_parent_001',
              childSessions: [],
            },
          }),
        };
      }
      if (url.endsWith('/delegate') && init.method === 'POST') {
        const jobId = jobCounter();
        return { ok: true, status: 202, json: async () => ({ jobId }) };
      }
      if (url.includes('/jobs/job_') && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'succeeded',
            result: { childSessionId: 'child_TSK-001_ux_1' },
          }),
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
    event_type: 'task.architect_engineer_assignment_recorded',
    task_id: 'TSK-001',
    payload: { assignee: 'engineer-sr', engineer_tier: 'Sr' },
  }, config);

  assert.equal(result.handled, true);
  assert.equal(result.bridge, 'architect_assignment_to_forge_delegate');
  assert.equal(result.action, 'delegate');
  assert.equal(result.taskId, 'TSK-001');
  assert.equal(result.targetAgent, 'ux');
  assert.ok(calls.some((call) => call.url.endsWith('/tasks/TSK-001/runtime')));
  assert.ok(calls.some((call) => call.url.endsWith('/tasks/TSK-001/delegate')));
  assert.equal(
    calls.filter((call) => call.url.endsWith('/tasks/TSK-GOLDEN001/delegate')).length,
    0,
  );
});

test('resolveForgeCloseoutGates includes ux when task affects UI', () => {
  assert.deepEqual(
    resolveForgeCloseoutGates({ affectsUi: true }, {}),
    ['ux', 'qa', 'architect', 'pm'],
  );
  assert.deepEqual(
    resolveForgeCloseoutGates({}, { reviewGates: [{ gate: 'ux', required: true, status: 'required' }] }),
    ['ux', 'qa', 'architect', 'pm'],
  );
  assert.deepEqual(
    resolveForgeCloseoutGates({}, { reviewGates: [{ gate: 'qa', required: true, status: 'required' }] }),
    ['qa', 'architect', 'pm'],
  );
});

test('resolveForgeReviewChildSessionId prefers delegated ux child session', () => {
  const sessionId = resolveForgeReviewChildSessionId({
    sessions: {
      childSessions: [
        { targetAgent: 'ux', childSessionId: 'child_TSK-001_ux_1' },
      ],
    },
  }, 'ux');
  assert.equal(sessionId, 'child_TSK-001_ux_1');
});

test('maybeCompleteForgeUxReviewGate approves ux gate and chains forge resume', async () => {
  const { fetchImpl, calls } = createUxHandoffFetchMock();

  const config = {
    enabled: true,
    forgeAdapterBaseUrl: 'http://forge.local',
    engineeringTeamBaseUrl: 'http://et.local',
    forgeAdapterToken: 'fa-token',
    forgeServiceToken: 'et-token',
    jobPollAttempts: 5,
    jobPollIntervalMs: 1,
    fetchImpl,
  };

  const previous = process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE;
  process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE = 'true';
  try {
    const result = await maybeCompleteForgeUxReviewGate(config, 'TSK-001');
    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.equal(result.action, 'ux_handoff_complete');
    assert.equal(result.review.gate, 'ux');
    assert.equal(result.review.childSessionId, 'child_TSK-001_ux_1');
    assert.equal(result.resume.action, 'resume');
    assert.ok(calls.some((call) => call.url.endsWith('/tasks/TSK-001/review')));
    assert.ok(calls.some((call) => call.url.endsWith('/tasks/TSK-001/resume')));
    assert.equal(calls.filter((call) => call.url.includes('/review-requests/')).length, 0);
  } finally {
    if (previous == null) delete process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE;
    else process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE = previous;
  }
});

test('maybeResumeForgeAfterUxReview skips when forge already resumed', async () => {
  const { fetchImpl, calls } = createUxHandoffFetchMock({
    uxGateStatus: 'approved',
    lastAction: 'resume',
  });

  const config = {
    enabled: true,
    forgeAdapterBaseUrl: 'http://forge.local',
    engineeringTeamBaseUrl: 'http://et.local',
    forgeAdapterToken: 'fa-token',
    forgeServiceToken: 'et-token',
    jobPollAttempts: 5,
    jobPollIntervalMs: 1,
    fetchImpl,
  };

  const previous = process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE;
  process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE = 'true';
  try {
    const result = await maybeResumeForgeAfterUxReview(config, 'TSK-001');
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'already_resumed');
    assert.equal(calls.filter((call) => call.url.endsWith('/resume')).length, 0);
  } finally {
    if (previous == null) delete process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE;
    else process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE = previous;
  }
});

test('handleForgeUxDelegationCompletion approves ux gate after successful ux delegation', async () => {
  const { fetchImpl } = createUxHandoffFetchMock();

  const previous = {
    enabled: process.env.ET_FORGE_DISPATCH_ENABLED,
    auto: process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE,
    base: process.env.FORGEADAPTER_BASE_URL,
  };
  process.env.ET_FORGE_DISPATCH_ENABLED = 'true';
  process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE = 'true';
  process.env.FORGEADAPTER_BASE_URL = 'http://forge.local';
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const result = await handleForgeUxDelegationCompletion({
      taskId: 'TSK-001',
      targetAgent: 'ux',
      exitCode: 0,
      delegationId: 'delegation-123',
      env: {
        ...process.env,
        FORGEADAPTER_BASE_URL: 'http://forge.local',
        FORGEADAPTER_SERVICE_TOKEN: 'fa-token',
        ET_FORGE_DISPATCH_ENABLED: 'true',
        FORGE_AUTO_COMPLETE_UX_REVIEW_GATE: 'true',
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.action, 'ux_handoff_complete');
    assert.equal(result.resume.action, 'resume');
  } finally {
    globalThis.fetch = previousFetch;
    if (previous.enabled == null) delete process.env.ET_FORGE_DISPATCH_ENABLED;
    else process.env.ET_FORGE_DISPATCH_ENABLED = previous.enabled;
    if (previous.auto == null) delete process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE;
    else process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE = previous.auto;
    if (previous.base == null) delete process.env.FORGEADAPTER_BASE_URL;
    else process.env.FORGEADAPTER_BASE_URL = previous.base;
  }
});

test('architect engineer assignment skips delegate when child session already exists', async () => {
  const calls = [];
  let uxApproved = false;
  const previousAutoUx = process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE;
  process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE = 'true';
  const config = {
    enabled: true,
    forgeAdapterBaseUrl: 'http://forge.local',
    engineeringTeamBaseUrl: 'http://et.local',
    forgeAdapterToken: 'fa-token',
    forgeServiceToken: 'et-token',
    jobPollAttempts: 5,
    jobPollIntervalMs: 1,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      if (url.endsWith('/forge-execution-readiness')) {
        return { ok: true, status: 200, json: async () => ({ taskId: 'TSK-001' }) };
      }
      if (url.endsWith('/runtime')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            executionState: 'running',
            routedOwner: 'ux',
            reviewGates: [{
              gate: 'ux',
              status: uxApproved ? 'approved' : 'required',
              required: true,
            }],
            reviews: uxApproved ? [{ gate: 'ux', status: 'approved' }] : [],
            sessions: {
              parentSessionId: 'sess_parent_001',
              childSessions: [{ targetAgent: 'ux', childSessionId: 'child_existing' }],
            },
          }),
        };
      }
      if (url.endsWith('/review') && init.method === 'POST') {
        uxApproved = true;
        return { ok: true, status: 202, json: async () => ({ jobId: 'job_0001' }) };
      }
      if (url.endsWith('/resume') && init.method === 'POST') {
        return { ok: true, status: 202, json: async () => ({ jobId: 'job_0002' }) };
      }
      if (url.includes('/jobs/job_') && (!init.method || init.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ status: 'succeeded' }) };
      }
      throw new Error(`unexpected url ${url}`);
    },
  };

  try {
    const result = await handleEtForgeDispatchEvent({
      event_type: 'task.architect_engineer_assignment_recorded',
      task_id: 'TSK-001',
      payload: {},
    }, config);

    assert.equal(result.handled, true);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'already_delegated');
    assert.equal(calls.filter((call) => call.url.endsWith('/delegate')).length, 0);
    assert.equal(result.uxReview?.action, 'ux_handoff_complete');
    assert.equal(result.uxReview?.resume?.action, 'resume');
  } finally {
    if (previousAutoUx == null) delete process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE;
    else process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE = previousAutoUx;
  }
});

test('engineer submission v2 routes to forge resume after QA fail', async () => {
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
      if (url.includes('/tasks/TSK-D54F1849/runtime') && (!init.method || init.method === 'GET')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (url.includes('/tasks/TSK-GOLDEN001/runtime') && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            executionState: 'running',
            reviewGates: [{ gate: 'qa', status: 'rejected', required: true }],
            reviews: [{ gate: 'qa', status: 'rejected' }],
          }),
        };
      }
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
  assert.match(calls.find((call) => call.url.endsWith('/resume')).url, /\/tasks\/TSK-GOLDEN001\/resume$/);
});

test('engineer submission v2 skips forge resume before QA fail', async () => {
  const config = {
    enabled: true,
    forgeAdapterBaseUrl: 'http://forge.local',
    engineeringTeamBaseUrl: 'http://et.local',
    forgeAdapterToken: 'fa-token',
    forgeServiceToken: 'et-token',
    lifecycleTaskId: null,
    fetchImpl: async (url) => {
      if (url.includes('/tasks/TSK-001/runtime')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            executionState: 'running',
            reviewGates: [{ gate: 'qa', status: 'required', required: true }],
          }),
        };
      }
      throw new Error(`unexpected url ${url}`);
    },
  };

  const result = await handleEtForgeDispatchEvent({
    event_type: 'task.engineer_submission_recorded',
    task_id: 'TSK-001',
    payload: { version: 2 },
  }, config);

  assert.equal(result.handled, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no_prior_qa_fail');
  assert.equal(result.taskId, 'TSK-001');
});

test('QA retest pass routes to forge closeout and ET close recommendations when JWT configured', async () => {
  const { fetchImpl, calls } = createForgeFetchMock({
    match: ({ url, init, jobCounter }) => {
      if (url.includes('/tasks/TSK-GOLDEN001/forge-execution-readiness') && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ taskId: 'TSK-GOLDEN001', affectsUi: false }),
        };
      }
      if (url.includes('/tasks/TSK-D54F1849/runtime') && (!init.method || init.method === 'GET')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (url.includes('/tasks/TSK-GOLDEN001/runtime') && (!init.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            executionState: 'running',
            reviewGates: [
              { gate: 'qa', status: 'required', required: true },
              { gate: 'architect', status: 'required', required: true },
              { gate: 'pm', status: 'required', required: true },
            ],
          }),
        };
      }
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
  assert.ok(result.gates.length >= 3);
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