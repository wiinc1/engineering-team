const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createAuditApiServer } = require('../../lib/audit/http');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, roles, overrides = {}) {
  return {
    authorization: `Bearer ${sign({
      sub: 'v1-workflow-route-test',
      tenant_id: 'tenant-v1-workflow',
      roles,
      exp: Math.floor(Date.now() / 1000) + 60,
      ...overrides,
    }, secret)}`,
  };
}

async function withServer(callback, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-v1-workflow-'));
  const secret = 'audit-v1-workflow-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await callback({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('intake creation auto-starts PM refinement and records runtime evidence', async () => {
  await withServer(assertAutoStartedPmRefinement, {
    pmRefinementDelegateWork: async () => successfulPmRefinementDelegate(),
  });
});

test('explicit PM refinement start records runtime fallback evidence', async () => {
  await withServer(assertManualPmRefinementFallback, {
    specialistDelegationEnabled: false,
  });
});

function simpleSections() {
  return {
    1: 'As an operator, I want the v1 workflow route to accept execution contracts.',
    2: 'Given an intake task, when the v1 workflow route is called, then the contract is recorded.',
    4: 'Run the unit route coverage for the v1 workflow adapter.',
    11: 'Rollback by reverting the adapter route change.',
    12: 'Record route coverage in unit tests.',
    15: 'The v1 route records and approves a Simple execution contract.',
    16: 'Validate through the local audit API server.',
    17: 'Handoff includes the v1 route coverage result.',
  };
}

async function postIntakeTask(baseUrl, secret, body) {
  return fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(secret, ['contributor']) },
    body: JSON.stringify(body),
  });
}

async function getTaskHistory(baseUrl, secret, taskId) {
  const response = await fetch(`${baseUrl}/tasks/${taskId}/history`, {
    headers: authHeaders(secret, ['reader']),
  });
  assert.equal(response.status, 200);
  return response.json();
}

function successfulPmRefinementDelegate() {
  return {
    agentId: 'pm',
    sessionId: 'runtime-session-pm-refinement',
    output: 'PM refinement complete.',
    ownership: { specialistId: 'pm', agentId: 'pm' },
  };
}

function assertCompletedPmRefinement(history) {
  const eventTypes = history.items.map(item => item.event_type);
  assert.ok(eventTypes.includes('task.refinement_started'));
  assert.ok(eventTypes.includes('task.execution_contract_version_recorded'));
  assert.ok(eventTypes.includes('task.refinement_completed'));
  const completed = history.items.find(item => item.event_type === 'task.refinement_completed');
  assert.equal(completed.payload.agent_id, 'pm');
  assert.equal(completed.payload.session_id, 'runtime-session-pm-refinement');
  assert.equal(completed.payload.truthful_runtime_attribution, true);
  assert.match(completed.payload.delegation_artifact_path, /specialist-delegation\.jsonl$/);
}

async function assertAutoStartedPmRefinement({ baseUrl, secret }) {
  const response = await postIntakeTask(baseUrl, secret, {
    title: 'Auto PM refinement intake',
    raw_requirements: 'Refine this operator intake into an Execution Contract.',
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.pmRefinement.status, 'completed');
  assert.equal(created.pmRefinement.agentId, 'pm');
  assert.equal(created.pmRefinement.sessionId, 'runtime-session-pm-refinement');
  assert.equal(created.pmRefinement.contractVersion, 1);
  assert.match(created.pmRefinement.delegationArtifactPath, /specialist-delegation\.jsonl$/);
  assertCompletedPmRefinement(await getTaskHistory(baseUrl, secret, created.taskId));
}

async function createPendingRefinementTask(baseUrl, secret) {
  const eventHeaders = { 'content-type': 'application/json', ...authHeaders(secret, ['contributor']) };
  let response = await fetch(`${baseUrl}/tasks/TSK-REFINEMENT-RETRY/events`, {
    method: 'POST',
    headers: eventHeaders,
    body: JSON.stringify({
      eventType: 'task.created',
      actorType: 'user',
      idempotencyKey: 'create:TSK-REFINEMENT-RETRY',
      payload: {
        title: 'Retry PM refinement',
        raw_requirements: 'Needs PM refinement retry.',
        intake_draft: true,
        initial_stage: 'DRAFT',
        assignee: 'pm',
        waiting_state: 'task_refinement',
        next_required_action: 'PM refinement required',
      },
    }),
  });
  assert.equal(response.status, 202);
  response = await fetch(`${baseUrl}/tasks/TSK-REFINEMENT-RETRY/events`, {
    method: 'POST',
    headers: eventHeaders,
    body: JSON.stringify({
      eventType: 'task.refinement_requested',
      actorType: 'user',
      idempotencyKey: 'refinement-requested:TSK-REFINEMENT-RETRY',
      payload: {
        intake_draft: true,
        raw_requirements: 'Needs PM refinement retry.',
        assignee: 'pm',
        waiting_state: 'task_refinement',
        next_required_action: 'PM refinement required',
      },
    }),
  });
  assert.equal(response.status, 202);
}

async function assertManualPmRefinementFallback({ baseUrl, secret }) {
  await createPendingRefinementTask(baseUrl, secret);
  const response = await fetch(`${baseUrl}/api/v1/tasks/TSK-REFINEMENT-RETRY/refinement/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(secret, ['pm', 'reader']) },
    body: JSON.stringify({ trigger: 'operator_retry' }),
  });
  assert.equal(response.status, 202);
  const started = await response.json();
  assert.equal(started.success, false);
  assert.equal(started.data.status, 'failed');
  assert.equal(started.data.fallbackReason, 'feature_disabled');
  const history = await getTaskHistory(baseUrl, secret, 'TSK-REFINEMENT-RETRY');
  const failed = history.items.find(item => item.event_type === 'task.refinement_failed');
  assert.equal(failed.payload.truthful_runtime_attribution, false);
  assert.equal(failed.payload.delegated, false);
  assert.equal(failed.payload.fallback_reason, 'feature_disabled');
}

test('v1 task workflow routes reach the audit execution-contract handler', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['contributor']) },
      body: JSON.stringify({
        title: 'V1 workflow adapter intake',
        raw_requirements: 'Verify /api/v1 task workflow routes reach the audit handler.',
      }),
    });
    assert.equal(response.status, 201);
    const task = await response.json();

    response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/execution-contract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['pm', 'reader']) },
      body: JSON.stringify({
        templateTier: 'Simple',
        sections: simpleSections(),
        scopeBoundaries: {
          committedRequirements: [
            { id: 'V1-ROUTE-1', text: 'The v1 workflow route records the contract.', sourceSectionId: '2' },
          ],
        },
      }),
    });
    assert.equal(response.status, 201);
    const contract = await response.json();
    assert.equal(contract.data.validation.status, 'valid');

    response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/execution-contract/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['pm', 'reader']) },
      body: JSON.stringify({ approvalNote: 'Route coverage approval.' }),
    });
    assert.equal(response.status, 201);
    const approval = await response.json();
    assert.equal(approval.data.status, 'approved');
  });
});
