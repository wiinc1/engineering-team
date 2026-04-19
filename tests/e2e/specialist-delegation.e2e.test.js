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

test('e2e: canonical specialist delegation kill switch disables runtime routing before execution starts', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-e2e-disabled-'));
  const coordinator = createSpecialistCoordinator({
    baseDir,
    ffRealSpecialistDelegation: 'false',
    delegationRunnerCommand: `node ${runtimeRunnerPath}`,
  });

  const result = await coordinator.handleRequest('Please implement this bug fix', { coordinatorAgent: 'main' });

  assert.equal(result.mode, 'coordinator');
  assert.equal(result.metadata.fallbackReason, 'feature_disabled');
  assert.equal(result.metadata.userFacingReasonCategory, 'delegation_disabled');
  assert.match(result.message, /ff_real_specialist_delegation/i);
  assert.equal(result.attribution.delegated, false);
});

test('e2e: malformed runtime output is rejected and failure artifacts record the verification outcome', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-e2e-invalid-json-'));
  const coordinator = createSpecialistCoordinator({
    baseDir,
    delegationRunnerCommand: `node ${runtimeRunnerPath}`,
    runnerEnv: {
      FIXTURE_RUNTIME_MODE: 'invalid-json',
    },
  });

  const result = await coordinator.handleRequest('Please implement this bug fix', { coordinatorAgent: 'main' });

  assert.equal(result.mode, 'fallback');
  assert.equal(result.metadata.fallbackReason, 'invalid_json');
  assert.equal(result.metadata.userFacingReasonCategory, 'delegation_unverified');
  assert.match(result.message, /could not be verified/i);
  assert.equal(result.attribution.delegated, false);

  const artifactPath = path.join(baseDir, 'observability', 'specialist-delegation.jsonl');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8').trim().split('\n').at(-1));
  assert.equal(artifact.event, 'specialist.delegation.failed');
  assert.equal(artifact.error_code, 'SPECIALIST_RUNTIME_INVALID_JSON');
  assert.equal(artifact.fallback_reason, 'invalid_json');
  assert.equal(artifact.user_facing_reason_category, 'delegation_unverified');
});
