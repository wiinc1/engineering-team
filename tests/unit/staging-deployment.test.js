'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const {
  buildStagingDeployComponent,
  stagingConfiguration,
  stagingServiceEnvironment,
} = require('../../lib/release-gates/staging-deployment');

const revision = 'a'.repeat(40);

function validEnvironment() {
  return {
    STAGING_BASE_URL: 'https://factory-staging.example.com',
    STAGING_DATABASE_URL: 'postgres://staging:secret@db.internal/staging_factory?sslmode=require',
    STAGING_DEPLOYMENT_ID: 'staging-20260819-1',
    STAGING_JWT_SECRET: 'staging-jwt-secret-with-at-least-32-characters',
    STAGING_RELEASE_ROOT: '/var/lib/engineering-team-staging',
    STAGING_REPOSITORY_URL: 'https://example.com/engineering-team.git',
    STAGING_REVISION: revision,
  };
}

test('requires an exact revision, protected HTTPS host, dedicated database, and persistent root', () => {
  const configuration = stagingConfiguration(validEnvironment());
  assert.equal(configuration.revision, revision);
  assert.equal(configuration.baseUrl, 'https://factory-staging.example.com');
  assert.equal(configuration.releaseDir, path.join('/var/lib/engineering-team-staging', 'releases', revision));

  for (const override of [
    { STAGING_REVISION: 'main' },
    { STAGING_BASE_URL: 'http://factory-staging.example.com' },
    { STAGING_BASE_URL: 'https://127.0.0.1' },
    { STAGING_DATABASE_URL: '' },
    { STAGING_JWT_SECRET: 'short' },
    { STAGING_RELEASE_ROOT: '/private/tmp/staging' },
  ]) {
    assert.throws(() => stagingConfiguration({ ...validEnvironment(), ...override }), { code: 'staging_configuration_invalid' });
  }
});

test('allows only explicit loopback endpoints in host-local staging mode', () => {
  const configuration = stagingConfiguration({
    ...validEnvironment(),
    STAGING_BASE_URL: 'http://127.0.0.1:23000',
    STAGING_ENDPOINT_MODE: 'host-local',
  });
  assert.equal(configuration.baseUrl, 'http://127.0.0.1:23000');
  assert.equal(configuration.endpointMode, 'host-local');
  assert.throws(() => stagingConfiguration({
    ...validEnvironment(), STAGING_BASE_URL: 'http://127.0.0.1:23000',
  }), { code: 'staging_configuration_invalid' });
  assert.throws(() => stagingConfiguration({
    ...validEnvironment(), STAGING_BASE_URL: 'https://staging.example.com',
    STAGING_ENDPOINT_MODE: 'host-local',
  }), { code: 'staging_configuration_invalid' });
});

test('builds an isolated production-mode service environment without changing default labels', () => {
  const configuration = stagingConfiguration(validEnvironment());
  const env = stagingServiceEnvironment(configuration, { PATH: '/usr/bin' });
  assert.equal(env.FACTORY_STACK_PROFILE, 'staging');
  assert.equal(env.FACTORY_STACK_NODE_ENV, 'production');
  assert.equal(env.DATABASE_URL, validEnvironment().STAGING_DATABASE_URL);
  assert.equal(env.AUTH_JWT_SECRET, validEnvironment().STAGING_JWT_SECRET);
  assert.equal(env.GOLDEN_PATH_JWT_SECRET, validEnvironment().STAGING_JWT_SECRET);
  assert.notEqual(env.AUTH_SESSION_SECRET, validEnvironment().STAGING_JWT_SECRET);
  assert.match(env.FACTORY_STACK_ROOT_BINDING_FILE, /state\/staging\/repo-root\.json$/);
});

test('emits revision-bound staging components and fails status when either health proof fails', () => {
  const base = {
    automation: 'pipeline-1', deploymentId: 'staging-20260819-1',
    endpointMode: 'host-local',
    generatedAt: '2026-08-19T12:00:00.000Z', healthUrl: 'https://factory-staging.example.com/health',
    hostedHealth: true, localHealth: true, profile: 'staging', releaseDirectory: '/var/lib/release',
    revision, runtime: 'graphile',
  };
  const passing = buildStagingDeployComponent(base);
  assert.equal(passing.status, 'passed');
  assert.equal(passing.summary.exactRevision, true);
  assert.equal(passing.summary.hostLocalEndpoint, true);
  assert.match(passing.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(buildStagingDeployComponent({ ...base, hostedHealth: false }).status, 'failed');
});
