const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuditApiServer } = require('../../lib/audit/http-projects');

const RESTRICTED_KEYS = ['activity', 'auditLog', 'comments', 'context', 'orchestration', 'relations', 'telemetry'];

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, claims = {}) {
  return {
    authorization: `Bearer ${sign({
      sub: 'security-user',
      tenant_id: 'tenant-a',
      roles: ['reader'],
      exp: Math.floor(Date.now() / 1000) + 60,
      ...claims,
    }, secret)}`,
  };
}

async function withServer(callback) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-task-updates-security-'));
  const secret = 'live-task-updates-security-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await callback({ baseUrl: `http://127.0.0.1:${server.address().port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
}

async function createTask(baseUrl, secret, tenantId, title) {
  const response = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(secret, { tenant_id: tenantId, roles: ['admin'] }) },
    body: JSON.stringify({ title, description: 'sensitive source detail', status: 'BACKLOG', priority: 'P2' }),
  });
  assert.equal(response.status, 201);
  return (await response.json()).data;
}

test('live task updates stay tenant-scoped and omit restricted detail fields', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const taskA = await createTask(baseUrl, secret, 'tenant-a', 'Tenant A task');
    const taskB = await createTask(baseUrl, secret, 'tenant-b', 'Tenant B task');

    let response = await fetch(`${baseUrl}/api/v1/tasks/updates`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-b', roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.equal(payload.data.updates.some(update => update.tenantId === 'tenant-a'), false);
    assert.equal(payload.data.updates.some(update => update.payload?.task?.title === 'Tenant A task'), false);
    assert.equal(payload.data.updates.some(update => update.entityId === taskB.taskId && update.tenantId === 'tenant-b'), true);
    assert.equal(payload.data.updates.every(update => update.payload?.task?.tenant_id === 'tenant-b' || update.entityType !== 'task'), true);

    response = await fetch(`${baseUrl}/api/v1/tasks/updates`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['stakeholder'] }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    const taskUpdate = payload.data.updates.find(update => update.entityId === taskA.taskId && update.tenantId === 'tenant-a');
    assert.ok(taskUpdate);
    for (const key of RESTRICTED_KEYS) {
      assert.equal(Object.hasOwn(taskUpdate.payload, key), false);
      assert.equal(Object.hasOwn(taskUpdate.payload.task, key), false);
    }
    assert.equal(Object.hasOwn(taskUpdate.payload.task, 'description'), false);
  });
});
