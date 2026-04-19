const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createRuntimeDelegateWork,
  normalizeRuntimeEvidence,
  resolveRunnerTimeoutMs,
} = require('../../lib/software-factory/runtime-delegation');

const slowRunnerPath = path.join(__dirname, '..', 'fixtures', 'specialist-runtime-slow-runner.js');

test('resolveRunnerTimeoutMs prefers explicit options and falls back to env/default values', () => {
  assert.equal(resolveRunnerTimeoutMs({ delegationRunnerTimeoutMs: 1234 }), 1234);
  assert.equal(resolveRunnerTimeoutMs({}, { SPECIALIST_RUNTIME_RUNNER_TIMEOUT_MS: '4321' }), 4321);
  assert.equal(resolveRunnerTimeoutMs({}, {}), 20000);
});

test('normalizeRuntimeEvidence preserves validated ownership payloads', () => {
  const evidence = normalizeRuntimeEvidence({
    agentId: 'engineer',
    sessionId: 'sess-1',
    output: 'done',
    ownership: { specialistId: 'engineer', runtimeAgentId: 'sr-engineer' },
  });

  assert.equal(evidence.agentId, 'engineer');
  assert.equal(evidence.sessionId, 'sess-1');
  assert.equal(evidence.ownership.runtimeAgentId, 'sr-engineer');
});

test('createRuntimeDelegateWork fails closed when the runtime bridge exceeds the configured timeout', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-delegation-timeout-'));
  const delegateWork = createRuntimeDelegateWork({
    baseDir,
    delegationRunnerCommand: `node ${slowRunnerPath}`,
    delegationRunnerTimeoutMs: 25,
    runnerEnv: {
      FIXTURE_RUNTIME_DELAY_MS: '250',
    },
  });

  await assert.rejects(
    delegateWork({
      specialist: 'engineer',
      request: 'Please implement this fix',
      delegationId: 'timeout-check',
    }),
    (error) => {
      assert.equal(error.code, 'SPECIALIST_RUNTIME_TIMEOUT');
      assert.match(error.message, /timed out/i);
      return true;
    },
  );
});
