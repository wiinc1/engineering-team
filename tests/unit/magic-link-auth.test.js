const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createEmailTransport,
  createMagicLinkAuthService,
  sanitizeNextPath,
} = require('../../lib/auth/magic-link');

test('sanitizeNextPath keeps same-origin relative paths only', () => {
  assert.equal(sanitizeNextPath('/tasks/TSK-1?tab=history'), '/tasks/TSK-1?tab=history');
  assert.equal(sanitizeNextPath('https://evil.example/tasks'), '/tasks');
  assert.equal(sanitizeNextPath('//evil.example/tasks'), '/tasks');
  assert.equal(sanitizeNextPath('/sign-in?next=/tasks'), '/tasks');
});

test('magic-link request sends only for active invited users and consumes once', async () => {
  const emailTransport = createEmailTransport({ provider: 'test' });
  const service = createMagicLinkAuthService({
    emailTransport,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
  });
  await service.upsertUser({
    email: 'PM@Example.com',
    tenantId: 'tenant-a',
    actorId: 'pm-1',
    roles: ['pm'],
    status: 'active',
  }, { actorId: 'admin-1', tenantId: 'tenant-a' });

  const result = await service.requestMagicLink({ email: 'pm@example.com', next: '/tasks?view=board', ip: '127.0.0.1' });
  assert.equal(result.ok, true);
  assert.equal(emailTransport.sent.length, 1);
  assert.match(emailTransport.sent[0].link, /^https:\/\/app\.example\/auth\/magic-link\/consume\?/);

  const token = new URL(emailTransport.sent[0].link).searchParams.get('token');
  const consumed = await service.consumeMagicLink({ token });
  assert.equal(consumed.user.actorId, 'pm-1');
  assert.equal(consumed.next, '/tasks?view=board');
  assert.ok(consumed.sessionToken);
  assert.ok(consumed.csrfToken);

  await assert.rejects(
    () => service.consumeMagicLink({ token }),
    /already been used/,
  );
});

test('magic-link email body contains only safe sign-in content', async () => {
  const emailTransport = createEmailTransport({ provider: 'test' });
  const service = createMagicLinkAuthService({
    emailTransport,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
  });
  await service.upsertUser({
    email: 'safe@example.com',
    tenantId: 'tenant-secret',
    actorId: 'actor-secret',
    roles: ['admin'],
    status: 'active',
  }, { actorId: 'admin-1', tenantId: 'tenant-a' });

  await service.requestMagicLink({ email: 'safe@example.com', next: '/tasks/TSK-1', ip: '127.0.0.1' });

  const email = emailTransport.sent[0];
  assert.equal(email.subject, 'Sign in to Engineering Team');
  assert.match(email.text, /https:\/\/app\.example\/auth\/magic-link\/consume\?token=/);
  assert.match(email.text, /This link expires in 15 minutes and can be used once\./);
  assert.match(email.text, /If you did not request this email, you can ignore it\./);
  assert.doesNotMatch(email.text, /tenant-secret/);
  assert.doesNotMatch(email.text, /actor-secret/);
  assert.doesNotMatch(email.text, /admin/);
  assert.doesNotMatch(email.text, /test-secret/);
});

test('magic-link request is generic and silent for unknown users', async () => {
  const emailTransport = createEmailTransport({ provider: 'test' });
  const service = createMagicLinkAuthService({
    emailTransport,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
  });
  const result = await service.requestMagicLink({ email: 'unknown@example.com', ip: '127.0.0.1' });
  assert.equal(result.message, 'If the email is eligible, a sign-in link has been sent.');
  assert.equal(emailTransport.sent.length, 0);
});

test('magic-link request is generic and silent for inactive users', async () => {
  const emailTransport = createEmailTransport({ provider: 'test' });
  const service = createMagicLinkAuthService({
    emailTransport,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
  });
  await service.upsertUser({
    email: 'disabled@example.com',
    tenantId: 'tenant-a',
    actorId: 'disabled-1',
    roles: ['reader'],
    status: 'disabled',
  }, { actorId: 'admin-1', tenantId: 'tenant-a' });

  const result = await service.requestMagicLink({ email: 'disabled@example.com', ip: '127.0.0.1' });

  assert.equal(result.message, 'If the email is eligible, a sign-in link has been sent.');
  assert.equal(emailTransport.sent.length, 0);
  assert.ok(service.store.auditEvents.some((event) => event.eventType === 'auth.magic_link.request_suppressed'));
});

test('magic-link rate limits stay generic and suppress excess email sends', async () => {
  const emailTransport = createEmailTransport({ provider: 'test' });
  const service = createMagicLinkAuthService({
    emailTransport,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
  });
  await service.upsertUser({
    email: 'limited@example.com',
    tenantId: 'tenant-a',
    actorId: 'limited-1',
    roles: ['reader'],
    status: 'active',
  }, { actorId: 'admin-1', tenantId: 'tenant-a' });

  for (let index = 0; index < 4; index += 1) {
    const result = await service.requestMagicLink({ email: 'limited@example.com', ip: '127.0.0.1', nowMs: Date.parse('2026-04-01T00:00:00.000Z') + index });
    assert.equal(result.message, 'If the email is eligible, a sign-in link has been sent.');
  }

  assert.equal(emailTransport.sent.length, 3);
  assert.ok(service.store.auditEvents.some((event) => event.eventType === 'auth.magic_link.request_throttled'));
});

test('magic-link IP rate limit stays generic across unknown identities', async () => {
  const emailTransport = createEmailTransport({ provider: 'test' });
  const service = createMagicLinkAuthService({
    emailTransport,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
  });

  for (let index = 0; index < 11; index += 1) {
    const result = await service.requestMagicLink({ email: `unknown-${index}@example.com`, ip: '203.0.113.10', nowMs: Date.parse('2026-04-01T00:00:00.000Z') + index });
    assert.equal(result.message, 'If the email is eligible, a sign-in link has been sent.');
  }

  assert.equal(emailTransport.sent.length, 0);
  assert.ok(service.store.auditEvents.some((event) => event.eventType === 'auth.magic_link.request_throttled'));
});

test('magic-link request stays generic when email delivery fails for active users', async () => {
  const emailTransport = {
    provider: 'test-failing',
    async sendMagicLinkEmail() {
      throw new Error('provider unavailable');
    },
  };
  const service = createMagicLinkAuthService({
    emailTransport,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
  });
  await service.upsertUser({
    email: 'active@example.com',
    tenantId: 'tenant-a',
    actorId: 'active-1',
    roles: ['reader'],
    status: 'active',
  }, { actorId: 'admin-1', tenantId: 'tenant-a' });

  const result = await service.requestMagicLink({ email: 'active@example.com', ip: '127.0.0.1' });

  assert.equal(result.message, 'If the email is eligible, a sign-in link has been sent.');
  assert.ok(service.store.auditEvents.some((event) => event.eventType === 'auth.magic_link.delivery_failed'));
});

test('auth audit records request, consume, role change, disable, and reactivation events', async () => {
  const emailTransport = createEmailTransport({ provider: 'test' });
  const service = createMagicLinkAuthService({
    emailTransport,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
  });
  await service.upsertUser({
    email: 'audited@example.com',
    tenantId: 'tenant-a',
    actorId: 'audited-1',
    roles: ['reader'],
    status: 'active',
  }, { actorId: 'admin-1', tenantId: 'tenant-a' });
  await service.upsertUser({
    email: 'audited@example.com',
    tenantId: 'tenant-a',
    actorId: 'audited-1',
    roles: ['reader', 'pm'],
    status: 'disabled',
  }, { actorId: 'admin-1', tenantId: 'tenant-a' });
  await service.upsertUser({
    email: 'audited@example.com',
    tenantId: 'tenant-a',
    actorId: 'audited-1',
    roles: ['reader', 'pm'],
    status: 'active',
  }, { actorId: 'admin-1', tenantId: 'tenant-a' });
  await service.requestMagicLink({ email: 'audited@example.com', ip: '127.0.0.1' });
  const token = new URL(emailTransport.sent[0].link).searchParams.get('token');
  await service.consumeMagicLink({ token });

  const eventTypes = service.store.auditEvents.map((event) => event.eventType);
  assert.ok(eventTypes.includes('auth.magic_link.requested'));
  assert.ok(eventTypes.includes('auth.magic_link.consumed'));
  assert.ok(eventTypes.includes('auth.user.roles_changed'));
  assert.ok(eventTypes.includes('auth.user.disabled'));
  assert.ok(eventTypes.includes('auth.user.reactivated'));
});

test('expired, invalid, replayed, and disabled-user consumes are rejected and audited', async () => {
  const emailTransport = createEmailTransport({ provider: 'test' });
  const service = createMagicLinkAuthService({
    emailTransport,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
  });
  await service.upsertUser({
    email: 'rejects@example.com',
    tenantId: 'tenant-a',
    actorId: 'rejects-1',
    roles: ['reader'],
    status: 'active',
  }, { actorId: 'admin-1', tenantId: 'tenant-a' });

  await assert.rejects(
    () => service.consumeMagicLink({ token: 'not-a-real-token' }),
    /invalid or expired/,
  );

  await service.requestMagicLink({ email: 'rejects@example.com', ip: '127.0.0.1', nowMs: Date.parse('2026-04-01T00:00:00.000Z') });
  let token = new URL(emailTransport.sent.at(-1).link).searchParams.get('token');
  await assert.rejects(
    () => service.consumeMagicLink({ token, nowMs: Date.parse('2026-04-01T00:16:00.000Z') }),
    /expired/,
  );

  await service.requestMagicLink({ email: 'rejects@example.com', ip: '127.0.0.2' });
  token = new URL(emailTransport.sent.at(-1).link).searchParams.get('token');
  await service.consumeMagicLink({ token });
  await assert.rejects(
    () => service.consumeMagicLink({ token }),
    /already been used/,
  );

  await service.requestMagicLink({ email: 'rejects@example.com', ip: '127.0.0.3' });
  token = new URL(emailTransport.sent.at(-1).link).searchParams.get('token');
  await service.upsertUser({
    email: 'rejects@example.com',
    tenantId: 'tenant-a',
    actorId: 'rejects-1',
    roles: ['reader'],
    status: 'disabled',
  }, { actorId: 'admin-1', tenantId: 'tenant-a' });
  await assert.rejects(
    () => service.consumeMagicLink({ token }),
    /no longer eligible/,
  );

  const eventTypes = service.store.auditEvents.map((event) => event.eventType);
  assert.ok(eventTypes.includes('auth.magic_link.invalid_rejected'));
  assert.ok(eventTypes.includes('auth.magic_link.expired_rejected'));
  assert.ok(eventTypes.includes('auth.magic_link.replay_rejected'));
});

test('cookie sessions expire server-side and reject revoked sessions', async () => {
  const emailTransport = createEmailTransport({ provider: 'test' });
  const service = createMagicLinkAuthService({
    emailTransport,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
  });
  await service.upsertUser({
    email: 'session@example.com',
    tenantId: 'tenant-a',
    actorId: 'session-1',
    roles: ['reader'],
    status: 'active',
  }, { actorId: 'admin-1', tenantId: 'tenant-a' });
  await service.requestMagicLink({ email: 'session@example.com', ip: '127.0.0.1', nowMs: Date.parse('2026-04-01T00:00:00.000Z') });
  const token = new URL(emailTransport.sent[0].link).searchParams.get('token');
  const session = await service.consumeMagicLink({ token, nowMs: Date.parse('2026-04-01T00:01:00.000Z') });
  const cookie = service.buildSessionCookies(session.sessionToken, session.csrfToken, session.expiresAt).join('; ');

  assert.equal((await service.getSessionContext({ method: 'GET', headers: { cookie } }, Date.parse('2026-04-01T08:00:00.000Z'))).actorId, 'session-1');
  assert.equal(await service.getSessionContext({ method: 'GET', headers: { cookie } }, Date.parse('2026-04-01T08:02:00.000Z')), null);

  await service.requestMagicLink({ email: 'session@example.com', ip: '127.0.0.2' });
  const revocationToken = new URL(emailTransport.sent[1].link).searchParams.get('token');
  const revocationSession = await service.consumeMagicLink({ token: revocationToken });
  const revocationCookie = service.buildSessionCookies(revocationSession.sessionToken, revocationSession.csrfToken, revocationSession.expiresAt).join('; ');
  await service.revokeSession({ method: 'POST', headers: { cookie: revocationCookie, 'x-csrf-token': revocationSession.csrfToken } });
  assert.equal(await service.getSessionContext({ method: 'GET', headers: { cookie: revocationCookie } }), null);
  assert.ok(service.store.auditEvents.some((event) => event.eventType === 'auth.session.revoked'));
});

test('cookie session context requires matching csrf for mutations', async () => {
  const emailTransport = createEmailTransport({ provider: 'test' });
  const service = createMagicLinkAuthService({
    emailTransport,
    publicAppUrl: 'https://app.example',
    sessionSecret: 'test-secret',
  });
  await service.upsertUser({
    email: 'admin@example.com',
    tenantId: 'tenant-a',
    actorId: 'admin-1',
    roles: ['admin'],
    status: 'active',
  }, { actorId: 'admin-1', tenantId: 'tenant-a' });
  await service.requestMagicLink({ email: 'admin@example.com', next: '/tasks', ip: '127.0.0.1' });
  const token = new URL(emailTransport.sent[0].link).searchParams.get('token');
  const session = await service.consumeMagicLink({ token });
  const cookie = service.buildSessionCookies(session.sessionToken, session.csrfToken, session.expiresAt).join('; ');
  const req = { method: 'POST', headers: { cookie, 'x-csrf-token': session.csrfToken } };
  const context = await service.getSessionContext(req);
  assert.equal(context.actorId, 'admin-1');
  await service.requireCsrf(req, context);
  await assert.rejects(
    () => service.requireCsrf({ method: 'POST', headers: { cookie } }, context),
    /CSRF token is required/,
  );
});
