'use strict';

const crypto = require('node:crypto');
const { RUNTIME_ARTIFACTS, evaluateRuntimeEvidence } = require('./runtime-evidence');

const COMPONENT_SCHEMA_VERSION = 1;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function evidenceDigest(evidence) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stableValue(evidence))).digest('hex')}`;
}

function collectArtifact(component, options) {
  if (!component || typeof component !== 'object' || Array.isArray(component)) {
    throw new TypeError('Release evidence component must be an object.');
  }
  if (component.schemaVersion !== COMPONENT_SCHEMA_VERSION) throw new Error('Unsupported release evidence component schema.');
  if (component.runtime !== options.runtime) throw new Error(`Evidence runtime mismatch for ${component.kind || 'unknown'}.`);
  if (component.revision !== options.revision) throw new Error(`Evidence revision mismatch for ${component.kind || 'unknown'}.`);
  if (!RUNTIME_ARTIFACTS[options.runtime]?.includes(component.kind)) {
    throw new Error(`Unexpected ${options.runtime} evidence kind: ${component.kind || 'missing'}.`);
  }
  if (!Object.hasOwn(component, 'evidence')) throw new Error(`Evidence payload missing for ${component.kind}.`);
  const digest = evidenceDigest(component.evidence);
  if (component.digest && component.digest !== digest) throw new Error(`Evidence digest mismatch for ${component.kind}.`);
  return Object.freeze({
    kind: component.kind,
    status: component.status,
    revision: component.revision,
    redacted: component.redacted,
    digest,
    generatedAt: component.generatedAt,
    expiresAt: component.expiresAt,
    provenance: component.provenance,
    summary: component.summary || {},
  });
}

function collectRuntimeEvidence(input, options = {}) {
  if (!RUNTIME_ARTIFACTS[input?.runtime]) throw new Error('Runtime must be graphile or langgraph.');
  if (!input.revision || !input.deploymentId) throw new Error('Revision and deploymentId are required.');
  if (!Array.isArray(input.components)) throw new TypeError('Evidence components must be an array.');
  const artifacts = input.components.map((component) => collectArtifact(component, input));
  const kinds = artifacts.map((artifact) => artifact.kind);
  if (new Set(kinds).size !== kinds.length) throw new Error('Duplicate release evidence kind.');
  const manifest = Object.freeze({
    schemaVersion: 1,
    runtime: input.runtime,
    revision: input.revision,
    deploymentId: input.deploymentId,
    artifacts: Object.freeze([...artifacts].sort((left, right) => left.kind.localeCompare(right.kind))),
  });
  const decision = evaluateRuntimeEvidence(manifest, {
    runtime: input.runtime,
    revision: input.revision,
    now: options.now,
  });
  if (!options.allowIncomplete && !decision.allowed) {
    const error = new Error('Collected runtime evidence is incomplete or failing.');
    error.code = 'runtime_release_evidence_failed';
    error.reasons = decision.reasons;
    throw error;
  }
  return Object.freeze({ manifest, decision });
}

module.exports = {
  COMPONENT_SCHEMA_VERSION,
  collectArtifact,
  collectRuntimeEvidence,
  evidenceDigest,
  stableValue,
};
