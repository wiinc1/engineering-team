#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
  assertGoldenPathRealEvidencePreflight,
  collectGoldenPathRealEvidenceCliArgs,
  readGoldenPathRealEvidenceCliOptions,
} = require('../lib/task-platform/golden-path-real-evidence-preflight');

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
  ensurePostgresProcessEnv();

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

function assertPostgresReplayRealEvidencePreflight({ realEvidenceOptions, baseUrl, forgeadapterUrl, fromPhase, toPhase }) {
  assertGoldenPathRealEvidencePreflight({
    ...realEvidenceOptions,
    baseUrl,
    operatorUrl: DEFAULTS.uiUrl,
    forgeAdapterBaseUrl: forgeadapterUrl,
    requireReadableCandidateProof: true,
    fromPhase: Number(fromPhase),
    toPhase: Number(toPhase),
  }, { context: 'Postgres golden-path replay' });
}

function buildReplayConfig() {
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
  const childIssue = readArg('--child-issue');
  const childIssueUrl = readArg(
    '--child-issue-url',
    childIssue ? `https://github.com/wiinc1/engineering-team/issues/${childIssue}` : '',
  );
  const projectName = readArg(
    '--project-name',
    freshBootstrap
      ? `Golden Path Pilot - Issue ${childIssue || 'TBD'} (${new Date().toISOString().slice(0, 10)} fresh)`
      : '',
  );
  const bootstrapPhase1 = hasFlag('--bootstrap') || freshBootstrap || !fs.existsSync(path.resolve(process.cwd(), outputPath));
  const fromPhase = readArg('--from', bootstrapPhase1 ? '1' : '2');
  const toPhase = readArg('--to', '6');
  const stackUrls = loadLocalStackServiceUrls();
  const openclawUrl = readArg('--openclaw-url', process.env.OPENCLAW_BASE_URL || stackUrls.openclawUrl);
  const hermesUrl = readArg('--hermes-url', process.env.HERMES_BASE_URL || stackUrls.hermesUrl);
  const forgeadapterUrl = readArg('--forgeadapter-url', process.env.FORGEADAPTER_BASE_URL || stackUrls.forgeadapterUrl);
  const skipDelegationSmoke = !hasFlag('--require-delegation-smoke') || hasFlag('--skip-delegation-smoke');
  const forgeTaskId = readArg(
    '--forge-task-id',
    freshBootstrap
      ? `TSK-GOLDEN${Date.now().toString(36).slice(-6).toUpperCase()}`
      : 'TSK-GOLDEN001',
  );
  return {
    baseUrl, childIssue, childIssueUrl, forgeadapterUrl, forgeTaskId, freshBootstrap,
    hermesUrl, openclawUrl, outputPath, persistDir, projectName, skipDelegationSmoke,
    fromPhase, toPhase,
  };
}

async function runPhase1IfRequested(config, env) {
  if (Number(config.fromPhase) > 1) return;
  const phase1Args = buildPhase1Args({
    baseUrl: config.baseUrl,
    childIssue: config.childIssue,
    childIssueUrl: config.childIssueUrl,
    outputPath: config.outputPath,
    projectName: config.projectName,
  });
  const phase1 = await runScript('scripts/run-golden-path-phase1.js', phase1Args, env);
  process.stdout.write(phase1.stdout);
  if (phase1.stderr) process.stderr.write(phase1.stderr);
}

async function runRemainingPhasesIfRequested(config, env) {
  if (Number(config.toPhase) < 2) return;
  const phaseArgs = [
    '--base-url', config.baseUrl,
    '--from', String(Math.max(2, Number(config.fromPhase))),
    '--to', config.toPhase,
    '--operator-url', DEFAULTS.uiUrl,
    '--out', config.outputPath,
    '--persist-dir', config.persistDir,
    '--jwt-secret', env.AUTH_JWT_SECRET,
    '--forge-service-token', env.FORGE_SERVICE_TOKEN,
    '--forge-adapter-token', env.FORGEADAPTER_SERVICE_TOKEN,
    ...collectGoldenPathRealEvidenceCliArgs(),
  ];
  if (config.skipDelegationSmoke) phaseArgs.push('--skip-delegation-smoke');
  if (config.openclawUrl) phaseArgs.push('--openclaw-url', config.openclawUrl);
  if (config.hermesUrl) phaseArgs.push('--hermes-url', config.hermesUrl);
  phaseArgs.push('--forgeadapter-url', config.forgeadapterUrl, '--forge-task-id', config.forgeTaskId);
  const phases = await runScript('scripts/run-golden-path-phases.js', phaseArgs, {
    ...env,
    FORGEADAPTER_BASE_URL: config.forgeadapterUrl,
    ...(config.openclawUrl ? { OPENCLAW_BASE_URL: config.openclawUrl } : {}),
    ...(config.hermesUrl ? { HERMES_BASE_URL: config.hermesUrl } : {}),
    ...(config.skipDelegationSmoke ? {} : { FF_REAL_SPECIALIST_DELEGATION: 'true' }),
  });
  process.stdout.write(phases.stdout);
  if (phases.stderr) process.stderr.write(phases.stderr);
}

function readReplayEvidence(outputPath) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), outputPath), 'utf8'));
  } catch {
    return null;
  }
}

function printReplaySummary(outputPath) {
  const evidence = readReplayEvidence(outputPath);
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

async function main() {
  const config = buildReplayConfig();
  const realEvidenceOptions = readGoldenPathRealEvidenceCliOptions();
  assertPostgresReplayRealEvidencePreflight({
    realEvidenceOptions,
    baseUrl: config.baseUrl,
    forgeadapterUrl: config.forgeadapterUrl,
    fromPhase: config.fromPhase,
    toPhase: config.toPhase,
  });

  ensurePostgresProcessEnv();
  await assertStackReady(config.baseUrl);
  await seedForgeTask(config.baseUrl, DEFAULTS.forgeServiceToken, config.forgeTaskId);
  const env = buildReplayChildEnv();
  await runPhase1IfRequested(config, env);
  await runRemainingPhasesIfRequested(config, env);
  printReplaySummary(config.outputPath);
}

function buildPhase1Args({ baseUrl, childIssue, childIssueUrl, outputPath, projectName }) {
  if (!childIssue && !childIssueUrl) {
    throw new Error('Phase 1 replay requires an explicit --child-issue or --child-issue-url; default pilot issue 271 is not reused');
  }
  const args = ['--bootstrap', '--base-url', baseUrl, '--out', outputPath];
  if (childIssue) args.push('--child-issue', childIssue);
  if (childIssueUrl) args.push('--child-issue-url', childIssueUrl);
  if (projectName) args.push('--project-name', projectName);
  return args;
}

function ensurePostgresProcessEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL || DEFAULTS.databaseUrl;
  process.env.AUDIT_STORE_BACKEND = process.env.AUDIT_STORE_BACKEND || 'postgres';
  process.env.PGSSLMODE = process.env.PGSSLMODE || 'disable';
}

function buildReplayChildEnv() {
  ensurePostgresProcessEnv();
  return {
    AUTH_JWT_SECRET: readArg('--jwt-secret', DEFAULTS.jwtSecret),
    FORGE_SERVICE_TOKEN: readArg('--forge-service-token', DEFAULTS.forgeServiceToken),
    FORGEADAPTER_SERVICE_TOKEN: readArg('--forge-adapter-token', DEFAULTS.forgeAdapterToken),
    DATABASE_URL: process.env.DATABASE_URL,
    AUDIT_STORE_BACKEND: 'postgres',
    PGSSLMODE: process.env.PGSSLMODE,
  };
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULTS,
  buildPhase1Args,
  buildReplayChildEnv,
  loadLocalStackServiceUrls,
  main,
  readArg,
  hasFlag,
};
