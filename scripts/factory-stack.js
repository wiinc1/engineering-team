#!/usr/bin/env node
'use strict';

/**
 * Durable factory-of-record stack control for this host (GitLab #269).
 * Commands: up | down | status | restart | install | uninstall | accept
 *
 * Manages launchd KeepAlive services for:
 *   - Postgres ensure watcher (docker compose / existing :15432)
 *   - audit API (:13000)
 *   - audit workers (projection + outbox)
 *   - UI Vite (:15173) claim topology
 *   - forgeadapter (:14010) claim topology when checkout present
 *
 * OpenClaw live gateway remains separate launchd (ai.openclaw.gateway on :18789).
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  ROOT,
  STATE_DIR,
  ENV_EXAMPLE,
  ENV_FILE,
  DEFAULT_PORTS,
  LABELS,
  buildServiceEnv,
  defaultOpenclawUrl,
  resolveForgeadapterDir,
} = require('../lib/task-platform/factory-stack/defaults');
const {
  collectHealthReport,
  evaluateFactoryStackAcceptance,
} = require('../lib/task-platform/factory-stack/health');
const {
  installLaunchdServices,
  stopLaunchdServices,
  uninstallLaunchdServices,
  launchdStatus,
  kickstart,
} = require('../lib/task-platform/factory-stack/launchd');
const { ensurePostgres, dockerAvailable, stopDockerPostgres } = require('../lib/task-platform/factory-stack/postgres');

function usage() {
  process.stdout.write(`Usage: node scripts/factory-stack.js <up|down|status|restart|install|uninstall|accept> [options]

Commands:
  up         Ensure Postgres, install/start launchd units, wait for health
  down       Stop launchd units (optional --stop-postgres if Docker-managed)
  status     Show launchd + health probes (+ acceptance with --accept)
  restart    down then up
  install    Write env + plists and load launchd services
  uninstall  Unload and remove launchd plists
  accept     Evaluate GitLab #269 acceptance criteria against live stack

Options:
  --json              machine-readable output
  --stop-postgres     on down, also docker-stop golden-path postgres when Docker is present
  --skip-wait         on up, do not wait for health probes
  --skip-ui           omit UI launchd unit
  --skip-forgeadapter omit forgeadapter launchd unit
  --forgeadapter-dir  path to forgeadapter checkout
  --accept            include #269 acceptance evaluation on status
`);
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const readValue = (flag, fallback = '') => {
    const index = argv.indexOf(flag);
    return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
  };
  const command = ['up', 'down', 'status', 'restart', 'install', 'uninstall', 'accept', 'help', '-h', '--help']
    .find((name) => args.has(name)) || 'status';
  return {
    command: command === '-h' ? 'help' : command,
    json: args.has('--json'),
    stopPostgres: args.has('--stop-postgres'),
    skipWait: args.has('--skip-wait'),
    skipUi: args.has('--skip-ui'),
    skipForgeadapter: args.has('--skip-forgeadapter'),
    forgeadapterDirExplicit: readValue('--forgeadapter-dir', process.env.FORGEADAPTER_DIR || ''),
    includeAccept: args.has('--accept') || command === 'accept',
  };
}

function stackOptions(options) {
  return {
    skipUi: options.skipUi,
    skipForgeadapter: options.skipForgeadapter,
    forgeadapterDirExplicit: options.forgeadapterDirExplicit || undefined,
  };
}

function ensureExampleEnv() {
  fs.mkdirSync(path.dirname(ENV_EXAMPLE), { recursive: true });
  if (!fs.existsSync(ENV_EXAMPLE)) {
    const env = buildServiceEnv();
    const body = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
    fs.writeFileSync(ENV_EXAMPLE, `${body}\n`);
  }
}

function runMigrations(env) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'migrate-audit-postgres.js')], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
}

async function waitForRequiredHealth(options, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await collectHealthReport({
      apiPort: DEFAULT_PORTS.api,
      uiPort: DEFAULT_PORTS.ui,
      requireUi: !options.skipUi,
      requireForgeadapter: !options.skipForgeadapter && Boolean(resolveForgeadapterDir(options.forgeadapterDirExplicit)),
    });
    if (last.ok) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return last;
}

async function cmdInstall(options) {
  ensureExampleEnv();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const env = buildServiceEnv();
  const installed = installLaunchdServices(env, stackOptions(options));
  return {
    ok: true,
    action: 'install',
    openclawUrl: defaultOpenclawUrl(),
    ...installed,
    launchd: launchdStatus(),
  };
}

async function cmdUninstall() {
  const result = uninstallLaunchdServices();
  return { ok: true, action: 'uninstall', ...result };
}

async function cmdUp(options) {
  ensureExampleEnv();
  const env = buildServiceEnv();
  const postgres = await ensurePostgres();
  if (!postgres.ok) {
    return {
      ok: false,
      action: 'up',
      postgres,
      error: postgres.error,
      hint: 'Start Postgres on 15432 or install Docker Desktop/OrbStack, then re-run npm run factory:stack:up',
      remediation: postgres.remediation,
    };
  }

  try {
    runMigrations(env);
  } catch (error) {
    return {
      ok: false,
      action: 'up',
      postgres,
      error: `migrations failed: ${error.message}`,
    };
  }

  const installed = installLaunchdServices(env, stackOptions(options));
  for (const label of installed.labels || Object.values(LABELS)) {
    kickstart(label);
  }

  const health = options.skipWait
    ? await collectHealthReport({
      requireUi: !options.skipUi,
      requireForgeadapter: !options.skipForgeadapter && Boolean(installed.forgeadapterDir),
    })
    : await waitForRequiredHealth(options);

  const launchd = launchdStatus();
  const acceptance = evaluateFactoryStackAcceptance({
    health,
    launchd,
    dockerAvailable: dockerAvailable(),
  });

  return {
    ok: health.ok === true,
    action: 'up',
    postgres,
    installed,
    launchd,
    health,
    acceptance,
    dockerAvailable: dockerAvailable(),
    openclawNote: 'Live OpenClaw is managed separately (launchd ai.openclaw.gateway on :18789).',
    recovery: 'After reboot: npm run factory:stack:up (or rely on RunAtLoad KeepAlive units + postgres ensure watcher).',
  };
}

async function cmdDown({ stopPostgres }) {
  const launchd = stopLaunchdServices();
  const postgres = stopPostgres ? stopDockerPostgres() : { ok: true, action: 'left_running' };
  return {
    ok: true,
    action: 'down',
    launchd,
    postgres,
    note: 'Plists retained (reboot will restart stack units). OpenClaw left running.',
  };
}

async function cmdStatus(options) {
  const requireForge = !options.skipForgeadapter && Boolean(resolveForgeadapterDir(options.forgeadapterDirExplicit));
  const health = await collectHealthReport({
    requireUi: !options.skipUi,
    requireForgeadapter: requireForge,
  });
  const launchd = launchdStatus();
  const result = {
    ok: health.ok === true
      && launchd.api.loaded === true
      && launchd.workers.loaded === true
      && launchd.postgresEnsure.loaded === true,
    action: 'status',
    ports: DEFAULT_PORTS,
    openclawUrl: defaultOpenclawUrl(),
    envFile: ENV_FILE,
    envExample: ENV_EXAMPLE,
    dockerAvailable: dockerAvailable(),
    forgeadapterDir: resolveForgeadapterDir(options.forgeadapterDirExplicit),
    launchd,
    health,
  };
  if (options.includeAccept) {
    result.acceptance = evaluateFactoryStackAcceptance({
      health,
      launchd,
      dockerAvailable: dockerAvailable(),
    });
    result.ok = result.ok && result.acceptance.ok === true;
  }
  return result;
}

async function cmdAccept(options) {
  const status = await cmdStatus({ ...options, includeAccept: true });
  return {
    ...status,
    action: 'accept',
    ok: status.acceptance?.ok === true,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.command === 'help') {
    usage();
    return;
  }

  let result;
  if (options.command === 'install') result = await cmdInstall(options);
  else if (options.command === 'uninstall') result = await cmdUninstall();
  else if (options.command === 'up') result = await cmdUp(options);
  else if (options.command === 'down') result = await cmdDown(options);
  else if (options.command === 'restart') {
    await cmdDown({ stopPostgres: false });
    result = await cmdUp(options);
    result.action = 'restart';
  } else if (options.command === 'accept') result = await cmdAccept(options);
  else result = await cmdStatus(options);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.ok === false) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
