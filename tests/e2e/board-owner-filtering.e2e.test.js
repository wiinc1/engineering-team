const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fixture = require('../fixtures/board-owner/board-owner-states.json');
const { createAuditApiServer } = require('../../lib/audit/http');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, roles, overrides = {}) {
  return {
    authorization: `Bearer ${sign({ sub: 'board-e2e-tester', tenant_id: fixture.tenant_id, roles, exp: Math.floor(Date.now() / 1000) + 60, ...overrides }, secret)}`,
  };
}

async function withServer(run) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-owner-e2e-'));
  const secret = 'board-owner-e2e-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
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

test('e2e: board owner slice keeps owner-bearing projected data stable for board filtering and refresh', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    for (const task of fixture.tasks.slice(0, 3)) {
      await createTask(baseUrl, secret, task);
      if (task.assigned_owner) await assignTask(baseUrl, secret, task.task_id, task.assigned_owner);
    }

    let response = await fetch(`${baseUrl}/tasks`, { headers: authHeaders(secret, fixture.roles.reader) });
    assert.equal(response.status, 200);
    let list = await response.json();
    assert.equal(list.items.length, 3);

    const byStage = new Map(list.items.map(item => [item.task_id, { owner: item.current_owner, stage: item.current_stage }]));
    assert.deepEqual(byStage.get('TSK-BOARD-1'), { owner: 'qa', stage: 'IMPLEMENT' });
    assert.deepEqual(byStage.get('TSK-BOARD-2'), { owner: null, stage: 'TODO' });
    assert.deepEqual(byStage.get('TSK-BOARD-3'), { owner: 'engineer', stage: 'REVIEW' });

    const unassignedOnly = list.items.filter(item => item.current_owner === null);
    assert.deepEqual(unassignedOnly.map(item => item.task_id), ['TSK-BOARD-2']);

    await assignTask(baseUrl, secret, 'TSK-BOARD-3', fixture.tasks.find(task => task.task_id === 'TSK-BOARD-3').reassigned_owner);

    response = await fetch(`${baseUrl}/tasks`, { headers: authHeaders(secret, fixture.roles.reader) });
    assert.equal(response.status, 200);
    list = await response.json();
    const refreshed = list.items.find(item => item.task_id === 'TSK-BOARD-3');
    assert.equal(refreshed.current_owner, 'qa');

    response = await fetch(`${baseUrl}/tasks/TSK-BOARD-1/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, fixture.roles.reader),
      },
      body: JSON.stringify({ agentId: null }),
    });
    assert.equal(response.status, 403);
  });
});
