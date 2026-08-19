'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Resolve the checkout from this module, never from the caller's cwd. launchd
// services are host-persistent, so allowing cwd to select their checkout lets a
// disposable staging worktree become the host's factory of record.
const ROOT = path.resolve(__dirname, '..', '..', '..');
const PROFILE = String(process.env.FACTORY_STACK_PROFILE || 'default').trim().toLowerCase();
if (!/^[a-z][a-z0-9-]{0,31}$/.test(PROFILE)) {
  throw new Error(`Invalid FACTORY_STACK_PROFILE: ${PROFILE || 'empty'}`);
}
const PROFILE_SUFFIX = PROFILE === 'default' ? '' : `-${PROFILE}`;
const PROFILE_HOME = path.join(
  os.homedir(), 'Library', 'Application Support', 'engineering-team-factory', 'profiles', PROFILE,
);
const STATE_DIR = process.env.FACTORY_STACK_STATE_DIR
  || (PROFILE === 'default' ? path.join(ROOT, 'observability', 'factory-stack') : PROFILE_HOME);
const LOG_DIR = path.join(STATE_DIR, 'logs');
const ENV_FILE = path.join(STATE_DIR, 'service.env');
const ENV_EXAMPLE = path.join(ROOT, 'deploy', 'launchd', 'factory-stack.env.example');
const FA_STATE_DIR = path.join(STATE_DIR, 'forgeadapter');
const ROOT_BINDING_FILE = process.env.FACTORY_STACK_ROOT_BINDING_FILE
  || (PROFILE === 'default'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'engineering-team-factory', 'repo-root.json')
    : path.join(PROFILE_HOME, 'repo-root.json'));

const LABELS = Object.freeze({
  postgresEnsure: `com.engineering-team.factory${PROFILE_SUFFIX}-postgres-ensure`,
  api: `com.engineering-team.factory${PROFILE_SUFFIX}-audit-api`,
  workers: `com.engineering-team.factory${PROFILE_SUFFIX}-audit-workers`,
  ui: `com.engineering-team.factory${PROFILE_SUFFIX}-ui`,
  forgeadapter: `com.engineering-team.factory${PROFILE_SUFFIX}-forgeadapter`,
});

const PROFILE_PORTS = PROFILE === 'staging'
  ? { api: 23000, ui: 25173, forgeadapter: 24010, postgres: 25432 }
  : { api: 13000, ui: 15173, forgeadapter: 14010, postgres: 15432 };
const DEFAULT_PORTS = Object.freeze({
  api: Number(process.env.FACTORY_STACK_API_PORT || process.env.GOLDEN_PATH_ET_API_PORT || PROFILE_PORTS.api),
  ui: Number(process.env.FACTORY_STACK_UI_PORT || process.env.GOLDEN_PATH_UI_PORT || PROFILE_PORTS.ui),
  openclawLive: Number(process.env.FACTORY_STACK_OPENCLAW_PORT || 18789),
  openclawMock: 14001,
  hermesMock: 14002,
  forgeadapter: Number(process.env.FACTORY_STACK_FA_PORT || process.env.GOLDEN_PATH_FA_PORT || PROFILE_PORTS.forgeadapter),
  postgres: Number(process.env.FACTORY_STACK_PG_PORT || PROFILE_PORTS.postgres),
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
    || path.join(os.homedir(), 'Library', 'Logs', `engineering-team-factory${PROFILE_SUFFIX}`);
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
  const openclawUrl = defaultOpenclawUrl();
  const databaseUrl = defaultDatabaseUrl();
  const runner = process.env.SPECIALIST_DELEGATION_RUNNER
    || `node ${path.join(ROOT, 'scripts', 'openclaw-specialist-runner.js')}`;
  const etApiUrl = `http://127.0.0.1:${DEFAULT_PORTS.api}`;
  const forgeadapterUrl = `http://127.0.0.1:${DEFAULT_PORTS.forgeadapter}`;
  return {
    NODE_ENV: process.env.FACTORY_STACK_NODE_ENV || process.env.NODE_ENV || 'development',
    PATH: process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    PORT: String(DEFAULT_PORTS.api),
    DATABASE_URL: databaseUrl,
    PGSSLMODE: process.env.PGSSLMODE || 'disable',
    AUDIT_STORE_BACKEND: 'postgres',
    AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET || 'golden-path-local-dev-secret',
    AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET || 'golden-path-local-session-secret',
    AUTH_PRODUCTION_AUTH_STRATEGY: 'registration',
    AUTH_EMAIL_PROVIDER: 'test',
    AUTH_REGISTRATION_MODE: 'admin-approved',
    AUTH_REGISTRATION_DEFAULT_TENANT: 'engineering-team',
    AUTH_PUBLIC_APP_URL: process.env.AUTH_PUBLIC_APP_URL || `http://127.0.0.1:${DEFAULT_PORTS.ui}`,
    AUTH_REQUIRE_EMAIL_VERIFICATION: 'false',
    FF_AUDIT_FOUNDATION: 'true',
    FF_WORKFLOW_ENGINE: 'true',
    FF_EXECUTION_CONTRACTS: 'true',
    FF_PROJECTS: 'true',
    FF_INTAKE_DRAFT_CREATION: 'true',
    FF_REAL_SPECIALIST_DELEGATION: 'true',
    FACTORY_USE_FIXTURE_DELEGATION: 'false',
    FACTORY_PROOF_PROFILE: process.env.FACTORY_PROOF_PROFILE || 'live',
    FACTORY_STACK_REPO_ROOT: ROOT,
    FACTORY_STACK_PROFILE: PROFILE,
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

function resolvedRoot(root = ROOT) {
  const absolute = path.resolve(root);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function isTemporaryFactoryRoot(root = ROOT) {
  const candidates = [...new Set([path.resolve(root), resolvedRoot(root)])];
  const temporaryRoots = [...new Set(
    ['/tmp', '/private/tmp', os.tmpdir()].flatMap((entry) => [path.resolve(entry), resolvedRoot(entry)]),
  )];
  return candidates.some((candidate) => (
    temporaryRoots.some((temporaryRoot) => (
      candidate === temporaryRoot || candidate.startsWith(`${temporaryRoot}${path.sep}`)
    )) || candidate.split(path.sep).includes('_checkouts')
  ));
}

function readRepoRootBinding(bindingFile = ROOT_BINDING_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(bindingFile, 'utf8'));
    return typeof parsed.repoRoot === 'string' ? resolvedRoot(parsed.repoRoot) : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw Object.assign(new Error(`Factory stack root binding is unreadable: ${bindingFile}`), {
      code: 'FACTORY_STACK_ROOT_BINDING_INVALID',
      cause: error,
    });
  }
}

function writeRepoRootBinding(repoRoot, bindingFile = ROOT_BINDING_FILE) {
  const target = resolvedRoot(repoRoot);
  fs.mkdirSync(path.dirname(bindingFile), { recursive: true });
  const temporary = `${bindingFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({
    schemaVersion: 'factory-stack-root-binding.v1',
    repoRoot: target,
    boundAt: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, bindingFile);
  return target;
}

function assertPersistentRepoRoot({
  root = ROOT,
  bindingFile = ROOT_BINDING_FILE,
  rebindRoot = false,
  validateRoot = true,
} = {}) {
  const candidate = resolvedRoot(root);
  if (isTemporaryFactoryRoot(candidate)) {
    throw Object.assign(new Error(`Refusing to bind persistent factory services to temporary checkout: ${candidate}`), {
      code: 'FACTORY_STACK_TEMPORARY_ROOT',
      repoRoot: candidate,
    });
  }
  if (validateRoot) {
    const manifest = path.join(candidate, 'package.json');
    let projectName = null;
    try { projectName = JSON.parse(fs.readFileSync(manifest, 'utf8')).name; } catch { /* handled below */ }
    if (projectName !== 'engineering-team') {
      throw Object.assign(new Error(`Factory stack root is not an engineering-team checkout: ${candidate}`), {
        code: 'FACTORY_STACK_ROOT_INVALID',
        repoRoot: candidate,
      });
    }
  }
  const boundRoot = readRepoRootBinding(bindingFile);
  if (!boundRoot || rebindRoot) {
    return { repoRoot: writeRepoRootBinding(candidate, bindingFile), previousRoot: boundRoot, rebound: Boolean(boundRoot) };
  }
  if (boundRoot !== candidate) {
    throw Object.assign(new Error(
      `Factory stack is bound to ${boundRoot}; refusing checkout ${candidate}. Use --rebind-root from the intended canonical checkout.`,
    ), {
      code: 'FACTORY_STACK_ROOT_CONFLICT',
      repoRoot: candidate,
      boundRoot,
    });
  }
  return { repoRoot: candidate, previousRoot: boundRoot, rebound: false };
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
  PROFILE,
  STATE_DIR,
  LOG_DIR,
  ENV_FILE,
  ENV_EXAMPLE,
  FA_STATE_DIR,
  ROOT_BINDING_FILE,
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
  resolvedRoot,
  isTemporaryFactoryRoot,
  readRepoRootBinding,
  writeRepoRootBinding,
  assertPersistentRepoRoot,
};
