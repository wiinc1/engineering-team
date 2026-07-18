'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RUNTIME_ARTIFACTS, assertRuntimeEvidence, evaluateRuntimeEvidence } = require('../../lib/release-gates/runtime-evidence');

const revision = 'a'.repeat(40);
const now = Date.parse('2026-07-18T12:00:00.000Z');

function summary(kind, runtime) {
  if (kind === 'security') return { high: 0, critical: 0 };
  if (kind === 'performance_2x_10m') return runtime === 'graphile'
    ? { durationSeconds: 600, loadFactor: 2, enqueueP95Ms: 99, enqueueP99Ms: 249, readP95Ms: 249 }
    : { durationSeconds: 600, loadFactor: 2, statusP95Ms: 249, checkpointP95Ms: 249, resumeP95Ms: 1999, graphOverheadPercent: 9.9 };
  if (kind === 'soak_24h') return { durationSeconds: 86_400, violations: 0, leaks: 0 };
  if (kind === 'dr_restore') return { reconciled: true, rpoVerified: true, rtoSeconds: 900 };
  if (kind === 'chaos') return { duplicateEffects: 0, recovered: true };
  if (kind === 'synthetic_lifecycle') return { passes: 3, failures: 0 };
  if (kind === 'alerts') return { deliveryVerified: true, rulesTested: true };
  if (kind === 'kill_switch') return { stopSeconds: 120, legacyInvoked: false, recoveryVerified: true };
  if (kind === 'rollback') return { exclusiveOwnership: true, duplicateEffects: 0 };
  return {};
}

function manifest(runtime = 'graphile') {
  return {
    schemaVersion: 1, runtime, revision, deploymentId: 'staging-20260718-1',
    artifacts: RUNTIME_ARTIFACTS[runtime].map((kind) => ({
      kind, status: 'passed', revision, redacted: true,
      digest: `sha256:${'b'.repeat(64)}`,
      generatedAt: '2026-07-18T11:00:00.000Z', expiresAt: '2026-07-19T12:00:00.000Z',
      provenance: { automation: 'pipeline-123', environment: 'staging' }, summary: summary(kind, runtime),
    })),
  };
}

test('Graphile and LangGraph cutover gates accept complete current immutable evidence', () => {
  for (const runtime of ['graphile', 'langgraph']) {
    assert.equal(assertRuntimeEvidence(manifest(runtime), { runtime, revision, now }).allowed, true);
  }
});

test('gate blocks missing stale wrong-revision unredacted failing and duplicate evidence', () => {
  const value = manifest('graphile');
  value.artifacts.shift();
  value.artifacts[0].expiresAt = '2026-07-18T11:59:59.000Z';
  value.artifacts[1].revision = 'c'.repeat(40);
  value.artifacts[2].redacted = false;
  value.artifacts[3].status = 'failed';
  value.artifacts.push({ ...value.artifacts[4] });
  const decision = evaluateRuntimeEvidence(value, { runtime: 'graphile', revision, now });
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.some((reason) => reason.endsWith(':missing')));
  assert.ok(decision.reasons.some((reason) => reason.endsWith(':stale')));
  assert.ok(decision.reasons.some((reason) => reason.endsWith(':revision')));
  assert.ok(decision.reasons.some((reason) => reason.endsWith(':redaction')));
  assert.ok(decision.reasons.some((reason) => reason.endsWith(':status')));
  assert.ok(decision.reasons.some((reason) => reason.endsWith(':duplicate_or_missing_kind')));
});

test('threshold failures block security performance chaos soak DR synthetic alerts kill switch and rollback artifacts', () => {
  const value = manifest('langgraph');
  const summaries = Object.fromEntries(value.artifacts.map((artifact) => [artifact.kind, artifact.summary]));
  summaries.security.high = 1;
  summaries.performance_2x_10m.resumeP95Ms = 2000;
  summaries.chaos.duplicateEffects = 1;
  summaries.soak_24h.leaks = 1;
  summaries.dr_restore.rtoSeconds = 901;
  summaries.synthetic_lifecycle.passes = 2;
  summaries.alerts.deliveryVerified = false;
  summaries.kill_switch.legacyInvoked = true;
  summaries.rollback.exclusiveOwnership = false;
  const reasons = evaluateRuntimeEvidence(value, { runtime: 'langgraph', revision, now }).reasons;
  for (const expected of ['security:findings', 'performance_2x_10m:latency', 'chaos:recovery', 'soak_24h:threshold', 'dr_restore:recovery', 'synthetic_lifecycle:synthetic', 'alerts:routing', 'kill_switch:shutdown', 'rollback:ownership']) {
    assert.ok(reasons.includes(expected), expected);
  }
});
