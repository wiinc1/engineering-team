const path = require('node:path');

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, 'observability', 'golden-path-local-dev');
const STATE_FILE = path.join(STATE_DIR, 'stack.json');

const DEFAULTS = {
  databaseUrl: process.env.GOLDEN_PATH_DATABASE_URL
    || process.env.DATABASE_URL
    || 'postgres://audit:audit@127.0.0.1:15432/engineering_team',
  composeFiles: ['docker-compose.golden-path.yml'],
  composeProject: 'engineering-team-golden-path',
  jwtSecret: 'golden-path-local-dev-secret',
  sessionSecret: 'golden-path-local-session-secret',
  forgeServiceToken: 'local-golden-path-forge-token',
  forgeadapterToken: 'local-forgeadapter-token',
  etApiPort: 13000,
  uiPort: 15173,
  forgeadapterPort: 14010,
  /** Live OpenClaw gateway (factory of record default). */
  openclawLivePort: 18789,
  openclawLiveUrl: process.env.FACTORY_STACK_OPENCLAW_URL
    || process.env.OPENCLAW_BASE_URL
    || 'http://127.0.0.1:18789',
  /** Mock OpenClaw only when explicitly requested via --use-openclaw-mock. */
  openclawPort: 14001,
  hermesPort: 14002,
  tenantId: 'engineering-team',
  adminEmail: 'admin@golden-path.local',
  adminPassword: 'GoldenPathAdmin1',
  adminRoles: 'admin,pm,reader',
  githubWebhookSecret: 'golden-path-local-webhook-secret',
  gitlabWebhookSecret: 'golden-path-local-webhook-secret',
  gitlabBaseUrl: 'http://192.168.1.116',
  gitlabProjectPath: 'wiinc1/engineering-team',
  forgeIntakeProvider: 'gitlab',
};

module.exports = {
  ROOT,
  STATE_DIR,
  STATE_FILE,
  DEFAULTS,
};