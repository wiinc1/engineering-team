const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAuditApiServer } = require('../../lib/audit/http');
const { signBrowserAuthCode } = require('../../lib/auth/jwt');

function sign(payload, secret, header = { alg: 'HS256', typ: 'JWT' }) {
  const headerPart = Buffer.from(JSON.stringify(header)).toString('base64url');
  const bodyPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${headerPart}.${bodyPart}`).digest('base64url');
  return `${headerPart}.${bodyPart}.${signature}`;
}

function signRs256(payload, privateKey, header = { alg: 'RS256', typ: 'JWT', kid: 'kid-1' }) {
  const headerPart = Buffer.from(JSON.stringify(header)).toString('base64url');
  const bodyPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${headerPart}.${bodyPart}`), privateKey).toString('base64url');
  return `${headerPart}.${bodyPart}.${signature}`;
}

async function withServer(run, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-security-'));
  const secret = 'security-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret, baseDir });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function browserAuthCode(secret, payload = {}, options = {}) {
  return signBrowserAuthCode({
    actorId: 'pm-1',
    tenantId: 'tenant-sec',
    roles: ['pm', 'reader'],
    ...payload,
  }, secret, options);
}

function githubSignature(secret, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
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

test('reader scope keeps owner metadata visible while assignment remains forbidden', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorAuth = { authorization: `Bearer ${sign({ sub: 'eng', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const pmAuth = { authorization: `Bearer ${sign({ sub: 'pm', tenant_id: 'tenant-sec', roles: ['pm'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const readerAuth = { authorization: `Bearer ${sign({ sub: 'reader', tenant_id: 'tenant-sec', roles: ['reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };

    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-4/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-SEC-4', payload: { title: 'Owner visibility task', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-4/assignment`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...pmAuth },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-4`, { headers: readerAuth });
    assert.equal(response.status, 200);
    const summary = await response.json();
    assert.equal(summary.current_owner, 'qa');
    assert.deepEqual(summary.owner, { actor_id: 'qa', display_name: 'qa' });

    response = await fetch(`${baseUrl}/tasks`, { headers: readerAuth });
    assert.equal(response.status, 200);
    const taskList = await response.json();
    assert.equal(taskList.items[0].current_owner, 'qa');

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-4/assignment`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...readerAuth },
      body: JSON.stringify({ agentId: null }),
    });
    assert.equal(response.status, 403);
  });
});

test('browser auth bootstrap rejects missing and incomplete auth codes', async () => {
  await withServer(async ({ baseUrl, secret, baseDir }) => {
    let response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'missing_auth_code');

    response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: 'actor=pm-1;roles=pm,reader',
      }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_auth_code');

    response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: browserAuthCode('wrong-secret'),
      }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_auth_code');

    response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: browserAuthCode(secret, {}, { issuer: 'unexpected-issuer' }),
      }),
    });
    assert.equal(response.status, 200);

    const log = fs.readFileSync(path.join(baseDir, 'observability', 'workflow-audit.log'), 'utf8');
    assert.match(log, /"path":"\/auth\/session"/);
    assert.match(log, /"error_code":"invalid_auth_code"/);
    assert.match(log, /"request_id":"/);
  });

  await withServer(async ({ baseUrl, secret }) => {
    const response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: browserAuthCode(secret, {}, { issuer: 'unexpected-issuer' }),
      }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_auth_code');
  }, { browserAuthCodeIssuer: 'expected-issuer' });
});

test('browser bootstrap tokens stay usable when the API enforces issuer and audience verification', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: browserAuthCode(secret),
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();

    const followUp = await fetch(`${baseUrl}/tasks`, {
      headers: { authorization: `Bearer ${payload.data.accessToken}` },
    });
    assert.equal(followUp.status, 200);
  }, { jwtIssuer: 'expected-issuer', jwtAudience: 'expected-audience' });
});

test('accepts production-style JWKS tokens with explicit claim mapping', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  await withServer(async ({ baseUrl }) => {
    const token = signRs256({
      actor: 'pm-prod',
      tenant: 'tenant-prod',
      groups: ['pm', 'reader'],
      iss: 'https://idp.example.test/',
      aud: 'engineering-team-api',
      exp: Math.floor(Date.now() / 1000) + 60,
    }, privateKey);

    const response = await fetch(`${baseUrl}/tasks`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items, []);
  }, {
    jwtJwks: { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'kid-1', use: 'sig', alg: 'RS256' }] },
    jwtIssuer: 'https://idp.example.test/',
    jwtAudience: 'engineering-team-api',
    actorClaim: 'actor',
    tenantClaim: 'tenant',
    rolesClaim: 'groups',
  });
});

test('rejects GitHub webhook deliveries with missing or invalid signatures', async () => {
  await withServer(async ({ baseUrl }) => {
    const body = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'wiinc1/engineering-team' },
      sender: { login: 'octocat' },
      pull_request: {
        node_id: 'PR_sig',
        number: 55,
        title: 'feat: TSK-SEC-9',
        body: 'Implements TSK-SEC-9',
        html_url: 'https://github.com/wiinc1/engineering-team/pull/55',
        state: 'open',
        updated_at: '2026-04-13T23:00:00.000Z',
      },
    });

    let response = await fetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-sec-1',
      },
      body,
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_github_signature');

    response = await fetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-sec-2',
        'x-hub-signature-256': githubSignature('wrong-secret', body),
      },
      body,
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_github_signature');
  }, { githubWebhookSecret: 'gh-webhook-secret' });
});

test('keeps browser bootstrap compatibility tokens usable during JWKS rollout when a signing secret is still configured', async () => {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  await withServer(async ({ baseUrl, secret }) => {
    const response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: browserAuthCode(secret),
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();

    const followUp = await fetch(`${baseUrl}/tasks`, {
      headers: { authorization: `Bearer ${payload.data.accessToken}` },
    });
    assert.equal(followUp.status, 200);
  }, {
    jwtJwks: { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'kid-1', use: 'sig', alg: 'RS256' }] },
    jwtIssuer: 'expected-issuer',
    jwtAudience: 'expected-audience',
  });
});
