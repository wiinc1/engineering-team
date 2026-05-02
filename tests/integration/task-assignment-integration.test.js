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
    authorization: `Bearer ${sign({ sub: 'assignment-integration', tenant_id: 'tenant-assignment-int', roles, exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
  };
}

async function withServer(run) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-assignment-int-'));
  const secret = 'task-assignment-int-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('integration: assignment mutates audit projection and canonical v1 task record together', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/tasks/TSK-INT-ASSIGN/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['contributor']),
      },
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-INT-ASSIGN',
        payload: { title: 'Integrated assignment task', initial_stage: 'BACKLOG', priority: 'P1' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-INT-ASSIGN/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['pm']),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-INT-ASSIGN`, {
      headers: authHeaders(secret, ['reader']),
    });
    const legacy = await response.json();
    assert.equal(legacy.current_owner, 'qa');

    response = await fetch(`${baseUrl}/api/v1/tasks/TSK-INT-ASSIGN`, {
      headers: authHeaders(secret, ['reader']),
    });
    const canonical = await response.json();
    assert.equal(canonical.data.owner.agentId, 'qa');
    assert.equal(canonical.data.status, 'BACKLOG');
  });
});

test('integration: merge readiness reviews stay linked to canonical Task and PR identity', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['admin']),
      },
      body: JSON.stringify({
        title: 'Integrated merge readiness task',
        status: 'READY_FOR_REVIEW',
        priority: 'P1',
      }),
    });
    assert.equal(response.status, 201);
    const task = (await response.json()).data;

    const reviewBody = {
      repository: 'wiinc1/engineering-team',
      pullRequestNumber: 128,
      commitSha: 'abcdef1234567',
      reviewedLogSources: [{ url: 'https://github.com/wiinc1/engineering-team/actions/runs/1' }],
      findings: [],
    };

    response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/merge-readiness-reviews`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['admin']),
      },
      body: JSON.stringify({ ...reviewBody, reviewStatus: 'pending' }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/merge-readiness-reviews`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['admin']),
      },
      body: JSON.stringify({ ...reviewBody, reviewStatus: 'passed' }),
    });
    assert.equal(response.status, 201);
    const replacement = (await response.json()).data;

    response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/merge-readiness-reviews?repository=wiinc1%2Fengineering-team&pullRequestNumber=128&commitSha=abcdef1234567`, {
      headers: authHeaders(secret, ['reader']),
    });
    assert.equal(response.status, 200);
    const current = await response.json();
    assert.equal(current.data.items.length, 1);
    assert.equal(current.data.current.reviewId, replacement.reviewId);
    assert.equal(current.data.current.taskId, task.taskId);
    assert.equal(current.data.current.pullRequestNumber, 128);
    assert.equal(current.data.current.commitSha, 'abcdef1234567');
  });
});
