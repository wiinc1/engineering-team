'use strict';

const path = require('node:path');
const os = require('node:os');
const { evidenceDigest } = require('./evidence-collector');

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DEPLOYMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/;

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
  if (['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local')) return null;
  return parsed;
}

function stagingConfiguration(env = process.env) {
  const revision = String(env.STAGING_REVISION || env.CI_COMMIT_SHA || '').trim();
  const deploymentId = String(env.STAGING_DEPLOYMENT_ID || '').trim();
  const releaseRoot = realPathCandidate(env.STAGING_RELEASE_ROOT);
  const baseUrl = protectedHttpsUrl(String(env.STAGING_BASE_URL || '').trim());
  const databaseUrl = String(env.STAGING_DATABASE_URL || '').trim();
  const repositoryUrl = String(env.STAGING_REPOSITORY_URL || env.CI_PROJECT_DIR || '').trim();
  const errors = [];
  if (!SHA_PATTERN.test(revision)) errors.push('STAGING_REVISION must be an exact lowercase 40-character commit SHA.');
  if (!DEPLOYMENT_PATTERN.test(deploymentId)) errors.push('STAGING_DEPLOYMENT_ID must be a stable 3-128 character identifier.');
  if (!env.STAGING_RELEASE_ROOT || !path.isAbsolute(env.STAGING_RELEASE_ROOT) || isTemporaryPath(releaseRoot)) {
    errors.push('STAGING_RELEASE_ROOT must be an absolute persistent path outside temporary and _checkouts directories.');
  }
  if (!baseUrl) errors.push('STAGING_BASE_URL must be a credential-free, non-local HTTPS URL.');
  let parsedDatabase;
  try { parsedDatabase = new URL(databaseUrl); } catch { parsedDatabase = null; }
  if (!parsedDatabase || !['postgres:', 'postgresql:'].includes(parsedDatabase.protocol)) {
    errors.push('STAGING_DATABASE_URL must be an explicit PostgreSQL URL for the dedicated staging database.');
  }
  if (!repositoryUrl) errors.push('STAGING_REPOSITORY_URL or CI_PROJECT_DIR is required.');
  if (repositoryUrl && !path.isAbsolute(repositoryUrl)) {
    let parsedRepository;
    try { parsedRepository = new URL(repositoryUrl); } catch { parsedRepository = null; }
    if (!parsedRepository || parsedRepository.username || parsedRepository.password) {
      errors.push('The staging repository source must be an absolute checkout path or a credential-free URL.');
    }
  }
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
    DATABASE_URL: configuration.databaseUrl,
    FACTORY_STACK_DATABASE_URL: configuration.databaseUrl,
    FACTORY_STACK_PROFILE: 'staging',
    FACTORY_STACK_STATE_DIR: configuration.stateDir,
    FACTORY_STACK_ROOT_BINDING_FILE: path.join(configuration.stateDir, 'repo-root.json'),
    FACTORY_STACK_LOG_DIR: path.join(configuration.releaseRoot, 'logs', 'staging'),
    FACTORY_STACK_NODE_ENV: 'production',
    STAGING_DEPLOYMENT_ID: configuration.deploymentId,
    STAGING_REVISION: configuration.revision,
  });
}

function buildStagingDeployComponent(input) {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const evidence = Object.freeze({
    checkoutRevision: input.revision,
    deploymentId: input.deploymentId,
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
      isolatedProfile: input.profile === 'staging',
      localHealth: input.localHealth === true,
    },
    evidence,
  });
}

module.exports = {
  buildStagingDeployComponent,
  isTemporaryPath,
  protectedHttpsUrl,
  stagingConfiguration,
  stagingServiceEnvironment,
};
