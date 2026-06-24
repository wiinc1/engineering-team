const fs = require('node:fs');
const path = require('node:path');
const { runAuditWorkersProductionSmoke } = require('./audit-workers-production-smoke');
const {
  applyLocalGoldenPathEnvIfNeeded,
  assertStagingRuntimeReady,
  resolveStagingRuntime,
} = require('../task-platform/staging-runtime');

const DEFAULT_STACK_STATE = 'observability/golden-path-local-dev/stack.json';

function readStackState(stackStatePath = DEFAULT_STACK_STATE) {
  const resolved = path.resolve(stackStatePath);
  if (!fs.existsSync(resolved)) return null;
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function stackHasAuditWorkers(stackState) {
  if (!stackState?.processes) return false;
  return stackState.processes.some((entry) => entry.name === 'audit-workers' && Number(entry.pid) > 0);
}

async function runGp007ProjectionWorkersVerify(options = {}) {
  const runtime = applyLocalGoldenPathEnvIfNeeded(assertStagingRuntimeReady(resolveStagingRuntime({
    baseUrl: options.baseUrl,
    jwtSecret: options.jwtSecret,
    outputDir: options.outputDir || 'observability/gp-007-staging',
  })));

  const outputDir = path.resolve(process.cwd(), runtime.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const stackStatePath = options.stackStatePath || DEFAULT_STACK_STATE;
  const stackState = readStackState(stackStatePath);

  const evidence = {
    schemaVersion: '1.0',
    kind: 'gp-007-projection-workers-verify',
    generatedAt: new Date().toISOString(),
    profile: runtime.profile,
    baseUrl: runtime.baseUrl,
    outputDir: runtime.outputDir,
    stackStatePath,
    summary: { passed: false, checks: [] },
    artifacts: {},
  };

  evidence.summary.checks.push({
    name: 'stack_state_present',
    ok: Boolean(stackState),
    stackStatePath,
  });

  evidence.summary.checks.push({
    name: 'audit_workers_process_registered',
    ok: stackHasAuditWorkers(stackState),
    processes: stackState?.processes?.map((entry) => entry.name) || [],
  });

  const workersSmoke = await runAuditWorkersProductionSmoke({
    fetchImpl: options.fetchImpl || fetch,
    baseUrl: runtime.baseUrl,
    tenantId: runtime.tenantId,
    jwtSecret: runtime.jwtSecret,
    outputPath: path.join(outputDir, 'audit-workers-production-smoke.json'),
    waitMs: options.waitMs,
    lagThresholdSeconds: options.lagThresholdSeconds,
  });

  evidence.artifacts.workersSmoke = path.join(runtime.outputDir, 'audit-workers-production-smoke.json');
  const canonicalSmokePath = options.canonicalSmokePath || 'observability/audit-workers-production-smoke.json';
  evidence.artifacts.canonicalSmoke = canonicalSmokePath;
  fs.mkdirSync(path.dirname(path.resolve(canonicalSmokePath)), { recursive: true });
  fs.copyFileSync(
    path.resolve(evidence.artifacts.workersSmoke),
    path.resolve(canonicalSmokePath),
  );

  evidence.summary.checks.push({
    name: 'append_event_without_manual_projection',
    ok: workersSmoke.summary.checks.find((check) => check.name === 'append_event')?.ok === true,
    status: workersSmoke.task?.createStatus ?? null,
  });
  evidence.summary.checks.push({
    name: 'projection_lag_under_threshold',
    ok: workersSmoke.summary.checks.find((check) => check.name === 'projection_lag_under_threshold')?.ok === true,
    lagSeconds: workersSmoke.metrics?.projectionLagSecondsAfter ?? null,
    thresholdSeconds: workersSmoke.summary.checks.find((check) => check.name === 'projection_lag_under_threshold')?.thresholdSeconds ?? null,
  });
  evidence.summary.checks.push({
    name: 'projected_state_visible',
    ok: workersSmoke.summary.checks.find((check) => check.name === 'projected_state_visible')?.ok === true,
    status: workersSmoke.task?.stateStatus ?? null,
  });

  evidence.summary.passed = evidence.summary.checks.every((check) => check.ok);

  const completePath = options.completePath || path.join(outputDir, 'gp-007-complete.json');
  const complete = {
    schemaVersion: '1.0',
    kind: 'gp-007-complete',
    milestone: 'GP-007',
    title: 'Always-on projection + outbox workers',
    generatedAt: evidence.generatedAt,
    profile: evidence.profile,
    baseUrl: evidence.baseUrl,
    summary: {
      passed: evidence.summary.passed,
      workersSmokePassed: workersSmoke.summary.passed,
      projectionLagSeconds: workersSmoke.metrics?.projectionLagSecondsAfter ?? null,
    },
    exitCriteria: {
      workersRunning: stackHasAuditWorkers(stackState),
      appendWithoutManualProjection: workersSmoke.summary.checks.find((check) => check.name === 'append_event')?.ok === true,
      lagUnderThreshold: workersSmoke.summary.checks.find((check) => check.name === 'projection_lag_under_threshold')?.ok === true,
      projectedStateVisible: workersSmoke.summary.checks.find((check) => check.name === 'projected_state_visible')?.ok === true,
    },
    artifacts: {
      verify: path.relative(process.cwd(), path.resolve(completePath.replace('-complete.json', '-projection-workers-verify.json'))),
      workersSmoke: evidence.artifacts.workersSmoke,
      canonicalSmoke: evidence.artifacts.canonicalSmoke,
    },
    notes: [
      'Coordinated stack proof: npm run dev:golden-path:up starts audit-workers via scripts/run-audit-workers.js.',
      'Hosted proof: deploy docker-compose.production-workers.yml or fly.toml, then npm run audit:workers:production-smoke against the hosted API.',
      'Golden-path phase runners treat manual projection scripts as fallback only (lib/audit/projection-catch-up.js).',
    ],
  };

  const verifyPath = completePath.replace('-complete.json', '-projection-workers-verify.json');
  fs.writeFileSync(path.resolve(verifyPath), `${JSON.stringify(evidence, null, 2)}\n`);
  fs.writeFileSync(path.resolve(completePath), `${JSON.stringify(complete, null, 2)}\n`);
  evidence.artifacts.verify = verifyPath;
  evidence.artifacts.complete = completePath;

  return { evidence, complete, workersSmoke };
}

module.exports = {
  DEFAULT_STACK_STATE,
  readStackState,
  stackHasAuditWorkers,
  runGp007ProjectionWorkersVerify,
};