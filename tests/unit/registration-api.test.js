const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createAuditApiServer } = require('../../lib/audit/http');

async function withServer(callback, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registration-api-'));
  const { server } = createAuditApiServer({
    baseDir,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-session-secret',
    registrationMode: 'open',
    requireEmailVerification: false,
    ...options,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await callback({ baseUrl: `http://127.0.0.1:${port}` });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = headers.get('set-cookie');
  if (!combined) return [];
  return combined.split(/,(?=\s*engineering_team_(?:session|csrf)=)/i).map((value) => value.trim());
}

function parseCookieValue(setCookies, name) {
  const prefix = `${name}=`;
  const cookie = setCookies.find((item) => item.startsWith(prefix));
  if (!cookie) return '';
  return decodeURIComponent(cookie.slice(prefix.length).split(';')[0] || '');
}

function cookieHeader(setCookies) {
  return setCookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

test('registration and login APIs issue cookie sessions and support logout', async () => {
  await withServer(async ({ baseUrl }) => {
    let response = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'api@example.com', password: 'CorrectHorse123!' }),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).message, 'If registration is available for that email, next steps have been sent.');

    response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'api@example.com', password: 'CorrectHorse123!', next: '/tasks?view=board' }),
    });
    assert.equal(response.status, 200);
    const login = await response.json();
    assert.equal(login.data.next, '/tasks?view=board');

    const setCookies = getSetCookieHeaders(response.headers);
    const cookies = cookieHeader(setCookies);
    const csrfToken = parseCookieValue(setCookies, 'engineering_team_csrf');
    assert.ok(parseCookieValue(setCookies, 'engineering_team_session'));
    assert.ok(csrfToken);

    response = await fetch(`${baseUrl}/auth/me`, {
      headers: { cookie: cookies },
    });
    assert.equal(response.status, 200);
    const me = await response.json();
    assert.equal(me.data.tenantId, 'engineering-team');
    assert.deepEqual(me.data.roles, ['reader']);

    response = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie: cookies, 'x-csrf-token': csrfToken },
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/auth/me`, {
      headers: { cookie: cookies },
    });
    assert.equal(response.status, 401);
  });
});

test('removed magic-link API cannot create sessions after registration cutover', async () => {
  await withServer(async ({ baseUrl }) => {
    const request = await fetch(`${baseUrl}/auth/magic-link/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'api@example.com' }),
    });
    assert.equal(request.status, 410);
    assert.equal((await request.json()).error.code, 'magic_link_removed');

    const consume = await fetch(`${baseUrl}/auth/magic-link/consume?token=old-token`, {
      redirect: 'manual',
    });
    assert.equal(consume.status, 302);
    assert.match(consume.headers.get('location'), /magic_link_removed/);
  });
});

test('registration API fails closed when registration is disabled', async () => {
  await withServer(
    async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'api@example.com', password: 'CorrectHorse123!' }),
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'registration_disabled');
    },
    { registrationMode: 'disabled' }
  );
});

test('production auth API routes include grouped Vercel wrappers', () => {
  const wrappers = [
    ['../../api/auth/[...route].js', /\.\.\/_server/],
    ['../../api/auth/magic-link/[...route].js', /\.\.\/\.\.\/_server/],
    ['../../api/auth/password-reset/[...route].js', /\.\.\/\.\.\/_server/],
    ['../../api/auth/email/verify/[...route].js', /\.\.\/\.\.\/\.\.\/_server/],
  ];
  for (const [relativePath, requirePattern] of wrappers) {
    const routePath = path.join(__dirname, relativePath);
    assert.equal(fs.existsSync(routePath), true, `${relativePath} exists`);
    assert.match(fs.readFileSync(routePath, 'utf8'), requirePattern);
  }

  for (const removedWrapper of ['../../api/auth/me.js', '../../api/auth/logout.js', '../../api/auth/users.js']) {
    assert.equal(fs.existsSync(path.join(__dirname, removedWrapper)), false, `${removedWrapper} stays folded into the catch-all`);
  }
});
