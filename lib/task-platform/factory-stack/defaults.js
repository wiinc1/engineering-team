'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, 'observability', 'factory-stack');
const LOG_DIR = path.join(STATE_DIR, 'logs');
const ENV_FILE = path.join(STATE_DIR, 'service.env');
const ENV_EXAMPLE = path.join(ROOT, 'deploy', 'launchd', 'factory-stack.env.example');
const FA_STATE_DIR = path.join(STATE_DIR, 'forgeadapter');

const LABELS = Object.freeze({
  postgresEnsure: 'com.engineering-team.factory-postgres-ensure',
  api: 'com.engineering-team.factory-audit-api',
  workers: 'com.engineering-team.factory-audit-workers',
  ui: 'com.engineering-team.factory-ui',
  forgeadapter: 'com.engineering-team.factory-forgeadapter',
});

const DEFAULT_PORTS = Object.freeze({
  api: Number(process.env.FACTORY_STACK_API_PORT || process.env.GOLDEN_PATH_ET_API_PORT || 13000),
  ui: Number(process.env.FACTORY_STACK_UI_PORT || process.env.GOLDEN_PATH_UI_PORT || 15173),
  openclawLive: Number(process.env.FACTORY_STACK_OPENCLAW_PORT || 18789),
  openclawMock: 14001,
  hermesMock: 14002,
  forgeadapter: Number(process.env.FACTORY_STACK_FA_PORT || process.env.GOLDEN_PATH_FA_PORT || 14010),
  postgres: Number(process.env.FACTORY_STACK_PG_PORT || 15432),
});

function defaultDatabaseUrl() {
  return process.env.FACTORY_STACK_DATABASE_URL
    || process.env.GOLDEN_PATH_DATABASE_URL
    || process.env.DATABASE_URL
    || `postgres://audit:audit@127.0.0.1:${DEFAULT_PORTS.postgres}/engineering_team?sslmode=disable`;
}

function defaultOpenclawUrl() {
  return process.env.FACTORY_STACK_OPENCLAW_URL
    || process.env.OPENCLAW_BASE_URL
    || `http://127.0.0.1:${DEFAULT_PORTS.openclawLive}`;
}

function nodeBinary() {
  return process.env.FACTORY_STACK_NODE
    || process.env.NODE_BINARY
    || process.execPath;
}

function launchAgentsDir() {
  return process.env.FACTORY_STACK_LAUNCH_AGENTS_DIR
    || path.join(os.homedir(), 'Library', 'LaunchAgents');
}

function logsHomeDir() {
  return process.env.FACTORY_STACK_LOG_DIR
    || path.join(os.homedir(), 'Library', 'Logs', 'engineering-team-factory');
}

function resolveForgeadapterDir(explicit) {
  const candidates = [
    explicit,
    process.env.FACTORY_STACK_FORGEADAPTER_DIR,
    process.env.FORGEADAPTER_DIR,
    path.resolve(ROOT, '../forgeadapter'),
    path.resolve(os.homedir(), '.openclaw/workspace/forgeadapter'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, 'src', 'index.js'))) return resolved;
  }
  return null;
}

function forgeServiceToken() {
  return process.env.FORGE_SERVICE_TOKEN || 'local-golden-path-forge-token';
}

function forgeadapterServiceToken() {
  return process.env.FORGEADAPTER_SERVICE_TOKEN || 'local-forgeadapter-token';
}

function buildServiceEnv(overrides = {}) {
  const apiPort = DEFAULT_PORTS.api;
  const uiPort = DEFAULT_PORTS.ui;
  const openclawUrl = defaultOpenclawUrl();
  const databaseUrl = defaultDatabaseUrl();
  const runner = process.env.SPECIALIST_DELEGATION_RUNNER
    || `node ${path.join(ROOT, 'scripts', 'openclaw-specialist-runner.js')}`;
  const etApiUrl = `http://127.0.0.1:${apiPort}`;
  const forgeadapterUrl = `http://127.0.0.1:${DEFAULT_PORTS.forgeadapter}`;
  return {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PATH: process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    PORT: String(apiPort),
    DATABASE_URL: databaseUrl,
    PGSSLMODE: 'disable',
    AUDIT_STORE_BACKEND: 'postgres',
    AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET || 'golden-path-local-dev-secret',
    AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET || 'golden-path-local-session-secret',
    AUTH_PRODUCTION_AUTH_STRATEGY: 'registration',
    AUTH_EMAIL_PROVIDER: 'test',
    AUTH_REGISTRATION_MODE: 'admin-approved',
    AUTH_REGISTRATION_DEFAULT_TENANT: 'engineering-team',
    AUTH_PUBLIC_APP_URL: process.env.AUTH_PUBLIC_APP_URL || `http://127.0.0.1:${uiPort}`,
    AUTH_REQUIRE_EMAIL_VERIFICATION: 'false',
    FF_AUDIT_FOUNDATION: 'true',
    FF_WORKFLOW_ENGINE: 'true',
    FF_EXECUTION_CONTRACTS: 'true',
    FF_PROJECTS: 'true',
    FF_INTAKE_DRAFT_CREATION: 'true',
    FF_REAL_SPECIALIST_DELEGATION: 'true',
    FACTORY_USE_FIXTURE_DELEGATION: 'false',
    FACTORY_PROOF_PROFILE: process.env.FACTORY_PROOF_PROFILE || 'live',
    OPENCLAW_BASE_URL: openclawUrl,
    SPECIALIST_DELEGATION_RUNNER: runner,
    OPENCLAW_DELEGATION_TIMEOUT_SEC: process.env.OPENCLAW_DELEGATION_TIMEOUT_SEC || '90',
    OPENCLAW_DELEGATION_THINKING: process.env.OPENCLAW_DELEGATION_THINKING || 'low',
    FORGE_SERVICE_TOKEN: forgeServiceToken(),
    FORGEADAPTER_SERVICE_TOKEN: forgeadapterServiceToken(),
    FORGEADAPTER_BASE_URL: forgeadapterUrl,
    ENGINEERING_TEAM_BASE_URL: etApiUrl,
    TENANT_ID: 'engineering-team',
    ALLOW_LEGACY_HEADERS: 'false',
    PROJECTION_INTERVAL_MS: process.env.PROJECTION_INTERVAL_MS || '3000',
    OUTBOX_INTERVAL_MS: process.env.OUTBOX_INTERVAL_MS || '3000',
    ET_FORGE_DISPATCH_ENABLED: process.env.ET_FORGE_DISPATCH_ENABLED || 'true',
    FORGE_AUTO_COMPLETE_UX_REVIEW_GATE: process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE || 'true',
    ...overrides,
  };
}

function buildUiEnv(baseEnv = buildServiceEnv()) {
  const etApiUrl = `http://127.0.0.1:${DEFAULT_PORTS.api}`;
  return {
    ...baseEnv,
    VITE_TASK_API_PROXY_TARGET: etApiUrl,
    VITE_TASK_API_BASE_URL: '/backend',
    VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED: 'false',
    VITE_AUTH_PRODUCTION_AUTH_STRATEGY: 'registration',
  };
}

function buildForgeadapterEnv(baseEnv = buildServiceEnv(), forgeadapterDir) {
  fs.mkdirSync(FA_STATE_DIR, { recursive: true });
  const openclawUrl = defaultOpenclawUrl();
  // Hermes is non-critical for factory claims (GitLab #272). Prefer explicit env;
  // otherwise leave empty rather than advertising hermes-mock as claim topology.
  // Operators may still point forgeadapter at hermes-mock for non-claim smoke.
  const hermesUrl = String(process.env.HERMES_BASE_URL || '').trim();
  return {
    ...baseEnv,
    NODE_ENV: 'development',
    FORGEADAPTER_HOST: '127.0.0.1',
    FORGEADAPTER_PORT: String(DEFAULT_PORTS.forgeadapter),
    ENGINEERING_TEAM_BASE_URL: `http://127.0.0.1:${DEFAULT_PORTS.api}`,
    ENGINEERING_TEAM_SERVICE_TOKEN: forgeServiceToken(),
    OPENCLAW_BASE_URL: openclawUrl,
    ...(hermesUrl ? { HERMES_BASE_URL: hermesUrl } : {}),
    FORGEADAPTER_SERVICE_TOKEN: forgeadapterServiceToken(),
    FORGEADAPTER_STATE_PATH: path.join(FA_STATE_DIR, 'state.json'),
    FORGEADAPTER_WORKTREE_ROOT: path.join(FA_STATE_DIR, 'worktrees'),
    FORGEADAPTER_BLOCK_UNTIL_JOB_COMPLETE: 'false',
    FORGEADAPTER_REPO_BINDINGS: JSON.stringify({
      'wiinc1/engineering-team': { projectId: 'engineering-team', repoPath: ROOT },
      ...(forgeadapterDir
        ? { 'wiinc1/forgeadapter': { projectId: 'forgeadapter', repoPath: forgeadapterDir } }
        : {}),
    }),
  };
}

module.exports = {
  ROOT,
  STATE_DIR,
  LOG_DIR,
  ENV_FILE,
  ENV_EXAMPLE,
  FA_STATE_DIR,
  LABELS,
  DEFAULT_PORTS,
  defaultDatabaseUrl,
  defaultOpenclawUrl,
  nodeBinary,
  launchAgentsDir,
  logsHomeDir,
  resolveForgeadapterDir,
  forgeServiceToken,
  forgeadapterServiceToken,
  buildServiceEnv,
  buildUiEnv,
  buildForgeadapterEnv,
};
