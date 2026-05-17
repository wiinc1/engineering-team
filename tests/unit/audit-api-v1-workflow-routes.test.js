const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createAuditApiServer } = require('../../lib/audit/http');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, roles, overrides = {}) {
  return {
    authorization: `Bearer ${sign({
      sub: 'v1-workflow-route-test',
      tenant_id: 'tenant-v1-workflow',
      roles,
      exp: Math.floor(Date.now() / 1000) + 60,
      ...overrides,
    }, secret)}`,
  };
}

async function withServer(callback) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-v1-workflow-'));
  const secret = 'audit-v1-workflow-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await callback({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function simpleSections() {
  return {
    1: 'As an operator, I want the v1 workflow route to accept execution contracts.',
    2: 'Given an intake task, when the v1 workflow route is called, then the contract is recorded.',
    4: 'Run the unit route coverage for the v1 workflow adapter.',
    11: 'Rollback by reverting the adapter route change.',
    12: 'Record route coverage in unit tests.',
    15: 'The v1 route records and approves a Simple execution contract.',
    16: 'Validate through the local audit API server.',
    17: 'Handoff includes the v1 route coverage result.',
  };
}

test('v1 task workflow routes reach the audit execution-contract handler', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['contributor']) },
      body: JSON.stringify({
        title: 'V1 workflow adapter intake',
        raw_requirements: 'Verify /api/v1 task workflow routes reach the audit handler.',
      }),
    });
    assert.equal(response.status, 201);
    const task = await response.json();

    response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/execution-contract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['pm', 'reader']) },
      body: JSON.stringify({
        templateTier: 'Simple',
        sections: simpleSections(),
        scopeBoundaries: {
          committedRequirements: [
            { id: 'V1-ROUTE-1', text: 'The v1 workflow route records the contract.', sourceSectionId: '2' },
          ],
        },
      }),
    });
    assert.equal(response.status, 201);
    const contract = await response.json();
    assert.equal(contract.data.validation.status, 'valid');

    response = await fetch(`${baseUrl}/api/v1/tasks/${task.taskId}/execution-contract/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['pm', 'reader']) },
      body: JSON.stringify({ approvalNote: 'Route coverage approval.' }),
    });
    assert.equal(response.status, 201);
    const approval = await response.json();
    assert.equal(approval.data.status, 'approved');
  });
});
