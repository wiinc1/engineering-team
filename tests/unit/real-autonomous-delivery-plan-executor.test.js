const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PLAN_SCHEMA_VERSION } = require('../../scripts/plan-real-autonomous-delivery');
const {
  executePlan,
  materializeCommand,
  planExecutionFailures,
  planDigestForObject,
  sha256,
  writeJsonReport,
} = require('../../scripts/execute-real-autonomous-delivery-plan');

const SCRIPT = path.join(__dirname, '../..', 'scripts/execute-real-autonomous-delivery-plan.js');

function readyCommand(overrides = {}) {
  return {
    id: 'candidate-proof',
    description: 'Collect candidate proof.',
    argv: ['node', '-e', 'process.stdout.write("ok")'],
    command: 'node -e process.stdout.write("ok")',
    requires: [],
    ready: true,
    blockedBy: [],
    ...overrides,
  };
}

function readyPlan(overrides = {}) {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    ok: true,
    blocked: false,
    blockedBy: [],
    failureCount: 0,
    failures: [],
    commands: [readyCommand()],
    postMergeCommands: [],
    ...overrides,
  };
}

function writePlan(filePath, plan) {
  fs.writeFileSync(filePath, `${JSON.stringify(plan, null, 2)}\n`);
}

function runCli(args, env = process.env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8',
    env,
  });
}

test('real delivery plan executor CLI prints help without reading a plan', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node scripts\/execute-real-autonomous-delivery-plan\.js/);
  assert.equal(result.stderr, '');
});

test('real delivery plan executor rejects blocked plans before command execution', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-exec-blocked-'));
  const planPath = path.join(tmp, 'plan.json');
  writePlan(planPath, readyPlan({
    ok: false,
    blocked: true,
    failures: ['GITHUB_TOKEN or GH_TOKEN is required'],
    commands: [readyCommand({
      ready: false,
      blockedBy: ['GITHUB_TOKEN or GH_TOKEN is required'],
    })],
  }));

  const result = runCli(['--plan', planPath, '--json']);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.match(report.failures.join('\n'), /plan is blocked/);
  assert.match(report.failures.join('\n'), /plan command candidate-proof is not ready/);
});

test('real delivery plan executor dry-runs ready commands without spawning', () => {
  let spawned = false;
  const report = executePlan(readyPlan(), {
    stage: 'pre-merge',
    spawnImpl() {
      spawned = true;
      return { status: 0 };
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.dryRun, true);
  assert.equal(report.commandCount, 1);
  assert.equal(spawned, false);
});

test('real delivery plan executor persists dry-run execution reports', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-exec-report-'));
  const planPath = path.join(tmp, 'plan.json');
  const reportPath = path.join(tmp, 'nested', 'execution.json');
  writePlan(planPath, readyPlan());

  const result = runCli(['--plan', planPath, '--stage', 'pre-merge', '--report', reportPath, '--json']);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const stdoutReport = JSON.parse(result.stdout);
  const writtenReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const expectedPlanDigest = sha256(fs.readFileSync(planPath, 'utf8'));
  assert.equal(stdoutReport.schemaVersion, 'real-autonomous-delivery-plan-execution.v1');
  assert.equal(stdoutReport.reportPath, reportPath);
  assert.deepEqual(stdoutReport.planDigest, {
    algorithm: 'sha256',
    value: expectedPlanDigest,
    source: 'file',
  });
  assert.equal(writtenReport.reportPath, reportPath);
  assert.deepEqual(writtenReport.planDigest, stdoutReport.planDigest);
  assert.equal(writtenReport.dryRun, true);
  assert.equal(writtenReport.commandCount, 1);
});

test('real delivery plan executor reports include deterministic in-memory plan digests', () => {
  const plan = readyPlan();
  const report = executePlan(plan, { stage: 'pre-merge' });

  assert.deepEqual(report.planDigest, planDigestForObject(plan));
  assert.equal(report.planDigest.algorithm, 'sha256');
  assert.equal(report.planDigest.source, 'object');
});

test('real delivery plan executor persists execute-mode command results', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-exec-run-report-'));
  const planPath = path.join(tmp, 'plan.json');
  const reportPath = path.join(tmp, 'execution.json');
  writePlan(planPath, readyPlan());

  const result = runCli(['--plan', planPath, '--execute', '--report', reportPath, '--json']);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const writtenReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(writtenReport.execute, true);
  assert.equal(writtenReport.dryRun, false);
  assert.deepEqual(writtenReport.results, [{ id: 'candidate-proof', status: 0, signal: null }]);
});

test('real delivery plan executor report writer creates parent directories', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-exec-writer-'));
  const reportPath = path.join(tmp, 'reports', 'execution.json');

  const resolved = writeJsonReport(reportPath, { ok: true }, tmp);

  assert.equal(resolved, path.resolve(tmp, reportPath));
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), { ok: true });
});

test('real delivery plan executor requires runtime env vars before execute mode', () => {
  const report = executePlan(readyPlan({
    commands: [readyCommand({ requires: ['GITHUB_TOKEN'] })],
  }), {
    execute: true,
    env: {},
  });

  assert.equal(report.ok, false);
  assert.match(report.failures.join('\n'), /command candidate-proof requires GITHUB_TOKEN/);
});

test('real delivery plan executor materializes post-merge placeholders during execute mode', () => {
  const mergeSha = '4f4a7c9e12b84d6f90a1c2e3b4d5f6789012abce';
  const command = readyCommand({
    id: 'final-verification',
    argv: ['node', '-e', 'process.exit(0)', '$MERGE_COMMIT_SHA'],
    requires: ['MERGE_COMMIT_SHA'],
  });
  const materialized = materializeCommand(command, { MERGE_COMMIT_SHA: mergeSha });
  const spawned = [];
  const report = executePlan(readyPlan({
    commands: [],
    postMergeCommands: [command],
  }), {
    stage: 'post-merge',
    commandId: 'final-verification',
    execute: true,
    env: { ...process.env, MERGE_COMMIT_SHA: mergeSha },
    json: true,
    spawnImpl(cmd, args) {
      spawned.push([cmd, ...args]);
      return { status: 0 };
    },
  });

  assert.deepEqual(materialized.argv.at(-1), mergeSha);
  assert.equal(report.ok, true);
  assert.equal(report.results[0].status, 0);
  assert.deepEqual(spawned[0].at(-1), mergeSha);
});

test('real delivery plan executor validates schema and selected command identity', () => {
  const failures = planExecutionFailures({
    ...readyPlan({ schemaVersion: 'wrong' }),
  }, [], { commandId: 'missing-command' });

  assert.match(failures.join('\n'), /plan schemaVersion must be real-autonomous-delivery-plan\.v1/);
  assert.match(failures.join('\n'), /plan command missing-command was not found/);
});
