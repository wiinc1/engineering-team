'use strict';

const crypto = require('node:crypto');

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

const COMMON_ARTIFACTS = Object.freeze([
  'staging_deploy', 'contract', 'security', 'sbom', 'performance_2x_10m',
  'chaos', 'soak_24h', 'dr_restore', 'synthetic_lifecycle', 'alerts',
  'kill_switch', 'rollback',
]);

const RUNTIME_ARTIFACTS = Object.freeze({
  graphile: Object.freeze([...COMMON_ARTIFACTS, 'composed_runtime']),
  langgraph: Object.freeze([...COMMON_ARTIFACTS, 'checkpoint_retention', 'browser']),
});

class ReleaseGateError extends Error {
  constructor(reasons) {
    super('Runtime cutover evidence did not pass.');
    this.name = 'ReleaseGateError';
    this.code = 'runtime_release_evidence_failed';
    this.reasons = Object.freeze([...reasons]);
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function runtimeManifestDigest(manifest) {
  const { manifestDigest: _ignored, ...payload } = manifest || {};
  const body = JSON.stringify(stableValue(payload));
  return `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`;
}

function sealRuntimeManifest(manifest) {
  const payload = { ...manifest };
  delete payload.manifestDigest;
  return { ...payload, manifestDigest: runtimeManifestDigest(payload) };
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function artifactReasons(artifact, input) {
  const prefix = artifact?.kind || 'unknown';
  const reasons = [];
  if (!artifact || typeof artifact !== 'object') return ['artifact_invalid'];
  if (artifact.status !== 'passed') reasons.push(`${prefix}:status`);
  if (artifact.revision !== input.revision) reasons.push(`${prefix}:revision`);
  if (artifact.redacted !== true) reasons.push(`${prefix}:redaction`);
  if (!DIGEST_PATTERN.test(String(artifact.digest || ''))) reasons.push(`${prefix}:digest`);
  if (!artifact.provenance?.automation || !artifact.provenance?.environment) reasons.push(`${prefix}:provenance`);
  const generated = Date.parse(artifact.generatedAt);
  const expires = Date.parse(artifact.expiresAt);
  if (!Number.isFinite(generated) || generated > input.now + MAX_FUTURE_SKEW_MS) reasons.push(`${prefix}:generated_at`);
  if (!Number.isFinite(expires) || expires <= input.now) reasons.push(`${prefix}:stale`);

  const summary = artifact.summary || {};
  if (prefix === 'security' && (positiveNumber(summary.high) !== 0 || positiveNumber(summary.critical) !== 0)) reasons.push(`${prefix}:findings`);
  if (prefix === 'performance_2x_10m') {
    if (positiveNumber(summary.durationSeconds) < 600 || positiveNumber(summary.loadFactor) < 2) reasons.push(`${prefix}:duration_or_load`);
    if (input.runtime === 'graphile' && (positiveNumber(summary.enqueueP95Ms) >= 100 || positiveNumber(summary.enqueueP99Ms) >= 250 || positiveNumber(summary.readP95Ms) >= 250)) reasons.push(`${prefix}:latency`);
    if (input.runtime === 'langgraph' && (positiveNumber(summary.statusP95Ms) >= 250 || positiveNumber(summary.checkpointP95Ms) >= 250 || positiveNumber(summary.resumeP95Ms) >= 2_000 || positiveNumber(summary.graphOverheadPercent) >= 10)) reasons.push(`${prefix}:latency`);
  }
  if (prefix === 'soak_24h' && (positiveNumber(summary.durationSeconds) < 86_400 || positiveNumber(summary.violations) !== 0 || positiveNumber(summary.leaks) !== 0)) reasons.push(`${prefix}:threshold`);
  if (prefix === 'dr_restore' && (summary.reconciled !== true || summary.rpoVerified !== true || positiveNumber(summary.rtoSeconds) > 900)) reasons.push(`${prefix}:recovery`);
  if (prefix === 'chaos' && (positiveNumber(summary.duplicateEffects) !== 0 || summary.recovered !== true)) reasons.push(`${prefix}:recovery`);
  if (prefix === 'synthetic_lifecycle' && (positiveNumber(summary.passes) < 3 || positiveNumber(summary.failures) !== 0)) reasons.push(`${prefix}:synthetic`);
  if (prefix === 'alerts' && (summary.deliveryVerified !== true || summary.rulesTested !== true)) reasons.push(`${prefix}:routing`);
  if (prefix === 'kill_switch' && (positiveNumber(summary.stopSeconds) > 120 || summary.legacyInvoked === true || summary.recoveryVerified !== true)) reasons.push(`${prefix}:shutdown`);
  if (prefix === 'rollback' && (summary.exclusiveOwnership !== true || positiveNumber(summary.duplicateEffects) !== 0)) reasons.push(`${prefix}:ownership`);
  return reasons;
}

function evaluateRuntimeEvidence(manifest, options = {}) {
  const now = options.now ?? Date.now();
  const runtime = options.runtime || manifest?.runtime;
  const revision = options.revision || manifest?.revision;
  const reasons = [];
  if (!RUNTIME_ARTIFACTS[runtime]) reasons.push('manifest:runtime');
  if (!SHA_PATTERN.test(String(revision || ''))) reasons.push('manifest:revision');
  if (manifest?.schemaVersion !== 1) reasons.push('manifest:schema_version');
  if (manifest?.runtime !== runtime) reasons.push('manifest:runtime_mismatch');
  if (manifest?.revision !== revision) reasons.push('manifest:revision_mismatch');
  if (!manifest?.deploymentId || typeof manifest.deploymentId !== 'string') reasons.push('manifest:deployment');
  const manifestDigest = runtimeManifestDigest(manifest);
  if (manifest?.manifestDigest !== manifestDigest) reasons.push('manifest:digest');
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const byKind = new Map();
  for (const artifact of artifacts) {
    if (!artifact?.kind || byKind.has(artifact.kind)) reasons.push(`${artifact?.kind || 'unknown'}:duplicate_or_missing_kind`);
    else byKind.set(artifact.kind, artifact);
  }
  for (const kind of RUNTIME_ARTIFACTS[runtime] || []) {
    if (!byKind.has(kind)) reasons.push(`${kind}:missing`);
  }
  for (const artifact of artifacts) reasons.push(...artifactReasons(artifact, { now, revision, runtime }));
  const uniqueReasons = Object.freeze([...new Set(reasons)].sort());
  return Object.freeze({
    allowed: uniqueReasons.length === 0,
    runtime,
    revision,
    deploymentId: manifest?.deploymentId || null,
    evaluatedAt: new Date(now).toISOString(),
    manifestDigest,
    reasons: uniqueReasons,
  });
}

function assertRuntimeEvidence(manifest, options = {}) {
  const decision = evaluateRuntimeEvidence(manifest, options);
  if (!decision.allowed) throw new ReleaseGateError(decision.reasons);
  return decision;
}

module.exports = {
  COMMON_ARTIFACTS, RUNTIME_ARTIFACTS, ReleaseGateError, assertRuntimeEvidence,
  evaluateRuntimeEvidence, runtimeManifestDigest, sealRuntimeManifest,
};
