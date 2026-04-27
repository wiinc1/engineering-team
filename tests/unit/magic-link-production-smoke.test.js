const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDryRunEvidence,
  cookieHeaderFromSetCookies,
  hashEvidence,
  normalizeBaseUrl,
  parseProtectedRoutes,
  runSmoke,
  summarizeChecks,
} = require('../../scripts/verify-magic-link-production');

function jsonResponse(payload, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || null;
      },
      getSetCookie() {
        const value = headers['set-cookie'];
        return Array.isArray(value) ? value : value ? [value] : [];
      },
    },
    json: async () => payload,
  };
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
    'engineering_team_session=session-token; engineering_team_csrf=csrf-token',
  );
  assert.deepEqual(parseProtectedRoutes('/tasks,/overview/pm'), ['/tasks', '/overview/pm']);
});

test('production smoke dry-run validates inputs without network evidence', () => {
  const evidence = buildDryRunEvidence({
    baseUrl: 'https://app.example',
    email: 'admin@example.com',
    unknownEmail: 'unknown@example.com',
    protectedRoutes: '/tasks,/overview/pm',
  });

  assert.equal(evidence.dryRun, true);
  assert.equal(evidence.summary.passed, true);
  assert.equal(evidence.summary.networkSkipped, true);
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
});

test('production smoke runner writes redacted evidence for the complete magic-link flow', async () => {
  const calls = [];
  let consumeCount = 0;
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === 'https://app.example/auth/magic-link/request') {
      return jsonResponse({ ok: true, message: 'If the email is eligible, a sign-in link has been sent.' });
    }
    if (url.startsWith('https://app.example/auth/magic-link/consume')) {
      consumeCount += 1;
      if (consumeCount > 1) {
        return jsonResponse({}, 302, {
          location: '/sign-in?reason=replayed_magic_link',
        });
      }
      return jsonResponse({}, 302, {
        location: '/tasks',
        'set-cookie': [
          'engineering_team_session=session-token; Path=/; HttpOnly; SameSite=Lax',
          'engineering_team_csrf=csrf-token; Path=/; SameSite=Lax',
        ],
      });
    }
    if (url === 'https://app.example/auth/me') {
      if (init.headers?.cookie) {
        return jsonResponse({ data: { actorId: 'admin-1', tenantId: 'tenant-a', roles: ['admin'], expiresAt: '2026-04-01T08:00:00.000Z' } });
      }
      return jsonResponse({ error: { code: 'missing_auth_context' } }, 401);
    }
    if (url === 'https://app.example/tasks' || url === 'https://app.example/tasks?view=board' || url === 'https://app.example/overview/pm') {
      return jsonResponse({}, 200);
    }
    if (url === 'https://app.example/auth/logout') {
      return jsonResponse({ success: true }, 200, {
        'set-cookie': ['engineering_team_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'],
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  let afterLogout = false;
  const guardedFetch = async (input, init = {}) => {
    if (String(input) === 'https://app.example/auth/me' && afterLogout) {
      return jsonResponse({ error: { code: 'missing_auth_context' } }, 401);
    }
    if (String(input) === 'https://app.example/auth/logout') afterLogout = true;
    return fetchImpl(input, init);
  };

  const evidence = await runSmoke({
    baseUrl: 'https://app.example',
    email: 'admin@example.com',
    unknownEmail: 'unknown@example.com',
    magicLinkUrl: 'https://app.example/auth/magic-link/consume?token=raw-token&next=%2Ftasks',
    fetchImpl: guardedFetch,
  });

  assert.equal(evidence.summary.passed, true);
  assert.equal(evidence.invitedEmailHash, hashEvidence('admin@example.com'));
  assert.equal(evidence.unknownEmailHash, hashEvidence('unknown@example.com'));
  assert.equal(evidence.consume.tokenHash, hashEvidence('raw-token'));
  assert.equal(JSON.stringify(evidence).includes('admin@example.com'), false);
  assert.equal(JSON.stringify(evidence).includes('raw-token'), false);
  assert.ok(calls.some((call) => call.url === 'https://app.example/auth/logout'));
});
