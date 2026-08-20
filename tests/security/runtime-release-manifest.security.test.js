'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateRuntimeEvidence, sealRuntimeManifest,
} = require('../../lib/release-gates/runtime-evidence');
const { stagingConfiguration } = require('../../lib/release-gates/staging-deployment');
const { cutoverApprovalDigest, validateJointCutover } = require('../../lib/runtime-cutover');
const { configuration: executableGateConfiguration } = require('../../scripts/normalize-runtime-gate-evidence');

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

it('does not accept a cutover confirmation copied from a differently scoped approval', () => {
  const plan = (scope, targetEngine, digest) => ({
    schemaVersion: 1, scope, targetEngine, mode: 'apply', allowed: true, freezeConfirmed: true,
    revision: 'a'.repeat(40), manifestDigest: digest, records: [], reasons: [],
  });
  const { cutoverPlanDigest } = require('../../lib/runtime-cutover');
  const jobsPlan = plan('jobs', 'graphile', `sha256:${'b'.repeat(64)}`);
  jobsPlan.digest = cutoverPlanDigest(jobsPlan);
  const factoryPlan = plan('factory', 'langgraph', `sha256:${'c'.repeat(64)}`);
  factoryPlan.digest = cutoverPlanDigest(factoryPlan);
  const approval = {
    schemaVersion: 'runtime-cutover-approval.v1', approved: true,
    approvedAt: '2026-08-19T18:00:00.000Z', actorId: 'operator-1', actorRole: 'admin',
    requestId: 'cutover-secure', revision: 'a'.repeat(40), jobsPlanDigest: jobsPlan.digest,
    factoryPlanDigest: factoryPlan.digest, graphileManifestDigest: jobsPlan.manifestDigest,
    langgraphManifestDigest: factoryPlan.manifestDigest,
  };
  const tampered = { ...approval, graphileManifestDigest: `sha256:${'d'.repeat(64)}` };
  const result = validateJointCutover({
    jobsPlan, factoryPlan, approval: tampered, confirmationDigest: cutoverApprovalDigest(approval),
  }, Date.parse('2026-08-19T18:01:00.000Z'));
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('approval_scope_mismatch'));
  assert.ok(result.reasons.includes('approval_confirmation_mismatch'));
});

it('requires explicit host-local scope and rejects credential-bearing staging inputs before mutation', () => {
  const base = {
    STAGING_BASE_URL: 'https://127.0.0.1',
    STAGING_DATABASE_URL: 'postgres://staging@db.internal/staging',
    STAGING_DEPLOYMENT_ID: 'staging-secure',
    STAGING_JWT_SECRET: 'staging-jwt-secret-with-at-least-32-characters',
    STAGING_RELEASE_ROOT: '/var/lib/engineering-team-staging',
    STAGING_REPOSITORY_URL: 'https://token@example.com/engineering-team.git',
    STAGING_REVISION: 'a'.repeat(40),
  };
  assert.throws(() => stagingConfiguration(base), { code: 'staging_configuration_invalid' });
  assert.throws(() => stagingConfiguration({
    ...base,
    STAGING_BASE_URL: 'https://staging.example.com',
    STAGING_ENDPOINT_MODE: 'host-local',
    STAGING_REPOSITORY_URL: 'https://example.com/engineering-team.git',
  }), { code: 'staging_configuration_invalid' });
  const local = stagingConfiguration({
    ...base,
    STAGING_BASE_URL: 'http://127.0.0.1:23000',
    STAGING_ENDPOINT_MODE: 'host-local',
    STAGING_REPOSITORY_URL: '/srv/engineering-team',
  });
  assert.equal(local.endpointMode, 'host-local');
});

it('rejects endpoint-scope downgrades while normalizing executable release evidence', () => {
  const revision = require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const base = {
    STAGING_REVISION: revision,
    STAGING_DEPLOYMENT_ID: 'staging-secure',
    CI_JOB_URL: 'https://ci.example.test/jobs/security',
  };
  assert.throws(() => executableGateConfiguration(['--runtime', 'graphile', '--kind', 'contract'], {
    ...base, STAGING_BASE_URL: 'http://127.0.0.1:23000',
  }), /hosted mode/);
  assert.throws(() => executableGateConfiguration(['--runtime', 'graphile', '--kind', 'contract'], {
    ...base, STAGING_ENDPOINT_MODE: 'host-local', STAGING_BASE_URL: 'https://staging.example.test',
  }), /host-local mode/);
  assert.throws(() => executableGateConfiguration(['--runtime', 'graphile', '--kind', 'contract'], {
    ...base, STAGING_ENDPOINT_MODE: 'host-local', STAGING_BASE_URL: 'http://user@127.0.0.1:23000',
  }), /host-local mode/);
  assert.throws(() => executableGateConfiguration(['--runtime', 'graphile', '--kind', 'contract'], {
    ...base, CI_JOB_URL: undefined, RUNTIME_EVIDENCE_AUTOMATION: 'local:runtime-hosted-evidence',
    STAGING_BASE_URL: 'https://staging.example.test',
  }), /hosted mode/);
});
