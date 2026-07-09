const fs = require('node:fs');
const path = require('node:path');
const { assertRealPhase6Evidence } = require('./golden-path-real-evidence');
const { DEFAULT_GITHUB_API_BASE_URL } = require('./github-evidence-client');
const { githubCheckFailures, githubIdentityFailures } = require('./final-github-proof');
const { hostedUrlFailure, isLocalOrPrivateUrl } = require('./hosted-url-evidence');
const { commitShaEvidenceFailure } = require('./real-commit-sha');
const { candidateProofFailures } = require('./real-delivery-candidate-continuity');
const { releaseArtifactShapeFailures } = require('./release-artifact-preflight');

const HOSTED_RELEASE_ENVIRONMENTS = new Set(['staging', 'prod']);
const RUNTIME_URL_KEYS = new Set([
  'baseurl',
  'operatorurl',
  'forgeadapterbaseurl',
  'deploymenturl',
  'productionurl',
  'deployment_url',
]);
const REQUIRED_RELEASE_ARTIFACTS = Object.freeze([
  { label: 'build', aliases: ['build'], requirePassedStatus: true },
  { label: 'compatibility-report', aliases: ['compatibility', 'compatibility-report'], requirePassedStatus: true },
  { label: 'vulnerability-scan', aliases: ['vulnerability', 'vulnerability-scan'], requirePassedStatus: true },
  { label: 'secret-scan', aliases: ['secret', 'secret-scan'], requirePassedStatus: true },
  { label: 'immutable-artifact', aliases: ['immutable', 'immutable-artifact'], requireDigest: true },
]);

function readJsonFile(filePath, repoRoot = process.cwd()) {
  const resolved = path.resolve(repoRoot, filePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function normalizeReleaseEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'production') return 'prod';
  if (normalized === 'development') return 'dev';
  return normalized;
}

function normalizeUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}
function prNumberFromUrl(prUrl) {
  const match = String(prUrl || '').match(/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : null;
}
function normalizePrNumber(value, prUrl) {
  const direct = Number(value);
  if (Number.isInteger(direct) && direct > 0) return direct;
  return prNumberFromUrl(prUrl);
}
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function commitShaFieldFailure(label, value) {
  if (!value) return null;
  const failure = commitShaEvidenceFailure(value);
  if (!failure) return null;
  if (failure.includes('non-fixture')) return `${label} must be a non-fixture 40-character commit SHA`;
  return `${label} must be a 40-character commit SHA`;
}

function collectRuntimeUrls(value, currentPath = '$', urls = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectRuntimeUrls(entry, `${currentPath}[${index}]`, urls));
    return urls;
  }
  if (!isPlainObject(value)) return urls;
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${currentPath}.${key}`;
    if (typeof entry === 'string' && RUNTIME_URL_KEYS.has(key.toLowerCase())) {
      urls.push({ path: nextPath, url: entry });
    }
    collectRuntimeUrls(entry, nextPath, urls);
  }
  return urls;
}

function loadArtifactPayload(repoRoot, reference, label, failures) {
  if (!reference) {
    failures.push(`${label} artifact is required`);
    return null;
  }
  if (isPlainObject(reference)) return reference;
  if (typeof reference !== 'string') {
    failures.push(`${label} artifact reference must be a path or object`);
    return null;
  }
  try {
    return readJsonFile(reference, repoRoot);
  } catch (error) {
    failures.push(`${label} artifact cannot be read: ${error.message}`);
    return null;
  }
}

function artifactReference(artifacts = {}, ...names) {
  for (const name of names) {
    if (artifacts[name]) return artifacts[name];
  }
  return null;
}

function candidateProofPathFromEvidence(evidence = {}) {
  return evidence.realDelivery?.candidateProofPath
    || evidence.candidateProofPath
    || null;
}

function releaseEvidenceValidatorFrom(evidence, releaseEnv) {
  const validation = evidence.releaseEvidence?.validation || {};
  return {
    ok: validation.ok === true,
    skipped: validation.skipped === true,
    reason: validation.reason || null,
    stdout: validation.ok === true ? 'embedded release evidence passed' : 'embedded release evidence missing or failed',
    environment: evidence.releaseEvidence?.environment || releaseEnv || 'prod',
  };
}

function validationFailures(evidence) {
  const validation = evidence.phase6?.api?.validation || evidence.deploy?.validation || null;
  if (!validation) return ['phase 6 deploy validation evidence is required'];
  const failures = [];
  if (validation.ok !== true) failures.push('phase 6 deploy validation must pass');
  if (validation.skipped === true) failures.push('phase 6 deploy validation cannot be skipped');
  return failures;
}

function sreWaiverFailures(evidence) {
  const sreMonitoring = evidence.phase6?.api?.sreMonitoring
    || evidence.phase5?.api?.sreMonitoring
    || null;
  if (!sreMonitoring) return [];
  if (sreMonitoring.waiver === true) return ['SRE waiver is not valid autonomous evidence'];
  return [];
}

function autoMergeFailures(evidence) {
  const failures = [];
  const autoMerge = evidence.phase6?.api?.autoMerge || null;
  const github = evidence.github || {};
  if (!autoMerge) return ['phase 6 auto-merge evidence is required'];
  if (autoMerge.ok !== true) failures.push('phase 6 auto-merge evidence must pass');
  if (autoMerge.simulated === true) failures.push('phase 6 auto-merge cannot be simulated');
  if (autoMerge.merged !== true) failures.push('phase 6 auto-merge must confirm GitHub merged the PR');
  if (!autoMerge.mergedAt || Number.isNaN(Date.parse(autoMerge.mergedAt))) {
    failures.push('phase 6 auto-merge mergedAt timestamp is required');
  }
  if (autoMerge.skipped === true) failures.push('phase 6 auto-merge cannot be skipped');
  const mergeCommitFailure = commitShaFieldFailure('phase 6 auto-merge mergeCommitSha', autoMerge.mergeCommitSha);
  if (!autoMerge.mergeCommitSha) failures.push('phase 6 auto-merge mergeCommitSha is required');
  else if (mergeCommitFailure) failures.push(mergeCommitFailure);
  if (autoMerge.mergeCommitSha && github.mergeCommitSha && autoMerge.mergeCommitSha !== github.mergeCommitSha) {
    failures.push('phase 6 auto-merge mergeCommitSha must match GitHub mergeCommitSha');
  }
  const autoMergePrNumber = normalizePrNumber(autoMerge.prNumber, autoMerge.prUrl);
  const githubPrNumber = normalizePrNumber(github.prNumber, github.prUrl);
  if (!autoMerge.prUrl && !autoMergePrNumber) failures.push('phase 6 auto-merge pull request evidence is required');
  if (autoMerge.prUrl && !prNumberFromUrl(autoMerge.prUrl)) {
    failures.push('phase 6 auto-merge prUrl must be a github.com pull request URL');
  }
  if (autoMergePrNumber && githubPrNumber && autoMergePrNumber !== githubPrNumber) {
    failures.push('phase 6 auto-merge prNumber must match GitHub prNumber');
  }
  if (autoMerge.prUrl && github.prUrl && autoMerge.prUrl !== github.prUrl) {
    failures.push('phase 6 auto-merge prUrl must match GitHub prUrl');
  }
  return failures;
}

function githubMergeStateFailures(evidence) {
  const failures = [];
  const github = evidence.github || {};
  if (github.merged !== true) failures.push('GitHub proof must confirm the pull request is merged');
  const mergeCommitFailure = commitShaFieldFailure('GitHub mergeCommitSha', github.mergeCommitSha);
  if (!github.mergeCommitSha) failures.push('GitHub mergeCommitSha is required');
  else if (mergeCommitFailure) failures.push(mergeCommitFailure);
  if (!github.mergedAt || Number.isNaN(Date.parse(github.mergedAt))) {
    failures.push('GitHub mergedAt timestamp is required');
  }
  return failures;
}

function githubEvidenceSourceFailures(evidence) {
  const source = evidence.github?.evidenceSource || {};
  const failures = [];
  if (source.provider !== 'github') failures.push('GitHub proof must be collected from GitHub API');
  if (normalizeUrl(source.apiBaseUrl) !== DEFAULT_GITHUB_API_BASE_URL) failures.push(`GitHub proof API base must be ${DEFAULT_GITHUB_API_BASE_URL}`);
  if (!source.collectedAt || Number.isNaN(Date.parse(source.collectedAt))) failures.push('GitHub proof collectedAt timestamp is required');
  return failures;
}

function strictProofFailures(evidence, releaseEnv) {
  try {
    assertRealPhase6Evidence(evidence, {
      agentDrivenPhases: true,
      releaseEnv: releaseEnv || evidence.releaseEvidence?.environment,
      releaseEvidenceValidator: () => releaseEvidenceValidatorFrom(evidence, releaseEnv),
    });
    return [];
  } catch (error) {
    return [error.message];
  }
}

function fieldMatchFailure(leftName, left, leftField, rightName, right, rightField) {
  if (!left || !right) return null;
  const leftValue = left[leftField];
  const rightValue = right[rightField];
  if (!leftValue || !rightValue || leftValue === rightValue) return null;
  return `${leftName}.${leftField} must match ${rightName}.${rightField}`;
}

function environmentFailure(label, payload, expectedEnv) {
  if (!payload || !expectedEnv) return null;
  const actual = normalizeReleaseEnv(payload.environment);
  if (!actual) return `${label}.environment is required`;
  return actual === expectedEnv ? null : `${label}.environment must match release environment ${expectedEnv}`;
}

function deployArtifactFailures(deploy, releaseEnv) {
  if (!deploy) return [];
  const failures = releaseArtifactShapeFailures(deploy, 'deploy-record')
    .concat(environmentFailure('deploy-record', deploy, releaseEnv)).filter(Boolean);
  if (!deploy.deployment_url) failures.push('deploy-record.deployment_url is required');
  else {
    const urlFailure = hostedUrlFailure('deploy-record.deployment_url', deploy.deployment_url);
    if (urlFailure) failures.push(urlFailure);
  }
  if (!deploy.deployed_sha) failures.push('deploy-record.deployed_sha is required');
  else {
    const commitFailure = commitShaFieldFailure('deploy-record.deployed_sha', deploy.deployed_sha);
    if (commitFailure) failures.push(commitFailure);
  }
  if (!deploy.rollback_target) failures.push('deploy-record.rollback_target is required');
  if (deploy.status && deploy.status !== 'deployed') failures.push('deploy-record.status must be deployed');
  return failures;
}

function healthArtifactFailures(health, releaseEnv) {
  if (!health) return [];
  const failures = releaseArtifactShapeFailures(health, 'post-deploy-health')
    .concat(environmentFailure('post-deploy-health', health, releaseEnv)).filter(Boolean);
  if (!health.deployment_url) failures.push('post-deploy-health.deployment_url is required');
  else {
    const urlFailure = hostedUrlFailure('post-deploy-health.deployment_url', health.deployment_url);
    if (urlFailure) failures.push(urlFailure);
  }
  if (health.status !== 'healthy') failures.push('post-deploy-health.status must be healthy');
  if (!health.checked_sha) failures.push('post-deploy-health.checked_sha is required');
  else {
    const commitFailure = commitShaFieldFailure('post-deploy-health.checked_sha', health.checked_sha);
    if (commitFailure) failures.push(commitFailure);
  }
  if (HOSTED_RELEASE_ENVIRONMENTS.has(releaseEnv) && health.commit_verified !== true) {
    failures.push('post-deploy-health.commit_verified must be true');
  }
  return failures;
}

function rollbackArtifactFailures(rollback, releaseEnv, expectedSha) {
  if (!rollback) return [];
  const failures = releaseArtifactShapeFailures(rollback, 'rollback-verification')
    .concat(environmentFailure('rollback-verification', rollback, releaseEnv)).filter(Boolean);
  const commitFailure = rollback.commit_sha
    ? commitShaFieldFailure('rollback-verification.commit_sha', rollback.commit_sha)
    : 'rollback-verification.commit_sha is required';
  if (commitFailure) failures.push(commitFailure);
  if (expectedSha && rollback.commit_sha && rollback.commit_sha !== expectedSha) failures.push('rollback-verification.commit_sha must match deployed SHA');
  if (rollback.verification_status !== 'verified') failures.push('rollback-verification.verification_status must be verified');
  if (!rollback.rollback_target) failures.push('rollback-verification.rollback_target is required');
  return failures;
}

function loadSupportingArtifacts(repoRoot, artifacts, failures) {
  return REQUIRED_RELEASE_ARTIFACTS.map((spec) => ({
    ...spec,
    payload: loadArtifactPayload(repoRoot, artifactReference(artifacts, ...spec.aliases), spec.label, failures),
  }));
}

function supportingArtifactFailures(entries, releaseEnv, expectedSha) {
  const failures = [];
  for (const entry of entries) {
    if (!entry.payload) continue;
    failures.push(...releaseArtifactShapeFailures(entry.payload, entry.label));
    const environment = environmentFailure(entry.label, entry.payload, releaseEnv);
    if (environment) failures.push(environment);
    if (!entry.payload.commit_sha) failures.push(`${entry.label}.commit_sha is required`);
    else {
      const commitFailure = commitShaFieldFailure(`${entry.label}.commit_sha`, entry.payload.commit_sha);
      if (commitFailure) failures.push(commitFailure);
      if (expectedSha && entry.payload.commit_sha !== expectedSha) failures.push(`${entry.label}.commit_sha must match deployed SHA`);
    }
    if (entry.requirePassedStatus && entry.payload.status !== 'passed') failures.push(`${entry.label}.status must be passed`);
    if (entry.requireDigest && !entry.payload.digest) failures.push(`${entry.label}.digest is required`);
  }
  return failures;
}

function releaseShaContinuityFailures(deploy, health, expectedSha) {
  if (!expectedSha) return [];
  return [
    deploy?.deployed_sha && deploy.deployed_sha !== expectedSha && 'deploy-record.deployed_sha must match GitHub mergeCommitSha',
    health?.checked_sha && health.checked_sha !== expectedSha && 'post-deploy-health.checked_sha must match GitHub mergeCommitSha',
  ].filter(Boolean);
}

function artifactFailures(evidence, options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const releaseEnv = normalizeReleaseEnv(options.releaseEnv || evidence.releaseEvidence?.environment);
  const artifacts = evidence.releaseEvidence?.artifacts || {};
  const failures = [];
  const deploy = loadArtifactPayload(repoRoot, artifactReference(artifacts, 'deploy', 'deploy-record'), 'deploy-record', failures);
  const health = loadArtifactPayload(repoRoot, artifactReference(artifacts, 'health', 'post-deploy-health'), 'post-deploy-health', failures);
  const rollback = loadArtifactPayload(repoRoot, artifactReference(artifacts, 'rollback', 'rollback-verification'), 'rollback-verification', failures);
  const supportingArtifacts = loadSupportingArtifacts(repoRoot, artifacts, failures);
  const githubReleaseSha = evidence.github?.mergeCommitSha || evidence.github?.commitSha || null;
  const expectedSha = deploy?.deployed_sha || health?.checked_sha || githubReleaseSha;

  failures.push(...supportingArtifactFailures(supportingArtifacts, releaseEnv, expectedSha));
  failures.push(...deployArtifactFailures(deploy, releaseEnv));
  failures.push(...healthArtifactFailures(health, releaseEnv));
  failures.push(...rollbackArtifactFailures(rollback, releaseEnv, expectedSha));
  failures.push(...releaseShaContinuityFailures(deploy, health, githubReleaseSha));

  for (const failure of [
    fieldMatchFailure('deploy-record', deploy, 'deployed_sha', 'post-deploy-health', health, 'checked_sha'),
    fieldMatchFailure('deploy-record', deploy, 'deployment_url', 'post-deploy-health', health, 'deployment_url'),
    fieldMatchFailure('deploy-record', deploy, 'rollback_target', 'rollback-verification', rollback, 'rollback_target'),
  ]) {
    if (failure) failures.push(failure);
  }
  return failures;
}

function verifyRealAutonomousDeliveryEvidence(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const evidence = options.evidence || readJsonFile(options.evidencePath, repoRoot);
  const candidateProofPath = options.candidateProofPath || candidateProofPathFromEvidence(evidence);
  const requestedReleaseEnv = normalizeReleaseEnv(options.releaseEnv);
  const evidenceReleaseEnv = normalizeReleaseEnv(evidence.releaseEvidence?.environment);
  const releaseEnv = requestedReleaseEnv || evidenceReleaseEnv || null;
  const failures = [];

  if (evidence.status !== 'phase6_complete') failures.push('factory evidence status must be phase6_complete');
  if (requestedReleaseEnv && evidenceReleaseEnv && requestedReleaseEnv !== evidenceReleaseEnv) {
    failures.push(`release evidence environment ${evidenceReleaseEnv} must match requested release environment ${requestedReleaseEnv}`);
  }
  if (!HOSTED_RELEASE_ENVIRONMENTS.has(String(releaseEnv || '').toLowerCase())) {
    failures.push(`hosted staging/prod release evidence is required; got ${releaseEnv || 'none'}`);
  }
  for (const entry of collectRuntimeUrls(evidence)) {
    const urlFailure = hostedUrlFailure(entry.path, entry.url);
    if (urlFailure) failures.push(urlFailure);
  }
  failures.push(...validationFailures(evidence));
  failures.push(...sreWaiverFailures(evidence));
  failures.push(...autoMergeFailures(evidence));
  failures.push(...githubIdentityFailures(evidence));
  failures.push(...githubCheckFailures(evidence));
  failures.push(...githubMergeStateFailures(evidence));
  failures.push(...githubEvidenceSourceFailures(evidence));
  failures.push(...strictProofFailures(evidence, releaseEnv));
  failures.push(...artifactFailures(evidence, { repoRoot, releaseEnv }));
  failures.push(...candidateProofFailures(evidence, {
    ...options,
    candidateProofPath,
    repoRoot,
    requireCandidateProof: true,
  }, releaseEnv));

  return {
    ok: failures.length === 0,
    evidencePath: options.evidencePath || null,
    candidateProofPath,
    releaseEnv,
    failures,
  };
}

module.exports = {
  candidateProofPathFromEvidence,
  collectRuntimeUrls,
  isLocalOrPrivateUrl,
  verifyRealAutonomousDeliveryEvidence,
};
