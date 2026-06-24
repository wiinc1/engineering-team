const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAuditApiServer } = require('../../lib/audit/http-projects');
const { SEQUENTIAL_TASK_ID_PATTERN } = require('../../lib/task-platform/task-id');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, claims = {}) {
  return {
    authorization: `Bearer ${sign({
      sub: 'principal-engineer',
      tenant_id: 'tenant-a',
      roles: ['admin'],
      exp: Math.floor(Date.now() / 1000) + 60,
      ...claims,
    }, secret)}`,
  };
}

async function withServer(run, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-id-http-'));
  const secret = 'test-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ baseUrl, secret });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('POST /tasks assigns sequential TSK-NNN ids and increments without reuse', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const headers = {
      'content-type': 'application/json',
      ...authHeaders(secret, { roles: ['contributor'] }),
    };

    const firstResponse = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ raw_requirements: 'First sequential intake draft.' }),
    });
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json();
    assert.match(first.taskId, SEQUENTIAL_TASK_ID_PATTERN);

    const secondResponse = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ raw_requirements: 'Second sequential intake draft.' }),
    });
    assert.equal(secondResponse.status, 201);
    const second = await secondResponse.json();
    assert.match(second.taskId, SEQUENTIAL_TASK_ID_PATTERN);
    assert.notEqual(second.taskId, first.taskId);

    const firstNumber = Number.parseInt(first.taskId.slice(4), 10);
    const secondNumber = Number.parseInt(second.taskId.slice(4), 10);
    assert.equal(secondNumber, firstNumber + 1);
  });
});