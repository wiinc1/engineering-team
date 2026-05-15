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

function authHeaders(secret, overrides = {}) {
  return {
    authorization: `Bearer ${sign(
      {
        sub: 'execution-contract-security',
        tenant_id: 'tenant-execution-contract-security',
        roles: ['admin'],
        exp: Math.floor(Date.now() / 1000) + 60,
        ...overrides,
      },
      secret
    )}`,
  };
}

async function withServer(callback) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-contract-refinement-security-'));
  const secret = 'execution-contract-refinement-security-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await callback({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

const STANDARD_SECTIONS = ['1', '2', '3', '4', '6', '7', '10', '11', '12', '15', '16', '17'];

function standardSections() {
  return Object.fromEntries(STANDARD_SECTIONS.map((sectionId) => [sectionId, `Security section ${sectionId}.`]));
}

async function createContract(baseUrl, secret) {
  let response = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(secret, { roles: ['contributor'] }) },
    body: JSON.stringify({
      title: 'Reviewer authorization',
      raw_requirements: 'Verify reviewer role boundaries.',
    }),
  });
  assert.equal(response.status, 201);
  const { taskId } = await response.json();

  response = await fetch(`${baseUrl}/tasks/${taskId}/execution-contract`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'pm-security', roles: ['pm', 'reader'] }),
    },
    body: JSON.stringify({
      templateTier: 'Standard',
      sections: standardSections(),
      reviewers: {
        architect: { status: 'pending' },
        ux: { status: 'pending' },
        qa: { status: 'pending' },
      },
    }),
  });
  assert.equal(response.status, 201);
  return taskId;
}

test('section review rejects non-reviewer callers and reviewer role spoofing', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const taskId = await createContract(baseUrl, secret);
    const route = `${baseUrl}/api/v1/tasks/${taskId}/execution-contract/1/sections/6/review`;

    let response = await fetch(route, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'reader-security', roles: ['reader'] }),
      },
      body: JSON.stringify({ status: 'approved' }),
    });
    assert.equal(response.status, 403);

    response = await fetch(route, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'qa-security', roles: ['qa'] }),
      },
      body: JSON.stringify({ reviewerRole: 'architect', status: 'approved' }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'forbidden');
  });
});
