const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSpecialistCoordinator } = require('../../lib/software-factory/delegation');

const runtimeRunnerPath = path.join(__dirname, '..', 'fixtures', 'specialist-runtime-runner.js');

test('e2e: clear specialist request produces validated runtime attribution', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-e2e-'));
  const coordinator = createSpecialistCoordinator({
    baseDir,
    delegationRunnerCommand: `node ${runtimeRunnerPath}`,
  });

  const result = await coordinator.handleRequest('Please implement this bug fix', { coordinatorAgent: 'main' });

  assert.equal(result.mode, 'delegated');
  assert.equal(result.attribution.handledBy, 'engineer');
  assert.match(result.metadata.sessionId, /^runtime-session-/);

  const artifactPath = path.join(baseDir, 'observability', 'specialist-delegation.jsonl');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8').trim().split('\n').at(-1));
  assert.equal(artifact.actual_agent, 'engineer');
  assert.equal(artifact.fallback_reason, undefined);
});

test('e2e: runtime misconfiguration falls back truthfully without specialist ownership', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-e2e-fallback-'));
  const coordinator = createSpecialistCoordinator({
    baseDir,
    delegationRunnerCommand: '',
  });

  const result = await coordinator.handleRequest('Please implement this bug fix', { coordinatorAgent: 'main' });

  assert.equal(result.mode, 'fallback');
  assert.equal(result.metadata.fallbackReason, 'not_configured');
  assert.match(result.message, /not configured or not available/i);
  assert.equal(result.attribution.delegated, false);
});
