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

function authHeaders(secret, payload = {}) {
  return {
    authorization: `Bearer ${sign({ sub: 'platform-user', tenant_id: 'engineering-team', roles: ['admin', 'pm', 'reader'], exp: Math.floor(Date.now() / 1000) + 60, ...payload }, secret)}`,
  };
}

async function withServer(run, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-platform-api-'));
  const secret = 'task-platform-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('supports canonical task platform create/list/get/owner flows with optimistic concurrency', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/api/v1/ai-agents`, {
      headers: authHeaders(secret),
    });
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.ok(payload.data.some((agent) => agent.agentId === 'qa'));

    response = await fetch(`${baseUrl}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['admin'] }),
      },
      body: JSON.stringify({
        title: 'Canonical task',
        description: 'Created through v1 API',
        status: 'BACKLOG',
        priority: 'P1',
      }),
    });
    assert.equal(response.status, 201);
    payload = await response.json();
    const created = payload.data;
    assert.equal(created.version, 1);
    assert.equal(created.owner, null);

    response = await fetch(`${baseUrl}/api/v1/tasks/${created.taskId}`, {
      headers: authHeaders(secret),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/api/v1/tasks/${created.taskId}/owner`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['pm'] }),
      },
      body: JSON.stringify({
        ownerAgentId: 'qa',
        version: 1,
      }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.data.owner.agentId, 'qa');
    assert.equal(payload.data.version, 2);

    response = await fetch(`${baseUrl}/api/v1/tasks/${created.taskId}/owner`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['pm'] }),
      },
      body: JSON.stringify({
        ownerAgentId: null,
        version: 1,
      }),
    });
    assert.equal(response.status, 409);
    payload = await response.json();
    assert.equal(payload.error.code, 'version_conflict');

    response = await fetch(`${baseUrl}/api/v1/tasks`, {
      headers: authHeaders(secret),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.data.length, 1);
    assert.equal(payload.data[0].owner.agentId, 'qa');
  });
});
