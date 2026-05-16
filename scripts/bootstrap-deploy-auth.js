#!/usr/bin/env node
const { createPgPoolFromEnv, runMigrations } = require('../lib/audit');
const {
  REQUIRED_ENV,
  applyAdminSeed,
  buildAdminSeedPlan,
  parseBoolean,
} = require('./seed-auth-admin');

const LOCK_KEY = 'engineering-team:deploy-auth-bootstrap';
const ADMIN_SEED_ENV = [
  'AUTH_ADMIN_EMAIL',
  'AUTH_ADMIN_ACTOR_ID',
  'AUTH_ADMIN_TENANT_ID',
  'AUTH_ADMIN_ROLES',
  'AUTH_ADMIN_STATUS',
  'AUTH_ADMIN_USER_ID',
  'AUTH_ADMIN_SEED_CREDENTIAL',
  'AUTH_ADMIN_INITIAL_PASSWORD',
];

function hasValue(env, name) {
  return String(env?.[name] || '').trim().length > 0;
}

function getDeployAuthBootstrapEnvPresence(env = process.env) {
  return {
    required: Object.fromEntries(REQUIRED_ENV.map(name => [name, hasValue(env, name)])),
    admin: Object.fromEntries(ADMIN_SEED_ENV.map(name => [name, hasValue(env, name)])),
    credential: {
      AUTH_ADMIN_SEED_CREDENTIAL: hasValue(env, 'AUTH_ADMIN_SEED_CREDENTIAL'),
      AUTH_ADMIN_INITIAL_PASSWORD: hasValue(env, 'AUTH_ADMIN_INITIAL_PASSWORD'),
    },
    controls: {
      AUTH_DEPLOY_BOOTSTRAP_ENABLED: hasValue(env, 'AUTH_DEPLOY_BOOTSTRAP_ENABLED'),
      AUTH_DEPLOY_BOOTSTRAP_MIGRATIONS: hasValue(env, 'AUTH_DEPLOY_BOOTSTRAP_MIGRATIONS'),
      AUTH_DEPLOY_BOOTSTRAP_ADMIN_SEED: hasValue(env, 'AUTH_DEPLOY_BOOTSTRAP_ADMIN_SEED'),
    },
  };
}

function resolveDeployAuthBootstrap(env = process.env) {
  const explicit = String(env.AUTH_DEPLOY_BOOTSTRAP_ENABLED || '').trim();
  const explicitConfigured = explicit.length > 0;
  const envPresence = getDeployAuthBootstrapEnvPresence(env);
  const databaseConfigured = hasValue(env, 'DATABASE_URL');
  const vercelBuild = parseBoolean(env.VERCEL, false) || hasValue(env, 'VERCEL_ENV');
  const enabled = explicitConfigured
    ? parseBoolean(explicit, false)
    : databaseConfigured && !vercelBuild;

  return {
    enabled,
    explicitConfigured,
    envPresence,
    migrations: parseBoolean(env.AUTH_DEPLOY_BOOTSTRAP_MIGRATIONS, true),
    adminSeed: parseBoolean(env.AUTH_DEPLOY_BOOTSTRAP_ADMIN_SEED, true),
  };
}

function createDeployAdminSeedPlan(env, stdout = process.stdout) {
  const envPresence = getDeployAuthBootstrapEnvPresence(env);
  if (!envPresence.required.AUTH_ADMIN_EMAIL) {
    stdout.write('Deploy auth admin seed skipped because AUTH_ADMIN_EMAIL is not configured.\n');
    stdout.write(`Deploy auth bootstrap env presence: ${JSON.stringify(envPresence)}\n`);
    return { ok: true, skipped: true, plan: null, env };
  }

  const deploySeedEnv = { ...env };
  if (parseBoolean(deploySeedEnv.AUTH_ADMIN_SEED_CREDENTIAL, false)
    && !hasValue(deploySeedEnv, 'AUTH_ADMIN_INITIAL_PASSWORD')) {
    stdout.write('Deploy auth credential seed skipped because AUTH_ADMIN_INITIAL_PASSWORD is not configured.\n');
    deploySeedEnv.AUTH_ADMIN_SEED_CREDENTIAL = 'false';
  }

  const plan = buildAdminSeedPlan(deploySeedEnv, ['--apply']);
  return { ok: plan.ok, skipped: false, plan, env: deploySeedEnv, errors: plan.errors };
}

async function withBootstrapLock(pool, callback, stdout = process.stdout) {
  const client = await pool.connect();
  try {
    stdout.write('Acquiring deploy auth bootstrap lock.\n');
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
    return await callback();
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
      stdout.write('Released deploy auth bootstrap lock.\n');
    } finally {
      client.release();
    }
  }
}

function validateBootstrapDatabase(env, config, stderr) {
  if (!(config.migrations || config.adminSeed) || hasValue(env, 'DATABASE_URL')) {
    return null;
  }

  const errors = ['Missing required variables: DATABASE_URL'];
  stderr.write('Deploy auth bootstrap validation failed.\n');
  for (const error of errors) stderr.write(`${error}\n`);
  return { ok: false, skipped: false, config, errors };
}

function createBootstrapSeedPlan(config, env, stdout, stderr) {
  if (!config.adminSeed) {
    return { ok: true, skipped: true, plan: null, env };
  }

  const seedPlan = createDeployAdminSeedPlan(env, stdout);
  if (!seedPlan.ok) {
    stderr.write('Deploy auth admin seed validation failed.\n');
    for (const error of seedPlan.errors) stderr.write(`${error}\n`);
  }
  return seedPlan;
}

function resolveBootstrapRunners(dependencies, env) {
  const poolFactory = dependencies.poolFactory || createPgPoolFromEnv;
  const pool = dependencies.pool || poolFactory(env.DATABASE_URL);
  return {
    migrationRunner: dependencies.migrationRunner || runMigrations,
    seedRunner: dependencies.seedRunner || applyAdminSeed,
    pool,
    ownsPool: !dependencies.pool,
  };
}

async function runBootstrapMigrations(config, pool, migrationRunner, stdout) {
  if (!config.migrations) {
    stdout.write('Deploy auth migration step skipped by AUTH_DEPLOY_BOOTSTRAP_MIGRATIONS=false.\n');
    return;
  }

  stdout.write('Applying deploy auth database migrations.\n');
  await migrationRunner(pool, { baseDir: process.cwd() });
}

async function runBootstrapAdminSeed(config, seedPlan, seedRunner, pool, stdout) {
  if (!config.adminSeed) {
    stdout.write('Deploy auth admin seed step skipped by AUTH_DEPLOY_BOOTSTRAP_ADMIN_SEED=false.\n');
    return null;
  }
  if (seedPlan.skipped) return null;

  const plan = seedPlan.plan;
  stdout.write(`${JSON.stringify(plan.redactedPlan, null, 2)}\n`);
  const seedResult = await seedRunner(plan.input, { pool });
  stdout.write(`${JSON.stringify({ applied: true, user: seedResult.redactedResult }, null, 2)}\n`);
  return seedResult;
}

async function runBootstrapSteps({ pool, config, seedPlan, migrationRunner, seedRunner, stdout }) {
  return withBootstrapLock(pool, async () => {
    await runBootstrapMigrations(config, pool, migrationRunner, stdout);
    const seedResult = await runBootstrapAdminSeed(config, seedPlan, seedRunner, pool, stdout);
    return { ok: true, skipped: false, config, seedResult };
  }, stdout);
}

async function closeOwnedPool(pool, ownsPool) {
  if (ownsPool && pool && typeof pool.end === 'function') {
    await pool.end();
  }
}

async function runDeployAuthBootstrap(dependencies = {}) {
  const env = dependencies.env || process.env;
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const config = resolveDeployAuthBootstrap(env);

  if (!config.enabled) {
    stdout.write('Deploy auth bootstrap skipped. Set AUTH_DEPLOY_BOOTSTRAP_ENABLED=true or provide admin seed env vars to enable it.\n');
    stdout.write(`Deploy auth bootstrap env presence: ${JSON.stringify(config.envPresence)}\n`);
    return { ok: true, skipped: true, config };
  }

  const databaseError = validateBootstrapDatabase(env, config, stderr);
  if (databaseError) return databaseError;

  const seedPlan = createBootstrapSeedPlan(config, env, stdout, stderr);
  if (config.adminSeed && !seedPlan.ok) {
    return { ok: false, skipped: false, config, errors: seedPlan.errors };
  }

  const runners = resolveBootstrapRunners(dependencies, env);

  try {
    return await runBootstrapSteps({ ...runners, config, seedPlan, stdout });
  } finally {
    await closeOwnedPool(runners.pool, runners.ownsPool);
  }
}

if (require.main === module) {
  runDeployAuthBootstrap().then(result => {
    process.exitCode = result.ok ? 0 : 1;
  }).catch(error => {
    process.stderr.write(`Deploy auth bootstrap failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  LOCK_KEY,
  createDeployAdminSeedPlan,
  getDeployAuthBootstrapEnvPresence,
  resolveDeployAuthBootstrap,
  runDeployAuthBootstrap,
  withBootstrapLock,
};
