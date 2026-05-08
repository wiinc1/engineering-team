const assert = require('node:assert/strict');
const test = require('node:test');
const { runRegistrationProductionSmoke } = require('../../lib/auth/registration-production-smoke');

function jsonResponse(status, body = {}, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || null;
      },
      getSetCookie() {
        return headers['set-cookie'] || [];
      },
    },
    async json() {
      return body;
    },
  };
}

test('registration production smoke writes redacted passing evidence', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    if (path === '/auth/magic-link/request') return jsonResponse(410, { error: { code: 'magic_link_removed' } });
    if (path === '/auth/login') {
      return jsonResponse(
        200,
        { data: { next: '/tasks' } },
        {
          'set-cookie': [
            'engineering_team_session=session-secret; Path=/; HttpOnly; SameSite=Lax',
            'engineering_team_csrf=csrf-secret; Path=/; SameSite=Lax',
          ],
        }
      );
    }
    if (path === '/auth/me') {
      return calls.filter((call) => new URL(call.url).pathname === '/auth/logout').length
        ? jsonResponse(401, { error: { code: 'missing_auth_context' } })
        : jsonResponse(200, {
            data: {
              actorId: 'admin-1',
              tenantId: 'tenant-int',
              roles: ['admin'],
              expiresAt: '2026-05-08T20:00:00.000Z',
            },
          });
    }
    if (path === '/tasks') return jsonResponse(200, {});
    if (path === '/auth/password-reset/request') {
      return jsonResponse(200, {
        message: 'If the email is eligible, password reset instructions have been sent.',
      });
    }
    if (path === '/auth/logout') return jsonResponse(200, { success: true });
    throw new Error(`Unexpected route ${path}`);
  };

  const evidence = await runRegistrationProductionSmoke({
    baseUrl: 'https://app.example',
    email: 'approved-admin@example.com',
    password: 'CorrectHorse123!',
    resetEmail: 'unknown-smoke@example.com',
    rollbackTarget: 'registration-last-known-good',
    deploymentId: 'dpl_registration',
    fetchImpl,
    writeEvidence: false,
  });

  assert.equal(evidence.summary.passed, true, JSON.stringify(evidence.summary));
  assert.equal(evidence.magicLink.requestStatus, 410);
  assert.equal(JSON.stringify(evidence).includes('CorrectHorse123!'), false);
  assert.equal(JSON.stringify(evidence).includes('approved-admin@example.com'), false);
  assert.equal(JSON.stringify(evidence).includes('engineering_team_session='), false);
});

test('registration production smoke requires https and login credentials', async () => {
  await assert.rejects(
    () =>
      runRegistrationProductionSmoke({
        baseUrl: 'http://app.example',
        email: 'admin@example.com',
        password: 'CorrectHorse123!',
        fetchImpl: async () => jsonResponse(200, {}),
        writeEvidence: false,
      }),
    /HTTPS/
  );
  await assert.rejects(
    () =>
      runRegistrationProductionSmoke({
        baseUrl: 'https://app.example',
        email: 'admin@example.com',
        fetchImpl: async () => jsonResponse(200, {}),
        writeEvidence: false,
      }),
    /REGISTRATION_PASSWORD/
  );
});
