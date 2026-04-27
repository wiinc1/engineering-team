const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAuditApiServer } = require('../../lib/audit/http');
const { signBrowserAuthCode } = require('../../lib/auth/jwt');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, payload = {}) {
  return {
    authorization: `Bearer ${sign({ sub: 'principal-engineer', tenant_id: 'tenant-a', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 60, ...payload }, secret)}`,
  };
}

function browserAuthCode(secret, payload = {}, options = {}) {
  return signBrowserAuthCode({
    actorId: 'pm-1',
    tenantId: 'tenant-a',
    roles: ['pm', 'reader'],
    ...payload,
  }, secret, options);
}

function githubSignature(secret, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function withServer(run, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-api-'));
  const secret = 'test-secret';
  const { server, store, authService } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run({ baseDir, baseUrl, secret, store, authService });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function getSetCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') return response.headers.getSetCookie();
  const combined = response.headers.get('set-cookie') || '';
  return combined
    .split(/,(?=\s*engineering_team_(?:session|csrf)=)/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function cookieHeaderFromSetCookies(setCookies) {
  return setCookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

function readCookieValue(cookieHeader, name) {
  const prefix = `${name}=`;
  return String(cookieHeader || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) || '';
}

test('enforces bearer-token auth context and isolates reads by tenant claim', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const unauthorized = await fetch(`${baseUrl}/tasks/TSK-200/history`);
    assert.equal(unauthorized.status, 401);
    const unauthorizedBody = await unauthorized.json();
    assert.equal(unauthorizedBody.error.code, 'missing_auth_context');
    assert.ok(unauthorized.headers.get('x-request-id'));

    const createRes = await fetch(`${baseUrl}/tasks/TSK-200/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
      },
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-200', payload: { title: 'Tenant task', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(createRes.status, 202);

    const okHistory = await fetch(`${baseUrl}/tasks/TSK-200/history`, { headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }) });
    const history = await okHistory.json();
    assert.equal(okHistory.status, 200);
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].tenant_id, 'tenant-a');

    const wrongTenantState = await fetch(`${baseUrl}/tasks/TSK-200/state`, { headers: authHeaders(secret, { tenant_id: 'tenant-b', roles: ['reader'] }) });
    assert.equal(wrongTenantState.status, 404);
    assert.equal((await wrongTenantState.json()).error.code, 'task_not_found');
  });
});

test('issues browser bootstrap sessions from the auth exchange endpoint and supports the /api alias', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: browserAuthCode(secret),
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.ok(payload.data.accessToken);
    assert.equal(payload.data.claims.actor_id, 'pm-1');
    assert.equal(payload.data.claims.tenant_id, 'tenant-a');
    assert.deepEqual(payload.data.claims.roles, ['pm', 'reader']);

    const sessionRead = await fetch(`${baseUrl}/tasks`, {
      headers: {
        authorization: `Bearer ${payload.data.accessToken}`,
      },
    });
    assert.equal(sessionRead.status, 200);

    response = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: browserAuthCode(secret, {
          actorId: 'engineer-1',
          roles: ['engineer', 'reader', 'contributor'],
        }),
      }),
    });
    assert.equal(response.status, 200);
    const aliasPayload = await response.json();
    assert.equal(aliasPayload.success, true);
    assert.equal(aliasPayload.data.claims.actor_id, 'engineer-1');
  });
});

test('rejects malformed browser auth bootstrap requests', async () => {
  await withServer(async ({ baseUrl, secret }) => {
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
      body: JSON.stringify({ authCode: 'tenant=tenant-a;roles=reader' }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_auth_code');

    response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authCode: `${browserAuthCode(secret)}tampered` }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_auth_code');
  });
});

test('disables internal browser auth bootstrap outside local mode when explicitly turned off', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: browserAuthCode(secret),
      }),
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'internal_browser_auth_disabled');
  }, {
    runtimeEnv: 'production',
    enableInternalBrowserAuthBootstrap: false,
  });
});

test('magic-link HTTP routes create cookie sessions, protect admin APIs, and revoke logout', async () => {
  const emailTransport = { provider: 'test', sent: [], async sendMagicLinkEmail(message) { this.sent.push(message); } };
  await withServer(async ({ baseUrl, authService }) => {
    await authService.upsertUser({
      email: 'admin@example.com',
      tenantId: 'tenant-a',
      actorId: 'admin-1',
      roles: ['admin', 'reader'],
      status: 'active',
    }, { actorId: 'system', tenantId: 'tenant-a' });
    await authService.upsertUser({
      email: 'reader@example.com',
      tenantId: 'tenant-a',
      actorId: 'reader-1',
      roles: ['reader'],
      status: 'active',
    }, { actorId: 'system', tenantId: 'tenant-a' });

    let response = await fetch(`${baseUrl}/auth/magic-link/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ADMIN@example.com', next: '/admin/users' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).message, 'If the email is eligible, a sign-in link has been sent.');
    assert.equal(emailTransport.sent.length, 1);

    response = await fetch(`${baseUrl}/backend/auth/magic-link/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@example.com', next: '/tasks' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).message, 'If the email is eligible, a sign-in link has been sent.');
    assert.equal(emailTransport.sent.length, 1);

    const token = new URL(emailTransport.sent[0].link).searchParams.get('token');
    response = await fetch(`${baseUrl}/auth/magic-link/consume?token=${encodeURIComponent(token)}&next=%2Fadmin%2Fusers`, {
      redirect: 'manual',
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/admin/users');
    const setCookies = getSetCookies(response);
    assert.ok(setCookies.some((cookie) => cookie.startsWith('engineering_team_session=') && cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax')));
    assert.ok(setCookies.some((cookie) => cookie.startsWith('engineering_team_csrf=') && cookie.includes('SameSite=Lax')));
    const cookie = cookieHeaderFromSetCookies(setCookies);
    const csrf = decodeURIComponent(readCookieValue(cookie, 'engineering_team_csrf'));
    assert.ok(csrf);

    response = await fetch(`${baseUrl}/auth/me`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const me = await response.json();
    assert.equal(me.data.actorId, 'admin-1');
    assert.equal(me.data.tenantId, 'tenant-a');
    assert.deepEqual(me.data.roles, ['admin', 'reader']);

    response = await fetch(`${baseUrl}/auth/users`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.length, 2);

    response = await fetch(`${baseUrl}/auth/users`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pm@example.com', tenantId: 'tenant-a', actorId: 'pm-1', roles: ['pm', 'reader'], status: 'active' }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'csrf_required');

    response = await fetch(`${baseUrl}/auth/users`, {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pm@example.com', tenantId: 'tenant-a', actorId: 'pm-1', roles: ['pm', 'reader'], status: 'active' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.actorId, 'pm-1');

    const adminUser = (await authService.listUsers()).find((user) => user.email === 'admin@example.com');
    response = await fetch(`${baseUrl}/auth/users/${adminUser.userId}`, {
      method: 'PATCH',
      headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ roles: ['reader'], status: 'active' }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'self_admin_protection');

    response = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrf },
    });
    assert.equal(response.status, 200);
    assert.ok(getSetCookies(response).some((clearCookie) => clearCookie.includes('Max-Age=0')));

    response = await fetch(`${baseUrl}/auth/me`, { headers: { cookie } });
    assert.equal(response.status, 401);
  }, {
    publicAppUrl: 'https://app.example',
    sessionSecret: 'route-secret',
    emailTransport,
  });
});

test('magic-link admin APIs return 403 for non-admin cookie sessions', async () => {
  const emailTransport = { provider: 'test', sent: [], async sendMagicLinkEmail(message) { this.sent.push(message); } };
  await withServer(async ({ baseUrl, authService }) => {
    await authService.upsertUser({
      email: 'reader@example.com',
      tenantId: 'tenant-a',
      actorId: 'reader-1',
      roles: ['reader'],
      status: 'active',
    }, { actorId: 'system', tenantId: 'tenant-a' });

    await fetch(`${baseUrl}/auth/magic-link/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'reader@example.com' }),
    });
    const token = new URL(emailTransport.sent[0].link).searchParams.get('token');
    const consume = await fetch(`${baseUrl}/auth/magic-link/consume?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
    const cookie = cookieHeaderFromSetCookies(getSetCookies(consume));

    const response = await fetch(`${baseUrl}/auth/users`, { headers: { cookie } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'forbidden');
  }, {
    publicAppUrl: 'https://app.example',
    sessionSecret: 'route-secret',
    emailTransport,
  });
});

test('syncs GitHub pull request webhook state into task detail relationships', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const createRes = await fetch(`${baseUrl}/tasks/TSK-500/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'engineering-team', roles: ['contributor'] }),
      },
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-500',
        payload: { title: 'GitHub-linked task', initial_stage: 'PM_CLOSE_REVIEW' },
      }),
    });
    assert.equal(createRes.status, 202);

    const webhookBody = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'wiinc1/engineering-team' },
      sender: { login: 'octocat' },
      pull_request: {
        node_id: 'PR_kwDOAA',
        number: 42,
        title: 'feat: finish TSK-500 close path',
        body: 'Implements TSK-500',
        html_url: 'https://github.com/wiinc1/engineering-team/pull/42',
        state: 'open',
        draft: false,
        updated_at: '2026-04-13T23:00:00.000Z',
        head: { ref: 'feature/TSK-500-close-path' },
      },
    });

    const webhookRes = await fetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-1',
        'x-hub-signature-256': githubSignature('gh-webhook-secret', webhookBody),
      },
      body: webhookBody,
    });
    assert.equal(webhookRes.status, 202);

    const detailRes = await fetch(`${baseUrl}/tasks/TSK-500/detail`, {
      headers: authHeaders(secret, { tenant_id: 'engineering-team', roles: ['reader'] }),
    });
    assert.equal(detailRes.status, 200);
    const detail = await detailRes.json();
    assert.equal(detail.summary.prStatus.label, '1 open PR linked');
    assert.equal(detail.summary.githubSync.state, 'ok');
    assert.equal(detail.relations.linkedPrs[0].number, 42);
    assert.equal(detail.relations.linkedPrs[0].repository, 'wiinc1/engineering-team');
  }, { githubWebhookSecret: 'gh-webhook-secret' });
});

test('blocks task close while linked pull requests are still open and allows close after merge sync', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'engineering-team', roles: ['contributor'] }),
    };
    let response = await fetch(`${baseUrl}/tasks/TSK-501/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-501',
        payload: { title: 'Close gate task', initial_stage: 'PM_CLOSE_REVIEW' },
      }),
    });
    assert.equal(response.status, 202);

    const openWebhookBody = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'wiinc1/engineering-team' },
      sender: { login: 'octocat' },
      pull_request: {
        node_id: 'PR_kwDOAB',
        number: 43,
        title: 'feat: close TSK-501',
        body: 'Closes TSK-501',
        html_url: 'https://github.com/wiinc1/engineering-team/pull/43',
        state: 'open',
        draft: false,
        updated_at: '2026-04-13T23:00:00.000Z',
        head: { ref: 'feature/TSK-501-close' },
      },
    });

    response = await fetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-2',
        'x-hub-signature-256': githubSignature('gh-webhook-secret', openWebhookBody),
      },
      body: openWebhookBody,
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-501/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.closed',
        actorType: 'agent',
        idempotencyKey: 'close:TSK-501:blocked',
        payload: {},
      }),
    });
    assert.equal(response.status, 400);
    assert.match(JSON.stringify(await response.json()), /Close is blocked/i);

    const mergedWebhookBody = JSON.stringify({
      action: 'closed',
      repository: { full_name: 'wiinc1/engineering-team' },
      sender: { login: 'octocat' },
      pull_request: {
        node_id: 'PR_kwDOAB',
        number: 43,
        title: 'feat: close TSK-501',
        body: 'Closes TSK-501',
        html_url: 'https://github.com/wiinc1/engineering-team/pull/43',
        state: 'closed',
        merged: true,
        merged_at: '2026-04-13T23:10:00.000Z',
        updated_at: '2026-04-13T23:10:00.000Z',
        draft: false,
        head: { ref: 'feature/TSK-501-close' },
      },
    });

    response = await fetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-3',
        'x-hub-signature-256': githubSignature('gh-webhook-secret', mergedWebhookBody),
      },
      body: mergedWebhookBody,
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-501/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.closed',
        actorType: 'agent',
        idempotencyKey: 'close:TSK-501:merged',
        payload: {},
      }),
    });
    assert.equal(response.status, 202);
  }, { githubWebhookSecret: 'gh-webhook-secret' });
});

test('gates GitHub webhook sync behind the feature flag', async () => {
  await withServer(async ({ baseUrl }) => {
    const webhookBody = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'wiinc1/engineering-team' },
      sender: { login: 'octocat' },
      pull_request: {
        node_id: 'PR_kwDOAC',
        number: 44,
        title: 'feat: TSK-502',
        body: 'Implements TSK-502',
        html_url: 'https://github.com/wiinc1/engineering-team/pull/44',
        state: 'open',
        updated_at: '2026-04-13T23:00:00.000Z',
      },
    });

    const response = await fetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-4',
        'x-hub-signature-256': githubSignature('gh-webhook-secret', webhookBody),
      },
      body: webhookBody,
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'feature_disabled');
  }, { githubWebhookSecret: 'gh-webhook-secret', ffGitHubSync: 'false' });
});

test('routes GitHub webhook updates to the task tenant instead of the default tenant', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/tasks/TSK-503/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-b', roles: ['contributor'] }),
      },
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-503',
        payload: { title: 'Tenant-routed task', initial_stage: 'PM_CLOSE_REVIEW' },
      }),
    });
    assert.equal(response.status, 202);

    const webhookBody = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'wiinc1/engineering-team' },
      sender: { login: 'octocat' },
      pull_request: {
        node_id: 'PR_kwDOAD',
        number: 45,
        title: 'feat: TSK-503',
        body: 'Implements TSK-503',
        html_url: 'https://github.com/wiinc1/engineering-team/pull/45',
        state: 'open',
        updated_at: '2026-04-13T23:00:00.000Z',
      },
    });

    response = await fetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-5',
        'x-hub-signature-256': githubSignature('gh-webhook-secret', webhookBody),
      },
      body: webhookBody,
    });
    assert.equal(response.status, 202);
    const webhookResult = await response.json();
    assert.deepEqual(webhookResult.matchedTasks, [{ taskId: 'TSK-503', tenantId: 'tenant-b' }]);

    response = await fetch(`${baseUrl}/tasks/TSK-503/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-b', roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.relations.linkedPrs[0].number, 45);

    response = await fetch(`${baseUrl}/tasks/TSK-503/detail`, {
      headers: authHeaders(secret, { tenant_id: 'engineering-team', roles: ['reader'] }),
    });
    assert.equal(response.status, 404);
  }, { githubWebhookSecret: 'gh-webhook-secret', defaultTenantId: 'engineering-team' });
});

test('matches merge webhooks to existing linked PR state even when the payload no longer references the task id', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/tasks/TSK-504/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'engineering-team', roles: ['contributor'] }),
      },
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-504',
        payload: {
          title: 'Existing PR link',
          initial_stage: 'PM_CLOSE_REVIEW',
          linked_prs: [{
            id: 'PR_kwDOAE',
            number: 46,
            title: 'feat: finish close flow',
            url: 'https://github.com/wiinc1/engineering-team/pull/46',
            repository: 'wiinc1/engineering-team',
            state: 'open',
            merged: false,
            updated_at: '2026-04-13T23:00:00.000Z',
          }],
        },
      }),
    });
    assert.equal(response.status, 202);

    const mergedWebhookBody = JSON.stringify({
      action: 'closed',
      repository: { full_name: 'wiinc1/engineering-team' },
      sender: { login: 'octocat' },
      pull_request: {
        node_id: 'PR_kwDOAE',
        number: 46,
        title: 'feat: finish close flow',
        body: 'Final merge without task id in body',
        html_url: 'https://github.com/wiinc1/engineering-team/pull/46',
        state: 'closed',
        merged: true,
        merged_at: '2026-04-13T23:10:00.000Z',
        updated_at: '2026-04-13T23:10:00.000Z',
      },
    });

    response = await fetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-6',
        'x-hub-signature-256': githubSignature('gh-webhook-secret', mergedWebhookBody),
      },
      body: mergedWebhookBody,
    });
    assert.equal(response.status, 202);
    const webhookResult = await response.json();
    assert.deepEqual(webhookResult.matchedTasks, [{ taskId: 'TSK-504', tenantId: 'engineering-team' }]);

    response = await fetch(`${baseUrl}/tasks/TSK-504/detail`, {
      headers: authHeaders(secret, { tenant_id: 'engineering-team', roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.summary.prStatus.state, 'done');
    assert.equal(detail.summary.githubSync.state, 'ok');
    assert.equal(detail.relations.linkedPrs[0].merged, true);
  }, { githubWebhookSecret: 'gh-webhook-secret' });
});

test('browser bootstrap session tokens include configured issuer and audience claims', async () => {
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

    const sessionRead = await fetch(`${baseUrl}/tasks`, {
      headers: {
        authorization: `Bearer ${payload.data.accessToken}`,
      },
    });
    assert.equal(sessionRead.status, 200);

    const claims = JSON.parse(Buffer.from(payload.data.accessToken.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(claims.iss, 'expected-issuer');
    assert.equal(claims.aud, 'expected-audience');
  }, { jwtIssuer: 'expected-issuer', jwtAudience: 'expected-audience' });
});

test('enforces role-based permissions for writes and metrics', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const forbiddenWrite = await fetch(`${baseUrl}/tasks/TSK-202/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'observer', tenant_id: 'tenant-a', roles: ['reader'] }),
      },
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-202' }),
    });
    assert.equal(forbiddenWrite.status, 403);
    assert.equal((await forbiddenWrite.json()).error.code, 'forbidden');

    const forbiddenMetrics = await fetch(`${baseUrl}/metrics`, { headers: authHeaders(secret, { sub: 'observer', tenant_id: 'tenant-a', roles: ['reader'] }) });
    assert.equal(forbiddenMetrics.status, 403);
  });
});

test('returns state, relationships, observability summary, and metrics from projections', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const writeHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-z', roles: ['contributor'] }),
    };

    await fetch(`${baseUrl}/tasks/TSK-201/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-201', traceId: 'trace-1', correlationId: 'corr-1', payload: { title: 'Projection task', initial_stage: 'BACKLOG', priority: 'P0', technical_spec: 'Initial technical spec', monitoring_spec: 'Initial monitoring spec', linked_prs: [{ id: 'pr-7', number: 7, title: 'feat: task detail', state: 'open', repository: 'wiinc1/engineering-team' }] } }),
    });
    await fetch(`${baseUrl}/tasks/TSK-201/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.child_link_added', actorType: 'agent', idempotencyKey: 'child:TSK-201', payload: { child_task_id: 'TSK-202' } }),
    });
    await fetch(`${baseUrl}/tasks/TSK-202/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-202', payload: { title: 'Child task', initial_stage: 'REVIEW' } }),
    });
    await fetch(`${baseUrl}/tasks/TSK-201/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.comment_workflow_recorded', actorType: 'agent', idempotencyKey: 'comment:TSK-201', payload: { technical_spec: 'Revised technical spec', monitoring_spec: 'Revised monitoring spec' } }),
    });

    const readHeaders = authHeaders(secret, { tenant_id: 'tenant-z', roles: ['reader'] });
    const taskRes = await fetch(`${baseUrl}/tasks/TSK-201`, { headers: readHeaders });
    const taskSummary = await taskRes.json();
    assert.equal(taskRes.status, 200);
    assert.equal(taskSummary.title, 'Projection task');
    assert.equal(taskSummary.priority, 'P0');

    const stateRes = await fetch(`${baseUrl}/tasks/TSK-201/state`, { headers: readHeaders });
    const state = await stateRes.json();
    assert.equal(stateRes.status, 200);
    assert.equal(state.priority, 'P0');

    const relationshipsRes = await fetch(`${baseUrl}/tasks/TSK-201/relationships`, { headers: readHeaders });
    const relationships = await relationshipsRes.json();
    assert.equal(relationshipsRes.status, 200);
    assert.deepEqual(relationships.child_task_ids, ['TSK-202']);

    const summaryRes = await fetch(`${baseUrl}/tasks/TSK-201/observability-summary`, { headers: readHeaders });
    const summary = await summaryRes.json();
    assert.equal(summaryRes.status, 200);
    assert.equal(summary.event_count, 3);
    assert.equal(summary.access.restricted, true);
    assert.deepEqual(summary.correlation.approved_correlation_ids, ['comment:TSK-201', 'child:TSK-201', 'corr-1']);
    assert.equal(summary.trace_ids, undefined);

    const detailRes = await fetch(`${baseUrl}/tasks/TSK-201/detail`, { headers: readHeaders });
    const detail = await detailRes.json();
    assert.equal(detailRes.status, 200);
    assert.equal(detail.task.id, 'TSK-201');
    assert.equal(detail.task.status, 'active');
    assert.equal(detail.summary.prStatus.label, '1 open PR linked');
    assert.equal(detail.summary.childStatus.total, 1);
    assert.equal(detail.context.technicalSpec, 'Revised technical spec');
    assert.equal(detail.context.monitoringSpec, 'Revised monitoring spec');
    assert.equal(detail.meta.permissions.canViewLinkedPrMetadata, true);
    assert.equal(detail.relations.linkedPrs[0].number, 7);
    assert.equal(detail.relations.childTasks[0].stage, 'REVIEW');
    assert.equal(detail.relations.childTasks[0].id, 'TSK-202');

    const metricsRes = await fetch(`${baseUrl}/metrics`, { headers: authHeaders(secret, { tenant_id: 'tenant-z', roles: ['admin'] }) });
    const metrics = await metricsRes.text();
    assert.equal(metricsRes.status, 200);
    assert.match(metrics, /workflow_audit_events_written_total 4/);
    assert.match(metrics, /workflow_projection_lag_seconds 0/);
  });
});

test('builds dependency-aware planner state in task detail and orchestration reads', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const writeHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-orch', roles: ['contributor'] }),
    };

    await fetch(`${baseUrl}/tasks/TSK-PARENT/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-PARENT',
        payload: {
          title: 'Parent task',
          initial_stage: 'BACKLOG',
          child_task_ids: ['TSK-CHILD-1', 'TSK-CHILD-2'],
          child_dependencies: {
            'TSK-CHILD-2': ['TSK-CHILD-1'],
          },
        },
      }),
    });
    await fetch(`${baseUrl}/tasks/TSK-CHILD-1/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-CHILD-1', payload: { title: 'Child one', task_type: 'engineer', initial_stage: 'DONE' } }),
    });
    await fetch(`${baseUrl}/tasks/TSK-CHILD-1/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.closed', actorType: 'agent', idempotencyKey: 'close:TSK-CHILD-1', payload: {} }),
    });
    await fetch(`${baseUrl}/tasks/TSK-CHILD-2/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-CHILD-2', payload: { title: 'Child two', task_type: 'qa', initial_stage: 'TODO' } }),
    });

    const readHeaders = authHeaders(secret, { tenant_id: 'tenant-orch', roles: ['reader'] });
    const detailRes = await fetch(`${baseUrl}/tasks/TSK-PARENT/detail`, { headers: readHeaders });
    const detail = await detailRes.json();
    assert.equal(detailRes.status, 200);
    assert.equal(detail.meta.permissions.canViewOrchestration, true);
    assert.equal(detail.orchestration.planner.summary.readyCount, 1);
    assert.equal(detail.orchestration.planner.summary.doneCount, 1);
    assert.equal(detail.orchestration.run.summary.readyCount, 1);
    assert.equal(detail.orchestration.run.items.find((item) => item.id === 'TSK-CHILD-2').dependencyState, 'ready');

    const orchestrationRes = await fetch(`${baseUrl}/tasks/TSK-PARENT/orchestration`, { headers: readHeaders });
    const orchestration = await orchestrationRes.json();
    assert.equal(orchestrationRes.status, 200);
    assert.equal(orchestration.run.state, 'not_started');
    assert.equal(orchestration.planner.readyWork[0].id, 'TSK-CHILD-2');
  });
});

test('omits orchestration visibility when the caller lacks relationship permissions', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const writeHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-orch', roles: ['contributor'] }),
    };

    await fetch(`${baseUrl}/tasks/TSK-PARENT/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-PARENT:hidden',
        payload: { title: 'Parent task', initial_stage: 'BACKLOG', child_task_ids: ['TSK-CHILD-1'] },
      }),
    });
    await fetch(`${baseUrl}/tasks/TSK-CHILD-1/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-CHILD-1:hidden', payload: { title: 'Hidden child', initial_stage: 'TODO' } }),
    });

    const response = await fetch(`${baseUrl}/tasks/TSK-PARENT/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-orch', roles: ['stakeholder'] }),
    });
    const detail = await response.json();
    assert.equal(response.status, 200);
    assert.equal(detail.orchestration, null);
    assert.equal(detail.meta.permissions.canViewOrchestration, false);
  });
});

test('starts orchestration runs, persists fallback details, and avoids duplicate dispatch for running work', async () => {
  const dispatchCalls = [];
  await withServer(async ({ baseUrl, secret }) => {
    const writeHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-orch', roles: ['admin'] }),
    };

    await fetch(`${baseUrl}/tasks/TSK-PARENT/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-PARENT:run',
        payload: {
          title: 'Parent task',
          initial_stage: 'BACKLOG',
          child_task_ids: ['TSK-ENG', 'TSK-QA'],
        },
      }),
    });
    await fetch(`${baseUrl}/tasks/TSK-ENG/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-ENG', payload: { title: 'Engineer child', task_type: 'engineer', initial_stage: 'TODO' } }),
    });
    await fetch(`${baseUrl}/tasks/TSK-QA/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-QA', payload: { title: 'QA child', task_type: 'qa', initial_stage: 'TODO' } }),
    });

    let response = await fetch(`${baseUrl}/tasks/TSK-PARENT/orchestration`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ idempotencyKey: 'orch:start:1' }),
    });
    let body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(body.run.summary.runningCount, 1);
    assert.equal(body.run.summary.failedCount, 1);
    assert.equal(body.run.items.find((item) => item.id === 'TSK-QA').fallbackReason, 'runtime_exec_failed');

    response = await fetch(`${baseUrl}/tasks/TSK-PARENT/orchestration`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ idempotencyKey: 'orch:start:2' }),
    });
    body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(body.run.summary.runningCount, 1);
    assert.equal(dispatchCalls.filter((taskId) => taskId === 'TSK-ENG').length, 1);
  }, {
    dispatchWork: async (task) => {
      dispatchCalls.push(task.id);
      if (task.id === 'TSK-ENG') {
        return {
          mode: 'delegated',
          agentId: 'engineer',
          specialist: 'engineer',
          message: 'Delegated to engineer.',
          metadata: {},
        };
      }
      return {
        mode: 'fallback',
        agentId: 'main',
        specialist: null,
        message: 'Coordinator handling this request because runtime delegation for specialist `qa` failed during execution.',
        metadata: {
          fallbackReason: 'runtime_exec_failed',
          userFacingReasonCategory: 'runtime_execution_failed',
        },
      };
    },
  });
});

test('records orchestration metrics for detail reads, orchestration reads, starts, and dispatch outcomes', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const writeHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-orch-metrics', roles: ['admin'] }),
    };

    await fetch(`${baseUrl}/tasks/TSK-PARENT/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-PARENT:metrics',
        payload: {
          title: 'Parent task',
          initial_stage: 'BACKLOG',
          child_task_ids: ['TSK-ENG', 'TSK-QA'],
          child_dependencies: { 'TSK-QA': ['TSK-ENG'] },
        },
      }),
    });
    await fetch(`${baseUrl}/tasks/TSK-ENG/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-ENG:metrics', payload: { title: 'Engineer child', task_type: 'engineer', initial_stage: 'TODO' } }),
    });
    await fetch(`${baseUrl}/tasks/TSK-QA/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-QA:metrics', payload: { title: 'QA child', task_type: 'qa', initial_stage: 'TODO' } }),
    });

    const readHeaders = authHeaders(secret, { tenant_id: 'tenant-orch-metrics', roles: ['reader'] });
    let response = await fetch(`${baseUrl}/tasks/TSK-PARENT/detail`, { headers: readHeaders });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-PARENT/orchestration`, { headers: readHeaders });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-PARENT/orchestration`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ idempotencyKey: 'orch:metrics:start' }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/metrics`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-orch-metrics', roles: ['admin'] }),
    });
    const metrics = await response.text();
    assert.match(metrics, /feature_dependency_planner_requests_total 2/);
    assert.match(metrics, /feature_dependency_planner_ready_work_total 2/);
    assert.match(metrics, /feature_orchestration_visibility_requests_total 2/);
    assert.match(metrics, /feature_orchestration_visibility_view_total 2/);
    assert.match(metrics, /feature_orchestration_scheduler_requests_total 1/);
    assert.match(metrics, /feature_orchestration_scheduler_dispatch_total 1/);
    assert.match(metrics, /feature_orchestration_scheduler_fallback_total 0/);
    assert.match(metrics, /feature_orchestration_scheduler_duplicate_skip_total 0/);
  }, {
    dispatchWork: async () => ({
      mode: 'delegated',
      agentId: 'engineer',
      specialist: 'engineer',
      message: 'Delegated to engineer.',
      metadata: {},
    }),
  });
});

test('restricts orchestration starts to PM and admin roles', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const adminHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-orch-authz', roles: ['admin'] }),
    };

    await fetch(`${baseUrl}/tasks/TSK-PARENT/events`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-PARENT:authz',
        payload: {
          title: 'Parent task',
          initial_stage: 'BACKLOG',
          child_task_ids: ['TSK-ENG'],
        },
      }),
    });
    await fetch(`${baseUrl}/tasks/TSK-ENG/events`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-ENG:authz', payload: { title: 'Engineer child', task_type: 'engineer', initial_stage: 'TODO' } }),
    });

    let response = await fetch(`${baseUrl}/tasks/TSK-PARENT/orchestration`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-orch-authz', roles: ['contributor'] }),
      },
      body: JSON.stringify({ idempotencyKey: 'orch:authz:contributor' }),
    });
    assert.equal(response.status, 403);
    let body = await response.json();
    assert.equal(body.error.code, 'forbidden');

    response = await fetch(`${baseUrl}/tasks/TSK-PARENT/orchestration`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-orch-authz', roles: ['pm'] }),
      },
      body: JSON.stringify({ idempotencyKey: 'orch:authz:pm' }),
    });
    assert.equal(response.status, 202);
  }, {
    dispatchWork: async () => ({
      mode: 'delegated',
      agentId: 'engineer',
      specialist: 'engineer',
      message: 'Delegated to engineer.',
      metadata: {},
    }),
  });
});

test('omits restricted detail sections server-side for low-permission viewers', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const writeHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-z', roles: ['contributor'] }),
    };

    await fetch(`${baseUrl}/tasks/TSK-301/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-301', payload: { title: 'Restricted detail', initial_stage: 'BACKLOG', child_task_ids: ['TSK-302'] } }),
    });
    await fetch(`${baseUrl}/tasks/TSK-302/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-302', payload: { title: 'Restricted child', initial_stage: 'TODO' } }),
    });
    await fetch(`${baseUrl}/tasks/TSK-301/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.comment_workflow_recorded', actorType: 'agent', idempotencyKey: 'comment:TSK-301', payload: { body: 'Hidden comment', linked_prs: [{ number: 12, title: 'feat: hidden detail' }] } }),
    });

    const response = await fetch(`${baseUrl}/tasks/TSK-301/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-z', roles: ['stakeholder'] }),
    });
    const detail = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(detail.activity.comments, []);
    assert.deepEqual(detail.activity.auditLog, []);
    assert.deepEqual(detail.relations.linkedPrs, []);
    assert.deepEqual(detail.relations.childTasks, []);
    assert.equal(detail.telemetry.availability, 'restricted');
    assert.equal(detail.meta.permissions.canViewComments, false);
    assert.equal(detail.meta.permissions.canViewAuditLog, false);
    assert.equal(detail.meta.permissions.canViewTelemetry, false);
    assert.equal(detail.meta.permissions.canViewChildTasks, false);
    assert.equal(detail.meta.permissions.canViewLinkedPrMetadata, false);
  });
});

test('supports history pagination and writes explicit audit-access logs for reads', async () => {
  await withServer(async ({ baseDir, baseUrl, secret }) => {
    const writeHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
    };
    for (let index = 1; index <= 3; index += 1) {
      const eventType = index === 1 ? 'task.created' : 'task.comment_workflow_recorded';
      const payload = index === 1 ? { title: 'Paged task', initial_stage: 'BACKLOG' } : { comment_type: `note-${index}` };
      const response = await fetch(`${baseUrl}/tasks/TSK-203/events`, {
        method: 'POST',
        headers: writeHeaders,
        body: JSON.stringify({ eventType, actorType: 'agent', idempotencyKey: `page:${index}`, payload }),
      });
      assert.equal(response.status, 202);
    }

    const readHeaders = authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] });
    let response = await fetch(`${baseUrl}/tasks/TSK-203/history?limit=2`, { headers: readHeaders });
    assert.equal(response.status, 200);
    const firstPage = await response.json();
    assert.equal(firstPage.items.length, 2);
    assert.equal(firstPage.page_info.has_more, true);
    assert.equal(firstPage.page_info.next_cursor, '2');
    assert.equal(firstPage.items[0].summary, 'Workflow comment recorded: note-3');
    assert.equal(firstPage.items[0].display.fallback_used, false);

    response = await fetch(`${baseUrl}/tasks/TSK-203/history?limit=2&cursor=2`, { headers: readHeaders });
    const secondPage = await response.json();
    assert.equal(secondPage.items.length, 1);
    assert.equal(secondPage.page_info.has_more, false);

    const log = fs.readFileSync(path.join(baseDir, 'observability', 'workflow-audit.log'), 'utf8');
    assert.match(log, /"action":"audit_access"/);
    assert.match(log, /"resource":"history"/);
  }, { historyLatencyRegressionThresholdMs: 0 });
});

test('supports review question workflow endpoints and blocks architect handoff until blocking questions are resolved', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-rq', roles: ['contributor', 'architect'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-RQ-1', payload: { title: 'Review question task', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-RQ-1:ARCHITECT_REVIEW', payload: { from_stage: 'BACKLOG', to_stage: 'ARCHITECT_REVIEW' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'observer', tenant_id: 'tenant-rq', roles: ['contributor'] }),
      },
      body: JSON.stringify({ prompt: 'Unauthorized review question', blocking: true }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ prompt: 'What is the PM-approved state machine?', blocking: true }),
    });
    assert.equal(response.status, 201);
    const createdQuestion = await response.json();
    assert.ok(createdQuestion.questionId);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-rq', roles: ['reader'] }),
    });
    const summary = await response.json();
    assert.equal(summary.blocked, true);
    assert.equal(summary.waiting_state, 'pm_review_question_resolution');
    assert.equal(summary.next_required_action, 'Resolve blocking architect review questions');

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-rq', roles: ['reader'] }),
    });
    const detail = await response.json();
    assert.equal(detail.reviewQuestions.summary.unresolvedBlockingCount, 1);
    assert.equal(detail.reviewQuestions.items[0].state, 'open');
    assert.equal(detail.reviewQuestions.pinned.length, 1);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-RQ-1:TECHNICAL_SPEC:blocked', payload: { from_stage: 'ARCHITECT_REVIEW', to_stage: 'TECHNICAL_SPEC' } }),
    });
    const blockedTransition = await response.json();
    assert.equal(response.status, 400);
    assert.equal(blockedTransition.error.code, 'workflow_violation');

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions/${createdQuestion.questionId}/answers`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'observer', tenant_id: 'tenant-rq', roles: ['contributor'] }),
      },
      body: JSON.stringify({ body: 'Trying to answer without PM role.' }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions/${createdQuestion.questionId}/answers`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'pm-user', tenant_id: 'tenant-rq', roles: ['pm', 'contributor'] }),
      },
      body: JSON.stringify({ body: 'Use open, answered, resolved, reopened.' }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions/${createdQuestion.questionId}/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'observer', tenant_id: 'tenant-rq', roles: ['contributor'] }),
      },
      body: JSON.stringify({ resolution: 'Looks good' }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions/${createdQuestion.questionId}/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'pm-user', tenant_id: 'tenant-rq', roles: ['pm', 'contributor'] }),
      },
      body: JSON.stringify({ resolution: 'PM resolved after answer' }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions/${createdQuestion.questionId}/reopen`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-rq', roles: ['architect', 'contributor'] }),
      },
      body: JSON.stringify({ reason: 'Need more detail' }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions/${createdQuestion.questionId}/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'pm-user', tenant_id: 'tenant-rq', roles: ['pm', 'contributor'] }),
      },
      body: JSON.stringify({ resolution: 'Resolved again' }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-rq', roles: ['reader'] }),
    });
    const questions = await response.json();
    assert.equal(questions.summary.unresolvedBlockingCount, 0);
    assert.equal(questions.items[0].resolvedBy, 'pm-user');
    assert.equal(questions.items[0].state, 'resolved');

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-RQ-1:TECHNICAL_SPEC:ok', payload: { from_stage: 'ARCHITECT_REVIEW', to_stage: 'TECHNICAL_SPEC' } }),
    });
    assert.equal(response.status, 202);
  });
});

test('records structured architect handoff details, versions revisions, and blocks implementation until ready', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-handoff', roles: ['architect', 'contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-HO-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-HO-1', payload: { title: 'Architect handoff task', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-HO-1:ARCHITECT_REVIEW', payload: { from_stage: 'BACKLOG', to_stage: 'ARCHITECT_REVIEW' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-HO-1:TECHNICAL_SPEC', payload: { from_stage: 'ARCHITECT_REVIEW', to_stage: 'TECHNICAL_SPEC' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-HO-1:IMPLEMENTATION:blocked', payload: { from_stage: 'TECHNICAL_SPEC', to_stage: 'IMPLEMENTATION' } }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'workflow_violation');

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/architect-handoff`, {
      method: 'PUT',
      headers: architectHeaders,
      body: JSON.stringify({
        readyForEngineering: true,
        engineerTier: 'Sr',
        tierRationale: 'Standard scope with audit and UI work.',
        technicalSpec: {
          summary: 'Define API contract.',
          scope: 'No cross-tenant writes.',
          design: 'Dedicated handoff endpoint.',
          rolloutPlan: 'Ship behind ff-architect-spec-tiering.',
        },
        monitoringSpec: {
          service: 'workflow-audit-api',
          dashboardUrls: ['https://dash.example/handoff'],
          alertPolicies: ['Latency budget breach'],
          runbook: 'docs/runbooks/audit-foundation.md',
          successMetrics: ['p95 under 250ms'],
        },
      }),
    });
    assert.equal(response.status, 200);
    const firstHandoff = await response.json();
    assert.equal(firstHandoff.data.version, 1);
    assert.equal(firstHandoff.data.engineerTier, 'Sr');

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-handoff', roles: ['reader'] }),
    });
    const detail = await response.json();
    assert.equal(response.status, 200);
    assert.equal(detail.context.architectHandoff.version, 1);
    assert.equal(detail.context.architectHandoff.engineerTier, 'Sr');
    assert.equal(detail.context.architectHandoff.tierRationale, 'Standard scope with audit and UI work.');
    assert.equal(detail.context.architectHandoff.monitoringSpec.dashboardUrls[0], 'https://dash.example/handoff');
    assert.match(detail.context.technicalSpec, /Define API contract/);

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/architect-handoff`, {
      method: 'PUT',
      headers: architectHeaders,
      body: JSON.stringify({
        readyForEngineering: true,
        engineerTier: 'Principal',
        tierRationale: 'Scope expanded to cross-team migration.',
        technicalSpec: {
          summary: 'Define API contract and migration path.',
          scope: 'Coordinate rollout across services.',
          design: 'Dedicated endpoint plus versioned handoff.',
          rolloutPlan: 'Canary then default on.',
        },
        monitoringSpec: {
          service: 'workflow-audit-api',
          dashboardUrls: ['https://dash.example/handoff-v2'],
          alertPolicies: ['Latency budget breach', 'Error budget breach'],
          runbook: 'docs/runbooks/audit-foundation.md',
          successMetrics: ['p95 under 250ms', 'error rate under 1%'],
        },
      }),
    });
    assert.equal(response.status, 200);
    const revisedHandoff = await response.json();
    assert.equal(revisedHandoff.data.version, 2);
    assert.equal(revisedHandoff.data.engineerTier, 'Principal');

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-HO-1:IMPLEMENTATION:ok', payload: { from_stage: 'TECHNICAL_SPEC', to_stage: 'IMPLEMENTATION' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/state`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-handoff', roles: ['reader'] }),
    });
    const state = await response.json();
    assert.equal(state.engineer_tier, 'Principal');
    assert.equal(state.architect_handoff_version, 2);
    assert.equal(state.ready_for_engineering, true);
  });
});

test('validates required architect handoff fields and feature flag state', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-handoff', roles: ['architect', 'contributor'] }),
    };

    await fetch(`${baseUrl}/tasks/TSK-HO-2/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-HO-2', payload: { title: 'Architect handoff validation', initial_stage: 'ARCHITECT_REVIEW' } }),
    });

    let response = await fetch(`${baseUrl}/tasks/TSK-HO-2/architect-handoff`, {
      method: 'PUT',
      headers: architectHeaders,
      body: JSON.stringify({
        readyForEngineering: false,
        engineerTier: '',
        tierRationale: '',
        technicalSpec: { summary: '', scope: '', design: '', rolloutPlan: '' },
        monitoringSpec: { service: '', dashboardUrls: [], alertPolicies: [], runbook: '', successMetrics: [] },
      }),
    });
    assert.equal(response.status, 400);
    const invalidBody = await response.json();
    assert.equal(invalidBody.error.code, 'missing_required_architect_fields');
    assert.ok(invalidBody.error.details.missing_fields.includes('technicalSpec.summary'));
    assert.ok(invalidBody.error.details.missing_fields.includes('readyForEngineering'));
  });

  await withServer(async ({ baseUrl, secret }) => {
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-handoff', roles: ['architect', 'contributor'] }),
    };

    const response = await fetch(`${baseUrl}/tasks/TSK-HO-3/architect-handoff`, {
      method: 'PUT',
      headers: architectHeaders,
      body: JSON.stringify({
        readyForEngineering: true,
        engineerTier: 'Sr',
        tierRationale: 'Disabled path test.',
        technicalSpec: { summary: 'a', scope: 'b', design: 'c', rolloutPlan: 'd' },
        monitoringSpec: { service: 'svc', dashboardUrls: ['x'], alertPolicies: ['y'], runbook: 'z', successMetrics: ['m'] },
      }),
    });
    assert.equal(response.status, 503);
    const disabledBody = await response.json();
    assert.equal(disabledBody.error.code, 'feature_disabled');
    assert.equal(disabledBody.error.details.feature, 'ff_architect_spec_tiering');
  }, { architectSpecTieringEnabled: false });
});

test('records engineer implementation metadata, exposes the primary reference in detail, and blocks QA until submitted', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-engineer', roles: ['architect', 'contributor'] }),
    };
    const engineerHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'engineer-user', tenant_id: 'tenant-engineer', roles: ['engineer', 'contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-ENG-1', payload: { title: 'Engineer handoff validation', initial_stage: 'ARCHITECT_REVIEW' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-ENG-1:TECHNICAL_SPEC', payload: { from_stage: 'ARCHITECT_REVIEW', to_stage: 'TECHNICAL_SPEC' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.assigned', actorType: 'agent', idempotencyKey: 'assign:TSK-ENG-1:engineer', payload: { assignee: 'engineer' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/architect-handoff`, {
      method: 'PUT',
      headers: architectHeaders,
      body: JSON.stringify({
        readyForEngineering: true,
        engineerTier: 'Sr',
        tierRationale: 'Standard implementation ownership.',
        technicalSpec: {
          summary: 'Engineers need the full architected implementation plan.',
          scope: 'Keep tenant isolation intact.',
          design: 'Submit implementation metadata before QA.',
          rolloutPlan: 'Feature-flag the handoff path.',
        },
        monitoringSpec: {
          service: 'workflow-audit-api',
          dashboardUrls: ['https://dash.example/engineer'],
          alertPolicies: ['Implementation queue latency breach'],
          runbook: 'docs/runbooks/audit-foundation.md',
          successMetrics: ['submission coverage 100%'],
        },
      }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-ENG-1:IMPLEMENTATION', payload: { from_stage: 'TECHNICAL_SPEC', to_stage: 'IMPLEMENTATION' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-ENG-1:QA_TESTING:blocked', payload: { from_stage: 'IMPLEMENTATION', to_stage: 'QA_TESTING' } }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /QA handoff cannot be completed until engineer submission includes a commit SHA or PR URL/);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({
        commitSha: 'abc1234def5678',
        prUrl: 'https://github.com/wiinc1/engineering-team/pull/14',
      }),
    });
    assert.equal(response.status, 200);
    const submissionBody = await response.json();
    assert.equal(submissionBody.data.version, 1);
    assert.equal(submissionBody.data.primaryReference.type, 'pr_url');

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-engineer', roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.context.engineerSubmission.version, 1);
    assert.equal(detail.context.engineerSubmission.commitSha, 'abc1234def5678');
    assert.equal(detail.context.engineerSubmission.primaryReference.label, 'https://github.com/wiinc1/engineering-team/pull/14');
    assert.match(detail.activity.auditLog[0].summary, /Engineer submission recorded/);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-ENG-1:QA_TESTING:ok', payload: { from_stage: 'IMPLEMENTATION', to_stage: 'QA_TESTING' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/state`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-engineer', roles: ['reader'] }),
    });
    const state = await response.json();
    assert.equal(state.current_stage, 'QA_TESTING');
    assert.equal(state.implementation_commit_sha, 'abc1234def5678');
    assert.equal(state.implementation_pr_url, 'https://github.com/wiinc1/engineering-team/pull/14');
  });
});

test('validates engineer metadata formats, stage restrictions, and feature flag state', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const engineerHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'engineer-user', tenant_id: 'tenant-engineer', roles: ['engineer', 'contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-ENG-2/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-ENG-2', payload: { title: 'Engineer metadata validation', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-2/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.assigned', actorType: 'agent', idempotencyKey: 'assign:TSK-ENG-2:engineer', payload: { assignee: 'engineer' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-2/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({ commitSha: '', prUrl: '' }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'invalid_stage');

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-2/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-ENG-2:IN_PROGRESS', payload: { from_stage: 'BACKLOG', to_stage: 'IN_PROGRESS' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-2/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({ commitSha: 'bad sha', prUrl: 'https://example.com/pull/14' }),
    });
    assert.equal(response.status, 400);
    const invalidBody = await response.json();
    assert.equal(invalidBody.error.code, 'invalid_engineer_metadata');
    assert.ok(invalidBody.error.details.invalid_fields.includes('commitSha'));
    assert.ok(invalidBody.error.details.invalid_fields.includes('prUrl'));

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-2/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({ commitSha: '', prUrl: '' }),
    });
    assert.equal(response.status, 400);
    const missingBody = await response.json();
    assert.equal(missingBody.error.code, 'missing_required_engineer_metadata');
    assert.ok(missingBody.error.details.missing_fields.includes('commitShaOrPrUrl'));
  });

  await withServer(async ({ baseUrl, secret }) => {
    const engineerHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'engineer-user', tenant_id: 'tenant-engineer', roles: ['engineer', 'contributor'] }),
    };

    const response = await fetch(`${baseUrl}/tasks/TSK-ENG-3/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({ commitSha: 'abc1234' }),
    });
    assert.equal(response.status, 503);
    const disabledBody = await response.json();
    assert.equal(disabledBody.error.code, 'feature_disabled');
    assert.equal(disabledBody.error.details.feature, 'ff_engineer_submission');
  }, { engineerSubmissionEnabled: false });
});

test('enforces task locking, allows expiry/release recovery, and exempts architect read-only check-ins', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const engineerHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'engineer-user', tenant_id: 'tenant-lock', roles: ['engineer', 'contributor'] }),
    };
    const pmHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'pm-user', tenant_id: 'tenant-lock', roles: ['pm'] }),
    };
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-lock', roles: ['architect', 'contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-LOCK-1', payload: { title: 'Lock semantics', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/lock`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ reason: 'Engineer editing task state', action: 'stage_transition', ttlSeconds: 600 }),
    });
    assert.equal(response.status, 200);
    const firstLock = await response.json();

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/lock`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ reason: 'Extending edit session', action: 'stage_transition', ttlSeconds: 900 }),
    });
    assert.equal(response.status, 200);
    const renewedLock = await response.json();
    assert.notEqual(renewedLock.data.lock.expiresAt, firstLock.data.lock.expiresAt);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/assignment`, {
      method: 'PATCH',
      headers: pmHeaders,
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 409);
    const lockConflict = await response.json();
    assert.equal(lockConflict.error.code, 'task_locked');
    assert.equal(lockConflict.error.details.lock.owner_id, 'engineer-user');

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({
        eventType: 'task.comment_workflow_recorded',
        actorType: 'agent',
        idempotencyKey: 'checkin:TSK-LOCK-1',
        payload: { comment_type: 'architect_check_in', body: 'Read-only architecture check-in while the task is locked.' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({
        eventType: 'task.stage_changed',
        actorType: 'agent',
        idempotencyKey: 'move:TSK-LOCK-1:TODO',
        payload: { from_stage: 'BACKLOG', to_stage: 'TODO' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-lock', roles: ['reader'] }),
    });
    let detail = await response.json();
    assert.equal(response.status, 200);
    assert.equal(detail.meta.lock, null);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/lock`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ reason: 'Wrap-up after transition', action: 'final_cleanup', ttlSeconds: 300 }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/lock`, {
      method: 'DELETE',
      headers: engineerHeaders,
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/assignment`, {
      method: 'PATCH',
      headers: pmHeaders,
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-lock', roles: ['reader'] }),
    });
    detail = await response.json();
    assert.equal(response.status, 200);
    assert.equal(detail.meta.lock, null);
    assert.match(detail.activity.auditLog.find((entry) => entry.type === 'task.lock_conflict').summary, /Task lock conflict/);
    assert.match(detail.activity.auditLog.find((entry) => entry.type === 'task.lock_released').summary, /Task lock released/);
  });
});

test('supports Jr above-skill escalation before implementation starts and lets architects re-tier the task', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const engineerHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'engineer-user', tenant_id: 'tenant-retier', roles: ['engineer', 'contributor'] }),
    };
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-retier', roles: ['architect', 'contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-RETIER-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-RETIER-1',
        payload: {
          title: 'Re-tier candidate',
          initial_stage: 'TECHNICAL_SPEC',
          business_context: 'Cross-service change.',
          acceptance_criteria: ['Tiering is explicit.'],
          definition_of_done: ['Architect updates the tier.'],
          priority: 'P1',
          task_type: 'feature',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RETIER-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({
        eventType: 'task.assigned',
        actorType: 'agent',
        idempotencyKey: 'assign:TSK-RETIER-1:engineer',
        payload: { assignee: 'engineer' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RETIER-1/skill-escalation`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ reason: 'This touches multiple services and rollout sequencing.' }),
    });
    assert.equal(response.status, 202);
    const escalation = await response.json();
    assert.equal(escalation.data.currentEngineerTier, 'Jr');
    assert.equal(escalation.data.requestedTier, 'Sr');

    response = await fetch(`${baseUrl}/tasks/TSK-RETIER-1/retier`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({
        engineerTier: 'Sr',
        tierRationale: 'Needs a senior engineer because the change spans service boundaries.',
        reason: 'accepted_above_skill_escalation',
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RETIER-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-retier', roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.context.skillEscalation.currentEngineerTier, 'Jr');
    assert.equal(detail.context.retiering.engineerTier, 'Sr');
    assert.match(detail.context.retiering.tierRationale, /senior engineer/i);
  });
});

test('reassigns inactive work after two missed check-ins, re-tiers it, and creates a ghosting review task with transferred context', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const engineerHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'engineer-user', tenant_id: 'tenant-ghost', roles: ['engineer', 'contributor'] }),
    };
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-ghost', roles: ['architect', 'contributor'] }),
    };
    const staleCheckInAt = new Date(Date.now() - (31 * 60 * 1000)).toISOString();

    let response = await fetch(`${baseUrl}/tasks/TSK-GHOST-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-GHOST-1',
        payload: {
          title: 'Inactive implementation',
          initial_stage: 'TECHNICAL_SPEC',
          business_context: 'Critical delivery task.',
          acceptance_criteria: ['Reassignment is auditable.'],
          definition_of_done: ['Transfer summary is preserved.'],
          priority: 'P1',
          task_type: 'feature',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-GHOST-1/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'pm-user', tenant_id: 'tenant-ghost', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: 'engineer' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-GHOST-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({
        eventType: 'task.architect_handoff_recorded',
        actorType: 'user',
        idempotencyKey: 'handoff:TSK-GHOST-1',
        payload: {
          ready_for_engineering: true,
          version: 1,
          engineer_tier: 'Jr',
          tier_rationale: 'Initial sizing assumed Jr ownership.',
          technical_spec: { summary: 'Implement the workflow', scope: 'Single task', design: 'API only', rolloutPlan: 'Direct deploy' },
          monitoring_spec: { service: 'audit-api', dashboardUrls: [], alertPolicies: [], runbook: 'docs/runbooks/audit-foundation.md', successMetrics: [] },
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-GHOST-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({
        eventType: 'task.check_in_recorded',
        actorType: 'user',
        idempotencyKey: 'checkin:TSK-GHOST-1',
        occurredAt: staleCheckInAt,
        payload: {
          summary: 'Started tracing the inactive branch.',
          evidence: ['draft notes'],
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-GHOST-1/reassignment`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({
        mode: 'inactivity',
        reason: 'Two check-in windows were missed without new delivery signals.',
      }),
    });
    assert.equal(response.status, 202);
    const reassignment = await response.json();
    assert.equal(reassignment.data.previousEngineerTier, 'Jr');
    assert.equal(reassignment.data.engineerTier, 'Sr');
    assert.equal(reassignment.data.assignee, 'engineer-sr');
    assert.equal(reassignment.data.missedCheckIns, 2);
    assert.match(reassignment.data.ghostingReview.reviewTaskId, /^GHOST-/);
    assert.equal(reassignment.data.transferSummary.prior_assignee, 'engineer');

    response = await fetch(`${baseUrl}/tasks/TSK-GHOST-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-ghost', roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.context.activityMonitoring.thresholdReached, true);
    assert.equal(detail.context.reassignment.mode, 'inactivity');
    assert.equal(detail.context.reassignment.engineerTier, 'Sr');
    assert.equal(detail.context.reassignment.assignee, 'engineer-sr');
    assert.equal(detail.context.ghostingReview.reviewTaskId, reassignment.data.ghostingReview.reviewTaskId);
    assert.equal(detail.context.transferredContext.prior_assignee, 'engineer');
    assert.match(detail.context.transferredContext.reason, /missed/i);

    response = await fetch(`${baseUrl}/tasks/${reassignment.data.ghostingReview.reviewTaskId}`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-ghost', roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    const reviewTask = await response.json();
    assert.match(reviewTask.title, /Inactivity review/);
  });
});

test('restricts engineer-only reassignment signals to the currently assigned engineer role', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const engineerHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'engineer-user', tenant_id: 'tenant-owner', roles: ['engineer', 'contributor'] }),
    };
    const pmHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'pm-user', tenant_id: 'tenant-owner', roles: ['pm'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-OWNER-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-OWNER-1',
        payload: {
          title: 'Ownership constrained task',
          initial_stage: 'IMPLEMENTATION',
          task_type: 'feature',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-OWNER-1/assignment`, {
      method: 'PATCH',
      headers: pmHeaders,
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-OWNER-1/check-ins`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ summary: 'Tried to post an update from the wrong owner role.' }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error.message, /currently assigned owner/i);

    response = await fetch(`${baseUrl}/tasks/TSK-OWNER-1/skill-escalation`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ reason: 'Tried to escalate from the wrong owner role.' }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error.message, /currently assigned owner/i);
  });
});

test('records structured workflow threads with type, blocking state, resolution, and workflow-event linkage', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-thread', roles: ['architect', 'contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-THREAD-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-THREAD-1', payload: { title: 'Structured comments', initial_stage: 'ARCHITECT_REVIEW' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-THREAD-1/workflow-threads`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        commentType: 'escalation',
        title: 'Need PM approval on degraded rollout path',
        body: 'Escalate the missing rollout decision before implementation proceeds.',
        blocking: true,
        linkedEventId: 'evt-rollout-1',
      }),
    });
    assert.equal(response.status, 201);
    const created = await response.json();

    response = await fetch(`${baseUrl}/tasks/TSK-THREAD-1/workflow-threads/${created.threadId}/replies`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ body: 'Added PM follow-up context and deployment constraints.' }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-THREAD-1/workflow-threads/${created.threadId}/resolve`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ resolution: 'PM approved the rollout guardrail.' }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-THREAD-1/workflow-threads`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-thread', roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    const threads = await response.json();
    assert.equal(threads.summary.total, 1);
    assert.equal(threads.summary.resolvedCount, 1);
    assert.equal(threads.items[0].commentType, 'escalation');
    assert.equal(threads.items[0].linkedEventId, 'evt-rollout-1');
    assert.equal(threads.items[0].blocking, true);
    assert.equal(threads.items[0].messages.length, 3);

    response = await fetch(`${baseUrl}/tasks/TSK-THREAD-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-thread', roles: ['reader'] }),
    });
    const detail = await response.json();
    assert.equal(response.status, 200);
    assert.equal(detail.activity.workflowThreads.items[0].commentType, 'escalation');
    assert.match(detail.activity.auditLog[0].summary, /resolved/);
  });
});

test('records structured QA results, routes fail/pass outcomes, preserves re-test linkage, and exposes escalation packages plus fix history', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-qa', roles: ['architect', 'contributor'] }),
    };
    const engineerHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'engineer-user', tenant_id: 'tenant-qa', roles: ['engineer', 'contributor'] }),
    };
    const qaHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'qa-user', tenant_id: 'tenant-qa', roles: ['qa', 'contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-QA-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-QA-1',
        payload: {
          title: 'QA workflow package',
          initial_stage: 'ARCHITECT_REVIEW',
          business_context: 'Ship workflow handoff safely.',
          acceptance_criteria: ['QA artifacts are structured'],
          definition_of_done: ['QA fail routes to implementation', 'QA pass routes to SRE'],
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-QA-1:TECHNICAL_SPEC', payload: { from_stage: 'ARCHITECT_REVIEW', to_stage: 'TECHNICAL_SPEC' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/architect-handoff`, {
      method: 'PUT',
      headers: architectHeaders,
      body: JSON.stringify({
        readyForEngineering: true,
        engineerTier: 'Sr',
        tierRationale: 'Standard implementation with QA loop.',
        technicalSpec: {
          summary: 'Implement structured QA artifact routing.',
          scope: 'No cross-tenant leakage.',
          design: 'Persist QA result artifacts and route by outcome.',
          rolloutPlan: 'Feature-flag the QA path.',
        },
        monitoringSpec: {
          service: 'workflow-audit-api',
          dashboardUrls: ['https://dash.example/qa'],
          alertPolicies: ['QA handoff failures'],
          runbook: 'docs/runbooks/audit-foundation.md',
          successMetrics: ['QA route coverage 100%'],
        },
      }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-QA-1:IMPLEMENTATION', payload: { from_stage: 'TECHNICAL_SPEC', to_stage: 'IMPLEMENTATION' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.assigned', actorType: 'agent', idempotencyKey: 'assign:TSK-QA-1:engineer', payload: { assignee: 'engineer' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({ commitSha: 'abc1234def5678', prUrl: 'https://github.com/wiinc1/engineering-team/pull/101' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-QA-1:QA_TESTING', payload: { from_stage: 'IMPLEMENTATION', to_stage: 'QA_TESTING' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/qa-results`, {
      method: 'POST',
      headers: qaHeaders,
      body: JSON.stringify({
        outcome: 'fail',
        summary: 'Regression in the audit history view.',
        scenarios: ['history tab render'],
        findings: ['timeline does not show latest event'],
        reproductionSteps: ['open task detail', 'switch to history'],
        stackTraces: ['TypeError: timeline is undefined'],
        envLogs: ['browser:chromium', 'api:local'],
        retestScope: ['history tab render', 'timeline pagination'],
      }),
    });
    assert.equal(response.status, 201);
    const failedQa = await response.json();
    assert.equal(failedQa.data.routedToStage, 'IMPLEMENTATION');
    assert.equal(failedQa.data.escalationPackage.routing.required_engineer_tier, 'Sr');
    assert.equal(failedQa.data.escalationPackage.previous_fix_history.length, 1);
    assert.equal(failedQa.data.escalationPackage.notification_preview.recipient_role, 'engineer');
    assert.equal(failedQa.data.escalationPackage.notification_preview.highlights[0], 'Regression in the audit history view.');

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/state`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-qa', roles: ['reader'] }),
    });
    let state = await response.json();
    assert.equal(state.current_stage, 'IMPLEMENTATION');

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({ commitSha: 'fedcba987654321', prUrl: 'https://github.com/wiinc1/engineering-team/pull/102' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-QA-1:QA_TESTING:retest', payload: { from_stage: 'IMPLEMENTATION', to_stage: 'QA_TESTING' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/qa-results`, {
      method: 'POST',
      headers: qaHeaders,
      body: JSON.stringify({
        outcome: 'pass',
        summary: 'Scoped re-test passed after the second implementation submission.',
        scenarios: ['history tab render', 'timeline pagination'],
        findings: [],
        reproductionSteps: [],
        stackTraces: [],
        envLogs: [],
        retestScope: ['history tab render', 'timeline pagination'],
      }),
    });
    assert.equal(response.status, 201);
    const passedQa = await response.json();
    assert.equal(passedQa.data.runKind, 'retest');
    assert.equal(passedQa.data.routedToStage, 'SRE_MONITORING');

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-qa', roles: ['reader'] }),
    });
    const detail = await response.json();
    assert.equal(response.status, 200);
    assert.equal(detail.context.qaResults.summary.total, 2);
    assert.equal(detail.context.qaResults.latest.runKind, 'retest');
    assert.equal(detail.context.qaResults.latest.priorRunId, failedQa.data.runId);
    assert.equal(detail.context.implementationHistory.length, 2);
    assert.equal(detail.context.qaResults.items[1].escalationPackage.pm_requirements.business_context, 'Ship workflow handoff safely.');

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/state`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-qa', roles: ['reader'] }),
    });
    state = await response.json();
    assert.equal(state.current_stage, 'SRE_MONITORING');
  });
});

test('starts SRE monitoring after deploy confirmation and allows early approval into close review', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-sre', roles: ['contributor'] }),
    };
    const sreHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'sre-1', tenant_id: 'tenant-sre', roles: ['sre', 'reader'] }),
    };
    const engineerHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'engineer-1', tenant_id: 'tenant-sre', roles: ['engineer', 'contributor'] }),
    };
    const qaHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'qa-1', tenant_id: 'tenant-sre', roles: ['qa', 'contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-SRE-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-SRE-1',
        payload: {
          title: 'Monitor production rollout',
          initial_stage: 'IMPLEMENTATION',
          linked_prs: [{
            id: 'pr-sre-1',
            number: 501,
            title: 'feat: sre monitoring',
            repository: 'wiinc1/engineering-team',
            merged: true,
            state: 'closed',
            merged_at: '2026-04-14T12:00:00.000Z',
          }],
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.assigned',
        actorType: 'user',
        idempotencyKey: 'assign:TSK-SRE-1:engineer-1',
        payload: { assignee: 'engineer-1' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-1/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({ commitSha: 'abc1234def5678', prUrl: 'https://github.com/wiinc1/engineering-team/pull/501' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.stage_changed',
        actorType: 'user',
        idempotencyKey: 'move:TSK-SRE-1:QA_TESTING',
        payload: {
          from_stage: 'IMPLEMENTATION',
          to_stage: 'QA_TESTING',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-1/qa-results`, {
      method: 'POST',
      headers: qaHeaders,
      body: JSON.stringify({
        outcome: 'pass',
        summary: 'Deployment validation stayed stable.',
        scenarios: ['smoke'],
        findings: [],
        reproductionSteps: [],
        stackTraces: [],
        envLogs: [],
        retestScope: ['smoke'],
      }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-1/sre-monitoring/start`, {
      method: 'POST',
      headers: sreHeaders,
      body: JSON.stringify({
        deploymentEnvironment: 'production',
        deploymentUrl: 'https://deploy.example/releases/501',
        deploymentVersion: '2026.04.14-1',
      }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-1/detail`, {
      headers: authHeaders(secret, { sub: 'sre-1', tenant_id: 'tenant-sre', roles: ['sre', 'reader'] }),
    });
    assert.equal(response.status, 200);
    let detail = await response.json();
    assert.equal(detail.context.sreMonitoring.state, 'active');
    assert.equal(detail.context.sreMonitoring.deployment.environment, 'production');
    assert.equal(detail.context.sreMonitoring.deployment.version, '2026.04.14-1');
    assert.equal(detail.context.sreMonitoring.commitSha, 'abc1234def5678');

    response = await fetch(`${baseUrl}/tasks`, {
      headers: authHeaders(secret, { sub: 'sre-1', tenant_id: 'tenant-sre', roles: ['sre', 'reader'] }),
    });
    assert.equal(response.status, 200);
    const list = await response.json();
    const monitoringRow = list.items.find((item) => item.task_id === 'TSK-SRE-1');
    assert.equal(monitoringRow.monitoring.deployment.environment, 'production');
    assert.equal(monitoringRow.monitoring.deployment.version, '2026.04.14-1');
    assert.equal(monitoringRow.monitoring.deployment.url, 'https://deploy.example/releases/501');

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-1/sre-monitoring/approve`, {
      method: 'POST',
      headers: sreHeaders,
      body: JSON.stringify({
        reason: 'Stable metrics, logs, and traces after deployment.',
        evidence: ['latency steady', 'error budget unchanged'],
      }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-1/state`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-sre', roles: ['reader'] }),
    });
    const state = await response.json();
    assert.equal(state.current_stage, 'PM_CLOSE_REVIEW');

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-1/detail`, {
      headers: authHeaders(secret, { sub: 'sre-1', tenant_id: 'tenant-sre', roles: ['sre', 'reader'] }),
    });
    detail = await response.json();
    assert.equal(detail.context.sreMonitoring.state, 'approved');
    assert.equal(detail.context.sreMonitoring.approval.reason, 'Stable metrics, logs, and traces after deployment.');
  });
});

test('auto-escalates expired SRE monitoring windows into human stakeholder review without read side effects', async () => {
  await withServer(async ({ baseUrl, secret, store }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-sre', roles: ['contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-SRE-2/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-SRE-2',
        payload: {
          title: 'Expired monitoring task',
          initial_stage: 'SRE_MONITORING',
          linked_prs: [{
            id: 'pr-sre-2',
            number: 502,
            title: 'feat: expired sre monitoring',
            repository: 'wiinc1/engineering-team',
            merged: true,
            state: 'closed',
            merged_at: '2026-04-13T12:00:00.000Z',
          }],
        },
      }),
    });
    assert.equal(response.status, 202);

    let stateResponse = await fetch(`${baseUrl}/tasks/TSK-SRE-2/state`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-sre', roles: ['reader'] }),
    });
    assert.equal(stateResponse.status, 200);
    let state = await stateResponse.json();
    assert.equal(state.waiting_state, null);

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-2/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.sre_monitoring_started',
        actorType: 'user',
        idempotencyKey: 'start:TSK-SRE-2',
        payload: {
          deployment_environment: 'production',
          deployment_url: 'https://deploy.example/releases/502',
          deployment_version: '2026.04.12-1',
          deployment_status: 'success',
          window_hours: 48,
          window_ends_at: '2026-04-13T00:00:00.000Z',
        },
      }),
    });
    assert.equal(response.status, 202);

    const expiryProcessing = await store.processExpiredSreMonitoring();
    assert.equal(expiryProcessing.processed, 1);

    response = await fetch(`${baseUrl}/tasks`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-sre', roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    const list = await response.json();
    const expiredItem = list.items.find((item) => item.task_id === 'TSK-SRE-2');
    assert.equal(expiredItem.monitoring.state, 'escalated');

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-2/detail`, {
      headers: authHeaders(secret, { sub: 'sre-1', tenant_id: 'tenant-sre', roles: ['sre', 'reader'] }),
    });
    const detail = await response.json();
    assert.equal(detail.context.sreMonitoring.state, 'escalated');
    assert.equal(detail.summary.nextAction.label, 'Human stakeholder escalation required after monitoring window expiry.');

    stateResponse = await fetch(`${baseUrl}/tasks/TSK-SRE-2/state`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-sre', roles: ['reader'] }),
    });
    state = await stateResponse.json();
    assert.equal(state.waiting_state, 'awaiting_human_stakeholder_escalation');
  });
});

test('creates a linked P0 child task from an SRE monitoring anomaly and blocks the parent with PM re-entry context', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-sre', roles: ['contributor'] }),
    };
    const sreHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'sre-1', tenant_id: 'tenant-sre', roles: ['sre', 'reader'] }),
    };
    const pmHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'pm-1', tenant_id: 'tenant-sre', roles: ['pm', 'reader'] }),
    };
    const readerHeaders = authHeaders(secret, { tenant_id: 'tenant-sre', roles: ['reader'] });

    let response = await fetch(`${baseUrl}/tasks/TSK-SRE-ANOM-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-SRE-ANOM-1',
        payload: {
          title: 'Watch checkout rollout',
          initial_stage: 'SRE_MONITORING',
          linked_prs: [{
            id: 'pr-sre-anom-1',
            number: 503,
            title: 'feat: rollout checkout',
            repository: 'wiinc1/engineering-team',
            merged: true,
            state: 'closed',
            merged_at: '2026-04-14T12:00:00.000Z',
          }],
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-ANOM-1/sre-monitoring/anomaly-child-task`, {
      method: 'POST',
      headers: sreHeaders,
      body: JSON.stringify({
        title: 'Investigate checkout-api anomaly for TSK-SRE-ANOM-1',
        service: 'checkout-api',
        anomalySummary: '5xx rate spiked after deployment.',
        metrics: ['5xx_rate: 8%', 'latency_p95: 4.2s'],
        logs: ['checkout-api pod restart loop', 'gateway timeout burst'],
        errorSamples: ['TimeoutError at POST /checkout'],
      }),
    });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.data.parentTaskId, 'TSK-SRE-ANOM-1');
    assert.equal(created.data.priority, 'P0');
    assert.equal(created.data.waitingState, 'pm_business_context_required');
    const childTaskId = created.data.childTaskId;

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-ANOM-1/detail`, {
      headers: readerHeaders,
    });
    assert.equal(response.status, 200);
    const parentDetail = await response.json();
    assert.equal(parentDetail.summary.blockedState.label, 'Blocked');
    assert.equal(parentDetail.summary.blockedState.waitingOn, 'Child task investigation');
    assert.equal(parentDetail.summary.childStatus.total, 1);
    assert.equal(parentDetail.relations.childTasks[0].id, childTaskId);
    assert.equal(parentDetail.blockers[0].freezeScope.join(','), 'stage_transitions,closure');
    assert.equal(parentDetail.blockers[0].commentable, true);

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-ANOM-1/sre-monitoring/approve`, {
      method: 'POST',
      headers: sreHeaders,
      body: JSON.stringify({
        reason: 'Telemetry is stable.',
        evidence: ['no new errors'],
      }),
    });
    assert.equal(response.status, 409);

    response = await fetch(`${baseUrl}/tasks/${childTaskId}/detail`, {
      headers: readerHeaders,
    });
    assert.equal(response.status, 200);
    const childDetail = await response.json();
    assert.equal(childDetail.task.priority, 'P0');
    assert.equal(childDetail.summary.owner.label, 'pm');
    assert.equal(childDetail.summary.nextAction.label, 'PM must review and complete the machine-generated business context before Architect details begin.');
    assert.equal(childDetail.relations.parentTask.id, 'TSK-SRE-ANOM-1');
    assert.equal(childDetail.context.anomalyChildTask.service, 'checkout-api');
    assert.equal(childDetail.context.anomalyChildTask.summary, '5xx rate spiked after deployment.');
    assert.equal(childDetail.context.pmBusinessContextReview.finalized, false);

    response = await fetch(`${baseUrl}/tasks/${childTaskId}/state`, {
      headers: readerHeaders,
    });
    assert.equal(response.status, 200);
    const childState = await response.json();
    assert.equal(childState.priority, 'P0');
    assert.equal(childState.assignee, 'pm');
    assert.equal(childState.waiting_state, 'pm_business_context_required');

    response = await fetch(`${baseUrl}/tasks/${childTaskId}/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.stage_changed',
        actorType: 'agent',
        idempotencyKey: `move:${childTaskId}:ARCHITECT_REVIEW:blocked`,
        payload: { from_stage: 'BACKLOG', to_stage: 'ARCHITECT_REVIEW' },
      }),
    });
    assert.equal(response.status, 400);

    response = await fetch(`${baseUrl}/tasks/${childTaskId}/pm-business-context`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({
        businessContext: 'PM reviewed the anomaly, confirmed customer impact, and approved architect follow-up.',
      }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/${childTaskId}/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.stage_changed',
        actorType: 'agent',
        idempotencyKey: `move:${childTaskId}:TODO`,
        payload: { from_stage: 'BACKLOG', to_stage: 'TODO' },
      }),
    });
    assert.equal(response.status, 202);
    response = await fetch(`${baseUrl}/tasks/${childTaskId}/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.stage_changed',
        actorType: 'agent',
        idempotencyKey: `move:${childTaskId}:IN_PROGRESS`,
        payload: { from_stage: 'TODO', to_stage: 'IN_PROGRESS' },
      }),
    });
    assert.equal(response.status, 202);
    response = await fetch(`${baseUrl}/tasks/${childTaskId}/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.stage_changed',
        actorType: 'agent',
        idempotencyKey: `move:${childTaskId}:VERIFY`,
        payload: { from_stage: 'IN_PROGRESS', to_stage: 'VERIFY' },
      }),
    });
    assert.equal(response.status, 202);
    response = await fetch(`${baseUrl}/tasks/${childTaskId}/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.stage_changed',
        actorType: 'agent',
        idempotencyKey: `move:${childTaskId}:DONE`,
        payload: { from_stage: 'VERIFY', to_stage: 'DONE' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SRE-ANOM-1/detail`, {
      headers: readerHeaders,
    });
    assert.equal(response.status, 200);
    const unblockedParentDetail = await response.json();
    assert.equal(unblockedParentDetail.summary.blockedState.label, 'Active');
    assert.equal(unblockedParentDetail.blockers.length, 0);
  });
});

test('projects close-review readiness, cancellation recommendations, human decision state, and backtrack reasons', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-close', roles: ['contributor'] }),
    };
    const readerHeaders = authHeaders(secret, { tenant_id: 'tenant-close', roles: ['reader'] });

    let response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-CLOSE-1',
        payload: {
          title: 'Governed close review task',
          initial_stage: 'PM_CLOSE_REVIEW',
          acceptance_criteria: ['Ship governed close review', 'Preserve cancellation recommendations'],
          linked_prs: [{
            id: 'pr-close-1',
            number: 601,
            title: 'feat: governed close review',
            repository: 'wiinc1/engineering-team',
            merged: true,
            state: 'closed',
            merged_at: '2026-04-15T12:00:00.000Z',
          }],
          waiting_state: 'awaiting_human_close_review',
          next_required_action: 'Human close review is required before final closure.',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CHILD-CLOSE-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-CHILD-CLOSE-1',
        payload: {
          title: 'Open anomaly child',
          initial_stage: 'BACKLOG',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.child_link_added',
        actorType: 'agent',
        idempotencyKey: 'child-link:TSK-CLOSE-1',
        payload: {
          child_task_id: 'TSK-CHILD-CLOSE-1',
          relationship_type: 'monitoring_anomaly',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.sre_approval_recorded',
        actorType: 'user',
        idempotencyKey: 'sre-approval:TSK-CLOSE-1',
        payload: {
          reason: 'Production telemetry remained stable.',
          evidence: ['latency within guardrail'],
          waiting_state: 'awaiting_human_close_review',
          next_required_action: 'Human close review is required before final closure.',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.decision_recorded',
        actorType: 'user',
        idempotencyKey: 'decision:pm-cancel:TSK-CLOSE-1',
        payload: {
          decision_type: 'cancellation_recommendation',
          actor_role: 'pm',
          outcome: 'recommend_cancel',
          summary: 'PM recommends cancellation because the close gate is no longer achievable this sprint.',
          rationale: 'Customer timing changed and the open anomaly child task removes the business value of immediate release.',
          artifact: { recommendation_id: 'pm-rec-1' },
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.decision_recorded',
        actorType: 'user',
        idempotencyKey: 'decision:architect-cancel:TSK-CLOSE-1',
        payload: {
          decision_type: 'cancellation_recommendation',
          actor_role: 'architect',
          outcome: 'recommend_cancel',
          summary: 'Architect agrees cancellation is the safer path.',
          rationale: 'Open anomaly remediation means the close gate is not technically satisfiable.',
          artifact: { recommendation_id: 'arch-rec-1' },
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.escalated',
        actorType: 'user',
        idempotencyKey: 'escalation:exceptional-dispute:TSK-CLOSE-1',
        payload: {
          severity: 'critical',
          reason: 'exceptional_dispute',
          summary: 'PM and Architect dispute whether cancellation is safer than reopening implementation.',
          rationale: 'The business case for cancellation changed, but the engineering cost to reopen remains acceptable.',
          recommendation_summary: 'Human stakeholder should decide whether to cancel or reopen implementation.',
          waiting_state: 'awaiting_human_stakeholder_escalation',
          next_required_action: 'Human stakeholder escalation required for exceptional dispute.',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.decision_recorded',
        actorType: 'user',
        idempotencyKey: 'decision:human-context:TSK-CLOSE-1',
        payload: {
          decision_type: 'human_close_decision',
          actor_role: 'human',
          outcome: 'request_more_context',
          summary: 'Human stakeholder needs a clearer release-vs-cancel tradeoff.',
          rationale: 'Provide the customer impact and the expected time to close the anomaly child task.',
          confirmation_required: true,
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.decision_recorded',
        actorType: 'user',
        idempotencyKey: 'decision:backtrack:TSK-CLOSE-1',
        payload: {
          decision_type: 'close_backtrack',
          actor_role: 'pm',
          outcome: 'child_tasks_open',
          summary: 'Backtrack to implementation if cancellation is rejected.',
          rationale: 'The open anomaly child task means the close gate failed.',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-1/detail`, {
      headers: readerHeaders,
    });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.context.closeGovernance.enabled, true);
    assert.equal(detail.context.closeGovernance.readiness.state, 'blocked');
    assert.equal(detail.context.closeGovernance.readiness.normalizedSignals.acceptanceCriteriaRecorded, true);
    assert.equal(detail.context.closeGovernance.readiness.normalizedSignals.monitoringResolved, true);
    assert.equal(detail.context.closeGovernance.readiness.normalizedSignals.linkedPrsClosed, true);
    assert.equal(detail.context.closeGovernance.readiness.normalizedSignals.childTasksClosed, false);
    assert.equal(detail.context.closeGovernance.cancellation.proposed, true);
    assert.equal(detail.context.closeGovernance.cancellation.recommendations.pm.artifact.recommendation_id, 'pm-rec-1');
    assert.equal(detail.context.closeGovernance.cancellation.recommendations.architect.artifact.recommendation_id, 'arch-rec-1');
    assert.equal(detail.context.closeGovernance.cancellation.awaitingHumanDecision, true);
    assert.equal(detail.context.closeGovernance.cancellation.requestMoreContextCount, 1);
    assert.equal(detail.context.closeGovernance.humanDecision.status, 'requested_more_context');
    assert.equal(detail.context.closeGovernance.humanDecision.latestDecision.confirmationRequired, true);
    assert.equal(detail.context.closeGovernance.escalation.source, 'exceptional_dispute');
    assert.equal(detail.context.closeGovernance.escalation.recommendation, 'Human stakeholder should decide whether to cancel or reopen implementation.');
    assert.equal(detail.context.closeGovernance.backtrack.available, true);
    assert.equal(detail.context.closeGovernance.backtrack.latestReason, 'The open anomaly child task means the close gate failed.');

    response = await fetch(`${baseUrl}/tasks`, {
      headers: readerHeaders,
    });
    assert.equal(response.status, 200);
    const list = await response.json();
    const row = list.items.find((item) => item.task_id === 'TSK-CLOSE-1');
    assert.equal(row.close_governance.enabled, true);
    assert.equal(row.close_governance.readiness.state, 'blocked');
    assert.equal(row.close_governance.humanDecision.status, 'requested_more_context');
    assert.equal(row.close_governance.cancellation.awaitingHumanDecision, true);
    assert.equal(row.close_governance.escalation.source, 'exceptional_dispute');
  });
});

test('records governed close-review recommendations, human decisions, and backtracks to implementation', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-close', roles: ['contributor'] }),
    };
    const pmHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'pm-1', tenant_id: 'tenant-close', roles: ['pm', 'reader'] }),
    };
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-1', tenant_id: 'tenant-close', roles: ['architect'] }),
    };
    const humanHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'human-1', tenant_id: 'tenant-close', roles: ['stakeholder'] }),
    };
    const readerHeaders = authHeaders(secret, { tenant_id: 'tenant-close', roles: ['reader'] });

    let response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-ROUTE-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-CLOSE-ROUTE-1',
        payload: {
          title: 'Close review route coverage',
          initial_stage: 'PM_CLOSE_REVIEW',
          acceptance_criteria: ['Keep close governance auditable'],
          waiting_state: 'awaiting_human_close_review',
          next_required_action: 'Human close review is required before final closure.',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-ROUTE-1/close-review/cancellation-recommendation`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({
        summary: 'PM recommends cancellation because the release window closed.',
        rationale: 'The business deadline passed while the task remained in close review.',
      }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-ROUTE-1/close-review/cancellation-recommendation`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({
        summary: 'Architect agrees cancellation is the safer governed outcome.',
        rationale: 'The close gate cannot complete without reopening implementation.',
      }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-ROUTE-1/close-review/exceptional-dispute`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({
        summary: 'PM disputes whether cancellation is safer than reopening implementation.',
        recommendation: 'Human stakeholder should decide whether to cancel or reopen implementation.',
        rationale: 'The customer timing changed, but delivery can still finish if implementation resumes.',
        severity: 'critical',
      }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-ROUTE-1/close-review/human-decision`, {
      method: 'POST',
      headers: humanHeaders,
      body: JSON.stringify({
        outcome: 'request_more_context',
        summary: 'Human stakeholder wants the remediation timeline before deciding.',
        rationale: 'Need a clearer tradeoff between cancellation and reopening implementation.',
        confirmationRequired: true,
      }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-ROUTE-1/detail`, {
      headers: readerHeaders,
    });
    assert.equal(response.status, 200);
    let detail = await response.json();
    assert.equal(detail.context.closeGovernance.cancellation.awaitingHumanDecision, true);
    assert.equal(detail.context.closeGovernance.humanDecision.status, 'requested_more_context');
    assert.equal(detail.context.closeGovernance.escalation.source, 'exceptional_dispute');
    assert.equal(detail.context.closeGovernance.escalation.severity, 'critical');

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-ROUTE-1/close-review/backtrack`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({
        reasonCode: 'criteria_gap',
        rationale: 'The release evidence package is incomplete and needs implementation follow-up.',
        agreementArtifact: 'pm+architect-close-review-2026-04-15',
        summary: 'Close review backtracked after joint PM/Architect agreement.',
      }),
    });
    assert.equal(response.status, 202);
    const backtrackPayload = await response.json();
    assert.equal(backtrackPayload.data.awaitingRole, 'architect');

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-ROUTE-1/state`, {
      headers: readerHeaders,
    });
    assert.equal(response.status, 200);
    let state = await response.json();
    assert.equal(state.current_stage, 'PM_CLOSE_REVIEW');

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-ROUTE-1/close-review/backtrack`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({
        reasonCode: 'criteria_gap',
        rationale: 'The release evidence package is incomplete and needs implementation follow-up.',
        agreementArtifact: 'pm+architect-close-review-2026-04-15',
        summary: 'Close review backtracked after joint PM/Architect agreement.',
      }),
    });
    assert.equal(response.status, 201);
    const finalBacktrackPayload = await response.json();
    assert.equal(finalBacktrackPayload.data.routedToStage, 'IMPLEMENTATION');

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-ROUTE-1/state`, {
      headers: readerHeaders,
    });
    assert.equal(response.status, 200);
    state = await response.json();
    assert.equal(state.current_stage, 'IMPLEMENTATION');

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-ROUTE-1/detail`, {
      headers: readerHeaders,
    });
    detail = await response.json();
    assert.equal(detail.context.closeGovernance.backtrack.latestReason, 'The release evidence package is incomplete and needs implementation follow-up.');
  });
});

test('rejects human decisions that are not yet decision-ready and requires dual-party backtrack agreement', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-close', roles: ['contributor'] }),
    };
    const pmHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'pm-1', tenant_id: 'tenant-close', roles: ['pm', 'reader'] }),
    };
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-1', tenant_id: 'tenant-close', roles: ['architect'] }),
    };
    const humanHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'human-1', tenant_id: 'tenant-close', roles: ['stakeholder'] }),
    };
    const readerHeaders = authHeaders(secret, { tenant_id: 'tenant-close', roles: ['reader'] });

    let response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-GUARDS-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-CLOSE-GUARDS-1',
        payload: {
          title: 'Close governance guardrails',
          initial_stage: 'PM_CLOSE_REVIEW',
          acceptance_criteria: ['Keep human close decisions explicit'],
          waiting_state: 'awaiting_human_close_review',
          next_required_action: 'Human close review is required before final closure.',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-GUARDS-1/close-review/human-decision`, {
      method: 'POST',
      headers: humanHeaders,
      body: JSON.stringify({
        outcome: 'approve',
        summary: 'Approving before the workflow is decision-ready.',
        rationale: 'This should be rejected until governance prerequisites are met.',
      }),
    });
    assert.equal(response.status, 409);
    let payload = await response.json();
    assert.equal(payload.error.code, 'human_close_decision_not_ready');

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-GUARDS-1/close-review/cancellation-recommendation`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({
        summary: 'PM recommends cancellation because the release window closed.',
        rationale: 'The business deadline passed while the task remained in close review.',
      }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-GUARDS-1/close-review/human-decision`, {
      method: 'POST',
      headers: humanHeaders,
      body: JSON.stringify({
        outcome: 'reject',
        summary: 'Still not decision-ready with only one recommendation.',
        rationale: 'Architect evidence is still missing.',
      }),
    });
    assert.equal(response.status, 409);
    payload = await response.json();
    assert.equal(payload.error.code, 'human_close_decision_not_ready');

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-GUARDS-1/close-review/backtrack`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({
        reasonCode: 'criteria_gap',
        rationale: 'The close gate failed and implementation follow-up is required.',
        agreementArtifact: 'pm+architect-close-review-2026-04-16',
        summary: 'PM recommends backtracking the task.',
      }),
    });
    assert.equal(response.status, 202);
    payload = await response.json();
    assert.equal(payload.data.awaitingRole, 'architect');

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-GUARDS-1/state`, {
      headers: readerHeaders,
    });
    assert.equal(response.status, 200);
    let state = await response.json();
    assert.equal(state.current_stage, 'PM_CLOSE_REVIEW');

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-GUARDS-1/close-review/backtrack`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({
        reasonCode: 'criteria_gap',
        rationale: 'The close gate failed and implementation follow-up is required.',
        agreementArtifact: 'pm+architect-close-review-2026-04-16',
        summary: 'PM recommends backtracking the task.',
      }),
    });
    assert.equal(response.status, 409);
    payload = await response.json();
    assert.equal(payload.error.code, 'close_backtrack_recommendation_already_recorded');

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-GUARDS-1/close-review/backtrack`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({
        reasonCode: 'criteria_gap',
        rationale: 'The close gate failed and implementation follow-up is required.',
        agreementArtifact: 'pm+architect-close-review-2026-04-16',
        summary: 'Architect agrees the task must return to implementation.',
      }),
    });
    assert.equal(response.status, 201);
    payload = await response.json();
    assert.equal(payload.data.routedToStage, 'IMPLEMENTATION');

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-GUARDS-1/state`, {
      headers: readerHeaders,
    });
    assert.equal(response.status, 200);
    state = await response.json();
    assert.equal(state.current_stage, 'IMPLEMENTATION');
  });
});

test('records human decisions for monitoring-expiry escalation items routed through the human inbox', async () => {
  await withServer(async ({ baseUrl, secret, store }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-close', roles: ['contributor'] }),
    };
    const humanHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'human-1', tenant_id: 'tenant-close', roles: ['stakeholder'] }),
    };
    const readerHeaders = authHeaders(secret, { tenant_id: 'tenant-close', roles: ['reader'] });

    let response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-EXPIRY-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-CLOSE-EXPIRY-1',
        payload: {
          title: 'Monitoring expiry escalation',
          initial_stage: 'SRE_MONITORING',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-EXPIRY-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.sre_monitoring_started',
        actorType: 'user',
        idempotencyKey: 'sre-start:TSK-CLOSE-EXPIRY-1',
        payload: {
          deployment_environment: 'production',
          deployment_url: 'https://deploy.example.com',
          deployment_version: '2026.04.15.1',
          deployment_status: 'healthy',
          evidence: ['deploy completed'],
          window_ends_at: '2026-04-10T00:00:00.000Z',
        },
      }),
    });
    assert.equal(response.status, 202);

    const expiryProcessing = await store.processExpiredSreMonitoring();
    assert.equal(expiryProcessing.processed, 1);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-EXPIRY-1/close-review/human-decision`, {
      method: 'POST',
      headers: humanHeaders,
      body: JSON.stringify({
        outcome: 'approve',
        summary: 'Human stakeholder approves escalation handling after monitoring expiry.',
        rationale: '',
        confirmationRequired: false,
      }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/tasks/TSK-CLOSE-EXPIRY-1/detail`, {
      headers: readerHeaders,
    });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.context.closeGovernance.escalation.source, 'monitoring_expiry');
    assert.equal(detail.context.closeGovernance.humanDecision.status, 'approved');
  });
});

test('supports all documented SRE monitoring feature-flag aliases', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/tasks/TSK-SRE-FLAG/sre-monitoring/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-sre', roles: ['sre'] }),
      },
      body: JSON.stringify({
        deploymentEnvironment: 'production',
        deploymentUrl: 'https://deploy.example/releases/900',
        deploymentVersion: '2026.04.15-1',
      }),
    });
    assert.equal(response.status, 503);
  }, { 'ff-sre-monitoring': false });

  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/tasks/TSK-SRE-FLAG/sre-monitoring/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-sre', roles: ['sre'] }),
      },
      body: JSON.stringify({
        deploymentEnvironment: 'production',
        deploymentUrl: 'https://deploy.example/releases/900',
        deploymentVersion: '2026.04.15-1',
      }),
    });
    assert.equal(response.status, 503);
  }, { ff_sre_monitoring: false });
});

test('supports AI-agent registry reads and assignment writes on the audit API path', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const createHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-204/events`, {
      method: 'POST',
      headers: createHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-204', payload: { title: 'Assigned task', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/ai-agents`, { headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }) });
    assert.equal(response.status, 200);
    const agents = await response.json();
    assert.equal(agents.items.some(agent => agent.id === 'qa'), true);

    response = await fetch(`${baseUrl}/tasks/TSK-204/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);
    const assigned = await response.json();
    assert.equal(assigned.data.owner.agentId, 'qa');

    response = await fetch(`${baseUrl}/tasks/TSK-204/state`, { headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }) });
    const state = await response.json();
    assert.equal(state.assignee, 'qa');

    response = await fetch(`${baseUrl}/tasks/TSK-204/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: null }),
    });
    assert.equal(response.status, 200);
    const unassigned = await response.json();
    assert.equal(unassigned.data.owner, null);
  });
});

test('rejects unauthorized or invalid AI-agent assignment attempts', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    await fetch(`${baseUrl}/tasks/TSK-205/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
      },
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-205', payload: { title: 'Protected assignment task', initial_stage: 'BACKLOG' } }),
    });

    let response = await fetch(`${baseUrl}/tasks/TSK-205/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/tasks/TSK-205/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: 'not-real' }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_agent');
  });
});

test('accepts /api-prefixed assignment and agent routes for docs compatibility', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    await fetch(`${baseUrl}/tasks/TSK-206/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
      },
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-206', payload: { title: 'Doc compatibility task', initial_stage: 'BACKLOG' } }),
    });

    let response = await fetch(`${baseUrl}/api/ai-agents`, { headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).items.some(agent => agent.id === 'qa'), true);

    response = await fetch(`${baseUrl}/api/tasks/TSK-206/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.owner.agentId, 'qa');
  });
});

test('returns standardized error payload when feature flag kill switch is off', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const response = await fetch(`${baseUrl}/tasks/TSK-999/history`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }),
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'feature_disabled');
    assert.equal(body.error.details.feature, 'ff_audit_foundation');
    assert.ok(body.error.request_id);
  }, { auditFoundationEnabled: false });
});

test('gates assignment and agent roster behind the task assignment feature flag and kill switch', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/ai-agents`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }),
    });
    assert.equal(response.status, 503);
    let body = await response.json();
    assert.equal(body.error.code, 'feature_disabled');
    assert.equal(body.error.details.feature, 'ff_assign_ai_agent_to_task');

    response = await fetch(`${baseUrl}/tasks/TSK-ASSIGN-FLAG/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 503);
    body = await response.json();
    assert.equal(body.error.details.feature, 'ff_assign_ai_agent_to_task');
  }, { taskAssignmentEnabled: false });

  await withServer(async ({ baseUrl, secret }) => {
    const createHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
    };
    await fetch(`${baseUrl}/tasks/TSK-ASSIGN-KILL/events`, {
      method: 'POST',
      headers: createHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-ASSIGN-KILL', payload: { title: 'Killed task', initial_stage: 'BACKLOG' } }),
    });

    const response = await fetch(`${baseUrl}/tasks/TSK-ASSIGN-KILL/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.details.feature, 'ff_assign_ai_agent_to_task_killswitch');
  }, { taskAssignmentKillSwitchEnabled: true });
});

test('exposes task assignment health and smoke-test endpoints for operators', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/health/task-assignment`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['admin'] }),
    });
    assert.equal(response.status, 200);
    let body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.feature.enabled, true);
    assert.equal(body.feature.killed, false);
    assert.ok(body.dependencies.agent_registry_active_count > 0);

    response = await fetch(`${baseUrl}/api/internal/smoke-test/task-assignment`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['admin'] }),
    });
    assert.equal(response.status, 200);
    body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.checks.length, 3);
  });
});

test('emits assignment-specific metrics and standardized error identifiers', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const createHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-ASSIGN-METRICS/events`, {
      method: 'POST',
      headers: createHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-ASSIGN-METRICS', payload: { title: 'Metric task', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ASSIGN-METRICS/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-ASSIGN-METRICS/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: 'not-real' }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, 'invalid_agent');
    assert.equal(body.error.error_id, 'ERR_TASK_ASSIGNMENT_INVALID_AGENT');
    assert.ok(body.error.requestId);

    response = await fetch(`${baseUrl}/metrics`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['admin'] }),
    });
    const metrics = await response.text();
    assert.match(metrics, /feature_task_assignment_requests_total 2/);
    assert.match(metrics, /feature_task_assignment_errors_total 1/);
    assert.match(metrics, /feature_task_assignment_business_metric 1/);
    assert.match(metrics, /feature_task_assignment_duration_ms_last \d+/);
  });
});

test('returns standardized error payload when task detail page feature flag is off', async () => {
  const prior = process.env.FF_TASK_DETAIL_PAGE;
  process.env.FF_TASK_DETAIL_PAGE = '0';

  try {
    await withServer(async ({ baseUrl, secret }) => {
      const response = await fetch(`${baseUrl}/tasks/TSK-999/detail`, {
        headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }),
      });
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.error.code, 'feature_disabled');
      assert.equal(body.error.details.feature, 'ff_task_detail_page');
      assert.ok(body.error.request_id);
    });
  } finally {
    if (prior == null) delete process.env.FF_TASK_DETAIL_PAGE;
    else process.env.FF_TASK_DETAIL_PAGE = prior;
  }
});

test('lists projected task summaries with owner and unassigned states', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const writeHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-301/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-301', payload: { title: 'Owned task', initial_stage: 'BACKLOG', priority: 'P1' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-302/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-302', payload: { title: 'Unassigned task', initial_stage: 'TODO', priority: 'P2' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-301/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks`, { headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.items.length, 2);
    const owned = payload.items.find(item => item.task_id === 'TSK-301');
    const unassigned = payload.items.find(item => item.task_id === 'TSK-302');
    assert.equal(owned.title, 'Owned task');
    assert.equal(owned.current_owner, 'qa');
    assert.equal(unassigned.current_owner, null);
    assert.equal(unassigned.owner, null);
  });
});
