const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  hashPassword,
  needsPasswordRehash,
  parsePasswordHash,
  verifyPassword,
} = require('../../lib/auth/credentials');
const {
  createEmailTransport,
  createRegistrationAuthService,
  sanitizeNextPath,
} = require('../../lib/auth/registration');
const { runMigrations } = require('../../lib/audit/postgres');

test('password hashing never stores raw passwords and verifies with timing-safe hashes', () => {
  const encoded = hashPassword('CorrectHorse123!');

  assert.notEqual(encoded, 'CorrectHorse123!');
  assert.equal(encoded.includes('CorrectHorse123!'), false);
  assert.equal(parsePasswordHash(encoded).version, 'scrypt.v1');
  assert.equal(verifyPassword('CorrectHorse123!', encoded), true);
  assert.equal(verifyPassword('WrongHorse123!', encoded), false);
  assert.equal(needsPasswordRehash(encoded), false);
});

test('sanitizeNextPath keeps same-origin relative paths and removes auth routes', () => {
  assert.equal(sanitizeNextPath('/tasks/TSK-1?tab=history'), '/tasks/TSK-1?tab=history');
  assert.equal(sanitizeNextPath('https://evil.example/tasks'), '/tasks');
  assert.equal(sanitizeNextPath('//evil.example/tasks'), '/tasks');
  assert.equal(sanitizeNextPath('/sign-in?next=/tasks'), '/tasks');
  assert.equal(sanitizeNextPath('/auth/register'), '/tasks');
});

test('registration creates credentials without changing existing magic-link-era user identity', async () => {
  const emailTransport = createEmailTransport({ provider: 'test' });
  const service = createRegistrationAuthService({
    emailTransport,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
    registrationMode: 'open',
    requireEmailVerification: false,
    defaultTenantId: 'tenant-new',
    defaultRoles: ['reader'],
  });
  const existing = await service.upsertUser(
    {
      email: 'PM@Example.com',
      tenantId: 'tenant-a',
      actorId: 'pm-1',
      roles: ['pm', 'reader'],
      status: 'active',
    },
    { actorId: 'admin-1', tenantId: 'tenant-a' }
  );

  await service.register({ email: 'pm@example.com', password: 'CorrectHorse123!' });
  const user = await service.store.findUserByEmail('pm@example.com');
  const credential = await service.store.findCredentialByUserId(existing.userId);

  assert.equal(user.tenantId, 'tenant-a');
  assert.equal(user.actorId, 'pm-1');
  assert.deepEqual(user.roles, ['pm', 'reader']);
  assert.equal(user.status, 'active');
  assert.ok(credential.passwordHash.startsWith('scrypt.v1$'));
  assert.equal(JSON.stringify(service.store.auditEvents).includes('CorrectHorse123!'), false);
});

test('registration requires email verification and rejects replayed verification tokens', async () => {
  const emailTransport = createEmailTransport({ provider: 'test' });
  const service = createRegistrationAuthService({
    emailTransport,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
    registrationMode: 'open',
    requireEmailVerification: true,
  });

  await service.register({ email: 'verify@example.com', password: 'CorrectHorse123!' });
  assert.equal(emailTransport.sent.length, 1);
  const token = new URL(emailTransport.sent[0].link).searchParams.get('token');
  await assert.rejects(
    () => service.login({ email: 'verify@example.com', password: 'CorrectHorse123!' }),
    /Verify your email/
  );

  const result = await service.confirmEmailVerification({ token });
  assert.equal(result.user.status, 'active');
  await assert.rejects(() => service.confirmEmailVerification({ token }), /already used/);

  const login = await service.login({ email: 'verify@example.com', password: 'CorrectHorse123!' });
  assert.equal(login.user.actorId.startsWith('user-'), true);
  assert.ok(login.sessionToken);
});

test('default public registration requires admin approval before app access', async () => {
  const service = createRegistrationAuthService({
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
    requireEmailVerification: false,
  });

  const result = await service.register({ email: 'pending@example.com', password: 'CorrectHorse123!' });
  const user = await service.store.findUserByEmail('pending@example.com');

  assert.equal(result.status, 'pending_approval');
  assert.equal(user.status, 'pending_approval');
  await assert.rejects(
    () => service.login({ email: 'pending@example.com', password: 'CorrectHorse123!' }),
    /not active yet/
  );

  await service.upsertUser(
    {
      email: 'pending@example.com',
      tenantId: user.tenantId,
      actorId: user.actorId,
      roles: user.roles,
      status: 'active',
    },
    { actorId: 'admin-1', tenantId: user.tenantId }
  );
  const login = await service.login({ email: 'pending@example.com', password: 'CorrectHorse123!' });
  assert.equal(login.user.status, 'active');
  assert.ok(login.sessionToken);
});

test('login creates cookie sessions, enforces CSRF, and rate-limits repeated failures', async () => {
  const service = createRegistrationAuthService({
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
    registrationMode: 'open',
    requireEmailVerification: false,
  });
  await service.register({ email: 'session@example.com', password: 'CorrectHorse123!' });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await assert.rejects(
      () =>
        service.login({
          email: 'session@example.com',
          password: 'WrongHorse123!',
          ip: '203.0.113.10',
          nowMs: Date.parse('2026-05-08T00:00:00.000Z') + attempt,
        }),
      /Unable to sign in/
    );
  }
  await assert.rejects(
    () =>
      service.login({
        email: 'session@example.com',
        password: 'WrongHorse123!',
        ip: '203.0.113.10',
        nowMs: Date.parse('2026-05-08T00:00:00.000Z') + 11,
      }),
    /temporarily unavailable/
  );

  const login = await service.login({
    email: 'session@example.com',
    password: 'CorrectHorse123!',
    ip: '203.0.113.11',
    nowMs: Date.parse('2026-05-08T00:16:00.000Z'),
  });
  const cookies = service.buildSessionCookies(login.sessionToken, login.csrfToken, login.expiresAt).join('; ');
  const context = await service.getSessionContext(
    { method: 'GET', headers: { cookie: cookies } },
    Date.parse('2026-05-08T00:17:00.000Z')
  );
  assert.equal(context.actorId.startsWith('user-'), true);
  await service.requireCsrf({ method: 'POST', headers: { cookie: cookies, 'x-csrf-token': login.csrfToken } }, context);
  await assert.rejects(() => service.requireCsrf({ method: 'POST', headers: { cookie: cookies } }, context), /CSRF token/);
  const summary = await service.getSecuritySummary();
  assert.equal(summary.loginFailures, 10);
});

test('registration abuse controls classify IP and domain spikes without raw PII', async () => {
  const service = createRegistrationAuthService({
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
    registrationMode: 'open',
    requireEmailVerification: false,
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await service.register({
      email: `signup-${attempt}@example.com`,
      password: 'CorrectHorse123!',
      ip: '198.51.100.10',
      nowMs: Date.parse('2026-05-08T01:00:00.000Z') + attempt,
    });
  }

  const result = await service.register({
    email: 'signup-throttled@example.com',
    password: 'CorrectHorse123!',
    ip: '198.51.100.10',
    nowMs: Date.parse('2026-05-08T01:00:00.000Z') + 11,
  });

  assert.equal(result.message, 'If registration is available for that email, next steps have been sent.');
  const abuseEvent = service.store.auditEvents.find((event) => event.eventType === 'auth.registration.abuse_classified');
  assert.ok(abuseEvent);
  assert.equal(abuseEvent.metadata.ipLimited, true);
  assert.equal(JSON.stringify(abuseEvent).includes('198.51.100.10'), false);
  assert.equal(JSON.stringify(abuseEvent).includes('example.com'), false);
});

test('password reset is generic for unknown emails and rejects replayed tokens', async () => {
  const emailTransport = createEmailTransport({ provider: 'test' });
  const service = createRegistrationAuthService({
    emailTransport,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
    registrationMode: 'open',
    requireEmailVerification: false,
  });
  await service.register({ email: 'reset@example.com', password: 'CorrectHorse123!' });

  const unknown = await service.requestPasswordReset({ email: 'unknown@example.com' });
  assert.equal(unknown.message, 'If the email is eligible, password reset instructions have been sent.');
  assert.equal(emailTransport.sent.length, 0);

  await service.requestPasswordReset({ email: 'reset@example.com' });
  assert.equal(emailTransport.sent.length, 1);
  const token = new URL(emailTransport.sent[0].link).searchParams.get('token');
  await service.confirmPasswordReset({ token, password: 'NewCorrectHorse123!' });
  await assert.rejects(() => service.confirmPasswordReset({ token, password: 'AnotherHorse123!' }), /already used/);
  await assert.rejects(() => service.login({ email: 'reset@example.com', password: 'CorrectHorse123!' }), /Unable to sign in/);
  const login = await service.login({ email: 'reset@example.com', password: 'NewCorrectHorse123!' });
  assert.equal(login.user.email, 'reset@example.com');
});

test('registration credential migration has apply and rollback coverage for auth tables', () => {
  const root = path.join(__dirname, '../..');
  const up = fs.readFileSync(path.join(root, 'db/migrations/011_registration_auth.sql'), 'utf8');
  const down = fs.readFileSync(path.join(root, 'db/migrations/011_registration_auth.down.sql'), 'utf8');

  for (const table of [
    'auth_credentials',
    'auth_email_verification_tokens',
    'auth_password_reset_tokens',
    'auth_login_failures',
  ]) {
    assert.match(up, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(down, new RegExp(`DROP TABLE IF EXISTS ${table}`));
  }
  assert.match(up, /REFERENCES auth_users\(user_id\) ON DELETE CASCADE/);
  assert.match(up, /CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_credentials_active_user/);
});

test('postgres migration runner skips rollback files during forward apply', async () => {
  const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registration-migrations-'));
  fs.writeFileSync(path.join(migrationsDir, '001_apply.sql'), 'SELECT 1 AS up;');
  fs.writeFileSync(path.join(migrationsDir, '001_apply.down.sql'), 'SELECT 1 AS down;');
  fs.writeFileSync(path.join(migrationsDir, '002_next.sql'), 'SELECT 2 AS up;');

  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('SELECT version FROM schema_migrations')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  await runMigrations(pool, { migrationsDir });

  const executedSql = queries.map((query) => query.sql).join('\n');
  assert.match(executedSql, /SELECT 1 AS up/);
  assert.match(executedSql, /SELECT 2 AS up/);
  assert.doesNotMatch(executedSql, /SELECT 1 AS down/);
  assert.deepEqual(
    queries
      .filter((query) => query.sql.includes('INSERT INTO schema_migrations'))
      .map((query) => query.params[0]),
    ['001_apply.sql', '002_next.sql']
  );
});
