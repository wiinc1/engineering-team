const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuditApiServer } = require('../../lib/audit/http-projects');
const { createPostgresProjectAdapter } = require('../../lib/task-platform/projects-postgres');

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

function postgresProjectRow(tenantId, projectId) {
  return {
    tenant_id: tenantId,
    project_id: projectId,
    name: 'Production Smoke Project',
    summary: '',
    status: 'ACTIVE',
    owner_actor_id: null,
    version: 1,
    created_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
    archived_at: null,
    metadata: {},
  };
}

function createPostgresProjectPoolFixture({ tenantId, projectId, hydrationParams, checkpointParams }) {
  const client = {
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT status FROM projects')) return { rows: [{ status: 'ACTIVE' }] };
      if (sql.includes('SELECT version FROM tasks')) return { rows: [{ version: 1 }] };
      if (sql.includes('UPDATE tasks SET project_id')) return { rows: [{ version: 2 }] };
      if (sql.includes('INSERT INTO task_sync_checkpoints')) {
        checkpointParams.push(params);
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO project_mutations')) return { rows: [] };
      throw new Error(`Unexpected client query: ${sql}`);
    },
    release() {},
  };
  return {
    async connect() {
      return client;
    },
    async query(sql, params = []) {
      if (sql.includes('LEFT JOIN projects')) {
        hydrationParams.push(params);
        return { rows: [postgresProjectRow(tenantId, projectId)] };
      }
      if (sql.includes('SELECT COUNT(*)::int AS count')) return { rows: [{ count: 1 }] };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  };
}

function createPostgresProjectHydrationAdapter({ pool, taskId }) {
  const service = {
    kind: 'postgres',
    async getTask() {
      return { taskId, title: 'Postgres task', description: '', status: 'BACKLOG', priority: 'P0', version: 2 };
    },
  };
  return createPostgresProjectAdapter(service, { pool }, {
    normalizeProjectId: value => value,
    projectLabel: project => project ? { projectId: project.projectId, name: project.name, status: project.status } : null,
    toProject: record => ({
      projectId: record.project_id,
      name: record.name,
      status: record.status,
      version: Number(record.version || 1),
    }),
  });
}

test('postgres project task updates hydrate the project label with tenant-scoped task lookups', async () => {
  const tenantId = 'tenant-int';
  const taskId = 'TSK-PG-001';
  const projectId = 'PRJ-PG123456';
  const hydrationParams = [];
  const checkpointParams = [];
  const pool = createPostgresProjectPoolFixture({ tenantId, projectId, hydrationParams, checkpointParams });
  const adapter = createPostgresProjectHydrationAdapter({ pool, taskId });

  const updated = await adapter.updateTaskProject({ tenantId, taskId, projectId, version: 1, actorId: 'pm' });

  assert.deepEqual(checkpointParams, [[tenantId, taskId, 2]]);
  assert.deepEqual(hydrationParams, [[tenantId, taskId]]);
  assert.equal(updated.projectId, projectId);
  assert.equal(updated.project.projectId, projectId);
});
