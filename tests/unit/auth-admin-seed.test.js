const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applyAdminSeed,
  buildAdminSeedPlan,
  normalizeStatus,
  readAdminSeedInput,
  runCli,
} = require('../../scripts/seed-auth-admin');

const VALID_ENV = {
  DATABASE_URL: 'postgres://user:secret@db.example:5432/app',
  AUTH_ADMIN_EMAIL: 'Admin@Example.com',
  AUTH_ADMIN_ACTOR_ID: 'admin-actor',
};

test('auth admin seed validates required production inputs', () => {
  const plan = buildAdminSeedPlan({}, []);

  assert.equal(plan.ok, false);
  assert.deepEqual(plan.missing, [
    'DATABASE_URL',
    'AUTH_ADMIN_EMAIL',
  ]);
  assert.match(plan.errors.join('\n'), /Missing required variables/);
});

test('auth admin seed builds a redacted dry-run plan with safe defaults', () => {
  const plan = buildAdminSeedPlan(VALID_ENV, []);
  const serialized = JSON.stringify(plan.redactedPlan);

  assert.equal(plan.ok, true);
  assert.equal(plan.redactedPlan.mode, 'dry-run');
  assert.equal(plan.redactedPlan.writesDatabase, false);
  assert.equal(plan.redactedPlan.databaseConfigured, true);
  assert.equal(plan.input.user.email, 'admin@example.com');
  assert.deepEqual(plan.input.user.roles, ['admin', 'pm']);
  assert.equal(plan.input.user.tenantId, 'tenant-int');
  assert.equal(plan.input.user.status, 'active');
  assert.equal(serialized.includes('Admin@Example.com'), false);
  assert.equal(serialized.includes('admin@example.com'), false);
  assert.equal(serialized.includes('postgres://'), false);
  assert.match(plan.redactedPlan.user.emailHash, /^sha256:[0-9a-f]{16}$/);
  assert.deepEqual(plan.redactedPlan.credential, {
    seed: false,
    passwordConfigured: false,
    passwordHashVersion: null,
  });
});

test('auth admin seed derives a stable actor id from email when none is configured', () => {
  const input = readAdminSeedInput({
    DATABASE_URL: VALID_ENV.DATABASE_URL,
    AUTH_ADMIN_EMAIL: 'wiinc1@hotmail.com',
  });

  assert.equal(input.ok, true);
  assert.equal(input.user.actorId, 'user-050da52cf762f914');
});

test('auth admin seed accepts explicit tenant, user id, roles, status, operator identity, and credential bootstrap', () => {
  const input = readAdminSeedInput({
    ...VALID_ENV,
    AUTH_ADMIN_TENANT_ID: 'tenant-prod',
    AUTH_ADMIN_USER_ID: 'stable-user-id',
    AUTH_ADMIN_ROLES: 'admin,sre',
    AUTH_ADMIN_STATUS: 'disabled',
    AUTH_ADMIN_SEED_CREDENTIAL: 'true',
    AUTH_ADMIN_INITIAL_PASSWORD: 'CorrectHorse123!',
    AUTH_SEED_OPERATOR_ACTOR_ID: 'release-operator',
    AUTH_SEED_OPERATOR_TENANT_ID: 'tenant-ops',
  });

  assert.equal(input.ok, true);
  assert.deepEqual(input.user, {
    email: 'admin@example.com',
    tenantId: 'tenant-prod',
    actorId: 'admin-actor',
    roles: ['admin', 'sre'],
    status: 'disabled',
    userId: 'stable-user-id',
  });
  assert.deepEqual(input.credential, {
    seed: true,
    initialPassword: 'CorrectHorse123!',
  });
  assert.deepEqual(input.operator, {
    tenantId: 'tenant-ops',
    actorId: 'release-operator',
  });
});

test('auth admin seed rejects invalid email, status, roles, and non-admin role sets', () => {
  assert.match(
    readAdminSeedInput({ ...VALID_ENV, AUTH_ADMIN_EMAIL: 'not-an-email' }).errors.join('\n'),
    /valid email/,
  );
  assert.throws(() => normalizeStatus('pending'), /active or disabled/);
  assert.match(
    readAdminSeedInput({ ...VALID_ENV, AUTH_ADMIN_ROLES: 'admin,owner' }).errors.join('\n'),
    /Invalid auth roles: owner/,
  );
  assert.match(
    readAdminSeedInput({ ...VALID_ENV, AUTH_ADMIN_ROLES: 'pm' }).errors.join('\n'),
    /must include admin/,
  );
  assert.match(
    readAdminSeedInput({ ...VALID_ENV, AUTH_ADMIN_SEED_CREDENTIAL: 'true' }).errors.join('\n'),
    /AUTH_ADMIN_INITIAL_PASSWORD is required/,
  );
  assert.match(
    readAdminSeedInput({ ...VALID_ENV, AUTH_ADMIN_INITIAL_PASSWORD: 'CorrectHorse123!' }).errors.join('\n'),
    /AUTH_ADMIN_SEED_CREDENTIAL=true is required/,
  );
  assert.match(
    readAdminSeedInput({
      ...VALID_ENV,
      AUTH_ADMIN_SEED_CREDENTIAL: 'true',
      AUTH_ADMIN_INITIAL_PASSWORD: 'short',
    }).errors.join('\n'),
    /Password must be at least 12 characters/,
  );
});

test('auth admin seed dry-run does not open a database pool', async () => {
  const output = [];
  const code = await runCli({
    env: VALID_ENV,
    argv: [],
    stdout: { write: chunk => output.push(chunk) },
    stderr: { write: chunk => output.push(chunk) },
    poolFactory: () => {
      throw new Error('pool should not be opened during dry-run');
    },
  });

  assert.equal(code, 0);
  assert.match(output.join(''), /Dry-run only/);
});

function createApplySeedHarness(state) {
  return {
    poolFactory: connectionString => {
      assert.equal(connectionString, VALID_ENV.DATABASE_URL);
      return { end: async () => { state.poolClosed = true; } };
    },
    serviceFactory: ({ pool }) => {
      assert.equal(typeof pool.end, 'function');
      return {
        upsertUser: async (user, operator) => {
          state.receivedUser = user;
          state.receivedOperator = operator;
          return {
            userId: 'user-1',
            email: user.email,
            tenantId: user.tenantId,
            actorId: user.actorId,
            roles: user.roles,
            status: user.status,
            updatedAt: '2026-05-04T00:00:00.000Z',
          };
        },
      };
    },
  };
}

test('auth admin seed apply path upserts through the registration service and closes the pool', async () => {
  const state = { poolClosed: false, receivedUser: null, receivedOperator: null };
  const input = readAdminSeedInput(VALID_ENV);
  const result = await applyAdminSeed(input, createApplySeedHarness(state));

  assert.equal(state.poolClosed, true);
  assert.equal(state.receivedUser.email, 'admin@example.com');
  assert.deepEqual(state.receivedOperator, {
    actorId: 'production-auth-operator',
    tenantId: 'tenant-int',
  });
  assert.equal(result.redactedResult.emailHash, 'sha256:258d8dc916db8cea');
  assert.deepEqual(
    { ...result.redactedResult, emailHash: '<redacted-hash>' },
    {
      userId: 'user-1',
      emailHash: '<redacted-hash>',
      tenantId: 'tenant-int',
      actorId: 'admin-actor',
      roles: ['admin', 'pm'],
      status: 'active',
      updatedAt: '2026-05-04T00:00:00.000Z',
      credential: {
        seeded: false,
        passwordHashVersion: null,
      },
    },
  );
});

test('auth admin seed credential path upserts a password hash without exposing the password', async () => {
  let receivedCredential = null;
  const input = readAdminSeedInput({
    ...VALID_ENV,
    AUTH_ADMIN_SEED_CREDENTIAL: 'true',
    AUTH_ADMIN_INITIAL_PASSWORD: 'CorrectHorse123!',
  });
  const result = await applyAdminSeed(input, {
    poolFactory: () => ({ end: async () => {} }),
    serviceFactory: () => ({
      store: {
        upsertCredential: async credential => {
          receivedCredential = credential;
          return credential;
        },
      },
      upsertUser: async user => ({
        userId: 'user-credential',
        email: user.email,
        tenantId: user.tenantId,
        actorId: user.actorId,
        roles: user.roles,
        status: user.status,
        updatedAt: '2026-05-04T00:00:00.000Z',
      }),
    }),
  });

  assert.equal(receivedCredential.userId, 'user-credential');
  assert.equal(receivedCredential.passwordHash.includes('CorrectHorse123!'), false);
  assert.match(receivedCredential.passwordHash, /^scrypt\.v1\$/);
  assert.deepEqual(result.redactedResult.credential, {
    seeded: true,
    passwordHashVersion: 'scrypt.v1',
  });
  assert.equal(JSON.stringify(result).includes('CorrectHorse123!'), false);
});
