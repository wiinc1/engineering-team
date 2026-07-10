#!/usr/bin/env node
'use strict';

/**
 * Durable factory-of-record stack control for this host.
 * Commands: up | down | status | restart | install | uninstall
 *
 * Manages launchd KeepAlive services for audit API + workers.
 * Postgres: reuses existing :15432 or docker compose golden-path when Docker exists.
 * OpenClaw live gateway is expected via existing launchd (ai.openclaw.gateway).
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
  buildServiceEnv,
  defaultOpenclawUrl,
} = require('../lib/task-platform/factory-stack/defaults');
const { collectHealthReport } = require('../lib/task-platform/factory-stack/health');
const {
  installLaunchdServices,
  stopLaunchdServices,
  uninstallLaunchdServices,
  launchdStatus,
  kickstart,
} = require('../lib/task-platform/factory-stack/launchd');
const { LABELS } = require('../lib/task-platform/factory-stack/defaults');
const { ensurePostgres, dockerAvailable, stopDockerPostgres } = require('../lib/task-platform/factory-stack/postgres');

function usage() {
  process.stdout.write(`Usage: node scripts/factory-stack.js <up|down|status|restart|install|uninstall> [options]

Commands:
  up         Ensure Postgres, install/start launchd API+workers, wait for health
  down       Stop launchd API+workers (optional --stop-postgres if Docker-managed)
  status     Show launchd + health probes (JSON with --json)
  restart    down then up
  install    Write env + plists and load launchd services
  uninstall  Unload and remove launchd plists

Options:
  --json              status as JSON
  --stop-postgres     on down, also docker-stop golden-path postgres when Docker is present
  --skip-wait         on up, do not wait for health probes
`);
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const command = ['up', 'down', 'status', 'restart', 'install', 'uninstall', 'help', '-h', '--help']
    .find((name) => args.has(name)) || 'status';
  return {
    command: command === '-h' ? 'help' : command,
    json: args.has('--json'),
    stopPostgres: args.has('--stop-postgres'),
    skipWait: args.has('--skip-wait'),
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

async function waitForRequiredHealth(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await collectHealthReport({ apiPort: DEFAULT_PORTS.api });
    if (last.ok) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return last;
}

async function cmdInstall() {
  ensureExampleEnv();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const env = buildServiceEnv();
  const installed = installLaunchdServices(env);
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

async function cmdUp({ skipWait }) {
  ensureExampleEnv();
  const env = buildServiceEnv();
  const postgres = await ensurePostgres();
  if (!postgres.ok) {
    return {
      ok: false,
      action: 'up',
      postgres,
      error: postgres.error,
      hint: 'Start Postgres on 15432 or install Docker Desktop/colima, then re-run npm run factory:stack:up',
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

  const installed = installLaunchdServices(env);
  kickstart(LABELS.api);
  kickstart(LABELS.workers);

  const health = skipWait
    ? await collectHealthReport({ apiPort: DEFAULT_PORTS.api })
    : await waitForRequiredHealth();

  return {
    ok: health.ok === true,
    action: 'up',
    postgres,
    installed,
    launchd: launchdStatus(),
    health,
    dockerAvailable: dockerAvailable(),
    openclawNote: 'Live OpenClaw is managed separately (launchd ai.openclaw.gateway on :18789).',
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
    note: 'Plists retained (reboot will restart API/workers). OpenClaw left running.',
  };
}

async function cmdStatus() {
  const health = await collectHealthReport({ apiPort: DEFAULT_PORTS.api });
  const launchd = launchdStatus();
  return {
    ok: health.ok === true && launchd.api.loaded === true && launchd.workers.loaded === true,
    action: 'status',
    ports: DEFAULT_PORTS,
    openclawUrl: defaultOpenclawUrl(),
    envFile: ENV_FILE,
    envExample: ENV_EXAMPLE,
    dockerAvailable: dockerAvailable(),
    launchd,
    health,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.command === 'help') {
    usage();
    return;
  }

  let result;
  if (options.command === 'install') result = await cmdInstall();
  else if (options.command === 'uninstall') result = await cmdUninstall();
  else if (options.command === 'up') result = await cmdUp(options);
  else if (options.command === 'down') result = await cmdDown(options);
  else if (options.command === 'restart') {
    await cmdDown({ stopPostgres: false });
    result = await cmdUp(options);
    result.action = 'restart';
  } else result = await cmdStatus();

  if (options.json || options.command === 'status') {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  if (result.ok === false) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
