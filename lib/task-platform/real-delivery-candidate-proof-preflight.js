const fs = require('node:fs');
const path = require('node:path');
const {
  REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION,
  deploymentHealthUrlFailures,
} = require('./real-delivery-candidate-proof');
const { finalGithubProofFailures } = require('./real-delivery-candidate-github-proof');
const { hostedUrlFailure } = require('./hosted-url-evidence');
const { normalizeBranchName, realBranchEvidenceFailure } = require('./real-branch');
const { commitShaEvidenceFailure, normalizeCommitSha } = require('./real-commit-sha');
const { productionSafetyEvidenceFailures } = require('./production-safety-evidence');
const { rollbackEvidenceFailures } = require('./rollback-evidence');

const HOSTED_RELEASE_ENVIRONMENTS = new Set(['staging', 'prod']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeReleaseEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'production') return 'prod';
  return normalized || null;
}

function normalizeUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function prNumberFromUrl(prUrl) {
  const match = String(prUrl || '').match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : null;
}

function normalizePrNumber(value, prUrl) {
  const direct = Number(value);
  if (Number.isInteger(direct) && direct > 0) return direct;
  return prNumberFromUrl(prUrl);
}

function loadCandidateProof(options = {}, proofPath) {
  if (options.candidateProof) return options.candidateProof;
  return JSON.parse(fs.readFileSync(path.resolve(options.repoRoot || process.cwd(), proofPath), 'utf8'));
}

function candidateIdentityPreflightFailures(proof = {}, options = {}) {
  const failures = [];
  const branchFailure = realBranchEvidenceFailure(proof.branch, 'branch');
  if (branchFailure) failures.push(branchFailure);
  const expectedBranch = normalizeBranchName(options.branchName || options.branch);
  if (!branchFailure && expectedBranch && normalizeBranchName(proof.branch) !== expectedBranch) {
    failures.push('branch must match requested branch');
  }
  const shaFailure = commitShaEvidenceFailure(proof.commitSha);
  if (!proof.commitSha) failures.push('commitSha is required');
  else if (shaFailure) failures.push(shaFailure);
  const expectedCommitSha = normalizeCommitSha(options.implementationCommitSha || options.commitSha);
  if (!shaFailure && expectedCommitSha && normalizeCommitSha(proof.commitSha) !== expectedCommitSha) {
    failures.push('commitSha must match requested implementation commit SHA');
  }
  const proofPr = normalizePrNumber(proof.prNumber, proof.prUrl);
  const expectedPr = normalizePrNumber(options.prNumber, options.prUrl);
  if (!proof.prUrl && !proofPr) failures.push('pull request evidence is required');
  if (proof.prUrl && !prNumberFromUrl(proof.prUrl)) failures.push('prUrl must include /pull/<number>');
  if (expectedPr && proofPr && expectedPr !== proofPr) failures.push('prNumber must match requested pull request');
  if (options.prUrl && proof.prUrl && options.prUrl !== proof.prUrl) failures.push('prUrl must match requested pull request');
  return failures;
}

function candidateDeploymentPreflightFailures(proof = {}, options = {}, releaseEnv = null) {
  const failures = [];
  const deploymentUrl = proof.deploymentUrl || proof.deployment_url;
  if (!deploymentUrl) failures.push('deploymentUrl is required');
  else {
    const urlFailure = hostedUrlFailure('deploymentUrl', deploymentUrl);
    if (urlFailure) failures.push(urlFailure);
    const expectedUrl = options.deploymentUrl || options.productionUrl;
    if (expectedUrl && normalizeUrl(expectedUrl) !== normalizeUrl(deploymentUrl)) {
      failures.push('deploymentUrl must match requested deployment URL');
    }
  }
  if (proof.requireFinalReleaseProof !== true) failures.push('must be generated with final release proof required');
  if (proof.verifyDeploymentHealth !== true) failures.push('deployment health verification must be enabled');
  if (proof.deploymentHealth?.ok !== true) failures.push('deployment health must pass');
  failures.push(...deploymentHealthUrlFailures({
    deploymentUrl,
    deploymentHealth: proof.deploymentHealth,
  }));
  if (HOSTED_RELEASE_ENVIRONMENTS.has(releaseEnv)) {
    if (proof.requireHealthCommit !== true) failures.push('must require health commit verification');
    if (proof.deploymentHealth?.commitVerified !== true) {
      failures.push('deployment health must prove candidate commit SHA');
    }
  }
  return failures;
}

function candidateReleasePreflightFailures(proof = {}, releaseEnv = null) {
  const failures = [];
  if (normalizeReleaseEnv(proof.releaseEnv) !== releaseEnv) {
    failures.push(`releaseEnv must match hosted release environment ${releaseEnv || 'none'}`);
  }
  if (proof.riskLevel !== 'low') failures.push('riskLevel must be low');
  if (proof.productionSafe !== true) failures.push('must mark productionSafe true');
  if (proof.rollbackVerified !== true) failures.push('rollback must be verified');
  failures.push(...productionSafetyEvidenceFailures({
    required: true,
    releaseEnv,
    deploymentUrl: proof.deploymentUrl,
    commitSha: proof.commitSha,
    productionSafetyEvidence: proof.productionSafetyEvidence,
  }));
  failures.push(...rollbackEvidenceFailures({
    required: true,
    releaseEnv,
    commitSha: proof.commitSha,
    rollbackTarget: proof.rollbackTarget,
    rollbackEvidence: proof.rollbackEvidence,
  }));
  return failures;
}

function candidateProofContentPreflightFailures(proof = {}, options = {}, releaseEnv = null) {
  const failures = [];
  if (proof.schemaVersion !== REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION) {
    failures.push(`schemaVersion must be ${REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION}`);
  }
  if (proof.ok !== true) failures.push('must pass');
  if (Array.isArray(proof.failures) && proof.failures.length) {
    failures.push(`must not record failures: ${proof.failures.slice(0, 3).join('; ')}`);
  }
  failures.push(...candidateIdentityPreflightFailures(proof, options));
  failures.push(...candidateDeploymentPreflightFailures(proof, options, releaseEnv));
  failures.push(...candidateReleasePreflightFailures(proof, releaseEnv));
  failures.push(...finalGithubProofFailures(proof));
  return failures;
}

function candidateProofPreflightFailures(options = {}, releaseEnv) {
  const proofPath = options.candidateProofPath || options.realDeliveryCandidateProofPath;
  if (options.generateCandidateProof === true && proofPath) return [];
  if (!proofPath && !options.candidateProof) return [`hosted ${releaseEnv} release evidence requires --candidate-proof`];
  if (!proofPath && isPlainObject(options.candidateProof)) {
    return candidateProofContentPreflightFailures(options.candidateProof, options, normalizeReleaseEnv(releaseEnv))
      .map((failure) => `hosted ${releaseEnv} candidate proof ${failure}`);
  }
  if (!proofPath || options.requireReadableCandidateProof !== true) return [];
  try {
    const proof = loadCandidateProof(options, proofPath);
    if (!isPlainObject(proof)) return [`hosted ${releaseEnv} candidate proof must be a JSON object`];
    return candidateProofContentPreflightFailures(proof, options, normalizeReleaseEnv(releaseEnv))
      .map((failure) => `hosted ${releaseEnv} candidate proof ${failure}`);
  } catch (error) {
    return [`hosted ${releaseEnv} candidate proof cannot be read: ${error.message}`];
  }
}

module.exports = {
  candidateProofContentPreflightFailures,
  candidateProofPreflightFailures,
};
