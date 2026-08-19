'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateRuntimeEvidence, sealRuntimeManifest,
} = require('../../lib/release-gates/runtime-evidence');

it('preserves an immutable manifest seal through JSON artifact transport', () => {
  const revision = 'a'.repeat(40);
  const manifest = sealRuntimeManifest({
    schemaVersion: 1, runtime: 'graphile', revision, deploymentId: 'staging-1', artifacts: [],
  });
  const transported = JSON.parse(JSON.stringify(manifest));
  const decision = evaluateRuntimeEvidence(transported, {
    runtime: 'graphile', revision, now: Date.parse('2026-08-19T18:00:00.000Z'),
  });
  assert.equal(decision.manifestDigest, manifest.manifestDigest);
  assert.equal(decision.reasons.includes('manifest:digest'), false);
});
