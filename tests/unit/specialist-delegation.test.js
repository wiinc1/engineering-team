const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
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
      error.code = 'SPECIALIST_UNAVAILABLE';
      throw error;
    },
  });

  const result = await coordinator.handleRequest('Need architecture review for this design', { coordinatorAgent: 'main' });

  assert.equal(result.mode, 'fallback');
  assert.match(result.message, /specialist `architect` could not be reached/i);
  assert.equal(result.attribution.handledBy, 'main');
  assert.equal(metrics.snapshot().fallbackToCoordinatorCount, 1);
  assert.equal(metrics.snapshot().delegationFailureByAgent.architect, 1);
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
  assert.equal(metrics.snapshot().attributionMismatchCount, 1);
  assert.equal(result.attribution.handledBy, 'main');
});

test('supports feature flag disablement for rollout control', () => {
  assert.equal(isSpecialistDelegationEnabled({ specialistDelegationEnabled: false }), false);
  assert.equal(isSpecialistDelegationEnabled({ ffSpecialistDelegation: 'false' }), false);
  assert.equal(isSpecialistDelegationEnabled({ ffSpecialistDelegation: 'true' }), true);
});
