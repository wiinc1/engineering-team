const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createSpecialistCoordinator } = require('../../lib/software-factory/delegation');
const { dispatchTaskToSpecialist } = require('../../lib/software-factory/task-dispatch');

const runtimeRunnerPath = path.join(__dirname, '..', 'fixtures', 'specialist-runtime-runner.js');

function readArtifacts(baseDir) {
  const artifactPath = path.join(baseDir, 'observability', 'specialist-delegation.jsonl');
  return fs.readFileSync(artifactPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

test('integration: runtime-backed delegation persists a success artifact that matches the validated result', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-integration-success-'));
  const coordinator = createSpecialistCoordinator({
    baseDir,
    delegationRunnerCommand: `node ${runtimeRunnerPath}`,
  });

  const result = await coordinator.handleRequest('Please implement this fix', { coordinatorAgent: 'main' });
  const artifact = readArtifacts(baseDir).at(-1);
  const metrics = JSON.parse(fs.readFileSync(path.join(baseDir, 'observability', 'specialist-delegation-metrics.json'), 'utf8'));

  assert.equal(result.mode, 'delegated');
  assert.equal(artifact.event, 'specialist.delegation.completed');
  assert.equal(artifact.target_specialist, result.specialist);
  assert.equal(artifact.actual_agent, result.agentId);
  assert.equal(artifact.session_id, result.metadata.sessionId);
  assert.deepEqual(artifact.ownership, result.metadata.ownership);
  assert.equal(metrics.prometheus.real_specialist_delegation_live_success_total, 1);
});

test('integration: malformed runtime output is rejected and recorded as delegation_unverified', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-integration-invalid-json-'));
  const coordinator = createSpecialistCoordinator({
    baseDir,
    delegationRunnerCommand: `node ${runtimeRunnerPath}`,
    runnerEnv: {
      FIXTURE_RUNTIME_MODE: 'invalid-json',
    },
  });

  const result = await coordinator.handleRequest('Please implement this fix', { coordinatorAgent: 'main' });
  const artifact = readArtifacts(baseDir).at(-1);
  const metrics = JSON.parse(fs.readFileSync(path.join(baseDir, 'observability', 'specialist-delegation-metrics.json'), 'utf8'));

  assert.equal(result.mode, 'fallback');
  assert.equal(result.metadata.fallbackReason, 'invalid_json');
  assert.equal(result.metadata.userFacingReasonCategory, 'delegation_unverified');
  assert.match(result.message, /could not be verified/i);
  assert.equal(artifact.event, 'specialist.delegation.failed');
  assert.equal(artifact.error_code, 'SPECIALIST_RUNTIME_INVALID_JSON');
  assert.equal(artifact.fallback_reason, 'invalid_json');
  assert.equal(artifact.user_facing_reason_category, 'delegation_unverified');
  assert.equal(result.attribution.delegated, false);
  assert.equal(metrics.prometheus.real_specialist_delegation_failure_reason_invalid_json_total, 1);
});

test('integration: unsupported task types fail closed without specialist ownership claims', async () => {
  const result = await dispatchTaskToSpecialist({
    id: 'TSK-UNSUPPORTED',
    type: 'operations',
    title: 'Unsupported specialist route',
    description: 'Validate unsupported task routing.',
  }, {
    coordinatorAgent: 'main',
  });

  assert.equal(result.mode, 'fallback');
  assert.equal(result.specialist, null);
  assert.equal(result.attribution.handledBy, 'main');
  assert.equal(result.metadata.fallbackReason, 'unsupported_task_type');
  assert.equal(result.metadata.userFacingReasonCategory, 'unsupported_runtime_specialist');
  assert.match(result.message, /unsupported for runtime delegation/i);
});
