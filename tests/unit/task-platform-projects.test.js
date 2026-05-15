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
      sub: 'project-user',
      tenant_id: 'engineering-team',
      roles: ['reader'],
      exp: Math.floor(Date.now() / 1000) + 60,
      ...claims,
    }, secret)}`,
  };
}

async function withServer(callback, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-platform-projects-'));
  const secret = 'task-platform-projects-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await callback({ baseUrl: `http://127.0.0.1:${server.address().port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function json(response) {
  return response.json();
}

async function createTask(baseUrl, secret) {
  const response = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(secret, { roles: ['admin'] }) },
    body: JSON.stringify({ title: 'Project task', description: 'Attach me', status: 'BACKLOG', priority: 'P1' }),
  });
  assert.equal(response.status, 201);
  return (await json(response)).data;
}

async function createProject(baseUrl, secret) {
  const response = await fetch(`${baseUrl}/api/v1/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(secret, { roles: ['pm'] }) },
    body: JSON.stringify({ name: 'Launch Plan', summary: 'Cross-team task plan', status: 'ACTIVE' }),
  });
  assert.equal(response.status, 201);
  const project = (await json(response)).data;
  assert.match(project.projectId, /^PRJ-[A-Z0-9]{8}$/);
  return project;
}

async function attachTask(baseUrl, secret, task, project) {
  const response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/project`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders(secret, { roles: ['pm'] }) },
    body: JSON.stringify({ projectId: project.projectId, version: task.version }),
  });
  assert.equal(response.status, 200);
  const attached = (await json(response)).data;
  assert.equal(attached.project.projectId, project.projectId);
  assert.equal(attached.version, 2);
}

async function assertProjectDetail(baseUrl, secret, task, project) {
  const response = await fetch(`${baseUrl}/api/v1/projects/${project.projectId}`, {
    headers: authHeaders(secret, { roles: ['reader'] }),
  });
  assert.equal(response.status, 200);
  const detail = (await json(response)).data;
  assert.equal(detail.tasks.length, 1);
  assert.equal(detail.tasks[0].taskId, task.taskId);
}

async function assertTaskListProject(baseUrl, secret, project) {
  const response = await fetch(`${baseUrl}/api/v1/tasks`, { headers: authHeaders(secret, { roles: ['reader'] }) });
  assert.equal(response.status, 200);
  const list = (await json(response)).data;
  assert.equal(list[0].project.projectId, project.projectId);
}

async function updateProject(baseUrl, secret, project) {
  const response = await fetch(`${baseUrl}/api/v1/projects/${project.projectId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders(secret, { roles: ['admin'] }) },
    body: JSON.stringify({ name: 'Launch Plan Updated', version: project.version }),
  });
  assert.equal(response.status, 200);
  assert.equal((await json(response)).data.version, 2);
}

test('projects API supports project CRUD, task membership, and task workspace project labels', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const task = await createTask(baseUrl, secret);
    const project = await createProject(baseUrl, secret);
    await attachTask(baseUrl, secret, task, project);
    await assertProjectDetail(baseUrl, secret, task, project);
    await assertTaskListProject(baseUrl, secret, project);
    await updateProject(baseUrl, secret, project);
  });
});

test('projects API can be disabled with FF_PROJECTS', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const response = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: authHeaders(secret, { roles: ['reader'] }),
    });
    assert.equal(response.status, 503);
    assert.equal((await json(response)).error.code, 'feature_disabled');
  }, { ffProjects: '0' });
});
