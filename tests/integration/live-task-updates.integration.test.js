const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuditApiServer } = require('../../lib/audit/http-projects');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, claims = {}) {
  return {
    authorization: `Bearer ${sign({
      sub: 'live-user',
      tenant_id: 'tenant-live',
      roles: ['reader'],
      exp: Math.floor(Date.now() / 1000) + 60,
      ...claims,
    }, secret)}`,
  };
}

async function withServer(callback, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-task-updates-integration-'));
  const secret = 'live-task-updates-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await callback({ baseUrl: `http://127.0.0.1:${server.address().port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
}

async function json(response) {
  return response.json();
}

async function createTask(baseUrl, secret) {
  const response = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(secret, { roles: ['admin'] }) },
    body: JSON.stringify({
      title: 'Live freshness task',
      description: 'Visible through the update delta endpoint',
      status: 'BACKLOG',
      priority: 'P1',
    }),
  });
  assert.equal(response.status, 201);
  return (await json(response)).data;
}

async function createProject(baseUrl, secret) {
  const response = await fetch(`${baseUrl}/api/v1/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(secret, { roles: ['pm'] }) },
    body: JSON.stringify({ name: 'Live Freshness Launch', status: 'ACTIVE' }),
  });
  assert.equal(response.status, 201);
  return (await json(response)).data;
}

async function attachTask(baseUrl, secret, task, project) {
  const response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/project`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders(secret, { roles: ['pm'] }) },
    body: JSON.stringify({ projectId: project.projectId, version: task.version }),
  });
  assert.equal(response.status, 200);
  return (await json(response)).data;
}

test('live task update endpoint returns cursor deltas for tasks and Project membership changes', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const task = await createTask(baseUrl, secret);

    let response = await fetch(`${baseUrl}/api/v1/tasks/updates`, {
      headers: authHeaders(secret, { roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    let payload = await json(response);
    assert.ok(payload.data.cursor);
    assert.equal(payload.data.updates.some(update => update.entityType === 'task' && update.entityId === task.taskId), true);
    const cursorAfterTask = payload.data.cursor;

    response = await fetch(`${baseUrl}/api/v1/tasks/updates?cursor=${encodeURIComponent(cursorAfterTask)}`, {
      headers: authHeaders(secret, { roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    payload = await json(response);
    assert.equal(payload.data.updates.length, 0);

    const project = await createProject(baseUrl, secret);
    await attachTask(baseUrl, secret, task, project);

    response = await fetch(`${baseUrl}/api/v1/tasks/updates?cursor=${encodeURIComponent(cursorAfterTask)}`, {
      headers: authHeaders(secret, { roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    payload = await json(response);
    const taskUpdate = payload.data.updates.find(update => update.entityType === 'task' && update.entityId === task.taskId);
    const projectUpdate = payload.data.updates.find(update => update.entityType === 'project' && update.entityId === project.projectId);
    assert.ok(taskUpdate);
    assert.equal(taskUpdate.payload.task.project_id, project.projectId);
    assert.ok(projectUpdate);
    assert.equal(projectUpdate.payload.project.name, 'Live Freshness Launch');

    response = await fetch(`${baseUrl}/api/v1/tasks/updates?cursor=not%20a%20cursor!`, {
      headers: authHeaders(secret, { roles: ['reader'] }),
    });
    assert.equal(response.status, 400);
    payload = await json(response);
    assert.equal(payload.error.code, 'invalid_cursor');
    assert.ok(payload.error.request_id);

    response = await fetch(`${baseUrl}/api/v1/tasks/updates`, {
      method: 'POST',
      headers: authHeaders(secret, { roles: ['reader'] }),
    });
    assert.equal(response.status, 405);
  });
});

test('live task update endpoint requires auth and honors the feature flag rollback path', async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/v1/tasks/updates`);
    assert.equal(response.status, 401);
    assert.equal((await json(response)).error.code, 'missing_auth_context');
  });

  await withServer(async ({ baseUrl, secret }) => {
    const response = await fetch(`${baseUrl}/api/v1/tasks/updates`, {
      headers: authHeaders(secret, { roles: ['reader'] }),
    });
    assert.equal(response.status, 503);
    const payload = await json(response);
    assert.equal(payload.error.code, 'feature_disabled');
    assert.equal(payload.error.details.feature, 'ff_live_task_freshness_polling');
  }, { liveTaskUpdatesEnabled: false });
});
