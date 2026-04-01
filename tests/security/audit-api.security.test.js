const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAuditApiServer } = require('../../lib/audit/http');

function sign(payload, secret, header = { alg: 'HS256', typ: 'JWT' }) {
  const headerPart = Buffer.from(JSON.stringify(header)).toString('base64url');
  const bodyPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${headerPart}.${bodyPart}`).digest('base64url');
  return `${headerPart}.${bodyPart}.${signature}`;
}

async function withServer(run, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-security-'));
  const secret = 'security-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('rejects tampered, expired, and issuer-mismatched bearer tokens', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const expired = sign({ sub: 'sec', tenant_id: 'tenant-sec', roles: ['reader'], exp: Math.floor(Date.now() / 1000) - 10 }, secret);
    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-1/history`, { headers: { authorization: `Bearer ${expired}` } });
    assert.equal(response.status, 401);
    assert.match(JSON.stringify(await response.json()), /expired/i);

    const wrongSecret = sign({ sub: 'sec', tenant_id: 'tenant-sec', roles: ['reader'], exp: Math.floor(Date.now() / 1000) + 60 }, 'not-the-secret');
    response = await fetch(`${baseUrl}/tasks/TSK-SEC-1/history`, { headers: { authorization: `Bearer ${wrongSecret}` } });
    assert.equal(response.status, 401);

    const issuerToken = sign({ sub: 'sec', tenant_id: 'tenant-sec', roles: ['reader'], iss: 'unexpected', exp: Math.floor(Date.now() / 1000) + 60 }, secret);
    const { server } = createAuditApiServer({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'audit-security-issuer-')), jwtSecret: secret, jwtIssuer: 'expected-issuer' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      response = await fetch(`http://127.0.0.1:${port}/tasks/TSK-SEC-1/history`, { headers: { authorization: `Bearer ${issuerToken}` } });
      assert.equal(response.status, 401);
    } finally {
      await new Promise(resolve => server.close(() => resolve()));
    }
  });
});

test('rejects invalid JSON, oversized bodies, and legacy headers unless explicitly enabled', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const auth = { authorization: `Bearer ${sign({ sub: 'sec', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };

    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-2/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: '{not valid json}',
    });
    assert.equal(response.status, 400);

    await assert.rejects(
      () => fetch(`${baseUrl}/tasks/TSK-SEC-2/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'oversized', payload: { body: 'x'.repeat(1024 * 1024 + 32) } }),
      }),
      /fetch failed/i,
    );

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-2/history`, {
      headers: { 'x-tenant-id': 'tenant-sec', 'x-actor-id': 'legacy', 'x-roles': 'reader' },
    });
    assert.equal(response.status, 401);
  });

  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/tasks/TSK-SEC-2/history`, {
      headers: { 'x-tenant-id': 'tenant-sec', 'x-actor-id': 'legacy', 'x-roles': 'reader' },
    });
    assert.equal(response.status, 200);
  }, { allowLegacyHeaders: true });
});

test('omits restricted telemetry fields for under-authorized task viewers', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorAuth = { authorization: `Bearer ${sign({ sub: 'eng', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const readerAuth = { authorization: `Bearer ${sign({ sub: 'pm', tenant_id: 'tenant-sec', roles: ['reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };

    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-3/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-SEC-3', traceId: 'trace-sec-3', correlationId: 'corr-sec-3', payload: { title: 'Security telemetry task', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-3/observability-summary`, { headers: readerAuth });
    assert.equal(response.status, 200);
    const restricted = await response.json();
    assert.equal(restricted.access.restricted, true);
    assert.deepEqual(restricted.access.omitted_fields, ['trace_ids', 'metrics', 'privileged_links']);
    assert.equal(restricted.trace_ids, undefined);
    assert.equal(restricted.metrics, undefined);
    assert.deepEqual(restricted.correlation.approved_correlation_ids, ['corr-sec-3']);
  });
});
