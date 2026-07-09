const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createDeployAdminSeedPlan,
  getDeployAuthBootstrapEnvPresence,
  LOCK_KEY,
  resolveDeployAuthBootstrap,
  runDeployAuthBootstrap,
} = require('../../scripts/bootstrap-deploy-auth');

const VALID_ENV = {
  DATABASE_URL: 'postgres://user:secret@db.example:5432/app',
  AUTH_ADMIN_EMAIL: 'Admin@Example.com',
  AUTH_ADMIN_ACTOR_ID: 'admin-actor',
  AUTH_ADMIN_SEED_CREDENTIAL: 'true',
  AUTH_ADMIN_INITIAL_PASSWORD: 'CorrectHorse123!',
};

function createOutput() {
  const chunks = [];
  return {
    chunks,
    stream: {
      write: chunk => chunks.push(String(chunk)),
    },
    text() {
      return chunks.join('');
    },
  };
}

function createFakePool() {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [] };
    },
    release() {
      queries.push({ sql: 'release', params: [] });
    },
  };
  return {
    queries,
    async connect() {
      return client;
    },
    async end() {
      queries.push({ sql: 'end', params: [] });
    },
  };
}

test('deploy auth bootstrap stays skipped unless explicitly enabled or database is present', () => {
  assert.deepEqual(resolveDeployAuthBootstrap({}).enabled, false);
  assert.deepEqual(resolveDeployAuthBootstrap({ AUTH_DEPLOY_BOOTSTRAP_ENABLED: 'true' }).enabled, true);
  assert.deepEqual(resolveDeployAuthBootstrap(VALID_ENV).enabled, true);
  assert.deepEqual(resolveDeployAuthBootstrap({
    DATABASE_URL: VALID_ENV.DATABASE_URL,
  }).enabled, true);
  assert.deepEqual(resolveDeployAuthBootstrap({
    ...VALID_ENV,
    AUTH_DEPLOY_BOOTSTRAP_ENABLED: 'false',
  }).enabled, false);
  assert.deepEqual(resolveDeployAuthBootstrap({
    ...VALID_ENV,
    AUTH_DEPLOY_BOOTSTRAP_ENABLED: 'true',
  }).enabled, true);
});

test('deploy auth bootstrap reports only redacted env presence', () => {
  assert.deepEqual(getDeployAuthBootstrapEnvPresence(VALID_ENV), {
    required: {
      DATABASE_URL: true,
      AUTH_ADMIN_EMAIL: true,
    },
    admin: {
      AUTH_ADMIN_EMAIL: true,
      AUTH_ADMIN_ACTOR_ID: true,
      AUTH_ADMIN_TENANT_ID: false,
      AUTH_ADMIN_ROLES: false,
      AUTH_ADMIN_STATUS: false,
      AUTH_ADMIN_USER_ID: false,
      AUTH_ADMIN_SEED_CREDENTIAL: true,
      AUTH_ADMIN_INITIAL_PASSWORD: true,
    },
    credential: {
      AUTH_ADMIN_SEED_CREDENTIAL: true,
      AUTH_ADMIN_INITIAL_PASSWORD: true,
    },
    controls: {
      AUTH_DEPLOY_BOOTSTRAP_ENABLED: false,
      AUTH_DEPLOY_BOOTSTRAP_MIGRATIONS: false,
      AUTH_DEPLOY_BOOTSTRAP_ADMIN_SEED: false,
    },
  });
});

test('deploy auth bootstrap skip path does not open a database pool', async () => {
  const output = createOutput();
  const result = await runDeployAuthBootstrap({
    env: {},
    stdout: output.stream,
    poolFactory: () => {
      throw new Error('pool should not be opened when bootstrap is skipped');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.match(output.text(), /Deploy auth bootstrap skipped/);
  assert.match(output.text(), /"DATABASE_URL":false/);
});

test('deploy auth admin seed plan skips credential seed when password is absent', () => {
  const output = createOutput();
  const seedPlan = createDeployAdminSeedPlan({
    DATABASE_URL: VALID_ENV.DATABASE_URL,
    AUTH_ADMIN_EMAIL: VALID_ENV.AUTH_ADMIN_EMAIL,
    AUTH_ADMIN_SEED_CREDENTIAL: 'true',
  }, output.stream);

  assert.equal(seedPlan.ok, true);
  assert.equal(seedPlan.skipped, false);
  assert.equal(seedPlan.plan.input.credential.seed, false);
  assert.match(output.text(), /credential seed skipped/);
});

test('deploy auth bootstrap runs migrations when admin seed email is missing', async () => {
  const output = createOutput();
  const pool = createFakePool();
  let migrated = false;
  let seeded = false;
  const result = await runDeployAuthBootstrap({
    env: {
      DATABASE_URL: VALID_ENV.DATABASE_URL,
      AUTH_ADMIN_SEED_CREDENTIAL: 'true',
    },
    stdout: output.stream,
    stderr: output.stream,
    pool,
    migrationRunner: async () => {
      migrated = true;
    },
    seedRunner: async () => {
      seeded = true;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(migrated, true);
  assert.equal(seeded, false);
  assert.match(output.text(), /admin seed skipped because AUTH_ADMIN_EMAIL is not configured/);
});

test('deploy auth bootstrap fails validation before opening a pool when explicitly enabled', async () => {
  const output = createOutput();
  const result = await runDeployAuthBootstrap({
    env: { AUTH_DEPLOY_BOOTSTRAP_ENABLED: 'true' },
    stdout: output.stream,
    stderr: output.stream,
    poolFactory: () => {
      throw new Error('pool should not be opened when validation fails');
    },
  });

  assert.equal(result.ok, false);
  assert.match(output.text(), /Deploy auth bootstrap validation failed/);
  assert.match(output.text(), /Missing required variables/);
});

test('deploy auth bootstrap runs migrations and admin seed under a postgres advisory lock', async () => {
  const output = createOutput();
  const pool = createFakePool();
  let migrated = false;
  let seededInput = null;
  const result = await runDeployAuthBootstrap({
    env: VALID_ENV,
    stdout: output.stream,
    stderr: output.stream,
    pool,
    migrationRunner: async receivedPool => {
      assert.equal(receivedPool, pool);
      migrated = true;
    },
    seedRunner: async (input, dependencies) => {
      assert.equal(dependencies.pool, pool);
      seededInput = input;
      return {
        redactedResult: {
          userId: 'user-1',
          emailHash: 'sha256:258d8dc916db8cea',
          tenantId: input.user.tenantId,
          actorId: input.user.actorId,
          roles: input.user.roles,
          status: input.user.status,
          updatedAt: '2026-05-12T00:00:00.000Z',
          credential: { seeded: true, passwordHashVersion: 'scrypt.v1' },
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(migrated, true);
  assert.equal(seededInput.user.email, 'admin@example.com');
  assert.equal(seededInput.credential.seed, true);
  assert.deepEqual(
    pool.queries.filter(query => String(query.sql).includes('pg_advisory_lock')).map(query => query.params),
    [[LOCK_KEY]],
  );
  assert.deepEqual(
    pool.queries.filter(query => String(query.sql).includes('pg_advisory_unlock')).map(query => query.params),
    [[LOCK_KEY]],
  );
  assert.equal(output.text().includes('CorrectHorse123!'), false);
  assert.equal(output.text().includes('postgres://'), false);
  assert.match(output.text(), /"passwordConfigured": true/);
});

test('deploy auth bootstrap can run only migrations when admin seed is disabled', async () => {
  const output = createOutput();
  const pool = createFakePool();
  let migrated = false;
  let seeded = false;
  const result = await runDeployAuthBootstrap({
    env: {
      AUTH_DEPLOY_BOOTSTRAP_ENABLED: 'true',
      AUTH_DEPLOY_BOOTSTRAP_ADMIN_SEED: 'false',
      DATABASE_URL: VALID_ENV.DATABASE_URL,
    },
    stdout: output.stream,
    pool,
    migrationRunner: async () => {
      migrated = true;
    },
    seedRunner: async () => {
      seeded = true;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(migrated, true);
  assert.equal(seeded, false);
  assert.match(output.text(), /admin seed step skipped/);
});
