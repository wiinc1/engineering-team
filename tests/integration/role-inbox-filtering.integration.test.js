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
    authorization: `Bearer ${sign({ sub: 'integration-role-inbox', tenant_id: fixture.tenant_id, roles, exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
  };
}

async function withServer(run) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-inbox-integration-'));
  const secret = 'role-inbox-integration-secret';
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

async function assignTask(baseUrl, secret, taskId, owner) {
  const response = await fetch(`${baseUrl}/tasks/${taskId}/assignment`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...authHeaders(secret, fixture.roles.manager),
    },
    body: JSON.stringify({ agentId: owner }),
  });
  assert.equal(response.status, 200);
}

test('integration: projected task list supports canonical role inbox filtering after refresh', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    for (const task of fixture.tasks) {
      await createTask(baseUrl, secret, task);
      if (task.assigned_owner && task.assigned_owner !== 'ghost') {
        await assignTask(baseUrl, secret, task.task_id, task.assigned_owner);
      }
    }

    let response = await fetch(`${baseUrl}/tasks`, { headers: authHeaders(secret, fixture.roles.reader) });
    assert.equal(response.status, 200);
    let payload = await response.json();

    const byId = new Map(payload.items.map((item) => [item.task_id, item]));
    assert.equal(byId.get('TSK-INBOX-1').current_owner, 'architect');
    assert.equal(byId.get('TSK-INBOX-2').current_owner, 'engineer');
    assert.equal(byId.get('TSK-INBOX-3').current_owner, null);
    assert.equal(byId.get('TSK-INBOX-4').current_owner, null);

    response = await fetch(`${baseUrl}/tasks/TSK-INBOX-2/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, fixture.roles.manager),
      },
      body: JSON.stringify({ agentId: fixture.tasks[1].reassigned_owner }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks`, { headers: authHeaders(secret, fixture.roles.reader) });
    assert.equal(response.status, 200);
    payload = await response.json();

    const reassigned = payload.items.find((item) => item.task_id === 'TSK-INBOX-2');
    assert.equal(reassigned.current_owner, 'qa');
    assert.deepEqual(reassigned.owner, { actor_id: 'qa', display_name: 'qa' });
  });
});
