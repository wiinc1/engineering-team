#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:13000',
  uiUrl: 'http://127.0.0.1:15173',
  jwtSecret: 'golden-path-local-dev-secret',
  forgeServiceToken: 'local-golden-path-forge-token',
  forgeAdapterToken: 'local-forgeadapter-token',
  databaseUrl: 'postgres://audit:audit@127.0.0.1:15432/engineering_team',
  outputPath: 'observability/golden-path-postgres-pilot.json',
  persistDir: 'observability/golden-path-postgres-stack/audit-data',
  childIssue: '271',
};

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function loadLocalStackServiceUrls() {
  const stackPath = path.resolve(process.cwd(), 'observability/golden-path-local-dev/stack.json');
  if (!fs.existsSync(stackPath)) {
    return { openclawUrl: '', hermesUrl: '', forgeadapterUrl: 'http://127.0.0.1:14010' };
  }
  try {
    const stack = JSON.parse(fs.readFileSync(stackPath, 'utf8'));
    return {
      openclawUrl: stack.services?.openclaw?.url || '',
      hermesUrl: stack.services?.hermes?.url || '',
      forgeadapterUrl: stack.services?.forgeadapter?.url || 'http://127.0.0.1:14010',
    };
  } catch {
    return { openclawUrl: '', hermesUrl: '', forgeadapterUrl: 'http://127.0.0.1:14010' };
  }
}

async function assertStackReady(baseUrl) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/metrics`);
  if (!response.ok && response.status !== 401) {
    throw new Error(
      `Golden-path stack is not ready (${response.status} from ${baseUrl}/metrics). Run: npm run dev:golden-path:up`,
    );
  }
}

async function seedForgeTask(baseUrl, forgeServiceToken, forgeTaskId = 'TSK-GOLDEN001') {
  process.env.DATABASE_URL = process.env.DATABASE_URL || DEFAULTS.databaseUrl;
  process.env.AUDIT_STORE_BACKEND = process.env.AUDIT_STORE_BACKEND || 'postgres';

  const { createAuditStore } = require('../lib/audit');
  const { assertAuditBackendConfiguration } = require('../lib/audit/config');
  const { seedGoldenPathForgeTask } = require('../lib/task-platform/golden-path-forge-seed');
  const { pollForgeExecutionReadiness } = require('../lib/task-platform/golden-path-shared');
  const backendConfig = assertAuditBackendConfiguration({ runtimeGuard: false });

  const seed = await seedGoldenPathForgeTask({
    taskId: forgeTaskId,
    tenantId: 'engineering-team',
    baseDir: process.cwd(),
    store: createAuditStore({
      baseDir: process.cwd(),
      backend: backendConfig.backend,
      connectionString: backendConfig.connectionString,
      workflowEngineEnabled: false,
    }),
  });
  const readiness = await pollForgeExecutionReadiness(baseUrl, forgeTaskId, forgeServiceToken);
  if (!readiness.ok) {
    throw new Error(`${forgeTaskId} forge readiness failed (${readiness.status}): ${JSON.stringify(readiness.body)}`);
  }
  return seed;
}

async function runScript(scriptPath, args, env) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    maxBuffer: 20 * 1024 * 1024,
  });
  return { stdout, stderr };
}

async function main() {
  const freshBootstrap = hasFlag('--fresh-bootstrap');
  const baseUrl = readArg('--base-url', DEFAULTS.baseUrl);
  const outputPath = readArg(
    '--out',
    freshBootstrap
      ? `observability/golden-path-postgres-pilot-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
      : DEFAULTS.outputPath,
  );
  const persistDir = readArg(
    '--persist-dir',
    freshBootstrap
      ? `observability/golden-path-postgres-stack/bootstrap-${Date.now()}`
      : DEFAULTS.persistDir,
  );
  const childIssue = readArg('--child-issue', DEFAULTS.childIssue);
  const projectName = readArg(
    '--project-name',
    freshBootstrap
      ? `Golden Path Pilot - Issue ${childIssue} (${new Date().toISOString().slice(0, 10)} fresh)`
      : '',
  );
  const bootstrapPhase1 = hasFlag('--bootstrap') || freshBootstrap || !fs.existsSync(path.resolve(process.cwd(), outputPath));
  const fromPhase = readArg('--from', bootstrapPhase1 ? '1' : '2');
  const toPhase = readArg('--to', '6');
  const stackUrls = loadLocalStackServiceUrls();
  const openclawUrl = readArg('--openclaw-url', process.env.OPENCLAW_BASE_URL || stackUrls.openclawUrl);
  const hermesUrl = readArg('--hermes-url', process.env.HERMES_BASE_URL || stackUrls.hermesUrl);
  const forgeadapterUrl = readArg('--forgeadapter-url', process.env.FORGEADAPTER_BASE_URL || stackUrls.forgeadapterUrl);
  const skipDelegationSmoke = !hasFlag('--require-delegation-smoke')
    || hasFlag('--skip-delegation-smoke');
  const forgeTaskId = readArg(
    '--forge-task-id',
    freshBootstrap
      ? `TSK-GOLDEN${Date.now().toString(36).slice(-6).toUpperCase()}`
      : 'TSK-GOLDEN001',
  );

  await assertStackReady(baseUrl);
  await seedForgeTask(baseUrl, DEFAULTS.forgeServiceToken, forgeTaskId);

  const env = {
    AUTH_JWT_SECRET: readArg('--jwt-secret', DEFAULTS.jwtSecret),
    FORGE_SERVICE_TOKEN: readArg('--forge-service-token', DEFAULTS.forgeServiceToken),
    FORGEADAPTER_SERVICE_TOKEN: readArg('--forge-adapter-token', DEFAULTS.forgeAdapterToken),
    DATABASE_URL: process.env.DATABASE_URL || DEFAULTS.databaseUrl,
    AUDIT_STORE_BACKEND: 'postgres',
  };

  if (Number(fromPhase) <= 1) {
    const phase1Args = [
      '--bootstrap',
      '--base-url', baseUrl,
      '--child-issue', childIssue,
      '--child-issue-url', `https://github.com/wiinc1/engineering-team/issues/${childIssue}`,
      '--out', outputPath,
    ];
    if (projectName) {
      phase1Args.push('--project-name', projectName);
    }
    const phase1 = await runScript('scripts/run-golden-path-phase1.js', phase1Args, env);
    process.stdout.write(phase1.stdout);
    if (phase1.stderr) {
      process.stderr.write(phase1.stderr);
    }
  }

  if (Number(toPhase) >= 2) {
    const phaseArgs = [
      '--base-url', baseUrl,
      '--from', String(Math.max(2, Number(fromPhase))),
      '--to', toPhase,
      '--operator-url', DEFAULTS.uiUrl,
      '--out', outputPath,
      '--persist-dir', persistDir,
      '--jwt-secret', env.AUTH_JWT_SECRET,
      '--forge-service-token', env.FORGE_SERVICE_TOKEN,
      '--forge-adapter-token', env.FORGEADAPTER_SERVICE_TOKEN,
    ];
    if (skipDelegationSmoke) {
      phaseArgs.push('--skip-delegation-smoke');
    }
    if (openclawUrl) {
      phaseArgs.push('--openclaw-url', openclawUrl);
    }
    if (hermesUrl) {
      phaseArgs.push('--hermes-url', hermesUrl);
    }
    phaseArgs.push('--forgeadapter-url', forgeadapterUrl, '--forge-task-id', forgeTaskId);
    const phases = await runScript('scripts/run-golden-path-phases.js', phaseArgs, {
      ...env,
      FORGEADAPTER_BASE_URL: forgeadapterUrl,
      ...(openclawUrl ? { OPENCLAW_BASE_URL: openclawUrl } : {}),
      ...(hermesUrl ? { HERMES_BASE_URL: hermesUrl } : {}),
      ...(skipDelegationSmoke ? {} : { FF_REAL_SPECIALIST_DELEGATION: 'true' }),
    });
    process.stdout.write(phases.stdout);
    if (phases.stderr) {
      process.stderr.write(phases.stderr);
    }
  }

  let evidence = null;
  try {
    evidence = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), outputPath), 'utf8'));
  } catch {
    evidence = null;
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: evidence?.status || 'unknown',
    taskId: evidence?.engineeringTeam?.taskId || null,
    projectId: evidence?.engineeringTeam?.projectId || null,
    stepsCompleted: evidence?.stepsCompleted || [],
    evidencePath: path.resolve(process.cwd(), outputPath),
    uiSignInUrl: `${DEFAULTS.uiUrl}/sign-in`,
    uiTasksUrl: `${DEFAULTS.uiUrl}/tasks`,
    preserveDataHint: 'npm run dev:golden-path:down -- --keep-postgres',
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});