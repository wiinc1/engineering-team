const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { hostedUrlFailure } = require('./hosted-url-evidence');
const { commitShaEvidenceFailure } = require('./real-commit-sha');

const VALIDATION_ARTIFACTS = Object.freeze({
  build: { file: 'build.json', status: 'passed', commitField: 'commit_sha' },
  compatibility: { file: 'compatibility-report.json', status: 'passed', commitField: 'commit_sha' },
  vulnerability: { file: 'vulnerability-scan.json', status: 'passed', commitField: 'commit_sha' },
  secret: { file: 'secret-scan.json', status: 'passed', commitField: 'commit_sha' },
  health: { file: 'post-deploy-health.json', status: 'healthy', commitField: 'checked_sha', requireCommitVerified: true },
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeReleaseEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'production') return 'prod';
  return normalized;
}

function normalizeUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readJsonArtifact(root, artifactPath, failures, label) {
  const resolved = path.resolve(root, artifactPath);
  try {
    const text = fs.readFileSync(resolved, 'utf8');
    const payload = JSON.parse(text);
    if (!isPlainObject(payload)) {
      failures.push(`production-safety.validation_artifacts.${label} must be a JSON object`);
      return null;
    }
    return { payload, digest: sha256(text) };
  } catch (error) {
    failures.push(`production-safety.validation_artifacts.${label} cannot be read: ${error.message}`);
    return null;
  }
}

function summarizeValidationArtifact(repoRoot, releaseArtifactDir, key, spec, options, failures) {
  const artifactPath = path.join(releaseArtifactDir, spec.file);
  const loaded = readJsonArtifact(repoRoot, artifactPath, failures, key);
  if (!loaded) return null;
  const { payload, digest } = loaded;
  const commitSha = payload[spec.commitField] || payload.commit_sha || null;
  if (payload.status !== spec.status) {
    failures.push(`production-safety.validation_artifacts.${key}.status must be ${spec.status}`);
  }
  if (commitSha !== options.commitSha) {
    failures.push(`production-safety.validation_artifacts.${key}.commit_sha must match production-safety.commit_sha`);
  }
  if (payload.deployment_url && options.deploymentUrl && normalizeUrl(payload.deployment_url) !== normalizeUrl(options.deploymentUrl)) {
    failures.push(`production-safety.validation_artifacts.${key}.deployment_url must match production-safety.deployment_url`);
  }
  if (spec.requireCommitVerified && payload.commit_verified !== true) {
    failures.push(`production-safety.validation_artifacts.${key}.commit_verified must be true`);
  }
  return {
    path: artifactPath,
    digest_algorithm: 'sha256',
    digest,
    status: payload.status || null,
    commit_sha: commitSha,
    deployment_url: payload.deployment_url || null,
    commit_verified: payload.commit_verified === true,
  };
}

function buildValidationArtifactsEvidence(repoRoot, releaseArtifactDir, options = {}) {
  const failures = [];
  if (!releaseArtifactDir) return { evidence: null, failures: ['production-safety validation requires --release-artifact-dir'] };
  const artifacts = {};
  for (const [key, spec] of Object.entries(VALIDATION_ARTIFACTS)) {
    const summary = summarizeValidationArtifact(repoRoot, releaseArtifactDir, key, spec, options, failures);
    if (summary) artifacts[key] = summary;
  }
  return {
    evidence: {
      source: 'release-artifacts',
      artifact_dir: releaseArtifactDir,
      artifacts,
    },
    failures,
  };
}

function loadProductionSafetyEvidenceReference(root, reference, failures = []) {
  if (!reference) return null;
  if (isPlainObject(reference)) return reference;
  if (typeof reference !== 'string') {
    failures.push('production-safety artifact reference must be a path or object');
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(path.resolve(root, reference), 'utf8'));
  } catch (error) {
    failures.push(`production-safety artifact cannot be read: ${error.message}`);
    return null;
  }
}

function baseProductionSafetyFailures(evidence, { releaseEnv, deploymentUrl, commitSha } = {}) {
  const failures = [];
  const environment = normalizeReleaseEnv(evidence.environment);
  if (!environment) failures.push('production-safety.environment is required');
  else if (releaseEnv && environment !== releaseEnv) failures.push(`production-safety.environment must match release environment ${releaseEnv}`);
  if (evidence.validation_status !== 'passed') failures.push("production-safety.validation_status must be 'passed'");
  if (evidence.production_safe !== true) failures.push('production-safety.production_safe must be true');
  if (evidence.risk_level !== 'low') failures.push("production-safety.risk_level must be 'low'");
  if (!evidence.deployment_url) failures.push('production-safety.deployment_url is required');
  else {
    const urlFailure = hostedUrlFailure('production-safety.deployment_url', evidence.deployment_url);
    if (urlFailure) failures.push(urlFailure);
    if (deploymentUrl && normalizeUrl(evidence.deployment_url) !== normalizeUrl(deploymentUrl)) failures.push('production-safety.deployment_url must match deployment URL');
  }
  if (!evidence.commit_sha) failures.push('production-safety.commit_sha is required');
  else {
    const shaFailure = commitShaEvidenceFailure(evidence.commit_sha);
    if (shaFailure) failures.push(`production-safety.commit_sha ${shaFailure}`);
    if (commitSha && evidence.commit_sha !== commitSha) failures.push('production-safety.commit_sha must match implementation commit SHA');
  }
  if (!evidence.validated_at || Number.isNaN(Date.parse(evidence.validated_at))) {
    failures.push('production-safety.validated_at timestamp is required');
  }
  return failures;
}

function validationArtifactFailures(key, spec, artifact, { commitSha, deploymentUrl } = {}) {
  const failures = [];
  if (!isPlainObject(artifact)) return [`production-safety.validation_artifacts.${key} is required`];
  if (!artifact.path) failures.push(`production-safety.validation_artifacts.${key}.path is required`);
  if (artifact.digest_algorithm !== 'sha256') failures.push(`production-safety.validation_artifacts.${key}.digest_algorithm must be sha256`);
  if (!/^[0-9a-f]{64}$/.test(String(artifact.digest || ''))) failures.push(`production-safety.validation_artifacts.${key}.digest must be a SHA-256 hex digest`);
  if (artifact.status !== spec.status) failures.push(`production-safety.validation_artifacts.${key}.status must be ${spec.status}`);
  if (commitSha && artifact.commit_sha !== commitSha) failures.push(`production-safety.validation_artifacts.${key}.commit_sha must match implementation commit SHA`);
  if (artifact.deployment_url && deploymentUrl && normalizeUrl(artifact.deployment_url) !== normalizeUrl(deploymentUrl)) {
    failures.push(`production-safety.validation_artifacts.${key}.deployment_url must match deployment URL`);
  }
  if (spec.requireCommitVerified && artifact.commit_verified !== true) {
    failures.push(`production-safety.validation_artifacts.${key}.commit_verified must be true`);
  }
  return failures;
}

function validationArtifactsFailures(validation, context = {}) {
  const failures = [];
  if (!validation || !isPlainObject(validation)) return ['production-safety.validation_artifacts is required'];
  if (validation.source !== 'release-artifacts') failures.push("production-safety.validation_artifacts.source must be 'release-artifacts'");
  if (!validation.artifact_dir) failures.push('production-safety.validation_artifacts.artifact_dir is required');
  const artifacts = validation.artifacts;
  if (!isPlainObject(artifacts)) return [...failures, 'production-safety.validation_artifacts.artifacts is required'];
  for (const [key, spec] of Object.entries(VALIDATION_ARTIFACTS)) {
    failures.push(...validationArtifactFailures(key, spec, artifacts[key], context));
  }
  return failures;
}

function productionSafetyEvidenceFailures({
  required = true,
  releaseEnv,
  deploymentUrl,
  commitSha,
  productionSafetyEvidence,
} = {}) {
  if (!required) return [];
  const failures = [];
  if (!productionSafetyEvidence) {
    failures.push('production-safety artifact is required for final real delivery candidate');
    return failures;
  }
  if (!isPlainObject(productionSafetyEvidence)) {
    failures.push('production-safety artifact must be a JSON object');
    return failures;
  }
  failures.push(...baseProductionSafetyFailures(productionSafetyEvidence, { releaseEnv, deploymentUrl, commitSha }));
  failures.push(...validationArtifactsFailures(productionSafetyEvidence.validation_artifacts, { commitSha, deploymentUrl }));
  return failures;
}

module.exports = {
  buildValidationArtifactsEvidence,
  loadProductionSafetyEvidenceReference,
  productionSafetyEvidenceFailures,
};
