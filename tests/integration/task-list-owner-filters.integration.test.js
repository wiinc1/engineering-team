const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fixture = require('../fixtures/task-list-owner/task-list-owner-states.json');
const { createAuditApiServer } = require('../../lib/audit/http');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, roles) {
  return {
    authorization: `Bearer ${sign({ sub: 'integration-tester', tenant_id: fixture.tenant_id, roles, exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
  };
}

async function withServer(run) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-list-owner-integration-'));
  const secret = 'task-list-owner-integration-secret';
  const { server } = createAuditApiServer({
    baseDir,
    jwtSecret: secret,
    agentRegistry: fixture.agents,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function seedTasks(baseUrl, secret) {
  const writeHeaders = {
    'content-type': 'application/json',
    ...authHeaders(secret, fixture.roles.writer),
  };

  for (const item of fixture.tasks) {
    let response = await fetch(`${baseUrl}/tasks/${item.task_id}/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: `create:${item.task_id}`,
        payload: { title: item.title, initial_stage: item.initial_stage, priority: item.priority },
      }),
    });
    assert.equal(response.status, 202);

    if (item.assigned_owner) {
      response = await fetch(`${baseUrl}/tasks/${item.task_id}/assignment`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          ...authHeaders(secret, fixture.roles.manager),
        },
        body: JSON.stringify({ agentId: item.assigned_owner }),
      });
      assert.equal(response.status, 200);
    }
  }
}

test('integration: projected task list read surface carries assigned, unassigned, and reassigned owners after refresh', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    await seedTasks(baseUrl, secret);

    let response = await fetch(`${baseUrl}/tasks`, { headers: authHeaders(secret, fixture.roles.reader) });
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.equal(payload.items.length, 3);

    const owned = payload.items.find(item => item.task_id === 'TSK-OWNER-1');
    const unassigned = payload.items.find(item => item.task_id === 'TSK-OWNER-2');
    const reassignedBefore = payload.items.find(item => item.task_id === 'TSK-OWNER-3');

    assert.equal(owned.current_owner, 'qa');
    assert.deepEqual(owned.owner, { actor_id: 'qa', display_name: 'qa' });
    assert.equal(unassigned.current_owner, null);
    assert.equal(unassigned.owner, null);
    assert.equal(reassignedBefore.current_owner, 'engineer');

    response = await fetch(`${baseUrl}/tasks/TSK-OWNER-3/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, fixture.roles.manager),
      },
      body: JSON.stringify({ agentId: fixture.tasks[2].reassigned_owner }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks`, { headers: authHeaders(secret, fixture.roles.reader) });
    assert.equal(response.status, 200);
    payload = await response.json();

    const reassignedAfter = payload.items.find(item => item.task_id === 'TSK-OWNER-3');
    assert.equal(reassignedAfter.current_owner, 'qa');
    assert.deepEqual(reassignedAfter.owner, { actor_id: 'qa', display_name: 'qa' });
  });
});
