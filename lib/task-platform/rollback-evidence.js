const fs = require('node:fs');
const path = require('node:path');
const { commitShaEvidenceFailure } = require('./real-commit-sha');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeReleaseEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'production') return 'prod';
  return normalized;
}

function loadRollbackEvidenceReference(root, reference, failures = []) {
  if (!reference) return null;
  if (isPlainObject(reference)) return reference;
  if (typeof reference !== 'string') {
    failures.push('rollback-verification artifact reference must be a path or object');
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(path.resolve(root, reference), 'utf8'));
  } catch (error) {
    failures.push(`rollback-verification artifact cannot be read: ${error.message}`);
    return null;
  }
}

function rollbackEvidenceFailures({
  required = true,
  releaseEnv,
  commitSha,
  rollbackTarget,
  rollbackEvidence,
} = {}) {
  if (!required) return [];
  const failures = [];
  if (!rollbackEvidence) {
    failures.push('rollback-verification artifact is required for final real delivery candidate');
    return failures;
  }
  if (!isPlainObject(rollbackEvidence)) {
    failures.push('rollback-verification artifact must be a JSON object');
    return failures;
  }
  const environment = normalizeReleaseEnv(rollbackEvidence.environment);
  if (!environment) failures.push('rollback-verification.environment is required');
  else if (releaseEnv && environment !== releaseEnv) {
    failures.push(`rollback-verification.environment must match release environment ${releaseEnv}`);
  }
  if (rollbackEvidence.verification_status !== 'verified') {
    failures.push("rollback-verification.verification_status must be 'verified'");
  }
  if (!rollbackEvidence.rollback_target) failures.push('rollback-verification.rollback_target is required');
  else if (rollbackTarget && rollbackEvidence.rollback_target !== rollbackTarget) {
    failures.push('rollback-verification.rollback_target must match rollback target');
  }
  if (!rollbackEvidence.verified_at || Number.isNaN(Date.parse(rollbackEvidence.verified_at))) {
    failures.push('rollback-verification.verified_at timestamp is required');
  }
  if (commitSha) {
    if (!rollbackEvidence.commit_sha) failures.push('rollback-verification.commit_sha is required');
    const shaFailure = rollbackEvidence.commit_sha ? commitShaEvidenceFailure(rollbackEvidence.commit_sha) : null;
    if (shaFailure) failures.push(`rollback-verification.commit_sha ${shaFailure}`);
    if (rollbackEvidence.commit_sha && !shaFailure && rollbackEvidence.commit_sha !== commitSha) {
      failures.push('rollback-verification.commit_sha must match implementation commit SHA');
    }
  }
  return failures;
}

function assertRollbackEvidence(options = {}) {
  const failures = rollbackEvidenceFailures(options);
  if (failures.length) throw new Error(failures[0]);
  return options.rollbackEvidence;
}

module.exports = {
  assertRollbackEvidence,
  loadRollbackEvidenceReference,
  rollbackEvidenceFailures,
};
