const fs = require('node:fs');
const path = require('node:path');
const { ROOT, STATE_DIR, STATE_FILE, DEFAULTS } = require('./constants');
const { startOpenClawMock, startHermesMock } = require('./mocks');
const {
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
} = require('./runtime');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const readValue = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
  };
  return {
    command: ['up', 'down', 'status'].find((name) => args.has(name)) || 'up',
    keepPostgres: args.has('--keep-postgres'),
    skipForgeadapter: args.has('--skip-forgeadapter'),
    skipMocks: args.has('--skip-mocks'),
    skipUi: args.has('--skip-ui'),
    externalOpenclaw: readValue('--openclaw-url', process.env.OPENCLAW_BASE_URL || ''),
    externalHermes: readValue('--hermes-url', process.env.HERMES_BASE_URL || ''),
    forgeadapterDir: readValue('--forgeadapter-dir', process.env.FORGEADAPTER_DIR || ''),
    etApiPort: Number(readValue('--et-port', process.env.GOLDEN_PATH_ET_API_PORT || DEFAULTS.etApiPort)),
    uiPort: Number(readValue('--ui-port', process.env.GOLDEN_PATH_UI_PORT || DEFAULTS.uiPort)),
    forgeadapterPort: Number(readValue('--fa-port', process.env.GOLDEN_PATH_FA_PORT || DEFAULTS.forgeadapterPort)),
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function writeState(state) {
  ensureDir(STATE_DIR);
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function removeState() {
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
}

async function startForgeadapter(options, etApiUrl, openclawUrl, hermesUrl, logsDir, faStateDir) {
  const forgeadapterDir = resolveForgeadapterDir(options.forgeadapterDir);
  if (!forgeadapterDir) {
    process.stderr.write('forgeadapter checkout not found; continuing without forgeadapter\n');
    return null;
  }
  const faEnv = {
    NODE_ENV: 'development',
    FORGEADAPTER_HOST: '127.0.0.1',
    FORGEADAPTER_PORT: String(options.forgeadapterPort),
    ENGINEERING_TEAM_BASE_URL: etApiUrl,
    ENGINEERING_TEAM_SERVICE_TOKEN: DEFAULTS.forgeServiceToken,
    OPENCLAW_BASE_URL: openclawUrl,
    HERMES_BASE_URL: hermesUrl,
    FORGEADAPTER_SERVICE_TOKEN: DEFAULTS.forgeadapterToken,
    FORGEADAPTER_STATE_PATH: path.join(faStateDir, 'state.json'),
    FORGEADAPTER_WORKTREE_ROOT: path.join(faStateDir, 'worktrees'),
    FORGEADAPTER_BLOCK_UNTIL_JOB_COMPLETE: 'false',
    FORGEADAPTER_REPO_BINDINGS: JSON.stringify({
      'wiinc1/engineering-team': { projectId: 'engineering-team', repoPath: ROOT },
      'wiinc1/forgeadapter': { projectId: 'forgeadapter', repoPath: forgeadapterDir },
    }),
  };
  const fa = spawnManaged(
    'forgeadapter',
    process.execPath,
    ['src/index.js'],
    faEnv,
    path.join(logsDir, 'forgeadapter.log'),
    forgeadapterDir,
  );
  const forgeadapterUrl = `http://127.0.0.1:${options.forgeadapterPort}`;
  await pollReady(`${forgeadapterUrl}/health`, { timeoutMs: 60000 });
  return { process: fa, url: forgeadapterUrl };
}

async function startUi(options, sharedEnv, etApiUrl, logsDir) {
  const ui = spawnManaged(
    'vite-ui',
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host', '127.0.0.1',
      '--port', String(options.uiPort),
      '--strictPort',
    ],
    {
      ...sharedEnv,
      VITE_TASK_API_PROXY_TARGET: etApiUrl,
      VITE_TASK_API_BASE_URL: '/backend',
      VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED: 'false',
      VITE_AUTH_PRODUCTION_AUTH_STRATEGY: 'registration',
    },
    path.join(logsDir, 'vite-ui.log'),
  );
  const uiUrl = `http://127.0.0.1:${options.uiPort}`;
  await pollReady(uiUrl, { timeoutMs: 60000 });
  return { process: ui, url: uiUrl };
}

async function bootstrapPostgres(options) {
  process.stdout.write('Ensuring Postgres is available...\n');
  await ensurePostgres();
  await waitForPostgres();
  const sharedEnv = buildSharedEnv({ uiPort: options.uiPort });
  process.stdout.write('Running audit migrations...\n');
  runMigrations(sharedEnv);
  await seedAuthAdmin(sharedEnv);
  return sharedEnv;
}

async function startEtCore(options, sharedEnv, logsDir) {
  const etApiUrl = `http://127.0.0.1:${options.etApiPort}`;
  const processes = [];
  processes.push(spawnManaged(
    'audit-api',
    process.execPath,
    ['scripts/run-audit-api.js'],
    { ...sharedEnv, PORT: String(options.etApiPort) },
    path.join(logsDir, 'audit-api.log'),
  ));
  await pollReady(`${etApiUrl}/metrics`, { timeoutMs: 60000, acceptStatuses: [401] });
  processes.push(spawnManaged(
    'audit-workers',
    process.execPath,
    ['scripts/run-audit-workers.js'],
    {
      ...sharedEnv,
      PROJECTION_INTERVAL_MS: '3000',
      OUTBOX_INTERVAL_MS: '3000',
      ET_FORGE_DISPATCH_ENABLED: 'true',
      ENGINEERING_TEAM_BASE_URL: etApiUrl,
      FORGEADAPTER_BASE_URL: `http://127.0.0.1:${options.forgeadapterPort || DEFAULTS.forgeadapterPort}`,
      FORGEADAPTER_SERVICE_TOKEN: DEFAULTS.forgeadapterToken,
      ET_FORGE_LIFECYCLE_TASK_ID: 'TSK-GOLDEN001',
      AUTH_JWT_SECRET: sharedEnv.AUTH_JWT_SECRET,
      FORGE_SERVICE_TOKEN: DEFAULTS.forgeServiceToken,
    },
    path.join(logsDir, 'audit-workers.log'),
  ));
  return { etApiUrl, processes };
}

async function resolveUpstreamUrls(options) {
  let openclawUrl = options.externalOpenclaw;
  let hermesUrl = options.externalHermes;
  const mockServers = [];
  if (!options.skipMocks && !openclawUrl) {
    const mock = await startOpenClawMock(DEFAULTS.openclawPort);
    mockServers.push(mock);
    openclawUrl = mock.baseUrl;
    process.stdout.write(`OpenClaw mock listening on ${openclawUrl}\n`);
  }
  if (!options.skipMocks && !hermesUrl) {
    const mock = await startHermesMock(DEFAULTS.hermesPort);
    mockServers.push(mock);
    hermesUrl = mock.baseUrl;
    process.stdout.write(`Hermes mock listening on ${hermesUrl}\n`);
  }
  return { openclawUrl, hermesUrl, mockServers };
}

function printStackSummary(etApiUrl, ui, forgeadapter) {
  process.stdout.write('\nGolden path local dev stack is up.\n');
  process.stdout.write(`  ET audit API:  ${etApiUrl}\n`);
  if (ui) {
    process.stdout.write(`  ET UI:         ${ui.url}\n`);
    process.stdout.write(`  Sign in:       ${ui.url}/sign-in\n`);
    process.stdout.write(`  Dev admin:     ${DEFAULTS.adminEmail} / ${DEFAULTS.adminPassword}\n`);
    process.stdout.write('  Tip: use http://127.0.0.1 (not localhost) and clear site data if sign-in still fails.\n');
  }
  if (forgeadapter) process.stdout.write(`  forgeadapter:  ${forgeadapter.url}\n`);
  process.stdout.write(`  State file:    ${STATE_FILE}\n`);
  process.stdout.write('\nCtrl+C to stop. Or: npm run dev:golden-path:down\n');
}

function bindShutdown(options, processes, mockServers) {
  const shutdown = async () => {
    for (const entry of processes) killPid(entry.pid);
    await Promise.all(mockServers.map((mock) => mock.close().catch(() => {})));
    removeState();
    if (!options.keepPostgres) {
      try { runDockerPostgresDown(); } catch { /* best effort */ }
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function commandUp(options) {
  if (readState()) {
    throw new Error(`Stack already running (see ${STATE_FILE}). Run: npm run dev:golden-path:down`);
  }

  ensureDir(STATE_DIR);
  const logsDir = path.join(STATE_DIR, 'logs');
  const faStateDir = path.join(STATE_DIR, 'forgeadapter');
  ensureDir(logsDir);
  ensureDir(faStateDir);

  const sharedEnv = await bootstrapPostgres(options);
  const { etApiUrl, processes } = await startEtCore(options, sharedEnv, logsDir);
  const { openclawUrl, hermesUrl, mockServers } = await resolveUpstreamUrls(options);

  let forgeadapter = null;
  if (!options.skipForgeadapter) {
    forgeadapter = await startForgeadapter(options, etApiUrl, openclawUrl, hermesUrl, logsDir, faStateDir);
    if (forgeadapter) processes.push(forgeadapter.process);
  }

  let ui = null;
  if (!options.skipUi) {
    ui = await startUi(options, sharedEnv, etApiUrl, logsDir);
    processes.push(ui.process);
  }

  writeState({
    startedAt: new Date().toISOString(),
    services: {
      auditApi: { url: etApiUrl },
      ui: ui ? { url: ui.url } : null,
      forgeadapter: forgeadapter ? { url: forgeadapter.url, token: DEFAULTS.forgeadapterToken } : null,
      openclaw: { url: openclawUrl },
      hermes: { url: hermesUrl },
    },
    processes: processes.map(({ name, pid, logPath }) => ({ name, pid, logPath })),
    logsDir,
  });

  printStackSummary(etApiUrl, ui, forgeadapter);
  bindShutdown(options, processes, mockServers);
  await new Promise(() => {});
}

function commandDown(options) {
  const state = readState();
  if (state?.processes) {
    for (const entry of state.processes) killPid(entry.pid);
  }
  removeState();
  if (!options.keepPostgres) runDockerPostgresDown();
  process.stdout.write('Golden path local dev stack stopped.\n');
}

function commandStatus() {
  const state = readState();
  if (!state) {
    process.stdout.write('Golden path local dev stack is not running.\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.command === 'down') {
    commandDown(options);
    return;
  }
  if (options.command === 'status') {
    commandStatus();
    return;
  }
  await commandUp(options);
}

module.exports = {
  parseArgs,
  commandUp,
  commandDown,
  commandStatus,
  main,
};