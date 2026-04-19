const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'validate-specialist-runtime.js');
const runtimeRunnerPath = path.join(repoRoot, 'tests', 'fixtures', 'specialist-runtime-runner.js');
const slowRunnerPath = path.join(repoRoot, 'tests', 'fixtures', 'specialist-runtime-slow-runner.js');

function runValidator(baseDir, env = {}, args = ['Please implement this fix']) {
  return spawnSync('node', [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      SPECIALIST_DELEGATION_BASE_DIR: baseDir,
      ...env,
    },
  });
}

function readSmokeReport(baseDir) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, 'observability', 'specialist-delegation-smoke.json'), 'utf8'));
}

test('validate-specialist-runtime fails when the runtime runner is not configured', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specialist-runtime-smoke-missing-'));
  const result = runValidator(baseDir, {
    SPECIALIST_DELEGATION_RUNNER: '',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Live runtime delegation was not confirmed/i);

  const report = readSmokeReport(baseDir);
  assert.equal(report.mode, 'fallback');
  assert.equal(report.metadata.errorCode, 'SPECIALIST_RUNTIME_NOT_CONFIGURED');
  assert.equal(report.metadata.fallbackReason, 'not_configured');
});

test('validate-specialist-runtime fails when the runtime output is malformed', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specialist-runtime-smoke-invalid-'));
  const result = runValidator(baseDir, {
    SPECIALIST_DELEGATION_RUNNER: `node ${runtimeRunnerPath}`,
    FIXTURE_RUNTIME_MODE: 'invalid-json',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Live runtime delegation was not confirmed/i);

  const report = readSmokeReport(baseDir);
  assert.equal(report.mode, 'fallback');
  assert.equal(report.metadata.errorCode, 'SPECIALIST_RUNTIME_INVALID_JSON');
  assert.equal(report.metadata.fallbackReason, 'invalid_json');
});

test('validate-specialist-runtime fails when the runtime bridge times out', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specialist-runtime-smoke-timeout-'));
  const result = runValidator(baseDir, {
    SPECIALIST_DELEGATION_RUNNER: `node ${slowRunnerPath}`,
    SPECIALIST_RUNTIME_RUNNER_TIMEOUT_MS: '25',
    FIXTURE_RUNTIME_DELAY_MS: '250',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Live runtime delegation was not confirmed/i);

  const report = readSmokeReport(baseDir);
  assert.equal(report.mode, 'fallback');
  assert.equal(report.metadata.errorCode, 'SPECIALIST_RUNTIME_TIMEOUT');
  assert.equal(report.metadata.fallbackReason, 'runtime_exec_failed');
});

test('validate-specialist-runtime passes only when delegated runtime evidence is present', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specialist-runtime-smoke-success-'));
  const result = runValidator(baseDir, {
    SPECIALIST_DELEGATION_RUNNER: `node ${runtimeRunnerPath}`,
  });

  assert.equal(result.status, 0, result.stderr);

  const report = readSmokeReport(baseDir);
  assert.equal(report.mode, 'delegated');
  assert.equal(report.agentId, 'engineer');
  assert.match(report.sessionId, /^runtime-session-/);
  assert.equal(report.attribution.delegated, true);
});
