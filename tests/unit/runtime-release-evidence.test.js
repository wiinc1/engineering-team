'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RUNTIME_ARTIFACTS, assertRuntimeEvidence, evaluateRuntimeEvidence } = require('../../lib/release-gates/runtime-evidence');
const { collectRuntimeEvidence, evidenceDigest, stableValue } = require('../../lib/release-gates/evidence-collector');
const { buildSbomEvidence, validateSbom } = require('../../scripts/generate-runtime-sbom');

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

function components(runtime = 'graphile') {
  return manifest(runtime).artifacts.map((artifact) => {
    const evidence = { source: `${runtime}:${artifact.kind}`, result: artifact.summary };
    return {
      schemaVersion: 1, runtime, ...artifact, digest: evidenceDigest(evidence), evidence,
    };
  });
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

function reasonsFor(runtime, kind, mutate) {
  const value = manifest(runtime);
  mutate(value.artifacts.find((artifact) => artifact.kind === kind), value);
  return evaluateRuntimeEvidence(value, { runtime, revision, now }).reasons;
}

test('manifest and immutable artifact provenance fail closed at every trust boundary', () => {
  for (const [mutate, expected] of [
    [(value) => { value.schemaVersion = 2; }, 'manifest:schema_version'],
    [(value) => { value.runtime = 'unknown'; }, 'manifest:runtime_mismatch'],
    [(value) => { value.revision = `x${revision}`; }, 'manifest:revision_mismatch'],
    [(value) => { value.deploymentId = ''; }, 'manifest:deployment'],
    [(value) => { value.artifacts = null; }, 'staging_deploy:missing'],
  ]) {
    const value = manifest('graphile');
    mutate(value);
    assert.ok(evaluateRuntimeEvidence(value, { runtime: 'graphile', revision, now }).reasons.includes(expected));
  }
  assert.ok(evaluateRuntimeEvidence(null, { runtime: 'unknown', revision: `x${revision}`, now }).reasons.includes('manifest:runtime'));

  const cases = [
    [(artifact) => { artifact.digest = `xsha256:${'b'.repeat(64)}`; }, 'security:digest'],
    [(artifact) => { artifact.digest = `sha256:${'b'.repeat(64)}x`; }, 'security:digest'],
    [(artifact) => { artifact.provenance.automation = ''; }, 'security:provenance'],
    [(artifact) => { artifact.provenance.environment = ''; }, 'security:provenance'],
    [(artifact) => { artifact.generatedAt = 'invalid'; }, 'security:generated_at'],
    [(artifact) => { artifact.generatedAt = new Date(now + 300_001).toISOString(); }, 'security:generated_at'],
    [(artifact) => { artifact.expiresAt = 'invalid'; }, 'security:stale'],
    [(artifact) => { artifact.expiresAt = new Date(now).toISOString(); }, 'security:stale'],
  ];
  for (const [mutate, expected] of cases) assert.ok(reasonsFor('graphile', 'security', mutate).includes(expected));
  const nullArtifact = manifest('graphile');
  nullArtifact.artifacts.push(null);
  assert.ok(evaluateRuntimeEvidence(nullArtifact, { runtime: 'graphile', revision, now }).reasons.includes('artifact_invalid'));
});

test('every release threshold dimension independently blocks readiness', () => {
  const cases = [
    ['graphile', 'security', (s) => { s.critical = 1; }, 'security:findings'],
    ['graphile', 'performance_2x_10m', (s) => { s.durationSeconds = 599; }, 'performance_2x_10m:duration_or_load'],
    ['graphile', 'performance_2x_10m', (s) => { s.loadFactor = 1.99; }, 'performance_2x_10m:duration_or_load'],
    ['graphile', 'performance_2x_10m', (s) => { s.enqueueP95Ms = 100; }, 'performance_2x_10m:latency'],
    ['graphile', 'performance_2x_10m', (s) => { s.enqueueP99Ms = 250; }, 'performance_2x_10m:latency'],
    ['graphile', 'performance_2x_10m', (s) => { s.readP95Ms = 250; }, 'performance_2x_10m:latency'],
    ['langgraph', 'performance_2x_10m', (s) => { s.statusP95Ms = 250; }, 'performance_2x_10m:latency'],
    ['langgraph', 'performance_2x_10m', (s) => { s.checkpointP95Ms = 250; }, 'performance_2x_10m:latency'],
    ['langgraph', 'performance_2x_10m', (s) => { s.resumeP95Ms = 2000; }, 'performance_2x_10m:latency'],
    ['langgraph', 'performance_2x_10m', (s) => { s.graphOverheadPercent = 10; }, 'performance_2x_10m:latency'],
    ['graphile', 'soak_24h', (s) => { s.durationSeconds = 86_399; }, 'soak_24h:threshold'],
    ['graphile', 'soak_24h', (s) => { s.violations = 1; }, 'soak_24h:threshold'],
    ['graphile', 'dr_restore', (s) => { s.reconciled = false; }, 'dr_restore:recovery'],
    ['graphile', 'dr_restore', (s) => { s.rpoVerified = false; }, 'dr_restore:recovery'],
    ['graphile', 'chaos', (s) => { s.recovered = false; }, 'chaos:recovery'],
    ['graphile', 'synthetic_lifecycle', (s) => { s.failures = 1; }, 'synthetic_lifecycle:synthetic'],
    ['graphile', 'alerts', (s) => { s.rulesTested = false; }, 'alerts:routing'],
    ['graphile', 'kill_switch', (s) => { s.stopSeconds = 121; }, 'kill_switch:shutdown'],
    ['graphile', 'kill_switch', (s) => { s.recoveryVerified = false; }, 'kill_switch:shutdown'],
    ['graphile', 'rollback', (s) => { s.duplicateEffects = 1; }, 'rollback:ownership'],
  ];
  for (const [runtime, kind, mutate, expected] of cases) {
    assert.ok(reasonsFor(runtime, kind, (artifact) => mutate(artifact.summary)).includes(expected), `${runtime}:${kind}`);
  }
});

test('assertion error and accepted decision expose deterministic immutable metadata', () => {
  const accepted = evaluateRuntimeEvidence(manifest('graphile'), { runtime: 'graphile', revision, now });
  assert.match(accepted.manifestDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(accepted.evaluatedAt, '2026-07-18T12:00:00.000Z');
  assert.throws(() => assertRuntimeEvidence({}, { runtime: 'graphile', revision, now }), (error) => {
    assert.equal(error.name, 'ReleaseGateError');
    assert.equal(error.code, 'runtime_release_evidence_failed');
    assert.ok(error.reasons.length > 0);
    return true;
  });
});

test('collector assembles deterministic exact-revision manifests and validates source evidence digests', () => {
  const input = { runtime: 'graphile', revision, deploymentId: 'staging-collector', components: components() };
  const result = collectRuntimeEvidence(input, { now });
  assert.equal(result.decision.allowed, true);
  assert.deepEqual(result.manifest.artifacts.map((artifact) => artifact.kind), [...RUNTIME_ARTIFACTS.graphile].sort());
  const reordered = { z: 1, nested: { b: 2, a: 1 }, a: 3 };
  assert.deepEqual(stableValue(reordered), { a: 3, nested: { a: 1, b: 2 }, z: 1 });
  assert.equal(evidenceDigest(reordered), evidenceDigest({ a: 3, nested: { a: 1, b: 2 }, z: 1 }));

  const corrupt = components();
  corrupt[0].digest = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => collectRuntimeEvidence({ ...input, components: corrupt }, { now }), /digest mismatch/);
});

test('collector supports explicit partial assembly but never treats missing soak or duplicate evidence as ready', () => {
  const partial = components().filter((artifact) => artifact.kind !== 'soak_24h');
  const result = collectRuntimeEvidence({
    runtime: 'graphile', revision, deploymentId: 'staging-partial', components: partial,
  }, { now, allowIncomplete: true });
  assert.equal(result.decision.allowed, false);
  assert.ok(result.decision.reasons.includes('soak_24h:missing'));
  assert.throws(() => collectRuntimeEvidence({
    runtime: 'graphile', revision, deploymentId: 'staging-partial', components: partial,
  }, { now }), (error) => error.code === 'runtime_release_evidence_failed');
  assert.throws(() => collectRuntimeEvidence({
    runtime: 'graphile', revision, deploymentId: 'staging-duplicate', components: [...partial, partial[0]],
  }, { now, allowIncomplete: true }), /Duplicate/);
});

test('SBOM evidence is CycloneDX, revision-bound, redacted, and integrity protected', () => {
  const sbom = validateSbom({ bomFormat: 'CycloneDX', specVersion: '1.6', components: [{ name: 'pg' }] });
  const artifact = buildSbomEvidence(sbom, {
    runtime: 'langgraph', revision, generatedAt: '2026-07-18T11:00:00.000Z',
    expiresAt: '2026-07-19T12:00:00.000Z', automation: 'pipeline-123', environment: 'staging',
  });
  assert.equal(artifact.kind, 'sbom');
  assert.equal(artifact.redacted, true);
  assert.equal(artifact.summary.components, 1);
  assert.equal(artifact.digest, evidenceDigest(artifact.evidence));
  assert.throws(() => validateSbom({ bomFormat: 'SPDX', components: [] }), /CycloneDX/);
});
