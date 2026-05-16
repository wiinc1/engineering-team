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

function headers(secret, claims = {}) {
  return {
    authorization: `Bearer ${sign({
      sub: 'project-security-user',
      tenant_id: 'tenant-a',
      roles: ['reader'],
      exp: Math.floor(Date.now() / 1000) + 60,
      ...claims,
    }, secret)}`,
  };
}

async function withServer(callback) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-security-'));
  const secret = 'projects-security-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await callback({ baseUrl: `http://127.0.0.1:${server.address().port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('projects enforce reader write denial and tenant isolation', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers(secret, { roles: ['reader'] }) },
      body: JSON.stringify({ name: 'Denied project' }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers(secret, { roles: ['pm'] }) },
      body: JSON.stringify({ name: 'Tenant A project' }),
    });
    assert.equal(response.status, 201);
    const project = (await response.json()).data;

    response = await fetch(`${baseUrl}/api/v1/projects/${project.projectId}`, {
      headers: headers(secret, { tenant_id: 'tenant-b', roles: ['reader'] }),
    });
    assert.equal(response.status, 404);

    response = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: headers(secret, { tenant_id: 'tenant-b', roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, []);
  });
});
