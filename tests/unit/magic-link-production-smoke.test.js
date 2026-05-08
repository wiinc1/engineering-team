const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildDeploymentEvidence,
  buildDryRunEvidence,
  cookieHeaderFromSetCookies,
  hashEvidence,
  normalizeBaseUrl,
  parseProtectedRoutes,
  runSmoke,
  summarizeChecks,
} = require('../../scripts/verify-magic-link-production');

function jsonResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || null;
      },
      getSetCookie() {
        const setCookie = headers['set-cookie'];
        return Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      },
    },
    json: async () => body,
  };
}

function protectedRouteUrls() {
  return new Set([
    'https://app.example/tasks',
    'https://app.example/tasks?view=board',
    'https://app.example/overview/pm',
  ]);
}

function sessionResponse(init, loggedOut) {
  return init.headers?.cookie && !loggedOut
    ? jsonResponse({
        data: {
          actorId: 'admin-1',
          tenantId: 'tenant-a',
          roles: ['admin'],
          expiresAt: '2026-04-01T08:00:00.000Z',
        },
      })
    : jsonResponse({ error: { code: 'missing_auth_context' } }, 401);
}

function successfulConsumeResponse() {
  return jsonResponse({}, 302, {
    location: '/tasks',
    'set-cookie': [
      'engineering_team_session=session-token; Path=/; HttpOnly; SameSite=Lax',
      'engineering_team_csrf=csrf-token; Path=/; SameSite=Lax',
    ],
  });
}

function createCompleteMagicLinkFetch(requests) {
  let consumeCount = 0;
  let loggedOut = false;
  const routes = protectedRouteUrls();

  return async function fetchImpl(url, init = {}) {
    const requestUrl = String(url);
    requests.push({ url: requestUrl, init });
    if (requestUrl === 'https://app.example/auth/magic-link/request') {
      return jsonResponse({
        ok: true,
        message: 'If the email is eligible, a sign-in link has been sent.',
      });
    }
    if (requestUrl.startsWith('https://app.example/auth/magic-link/consume')) {
      consumeCount += 1;
      return consumeCount > 1
        ? jsonResponse({}, 302, { location: '/sign-in?reason=replayed_magic_link' })
        : successfulConsumeResponse();
    }
    if (requestUrl === 'https://app.example/auth/me') return sessionResponse(init, loggedOut);
    if (routes.has(requestUrl)) return jsonResponse({}, 200);
    if (requestUrl === 'https://app.example/auth/logout') {
      loggedOut = true;
      return jsonResponse({ success: true }, 200, {
        'set-cookie': ['engineering_team_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'],
      });
    }
    throw new Error(`Unexpected fetch ${requestUrl}`);
  };
}

function assertCompleteMagicLinkEvidence(evidence) {
  assert.equal(evidence.summary.passed, true);
  assert.equal(evidence.summary.evidenceRedacted, true);
  assert.equal(evidence.deployment.id, 'dpl_123');
  assert.equal(evidence.deployment.selectedAuthStrategy, 'magic-link');
  assert.equal(evidence.deployment.rollbackTarget, 'last-known-good-magic-link-config');
  assert.equal(evidence.invitedEmailHash, hashEvidence('admin@example.com'));
  assert.equal(evidence.unknownEmailHash, hashEvidence('unknown@example.com'));
  assert.equal(evidence.consume.tokenHash, hashEvidence('raw-token'));
  assert.equal(JSON.stringify(evidence).includes('admin@example.com'), false);
  assert.equal(JSON.stringify(evidence).includes('raw-token'), false);
}

test('production smoke helpers normalize safe evidence without secrets', () => {
  assert.equal(normalizeBaseUrl('https://app.example///'), 'https://app.example');
  assert.throws(() => normalizeBaseUrl('http://app.example'), /HTTPS/);
  assert.equal(hashEvidence('USER@example.com'), hashEvidence('user@example.com'));
  assert.notEqual(hashEvidence('user@example.com'), 'user@example.com');
  assert.equal(
    cookieHeaderFromSetCookies([
      'engineering_team_session=session-token; Path=/; HttpOnly; SameSite=Lax',
      'engineering_team_csrf=csrf-token; Path=/; SameSite=Lax',
    ]),
    'engineering_team_session=session-token; engineering_team_csrf=csrf-token'
  );
  assert.deepEqual(parseProtectedRoutes('/tasks,/overview/pm'), ['/tasks', '/overview/pm']);
});

test('production smoke deployment evidence records metadata without secrets', () => {
  const evidence = buildDeploymentEvidence({
    baseUrl: 'https://app.example',
    deploymentId: 'dpl_123',
    deploymentStatus: 'Ready',
    commitSha: 'abc1234',
    buildTimestamp: '2026-05-07T12:00:00.000Z',
    rollbackTarget: 'last-known-good-magic-link-config',
  });

  assert.deepEqual(evidence, {
    selectedAuthStrategy: 'magic-link',
    id: 'dpl_123',
    url: 'https://app.example',
    status: 'Ready',
    commitSha: 'abc1234',
    buildTimestamp: '2026-05-07T12:00:00.000Z',
    rollbackTarget: 'last-known-good-magic-link-config',
  });
});

test('production smoke dry-run validates inputs without network evidence', () => {
  const evidence = buildDryRunEvidence({
    baseUrl: 'https://app.example',
    email: 'admin@example.com',
    unknownEmail: 'unknown@example.com',
    protectedRoutes: '/tasks,/overview/pm',
    rollbackTarget: 'last-known-good-magic-link-config',
  });

  assert.equal(evidence.dryRun, true);
  assert.equal(evidence.summary.passed, true);
  assert.equal(evidence.summary.networkSkipped, true);
  assert.equal(evidence.deployment.selectedAuthStrategy, 'magic-link');
  assert.equal(evidence.deployment.rollbackTarget, 'last-known-good-magic-link-config');
  assert.deepEqual(evidence.protectedRoutes, ['/tasks', '/overview/pm']);
  assert.equal(JSON.stringify(evidence).includes('admin@example.com'), false);
});

test('production smoke summary requires request, consume, session, routes, logout, unknown email, and replay evidence', () => {
  const summary = summarizeChecks({
    request: { genericResponse: true },
    consume: { status: 302, sessionCookieSet: true, csrfCookieSet: true },
    session: { actorId: 'admin-1', tenantId: 'tenant-a', roles: ['admin'] },
    protectedRoutes: [{ ok: true, redirectedToSignIn: false }],
    logout: { ok: true },
    afterLogout: { authRejected: true },
    unknownEmail: { genericResponse: true },
    replay: { rejected: true },
  });

  assert.equal(summary.passed, true);
  assert.equal(summary.evidenceRedacted, true);
});

test('production smoke runner writes redacted evidence for the complete magic-link flow', async () => {
  const requests = [];
  const fetchImpl = createCompleteMagicLinkFetch(requests);

  const evidence = await runSmoke({
    baseUrl: 'https://app.example',
    email: 'admin@example.com',
    unknownEmail: 'unknown@example.com',
    magicLinkUrl: 'https://app.example/auth/magic-link/consume?token=raw-token&next=%2Ftasks',
    deploymentId: 'dpl_123',
    deploymentStatus: 'Ready',
    commitSha: 'abc1234',
    buildTimestamp: '2026-05-07T12:00:00.000Z',
    rollbackTarget: 'last-known-good-magic-link-config',
    fetchImpl,
  });

  assertCompleteMagicLinkEvidence(evidence);
  assert.ok(requests.some((request) => request.url === 'https://app.example/auth/logout'));
});
