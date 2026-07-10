'use strict';

const path = require('node:path');
const os = require('node:os');

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, 'observability', 'factory-stack');
const LOG_DIR = path.join(STATE_DIR, 'logs');
const ENV_FILE = path.join(STATE_DIR, 'service.env');
const ENV_EXAMPLE = path.join(ROOT, 'deploy', 'launchd', 'factory-stack.env.example');

const LABELS = Object.freeze({
  api: 'com.engineering-team.factory-audit-api',
  workers: 'com.engineering-team.factory-audit-workers',
});

const DEFAULT_PORTS = Object.freeze({
  api: Number(process.env.FACTORY_STACK_API_PORT || process.env.GOLDEN_PATH_ET_API_PORT || 13000),
  openclawLive: Number(process.env.FACTORY_STACK_OPENCLAW_PORT || 18789),
  openclawMock: 14001,
  hermesMock: 14002,
  forgeadapter: Number(process.env.FACTORY_STACK_FA_PORT || 14010),
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

function buildServiceEnv(overrides = {}) {
  const apiPort = DEFAULT_PORTS.api;
  const openclawUrl = defaultOpenclawUrl();
  const databaseUrl = defaultDatabaseUrl();
  const runner = process.env.SPECIALIST_DELEGATION_RUNNER
    || `node ${path.join(ROOT, 'scripts', 'openclaw-specialist-runner.js')}`;
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
    AUTH_PUBLIC_APP_URL: process.env.AUTH_PUBLIC_APP_URL || 'http://127.0.0.1:15173',
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
    FORGE_SERVICE_TOKEN: process.env.FORGE_SERVICE_TOKEN || 'local-golden-path-forge-token',
    FORGEADAPTER_SERVICE_TOKEN: process.env.FORGEADAPTER_SERVICE_TOKEN || 'local-forgeadapter-token',
    TENANT_ID: 'engineering-team',
    ALLOW_LEGACY_HEADERS: 'false',
    ...overrides,
  };
}

module.exports = {
  ROOT,
  STATE_DIR,
  LOG_DIR,
  ENV_FILE,
  ENV_EXAMPLE,
  LABELS,
  DEFAULT_PORTS,
  defaultDatabaseUrl,
  defaultOpenclawUrl,
  nodeBinary,
  launchAgentsDir,
  logsHomeDir,
  buildServiceEnv,
};
