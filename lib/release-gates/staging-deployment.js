'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const { evidenceDigest } = require('./evidence-collector');

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DEPLOYMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/;
const ENDPOINT_MODES = new Set(['hosted', 'host-local']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function realPathCandidate(value) {
  return path.resolve(String(value || ''));
}

function isTemporaryPath(value) {
  const candidate = realPathCandidate(value);
  const temporaryRoots = [...new Set(['/tmp', '/private/tmp', os.tmpdir()].map((entry) => path.resolve(entry)))];
  return temporaryRoots.some((entry) => candidate === entry || candidate.startsWith(`${entry}${path.sep}`))
    || candidate.split(path.sep).includes('_checkouts');
}

function protectedHttpsUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  if (LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.local')) return null;
  return parsed;
}

function hostLocalUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) ? parsed : null;
}

function stagingEndpointUrl(value, mode) {
  return mode === 'host-local' ? hostLocalUrl(value) : protectedHttpsUrl(value);
}

function stagingSessionSecret(jwtSecret) {
  return crypto.createHash('sha256').update(`engineering-team-staging-session\0${jwtSecret}`).digest('hex');
}

function hasPostgresProtocol(value) {
  try { return ['postgres:', 'postgresql:'].includes(new URL(value).protocol); } catch { return false; }
}

function validRepositorySource(value) {
  if (!value) return false;
  if (path.isAbsolute(value)) return true;
  try {
    const parsed = new URL(value);
    return !parsed.username && !parsed.password;
  } catch { return false; }
}

function stagingConfigurationErrors(input) {
  const errors = [];
  if (!SHA_PATTERN.test(input.revision)) errors.push('STAGING_REVISION must be an exact lowercase 40-character commit SHA.');
  if (!DEPLOYMENT_PATTERN.test(input.deploymentId)) errors.push('STAGING_DEPLOYMENT_ID must be a stable 3-128 character identifier.');
  if (!input.releaseRootInput || !path.isAbsolute(input.releaseRootInput) || isTemporaryPath(input.releaseRoot)) {
    errors.push('STAGING_RELEASE_ROOT must be an absolute persistent path outside temporary and _checkouts directories.');
  }
  if (!ENDPOINT_MODES.has(input.endpointMode)) errors.push('STAGING_ENDPOINT_MODE must be hosted or host-local.');
  else if (!input.baseUrl) errors.push(input.endpointMode === 'host-local'
    ? 'STAGING_BASE_URL must be a credential-free HTTP(S) loopback URL in host-local mode.'
    : 'STAGING_BASE_URL must be a credential-free, non-local HTTPS URL in hosted mode.');
  if (!hasPostgresProtocol(input.databaseUrl)) {
    errors.push('STAGING_DATABASE_URL must be an explicit PostgreSQL URL for the dedicated staging database.');
  }
  if (input.jwtSecret.trim().length < 32) errors.push('STAGING_JWT_SECRET must contain at least 32 characters.');
  if (!validRepositorySource(input.repositoryUrl)) {
    errors.push(input.repositoryUrl ? 'The staging repository source must be an absolute checkout path or a credential-free URL.'
      : 'STAGING_REPOSITORY_URL or CI_PROJECT_DIR is required.');
  }
  return errors;
}

function stagingConfiguration(env = process.env) {
  const revision = String(env.STAGING_REVISION || env.CI_COMMIT_SHA || '').trim();
  const deploymentId = String(env.STAGING_DEPLOYMENT_ID || '').trim();
  const releaseRoot = realPathCandidate(env.STAGING_RELEASE_ROOT);
  const endpointMode = String(env.STAGING_ENDPOINT_MODE || 'hosted').trim().toLowerCase();
  const baseUrl = ENDPOINT_MODES.has(endpointMode)
    ? stagingEndpointUrl(String(env.STAGING_BASE_URL || '').trim(), endpointMode) : null;
  const databaseUrl = String(env.STAGING_DATABASE_URL || '').trim();
  const jwtSecret = String(env.STAGING_JWT_SECRET || '');
  const repositoryUrl = String(env.STAGING_REPOSITORY_URL || env.CI_PROJECT_DIR || '').trim();
  const errors = stagingConfigurationErrors({
    baseUrl, databaseUrl, deploymentId, endpointMode, jwtSecret,
    releaseRoot, releaseRootInput: env.STAGING_RELEASE_ROOT, repositoryUrl, revision,
  });
  if (errors.length) {
    const error = new Error(errors.join(' '));
    error.code = 'staging_configuration_invalid';
    error.reasons = errors;
    throw error;
  }
  return Object.freeze({
    baseUrl: baseUrl.toString().replace(/\/$/, ''),
    databaseUrl,
    deploymentId,
    endpointMode,
    jwtSecret,
    releaseDir: path.join(releaseRoot, 'releases', revision),
    releaseRoot,
    repositoryUrl,
    revision,
    stateDir: path.join(releaseRoot, 'state', 'staging'),
    artifactDir: path.join(releaseRoot, 'artifacts', deploymentId),
  });
}

function stagingServiceEnvironment(configuration, env = process.env) {
  return Object.freeze({
    ...env,
    AUTH_JWT_SECRET: configuration.jwtSecret,
    AUTH_SESSION_SECRET: stagingSessionSecret(configuration.jwtSecret),
    DATABASE_URL: configuration.databaseUrl,
    FACTORY_STACK_DATABASE_URL: configuration.databaseUrl,
    FACTORY_STACK_PROFILE: 'staging',
    FACTORY_STACK_STATE_DIR: configuration.stateDir,
    FACTORY_STACK_ROOT_BINDING_FILE: path.join(configuration.stateDir, 'repo-root.json'),
    FACTORY_STACK_LOG_DIR: path.join(configuration.releaseRoot, 'logs', 'staging'),
    FACTORY_STACK_NODE_ENV: 'production',
    GOLDEN_PATH_JWT_SECRET: configuration.jwtSecret,
    STAGING_DEPLOYMENT_ID: configuration.deploymentId,
    STAGING_ENDPOINT_MODE: configuration.endpointMode,
    STAGING_REVISION: configuration.revision,
  });
}

function buildStagingDeployComponent(input) {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const evidence = Object.freeze({
    checkoutRevision: input.revision,
    deploymentId: input.deploymentId,
    endpointMode: input.endpointMode || 'hosted',
    healthUrl: input.healthUrl,
    localHealth: input.localHealth,
    profile: input.profile,
    releaseDirectory: input.releaseDirectory,
  });
  return Object.freeze({
    schemaVersion: 1,
    runtime: input.runtime,
    kind: 'staging_deploy',
    status: input.hostedHealth === true && input.localHealth === true ? 'passed' : 'failed',
    revision: input.revision,
    redacted: true,
    digest: evidenceDigest(evidence),
    generatedAt,
    expiresAt: input.expiresAt || new Date(Date.parse(generatedAt) + 7 * 86_400_000).toISOString(),
    provenance: { automation: input.automation, environment: 'staging' },
    summary: {
      deploymentId: input.deploymentId,
      exactRevision: true,
      hostedHealth: input.hostedHealth === true,
      hostLocalEndpoint: input.endpointMode === 'host-local',
      isolatedProfile: input.profile === 'staging',
      localHealth: input.localHealth === true,
    },
    evidence,
  });
}

module.exports = {
  buildStagingDeployComponent,
  hostLocalUrl,
  isTemporaryPath,
  protectedHttpsUrl,
  stagingEndpointUrl,
  stagingConfiguration,
  stagingConfigurationErrors,
  stagingSessionSecret,
  stagingServiceEnvironment,
};
