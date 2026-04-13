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
    authorization: `Bearer ${sign({ sub: 'assignment-security', tenant_id: 'tenant-assignment-sec', roles, exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
  };
}

async function withServer(run, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-assignment-sec-'));
  const secret = 'task-assignment-sec-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('security: unauthorized and malformed assignment requests never mutate state', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-ASSIGN/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['contributor']),
      },
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-SEC-ASSIGN',
        payload: { title: 'Secure assignment task', initial_stage: 'BACKLOG' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-ASSIGN/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['reader']),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-ASSIGN/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['pm']),
      },
      body: JSON.stringify({ agentId: 42 }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, 'validation_error');

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-ASSIGN`, {
      headers: authHeaders(secret, ['reader']),
    });
    const summary = await response.json();
    assert.equal(summary.current_owner, null);
  });
});
