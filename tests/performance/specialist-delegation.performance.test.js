const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { createSpecialistCoordinator } = require('../../lib/software-factory/delegation');

const runtimeRunnerPath = path.join(__dirname, '..', 'fixtures', 'specialist-runtime-runner.js');

test('fixture-backed specialist delegation stays within local latency budget', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-perf-'));
  const coordinator = createSpecialistCoordinator({
    baseDir,
    delegationRunnerCommand: `node ${runtimeRunnerPath}`,
  });

  const started = performance.now();
  for (let index = 0; index < 5; index += 1) {
    const result = await coordinator.handleRequest('Please implement this fix', { coordinatorAgent: 'main' });
    assert.equal(result.mode, 'delegated');
  }
  const duration = performance.now() - started;

  assert.ok(duration < 2500, `delegation budget exceeded: ${duration}ms`);
});
