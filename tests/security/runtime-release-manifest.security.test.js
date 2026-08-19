'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateRuntimeEvidence, sealRuntimeManifest,
} = require('../../lib/release-gates/runtime-evidence');

it('fails closed when deployment identity is changed after a manifest is sealed', () => {
  const revision = 'a'.repeat(40);
  const manifest = JSON.parse(JSON.stringify(sealRuntimeManifest({
    schemaVersion: 1, runtime: 'langgraph', revision, deploymentId: 'staging-1', artifacts: [],
  })));
  manifest.deploymentId = 'attacker-controlled';
  const decision = evaluateRuntimeEvidence(manifest, {
    runtime: 'langgraph', revision, now: Date.parse('2026-08-19T18:00:00.000Z'),
  });
  assert.ok(decision.reasons.includes('manifest:digest'));
  assert.equal(decision.allowed, false);
});
