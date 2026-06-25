const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, DEFAULTS } = require('./constants');

function composeArgs() {
  return [
    '-p', DEFAULTS.composeProject,
    ...DEFAULTS.composeFiles.flatMap((file) => ['-f', path.join(ROOT, file)]),
  ];
}

async function pollReady(url, { timeoutMs = 60000, headers = {}, acceptStatuses = [] } = {}) {
  const allowed = new Set([200, 201, 202, 204, ...acceptStatuses]);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok || allowed.has(response.status)) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function postgresCredentialsReady() {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: DEFAULTS.databaseUrl, ssl: false });
    await pool.query('SELECT 1');
    await pool.end();
    return true;
  } catch {
    return false;
  }
}

async function waitForPostgres(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await postgresCredentialsReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Postgres at ${DEFAULTS.databaseUrl}`);
}

async function ensurePostgres() {
  if (await postgresCredentialsReady()) {
    process.stdout.write('Postgres already reachable; skipping docker compose up.\n');
    return;
  }
  execFileSync('docker', ['compose', ...composeArgs(), 'up', '-d', 'postgres'], { cwd: ROOT, stdio: 'inherit' });
}

function runDockerPostgresDown() {
  execFileSync('docker', ['compose', ...composeArgs(), 'stop', 'postgres'], { cwd: ROOT, stdio: 'inherit' });
}

function runMigrations(env) {
  execFileSync(process.execPath, ['scripts/migrate-audit-postgres.js'], { cwd: ROOT, env, stdio: 'inherit' });
}

function spawnManaged(name, command, args, env, logPath, cwd = ROOT) {
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  return { name, pid: child.pid, logPath, child };
}

function resolveForgeadapterDir(explicit) {
  const candidates = [explicit, process.env.FORGEADAPTER_DIR, path.resolve(ROOT, '../forgeadapter')].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, 'src', 'index.js'))) return resolved;
  }
  return null;
}

function buildSharedEnv(options = {}) {
  const uiPort = Number(options.uiPort || DEFAULTS.uiPort);
  return {
    NODE_ENV: 'development',
    DATABASE_URL: DEFAULTS.databaseUrl,
    PGSSLMODE: 'disable',
    AUDIT_STORE_BACKEND: 'postgres',
    AUTH_JWT_SECRET: DEFAULTS.jwtSecret,
    AUTH_PRODUCTION_AUTH_STRATEGY: 'registration',
    AUTH_SESSION_SECRET: DEFAULTS.sessionSecret,
    AUTH_EMAIL_PROVIDER: 'test',
    AUTH_REGISTRATION_MODE: 'admin-approved',
    AUTH_REGISTRATION_DEFAULT_TENANT: DEFAULTS.tenantId,
    AUTH_PUBLIC_APP_URL: `http://127.0.0.1:${uiPort}`,
    AUTH_REQUIRE_EMAIL_VERIFICATION: 'false',
    AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP: 'false',
    FF_AUDIT_FOUNDATION: 'true',
    FF_WORKFLOW_ENGINE: 'true',
    FF_INTAKE_DRAFT_CREATION: 'true',
    FF_GITHUB_INTAKE_NORMALIZER: 'true',
    FF_GITHUB_INTAKE_PROJECT_BOOTSTRAP: 'true',
    FF_PROJECTS: 'true',
    GITHUB_WEBHOOK_SECRET: DEFAULTS.githubWebhookSecret,
    GITHUB_INTAKE_OPT_IN_LABEL: 'factory-intake',
    GITHUB_INTAKE_DEFAULT_TENANT: DEFAULTS.tenantId,
    FORGE_SERVICE_TOKEN: DEFAULTS.forgeServiceToken,
    ALLOW_LEGACY_HEADERS: 'false',
    TENANT_ID: DEFAULTS.tenantId,
  };
}

async function seedAuthAdmin(sharedEnv) {
  const { buildAdminSeedPlan, applyAdminSeed } = require('../seed-auth-admin');
  const seedEnv = {
    ...sharedEnv,
    AUTH_ADMIN_EMAIL: DEFAULTS.adminEmail,
    AUTH_ADMIN_TENANT_ID: DEFAULTS.tenantId,
    AUTH_ADMIN_ROLES: DEFAULTS.adminRoles,
    AUTH_ADMIN_STATUS: 'active',
    AUTH_ADMIN_SEED_CREDENTIAL: 'true',
    AUTH_ADMIN_INITIAL_PASSWORD: DEFAULTS.adminPassword,
  };
  const plan = buildAdminSeedPlan(seedEnv, ['--apply']);
  if (!plan.ok) {
    throw new Error(`Auth admin seed validation failed: ${plan.errors.join('; ')}`);
  }
  process.stdout.write('Seeding golden-path registration admin...\n');
  const savedEnv = {};
  for (const key of ['DATABASE_URL', 'PGSSLMODE', 'PGSSLMODE_REQUIRE']) {
    if (key in seedEnv) {
      savedEnv[key] = process.env[key];
      process.env[key] = seedEnv[key];
    }
  }
  try {
    await applyAdminSeed(plan.input);
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function killPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already stopped
  }
}

module.exports = {
  pollReady,
  waitForPostgres,
  ensurePostgres,
  runDockerPostgresDown,
  runMigrations,
  spawnManaged,
  resolveForgeadapterDir,
  buildSharedEnv,
  seedAuthAdmin,
  killPid,
};