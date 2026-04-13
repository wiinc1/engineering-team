const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fixture = require('../fixtures/task-assignment/task-assignment-states.json');
const { createAuditApiServer } = require('../../lib/audit/http');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, roles) {
  return {
    authorization: `Bearer ${sign({ sub: 'assignment-e2e', tenant_id: fixture.tenant_id, roles, exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
  };
}

async function withServer(run, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-assignment-e2e-'));
  const secret = 'task-assignment-e2e-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('e2e: assignment endpoint honors feature readiness, assignment, and smoke checks', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const writeHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, ['contributor']),
    };

    for (const task of fixture.tasks) {
      const response = await fetch(`${baseUrl}/tasks/${task.task_id}/events`, {
        method: 'POST',
        headers: writeHeaders,
        body: JSON.stringify({
          eventType: 'task.created',
          actorType: 'agent',
          idempotencyKey: `create:${task.task_id}`,
          payload: { title: task.title, initial_stage: task.initial_stage, priority: task.priority },
        }),
      });
      assert.equal(response.status, 202);
    }

    let response = await fetch(`${baseUrl}/health/task-assignment`, {
      headers: authHeaders(secret, ['admin']),
    });
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.ok, true);

    response = await fetch(`${baseUrl}/api/internal/smoke-test/task-assignment`, {
      headers: authHeaders(secret, ['admin']),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-ASSIGN-1/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['pm']),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/metrics`, {
      headers: authHeaders(secret, ['admin']),
    });
    const metrics = await response.text();
    assert.match(metrics, /feature_task_assignment_requests_total 1/);
    assert.match(metrics, /feature_task_assignment_business_metric 1/);
  });
});
