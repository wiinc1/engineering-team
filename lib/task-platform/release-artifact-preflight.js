const fs = require('node:fs');
const path = require('node:path');
const {
  COMMAND_ARTIFACTS,
  DEFAULT_RELEASE_ARTIFACT_DIR,
  RELEASE_ARTIFACT_SCHEMA_VERSION,
  artifactPaths,
} = require('./release-artifact-evidence');
const { commitShaEvidenceFailure } = require('./real-commit-sha');

const RELEASE_ARTIFACT_GENERATORS = new Set([
  'golden-path-real-evidence-collector',
  'release-artifact-evidence-builder',
]);

const RELEASE_ARTIFACT_COMMAND_FLAGS = Object.freeze({
  build: '--release-build-command',
  compatibility: '--release-compatibility-command',
  vulnerability: '--release-vulnerability-command',
  secret: '--release-secret-command',
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readExistingArtifact(repoRoot, artifactPath, label, failures) {
  try {
    const payload = JSON.parse(fs.readFileSync(path.resolve(repoRoot, artifactPath), 'utf8'));
    if (!isPlainObject(payload)) {
      failures.push(`existing ${label} artifact must be a JSON object`);
      return null;
    }
    return payload;
  } catch (error) {
    failures.push(`existing ${label} artifact cannot be read: ${error.message}`);
    return null;
  }
}

function missingReleaseArtifactCommandFailures(commands = {}) {
  return COMMAND_ARTIFACTS
    .filter(([key]) => !commands[key])
    .map(([key]) => `hosted release evidence requires ${RELEASE_ARTIFACT_COMMAND_FLAGS[key]} or --use-existing-release-artifacts`);
}

function normalizeReleaseEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'production') return 'prod';
  return normalized || null;
}

function expectedCommitSha(options = {}) {
  return options.mergeCommitSha || options.commitSha || options.implementationCommitSha || null;
}

function releaseArtifactShapeFailures(payload, label) {
  const failures = [];
  if (payload.schema_version !== RELEASE_ARTIFACT_SCHEMA_VERSION) {
    failures.push(`${label}.schema_version must be ${RELEASE_ARTIFACT_SCHEMA_VERSION}`);
  }
  if (!RELEASE_ARTIFACT_GENERATORS.has(payload.generated_by)) {
    failures.push(`${label}.generated_by must be a release evidence generator`);
  }
  if (!payload.generated_at || Number.isNaN(Date.parse(payload.generated_at))) {
    failures.push(`${label}.generated_at timestamp is required`);
  }
  if (!payload.source_system) failures.push(`${label}.source_system is required`);
  if (payload.artifact_name !== label) failures.push(`${label}.artifact_name must be ${label}`);
  return failures;
}

function existingArtifactContentFailures(payload, label, options = {}) {
  const failures = [];
  failures.push(...releaseArtifactShapeFailures(payload, label).map((failure) => `existing ${failure}`));
  if (payload.status !== 'passed') failures.push(`existing ${label} artifact status must be passed`);
  const releaseEnv = normalizeReleaseEnv(options.releaseEnv);
  const artifactEnv = normalizeReleaseEnv(payload.environment);
  if (!artifactEnv) failures.push(`existing ${label} artifact environment is required`);
  else if (releaseEnv && artifactEnv !== releaseEnv) {
    failures.push(`existing ${label} artifact environment must match release environment ${releaseEnv}`);
  }
  if (!payload.commit_sha) failures.push(`existing ${label} artifact commit_sha is required`);
  else {
    const commitFailure = commitShaEvidenceFailure(payload.commit_sha);
    if (commitFailure) failures.push(`existing ${label} artifact commit_sha: ${commitFailure}`);
    const expected = expectedCommitSha(options);
    if (expected && payload.commit_sha !== expected) {
      failures.push(`existing ${label} artifact commit_sha must match expected release commit`);
    }
  }
  return failures;
}

function existingReleaseArtifactFailures(options = {}) {
  const commands = options.releaseArtifactCommands || {};
  if (options.useExistingReleaseArtifacts !== true) {
    return missingReleaseArtifactCommandFailures(commands);
  }
  const repoRoot = options.repoRoot || options.cwd || process.cwd();
  const paths = artifactPaths(options.releaseArtifactDir || DEFAULT_RELEASE_ARTIFACT_DIR);
  const failures = [];
  for (const [key, label] of COMMAND_ARTIFACTS) {
    if (commands[key]) continue;
    const payload = readExistingArtifact(repoRoot, paths[key], label, failures);
    if (payload) failures.push(...existingArtifactContentFailures(payload, label, options));
  }
  return failures;
}

module.exports = {
  existingArtifactContentFailures,
  existingReleaseArtifactFailures,
  releaseArtifactShapeFailures,
  missingReleaseArtifactCommandFailures,
};
