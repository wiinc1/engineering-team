const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fixture = require('../fixtures/role-inbox/role-inbox-states.json');
const { createAuditApiServer } = require('../../lib/audit/http');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, roles) {
  return {
    authorization: `Bearer ${sign({ sub: 'e2e-role-inbox', tenant_id: fixture.tenant_id, roles, exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
  };
}

async function withServer(run) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-inbox-e2e-'));
  const secret = 'role-inbox-e2e-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function createTask(baseUrl, secret, task) {
  const response = await fetch(`${baseUrl}/tasks/${task.task_id}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders(secret, fixture.roles.writer),
    },
    body: JSON.stringify({
      eventType: 'task.created',
      actorType: 'agent',
      idempotencyKey: `create:${task.task_id}`,
      payload: { title: task.title, initial_stage: task.initial_stage, priority: task.priority },
    }),
  });
  assert.equal(response.status, 202);
}

async function assignTask(baseUrl, secret, taskId, owner, roles = fixture.roles.manager) {
  return fetch(`${baseUrl}/tasks/${taskId}/assignment`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...authHeaders(secret, roles),
    },
    body: JSON.stringify({ agentId: owner }),
  });
}

test('e2e: canonical owner projection supports role inbox routing semantics', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    for (const task of fixture.tasks) {
      await createTask(baseUrl, secret, task);
      if (task.assigned_owner && task.assigned_owner !== 'ghost') {
        const response = await assignTask(baseUrl, secret, task.task_id, task.assigned_owner);
        assert.equal(response.status, 200);
      }
    }

    let response = await fetch(`${baseUrl}/tasks`, { headers: authHeaders(secret, fixture.roles.reader) });
    assert.equal(response.status, 200);
    let payload = await response.json();

    const all = payload.items;
    const architect = all.filter((item) => item.current_owner === 'architect').map((item) => item.task_id);
    const engineer = all.filter((item) => item.current_owner === 'engineer').map((item) => item.task_id);
    const unassigned = all.filter((item) => item.current_owner === null).map((item) => item.task_id);

    assert.deepEqual(architect, ['TSK-INBOX-1']);
    assert.deepEqual(engineer, ['TSK-INBOX-2']);
    assert.deepEqual(unassigned.sort(), ['TSK-INBOX-3', 'TSK-INBOX-4']);

    response = await assignTask(baseUrl, secret, 'TSK-INBOX-2', fixture.tasks[1].reassigned_owner);
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks`, { headers: authHeaders(secret, fixture.roles.reader) });
    assert.equal(response.status, 200);
    payload = await response.json();

    const moved = payload.items.find((item) => item.task_id === 'TSK-INBOX-2');
    assert.equal(moved.current_owner, 'qa');

    response = await assignTask(baseUrl, secret, 'TSK-INBOX-1', null, fixture.roles.reader);
    assert.equal(response.status, 403);
  });
});
