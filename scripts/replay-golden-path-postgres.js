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

async function assertStackReady(baseUrl) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/metrics`);
  if (!response.ok) {
    throw new Error(
      `Golden-path stack is not ready (${response.status} from ${baseUrl}/metrics). Run: npm run dev:golden-path:up`,
    );
  }
}

async function seedForgeTask(baseUrl, forgeServiceToken) {
  process.env.DATABASE_URL = process.env.DATABASE_URL || DEFAULTS.databaseUrl;
  process.env.AUDIT_STORE_BACKEND = process.env.AUDIT_STORE_BACKEND || 'postgres';

  const { seedGoldenPathForgeTask } = require('../lib/task-platform/golden-path-forge-seed');
  const { apiSendServiceToken } = require('../lib/task-platform/golden-path-shared');

  const seed = await seedGoldenPathForgeTask({
    taskId: 'TSK-GOLDEN001',
    tenantId: 'engineering-team',
    baseDir: process.cwd(),
  });
  const readiness = await apiSendServiceToken(
    baseUrl,
    '/tasks/TSK-GOLDEN001/forge-execution-readiness',
    'GET',
    forgeServiceToken,
  );
  if (!readiness.ok) {
    throw new Error(`TSK-GOLDEN001 forge readiness failed (${readiness.status}): ${JSON.stringify(readiness.body)}`);
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
  const baseUrl = readArg('--base-url', DEFAULTS.baseUrl);
  const outputPath = readArg('--out', DEFAULTS.outputPath);
  const persistDir = readArg('--persist-dir', DEFAULTS.persistDir);
  const childIssue = readArg('--child-issue', DEFAULTS.childIssue);
  const bootstrapPhase1 = hasFlag('--bootstrap') || !fs.existsSync(path.resolve(process.cwd(), outputPath));
  const fromPhase = readArg('--from', bootstrapPhase1 ? '1' : '2');
  const toPhase = readArg('--to', '6');

  await assertStackReady(baseUrl);
  await seedForgeTask(baseUrl, DEFAULTS.forgeServiceToken);

  const env = {
    AUTH_JWT_SECRET: readArg('--jwt-secret', DEFAULTS.jwtSecret),
    FORGE_SERVICE_TOKEN: readArg('--forge-service-token', DEFAULTS.forgeServiceToken),
    FORGEADAPTER_SERVICE_TOKEN: readArg('--forge-adapter-token', DEFAULTS.forgeAdapterToken),
    DATABASE_URL: process.env.DATABASE_URL || DEFAULTS.databaseUrl,
    AUDIT_STORE_BACKEND: 'postgres',
  };

  if (Number(fromPhase) <= 1) {
    const phase1 = await runScript('scripts/run-golden-path-phase1.js', [
      '--bootstrap',
      '--base-url', baseUrl,
      '--child-issue', childIssue,
      '--child-issue-url', `https://github.com/wiinc1/engineering-team/issues/${childIssue}`,
      '--out', outputPath,
    ], env);
    process.stdout.write(phase1.stdout);
    if (phase1.stderr) {
      process.stderr.write(phase1.stderr);
    }
  }

  if (Number(toPhase) >= 2) {
    const phases = await runScript('scripts/run-golden-path-phases.js', [
      '--base-url', baseUrl,
      '--from', String(Math.max(2, Number(fromPhase))),
      '--to', toPhase,
      '--skip-delegation-smoke',
      '--operator-url', DEFAULTS.uiUrl,
      '--out', outputPath,
      '--persist-dir', persistDir,
      '--jwt-secret', env.AUTH_JWT_SECRET,
      '--forge-service-token', env.FORGE_SERVICE_TOKEN,
      '--forge-adapter-token', env.FORGEADAPTER_SERVICE_TOKEN,
    ], env);
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