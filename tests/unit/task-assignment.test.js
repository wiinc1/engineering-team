const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAuditApiServer } = require('../../lib/audit/http');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, roles) {
  return {
    authorization: `Bearer ${sign({ sub: 'assignment-unit', tenant_id: 'tenant-unit', roles, exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
  };
}

async function withServer(run) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-assignment-unit-'));
  const secret = 'task-assignment-unit-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function requestJson(baseUrl, pathName, { secret, roles = ['reader'], method = 'GET', body } = {}) {
  const headers = authHeaders(secret, roles);
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function createWorkflowTask({ baseUrl, secret, taskId, title }) {
  const { response } = await requestJson(baseUrl, `/tasks/${taskId}/events`, {
    secret,
    roles: ['contributor'],
    method: 'POST',
    body: {
      eventType: 'task.created',
      actorType: 'agent',
      idempotencyKey: `create:${taskId}`,
      payload: { title, initial_stage: 'BACKLOG' },
    },
  });
  assert.equal(response.status, 202);
}

async function createAiAgent({ baseUrl, secret, agent }) {
  const { response, body } = await requestJson(baseUrl, '/api/v1/ai-agents', {
    secret,
    roles: ['pm'],
    method: 'POST',
    body: agent,
  });
  assert.equal(response.status, 201);
  return body.data;
}

async function updateAiAgent({ baseUrl, secret, agentId, patch }) {
  const { response, body } = await requestJson(baseUrl, `/api/v1/ai-agents/${agentId}`, {
    secret,
    roles: ['pm'],
    method: 'PATCH',
    body: patch,
  });
  assert.equal(response.status, 200);
  return body.data;
}

async function listCompatAgents({ baseUrl, secret }) {
  const { response, body } = await requestJson(baseUrl, '/ai-agents', { secret });
  assert.equal(response.status, 200);
  return body.items;
}

async function assignCompatAgent({ baseUrl, secret, taskId, agentId }) {
  return requestJson(baseUrl, `/tasks/${taskId}/assignment`, {
    secret,
    roles: ['pm'],
    method: 'PATCH',
    body: { agentId },
  });
}

test('unit: assignment validation rejects non-string agent ids with standardized validation errors', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    await createWorkflowTask({
      baseUrl,
      secret,
      taskId: 'TSK-UNIT-ASSIGN',
      title: 'Unit assignment task',
    });

    const { response, body } = await requestJson(baseUrl, '/tasks/TSK-UNIT-ASSIGN/assignment', {
      secret,
      roles: ['pm'],
      method: 'PATCH',
      body: { agentId: 7 },
    });
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'validation_error');
    assert.ok(body.error.details.errors.length > 0);
  });
});

test('unit: legacy assignment route accepts operator-created persisted AI agents', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    await createAiAgent({
      baseUrl,
      secret,
      agent: {
        agentId: 'qa-operator',
        displayName: 'Operator QA',
        role: 'qa',
        executionKind: 'software-factory',
        environmentScope: 'nightly',
      },
    });

    await createWorkflowTask({
      baseUrl,
      secret,
      taskId: 'TSK-UNIT-PERSISTED-AGENT',
      title: 'Persisted agent assignment task',
    });

    const agents = await listCompatAgents({ baseUrl, secret });
    assert.ok(agents.some((agent) => agent.id === 'qa-operator'));

    const { response, body } = await assignCompatAgent({
      baseUrl,
      secret,
      taskId: 'TSK-UNIT-PERSISTED-AGENT',
      agentId: 'qa-operator',
    });
    assert.equal(response.status, 200);
    assert.equal(body.data.owner.agentId, 'qa-operator');
    assert.equal(body.data.owner.displayName, 'Operator QA');
    assert.equal(body.data.owner.role, 'qa');
  });
});

test('unit: legacy assignment route rejects inactive persisted AI agents', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    await createAiAgent({
      baseUrl,
      secret,
      agent: {
        agentId: 'qa-paused',
        displayName: 'Paused QA',
        role: 'qa',
        active: false,
        assignable: true,
      },
    });

    await createWorkflowTask({
      baseUrl,
      secret,
      taskId: 'TSK-UNIT-INACTIVE-AGENT',
      title: 'Inactive agent assignment task',
    });

    const agents = await listCompatAgents({ baseUrl, secret });
    assert.equal(agents.some((agent) => agent.id === 'qa-paused'), false);

    const { response, body } = await assignCompatAgent({
      baseUrl,
      secret,
      taskId: 'TSK-UNIT-INACTIVE-AGENT',
      agentId: 'qa-paused',
    });
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'inactive_agent');
  });
});

test('unit: persisted AI agents take precedence over seeded defaults with the same id', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const updatedAgent = await updateAiAgent({
      baseUrl,
      secret,
      agentId: 'qa',
      patch: {
        version: 1,
        displayName: 'Operator Managed QA',
        assignable: false,
      },
    });
    assert.equal(updatedAgent.agentId, 'qa');
    assert.equal(updatedAgent.displayName, 'Operator Managed QA');
    assert.equal(updatedAgent.assignable, false);

    const { response, body } = await requestJson(baseUrl, '/api/v1/ai-agents?includeInactive=true', {
      secret,
    });
    assert.equal(response.status, 200);
    const persistedQa = body.data.find((agent) => agent.agentId === 'qa');
    assert.equal(persistedQa.displayName, 'Operator Managed QA');
    assert.equal(persistedQa.assignable, false);

    const agents = await listCompatAgents({ baseUrl, secret });
    assert.equal(agents.some((agent) => agent.id === 'qa'), false);
  });
});
