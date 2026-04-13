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
    authorization: `Bearer ${sign({ sub: 'assignment-contract', tenant_id: 'tenant-contract', roles, exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
  };
}

async function withServer(run, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-assignment-contract-'));
  const secret = 'task-assignment-contract-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('task assignment OpenAPI spec documents standardized assignment error payloads and live endpoints', () => {
  const spec = fs.readFileSync(path.join(__dirname, '../../docs/api/task-assignment-openapi.yml'), 'utf8');
  for (const snippet of [
    '/tasks/{taskId}/assignment:',
    'StandardErrorResponse',
    'error_id:',
    'request_id:',
    'requestId:',
    "'503':",
  ]) {
    assert.match(spec, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('task assignment runtime matches the documented success and error envelope shape', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-ASSIGN/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['contributor']),
      },
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-CONTRACT-ASSIGN',
        payload: { title: 'Contract assignment task', initial_stage: 'BACKLOG' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-ASSIGN/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['pm']),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);
    const success = await response.json();
    assert.equal(success.success, true);
    assert.equal(success.data.owner.agentId, 'qa');

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-ASSIGN/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['pm']),
      },
      body: JSON.stringify({ agentId: 'not-real' }),
    });
    assert.equal(response.status, 400);
    const failure = await response.json();
    assert.equal(failure.error.code, 'invalid_agent');
    assert.equal(failure.error.error_id, 'ERR_TASK_ASSIGNMENT_INVALID_AGENT');
    assert.ok(failure.error.request_id);
    assert.ok(failure.error.requestId);
  });
});
