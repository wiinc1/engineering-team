'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateRuntimeEvidence, sealRuntimeManifest,
} = require('../../lib/release-gates/runtime-evidence');
const { stagingConfiguration } = require('../../lib/release-gates/staging-deployment');

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

it('rejects local hosted targets and credential-bearing repository URLs before staging mutation', () => {
  const base = {
    STAGING_BASE_URL: 'https://127.0.0.1',
    STAGING_DATABASE_URL: 'postgres://staging@db.internal/staging',
    STAGING_DEPLOYMENT_ID: 'staging-secure',
    STAGING_RELEASE_ROOT: '/var/lib/engineering-team-staging',
    STAGING_REPOSITORY_URL: 'https://token@example.com/engineering-team.git',
    STAGING_REVISION: 'a'.repeat(40),
  };
  assert.throws(() => stagingConfiguration(base), { code: 'staging_configuration_invalid' });
});
