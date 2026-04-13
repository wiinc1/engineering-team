const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  FALLBACK_REASONS,
  buildDelegationFallbackMessage,
  classifyDelegationFailure,
  classifySpecialistRequest,
  createDelegationMetrics,
  createSpecialistCoordinator,
} = require('../../lib/software-factory/delegation');
const { isSpecialistDelegationEnabled } = require('../../lib/audit/feature-flags');

const runtimeRunnerPath = path.join(__dirname, '..', 'fixtures', 'specialist-runtime-runner.js');

test('routes clear specialist-owned requests to the expected specialist', () => {
  assert.deepEqual(classifySpecialistRequest('Please implement this bug fix').specialist, 'engineer');
  assert.deepEqual(classifySpecialistRequest('Need architecture review for this service boundary').specialist, 'architect');
  assert.deepEqual(classifySpecialistRequest('Can QA verify the regression coverage?').specialist, 'qa');
  assert.deepEqual(classifySpecialistRequest('SRE should inspect the latency spike and alerts').specialist, 'sre');
});

test('treats ambiguous or unmatched requests as coordinator-owned', () => {
  assert.equal(classifySpecialistRequest('hello team').confidence, 'none');
  const ambiguous = classifySpecialistRequest('Need architecture review and QA verification');
  assert.equal(ambiguous.confidence, 'ambiguous');
  assert.equal(ambiguous.specialist, null);
});

test('delegates through runtime evidence and returns truthful attribution with artifact evidence', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specialist-delegation-'));
  const coordinator = createSpecialistCoordinator({
    baseDir,
    delegationRunnerCommand: `node ${runtimeRunnerPath}`,
  });

  const result = await coordinator.handleRequest('Please implement this fix', { coordinatorAgent: 'main' });

  assert.equal(result.mode, 'delegated');
  assert.equal(result.agentId, 'engineer');
  assert.deepEqual(result.attribution, { handledBy: 'engineer', delegated: true, coordinator: 'main' });
  assert.match(result.metadata.sessionId, /^runtime-session-/);
  assert.deepEqual(result.metadata.ownership.runtime, 'fixture-openclaw');

  const artifactPath = path.join(baseDir, 'observability', 'specialist-delegation.jsonl');
  const artifactLines = fs.readFileSync(artifactPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(artifactLines[0].target_specialist, 'engineer');
  assert.equal(artifactLines[0].actual_agent, 'engineer');
  assert.match(artifactLines[0].session_id, /^runtime-session-/);
  assert.equal(artifactLines[0].ownership.runtime, 'fixture-openclaw');
});

test('falls back explicitly when delegation fails and records failure metrics', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specialist-fallback-'));
  const metrics = createDelegationMetrics();
  const coordinator = createSpecialistCoordinator({
    baseDir,
    metrics,
    delegateWork: async () => {
      const error = new Error('specialist offline');
      error.code = 'SPECIALIST_RUNTIME_EXEC_FAILED';
      throw error;
    },
  });

  const result = await coordinator.handleRequest('Need architecture review for this design', { coordinatorAgent: 'main' });

  assert.equal(result.mode, 'fallback');
  assert.equal(result.metadata.fallbackReason, FALLBACK_REASONS.RUNTIME_EXEC_FAILED);
  assert.match(result.message, /failed during execution/i);
  assert.equal(result.attribution.handledBy, 'main');
  assert.equal(metrics.snapshot().fallbackToCoordinatorCount, 1);
  assert.equal(metrics.snapshot().delegationFailureByAgent.architect, 1);
  assert.equal(metrics.snapshot().delegationFailureByReason.runtime_exec_failed, 1);
});

test('records attribution mismatches and falls back truthfully', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specialist-mismatch-'));
  const metrics = createDelegationMetrics();
  const coordinator = createSpecialistCoordinator({
    baseDir,
    metrics,
    delegateWork: async () => ({
      agentId: 'main',
      sessionId: 'bad-session',
      output: 'wrong owner',
    }),
  });

  const result = await coordinator.handleRequest('Please implement this feature', { coordinatorAgent: 'main' });

  assert.equal(result.mode, 'fallback');
  assert.equal(result.metadata.fallbackReason, FALLBACK_REASONS.ATTRIBUTION_MISMATCH);
  assert.match(result.message, /could not be verified/i);
  assert.equal(metrics.snapshot().attributionMismatchCount, 1);
  assert.equal(result.attribution.handledBy, 'main');
});

test('classifyDelegationFailure maps runtime errors to stable fallback reasons', () => {
  assert.equal(classifyDelegationFailure({ code: 'SPECIALIST_RUNTIME_NOT_CONFIGURED' }), FALLBACK_REASONS.NOT_CONFIGURED);
  assert.equal(classifyDelegationFailure({ code: 'SPECIALIST_RUNTIME_EXEC_FAILED' }), FALLBACK_REASONS.RUNTIME_EXEC_FAILED);
  assert.equal(classifyDelegationFailure({ code: 'SPECIALIST_RUNTIME_INVALID_JSON' }), FALLBACK_REASONS.INVALID_JSON);
  assert.equal(classifyDelegationFailure({ code: 'SPECIALIST_RUNTIME_MISSING_EVIDENCE' }), FALLBACK_REASONS.MISSING_EVIDENCE);
  assert.equal(classifyDelegationFailure({ code: 'SPECIALIST_ATTRIBUTION_MISMATCH' }), FALLBACK_REASONS.ATTRIBUTION_MISMATCH);
});

test('buildDelegationFallbackMessage returns safe user-facing copy per failure class', () => {
  assert.match(buildDelegationFallbackMessage({ specialist: 'engineer', fallbackReason: FALLBACK_REASONS.NOT_CONFIGURED }), /not configured or not available/i);
  assert.match(buildDelegationFallbackMessage({ specialist: 'engineer', fallbackReason: FALLBACK_REASONS.RUNTIME_EXEC_FAILED }), /failed during execution/i);
  assert.match(buildDelegationFallbackMessage({ specialist: 'engineer', fallbackReason: FALLBACK_REASONS.INVALID_JSON }), /could not be verified/i);
  assert.match(buildDelegationFallbackMessage({ specialist: 'engineer', fallbackReason: FALLBACK_REASONS.UNSUPPORTED_TASK_TYPE }), /does not map to a supported runtime specialist/i);
});

test('supports feature flag disablement for rollout control', () => {
  assert.equal(isSpecialistDelegationEnabled({ specialistDelegationEnabled: false }), false);
  assert.equal(isSpecialistDelegationEnabled({ ffSpecialistDelegation: 'false' }), false);
  assert.equal(isSpecialistDelegationEnabled({ ffSpecialistDelegation: 'true' }), true);
});
