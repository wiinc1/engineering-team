const fs = require('node:fs');
const path = require('node:path');
const {
  REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION,
  deploymentHealthUrlFailures,
} = require('./real-delivery-candidate-proof');
const { finalGithubProofFailures } = require('./real-delivery-candidate-github-proof');
const { commitShaEvidenceFailure } = require('./real-commit-sha');
const { productionSafetyEvidenceFailures } = require('./production-safety-evidence');
const { rollbackEvidenceFailures } = require('./rollback-evidence');

const HOSTED_RELEASE_ENVIRONMENTS = new Set(['staging', 'prod']);

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

function normalizePathValue(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function normalizeStringArray(value) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(entries.map(normalizePathValue).filter(Boolean))].sort();
}

function checkName(value) {
  if (typeof value === 'string') return value.trim();
  if (!isPlainObject(value)) return '';
  return String(value.name || value.context || value.checkName || value.check_name || '').trim();
}

function normalizeCheckNames(value) {
  const checks = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(checks.map(checkName).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function branchProtectionRequiredChecks(value = {}) {
  const protection = value.branchProtection || value.branch_protection || value;
  if (!isPlainObject(protection)) return [];
  const statusChecks = protection.requiredStatusChecks || protection.required_status_checks || {};
  return normalizeCheckNames(
    protection.requiredChecks
      || protection.required_checks
      || statusChecks.checks
      || statusChecks.contexts
      || protection.checks,
  );
}

function sameNames(left = [], right = []) {
  if (left.length !== right.length) return false;
  const normalizedRight = new Set(right.map((name) => name.toLowerCase()));
  return left.every((name) => normalizedRight.has(name.toLowerCase()));
}

function prNumberFromUrl(prUrl) {
  const match = String(prUrl || '').match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : null;
}

function repositoryFromPrUrl(prUrl) {
  const match = String(prUrl || '').match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/\d+(?:[/?#].*)?$/);
  return match ? `${match[1]}/${match[2]}` : '';
}

function normalizePrNumber(value, prUrl) {
  const direct = Number(value);
  if (Number.isInteger(direct) && direct > 0) return direct;
  return prNumberFromUrl(prUrl);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function artifactReference(artifacts = {}, ...names) {
  for (const name of names) {
    if (artifacts[name]) return artifacts[name];
  }
  return null;
}

function loadArtifactPayload(repoRoot, reference, label, failures) {
  if (!reference) {
    failures.push(`${label} artifact is required`);
    return null;
  }
  if (isPlainObject(reference)) return reference;
  try {
    return readJsonFile(reference, repoRoot);
  } catch (error) {
    failures.push(`${label} artifact cannot be read: ${error.message}`);
    return null;
  }
}

function loadCandidateProof(options = {}, failures = []) {
  if (options.candidateProof) return options.candidateProof;
  if (!options.candidateProofPath) return null;
  try {
    return readJsonFile(options.candidateProofPath, options.repoRoot || process.cwd());
  } catch (error) {
    failures.push(`real-delivery candidate proof cannot be read: ${error.message}`);
    return null;
  }
}

function candidateBaseFailures(candidateProof, releaseEnv) {
  const failures = [];
  if (candidateProof.schemaVersion !== REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION) {
    failures.push(`real-delivery candidate proof schemaVersion must be ${REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION}`);
  }
  if (candidateProof.ok !== true) failures.push('real-delivery candidate proof must pass');
  if (normalizeReleaseEnv(candidateProof.releaseEnv) !== releaseEnv) {
    failures.push(`real-delivery candidate proof releaseEnv must match final release environment ${releaseEnv || 'none'}`);
  }
  if (candidateProof.riskLevel !== 'low') failures.push('real-delivery candidate proof riskLevel must be low');
  if (candidateProof.productionSafe !== true) failures.push('real-delivery candidate proof must mark productionSafe true');
  failures.push(...productionSafetyEvidenceFailures({
    required: true,
    releaseEnv,
    deploymentUrl: candidateProof.deploymentUrl,
    commitSha: candidateProof.commitSha,
    productionSafetyEvidence: candidateProof.productionSafetyEvidence,
  }).map((failure) => `real-delivery candidate proof ${failure}`));
  if (candidateProof.rollbackVerified !== true) failures.push('real-delivery candidate proof rollback must be verified');
  failures.push(...rollbackEvidenceFailures({
    required: true,
    releaseEnv,
    commitSha: candidateProof.commitSha,
    rollbackTarget: candidateProof.rollbackTarget,
    rollbackEvidence: candidateProof.rollbackEvidence,
  }).map((failure) => `real-delivery candidate proof ${failure}`));
  if (candidateProof.requireFinalReleaseProof !== true) {
    failures.push('real-delivery candidate proof must be generated with final release proof required');
  }
  if (candidateProof.verifyDeploymentHealth !== true) {
    failures.push('real-delivery candidate proof deployment health verification must be enabled');
  }
  if (candidateProof.deploymentHealth?.ok !== true) {
    failures.push('real-delivery candidate proof deployment health must pass');
  }
  failures.push(...deploymentHealthUrlFailures(candidateProof)
    .map((failure) => `real-delivery candidate proof ${failure}`));
  if (HOSTED_RELEASE_ENVIRONMENTS.has(releaseEnv)) {
    if (candidateProof.requireHealthCommit !== true) {
      failures.push('real-delivery candidate proof must require health commit verification');
    }
    if (candidateProof.deploymentHealth?.commitVerified !== true) {
      failures.push('real-delivery candidate proof deployment health must prove candidate commit SHA');
    }
  }
  return failures;
}

function candidateIdentityFailures(candidateProof, evidence) {
  const failures = [];
  const github = evidence.github || {};
  const candidateRepository = String(candidateProof.repository || repositoryFromPrUrl(candidateProof.prUrl) || '').trim();
  const finalRepository = String(github.repository || repositoryFromPrUrl(github.prUrl) || '').trim();
  if (!candidateRepository) failures.push('real-delivery candidate proof repository evidence is required');
  else if (!finalRepository) {
    failures.push('final GitHub repository evidence is required for real-delivery candidate continuity');
  } else if (candidateRepository !== finalRepository) {
    failures.push('real-delivery candidate proof repository must match final GitHub repository');
  }
  const commitFailure = commitShaEvidenceFailure(candidateProof.commitSha);
  if (commitFailure) failures.push(`real-delivery candidate proof ${commitFailure}`);
  else if (!github.commitSha) {
    failures.push('final GitHub commitSha evidence is required for real-delivery candidate continuity');
  }
  else if (github.commitSha && candidateProof.commitSha !== github.commitSha) {
    failures.push('real-delivery candidate proof commitSha must match final GitHub commitSha');
  }
  const candidatePrNumber = normalizePrNumber(candidateProof.prNumber, candidateProof.prUrl);
  const finalPrNumber = normalizePrNumber(github.prNumber, github.prUrl);
  if (!candidateProof.prUrl && !candidatePrNumber) failures.push('real-delivery candidate proof pull request evidence is required');
  if (candidateProof.prUrl && !prNumberFromUrl(candidateProof.prUrl)) {
    failures.push('real-delivery candidate proof prUrl must include /pull/<number>');
  }
  if (candidateProof.prUrl && !github.prUrl) {
    failures.push('final GitHub prUrl evidence is required for real-delivery candidate continuity');
  }
  if (candidatePrNumber && !finalPrNumber) {
    failures.push('final GitHub prNumber evidence is required for real-delivery candidate continuity');
  }
  if (candidatePrNumber && finalPrNumber && candidatePrNumber !== finalPrNumber) {
    failures.push('real-delivery candidate proof prNumber must match final GitHub prNumber');
  }
  if (candidateProof.prUrl && github.prUrl && candidateProof.prUrl !== github.prUrl) {
    failures.push('real-delivery candidate proof prUrl must match final GitHub prUrl');
  }
  return failures;
}

function candidateGithubContinuityFailures(candidateProof, evidence) {
  const failures = [];
  const github = evidence.github || {};
  const candidateRequiredChecks = normalizeCheckNames(candidateProof.requiredChecks);
  const finalRequiredChecks = normalizeCheckNames(github.requiredChecks || github.required_checks);
  if (candidateRequiredChecks.length && finalRequiredChecks.length && !sameNames(candidateRequiredChecks, finalRequiredChecks)) {
    failures.push('real-delivery candidate proof requiredChecks must match final GitHub requiredChecks');
  }

  const candidateProtectedChecks = branchProtectionRequiredChecks(candidateProof);
  const finalProtectedChecks = branchProtectionRequiredChecks(github);
  if (candidateProtectedChecks.length && finalProtectedChecks.length && !sameNames(candidateProtectedChecks, finalProtectedChecks)) {
    failures.push('real-delivery candidate proof branchProtection requiredChecks must match final GitHub branchProtection');
  }

  const candidateMergeReadinessName = checkName(candidateProof.mergeReadiness || candidateProof.merge_readiness);
  const finalMergeReadinessName = checkName(github.mergeReadiness || github.merge_readiness);
  if (candidateMergeReadinessName && finalMergeReadinessName && candidateMergeReadinessName.toLowerCase() !== finalMergeReadinessName.toLowerCase()) {
    failures.push('real-delivery candidate proof mergeReadiness must match final GitHub mergeReadiness');
  }
  return failures;
}

function candidateTestFailures(candidateProof) {
  const failures = [];
  const testCommands = normalizeStringArray(candidateProof.testCommands);
  const testResults = Array.isArray(candidateProof.testCommandResults) ? candidateProof.testCommandResults : [];
  const expectedCommands = new Set(testCommands);
  const executedCommands = new Set();
  if (testCommands.length === 0) failures.push('real-delivery candidate proof must list executable test commands');
  if (testResults.length === 0) failures.push('real-delivery candidate proof must include executed test command results');
  for (const result of testResults) {
    const command = String(result?.command || '').trim();
    if (!command) {
      failures.push('real-delivery candidate proof test command result must include command');
      continue;
    }
    executedCommands.add(command);
    if (!expectedCommands.has(command)) {
      failures.push(`real-delivery candidate proof test command result must match a listed command: ${command}`);
    }
    if (result.ok !== true) {
      failures.push(`real-delivery candidate proof test command must pass: ${command}`);
    }
    if (result.exitCode !== 0) {
      failures.push(`real-delivery candidate proof test command exitCode must be 0: ${command}`);
    }
  }
  for (const command of testCommands.filter((entry) => !executedCommands.has(entry))) {
    failures.push(`real-delivery candidate proof must include executed result for listed test command: ${command}`);
  }
  return failures;
}

function candidateSourceIntegrityFailures(candidateProof) {
  const sourceIntegrity = candidateProof.sourceIntegrity || null;
  if (!sourceIntegrity) return ['real-delivery candidate proof source integrity evidence is required'];
  return sourceIntegrity.failureCount === 0
    ? []
    : ['real-delivery candidate proof source integrity must pass'];
}

function candidateLocalGitFailures(candidateProof) {
  const localGit = candidateProof.localGit || {};
  if (localGit.workingTreeClean === true) return [];
  if (localGit.workingTreeClean === false) {
    const count = Number.isInteger(localGit.dirtyFileCount) ? localGit.dirtyFileCount : 'unknown';
    return [`real-delivery candidate proof local git worktree must be clean (${count} dirty files)`];
  }
  return ['real-delivery candidate proof local git clean evidence is required'];
}

function candidateScopeFailures(candidateProof, evidence) {
  const failures = [];
  const github = evidence.github || {};
  if (!candidateProof.branch) failures.push('real-delivery candidate proof branch is required');
  else if (!github.branchName) {
    failures.push('final GitHub branch evidence is required for real-delivery candidate continuity');
  }
  else if (github.branchName && candidateProof.branch !== github.branchName) {
    failures.push('real-delivery candidate proof branch must match final GitHub branch');
  }
  const finalGithubChangedFiles = normalizeStringArray(github.changedFiles || github.changed_files);
  if (finalGithubChangedFiles.length === 0) {
    failures.push('final GitHub changed files are required for real-delivery candidate continuity');
  }
  const finalChangedFiles = new Set(finalGithubChangedFiles);
  const candidateChangedFiles = normalizeStringArray(candidateProof.changedFiles);
  const candidateFileSet = new Set(candidateChangedFiles);
  const implementationFiles = normalizeStringArray(candidateProof.implementationFiles);
  const testFiles = normalizeStringArray(candidateProof.testFiles);
  if (candidateChangedFiles.length === 0) failures.push('real-delivery candidate proof changedFiles are required');
  if (implementationFiles.length === 0) {
    failures.push('real-delivery candidate proof implementation files are required');
  }
  if (testFiles.length === 0) {
    failures.push('real-delivery candidate proof test files are required');
  }
  const unscopedImplementationFiles = implementationFiles.filter((filePath) => !candidateFileSet.has(filePath));
  if (unscopedImplementationFiles.length) {
    failures.push(`real-delivery candidate proof implementation files must be included in changedFiles: ${unscopedImplementationFiles.join(', ')}`);
  }
  const unscopedTestFiles = testFiles.filter((filePath) => !candidateFileSet.has(filePath));
  if (unscopedTestFiles.length) {
    failures.push(`real-delivery candidate proof test files must be included in changedFiles: ${unscopedTestFiles.join(', ')}`);
  }
  const missing = candidateChangedFiles.filter((filePath) => !finalChangedFiles.has(filePath));
  if (missing.length) failures.push(`real-delivery candidate proof files must appear in final GitHub changed files: ${missing.join(', ')}`);
  const extraFinalFiles = [...finalChangedFiles].filter((filePath) => !candidateFileSet.has(filePath));
  if (extraFinalFiles.length) {
    failures.push(`final GitHub changed files must stay within real-delivery candidate proof scope: ${extraFinalFiles.join(', ')}`);
  }
  return failures;
}

function loadReleaseArtifacts(evidence, options, failures) {
  const artifacts = evidence.releaseEvidence?.artifacts || {};
  const repoRoot = options.repoRoot || process.cwd();
  return {
    deploy: loadArtifactPayload(repoRoot, artifactReference(artifacts, 'deploy', 'deploy-record'), 'deploy-record', failures),
    health: loadArtifactPayload(repoRoot, artifactReference(artifacts, 'health', 'post-deploy-health'), 'post-deploy-health', failures),
    rollback: loadArtifactPayload(repoRoot, artifactReference(artifacts, 'rollback', 'rollback-verification'), 'rollback-verification', failures),
  };
}

function candidateArtifactContinuityFailures(candidateProof, evidence, options = {}) {
  const artifactFailures = [];
  const { deploy, health, rollback } = loadReleaseArtifacts(evidence, options, artifactFailures);
  if (artifactFailures.length) return [];
  const failures = [];
  if (!candidateProof.deploymentUrl) failures.push('real-delivery candidate proof deploymentUrl is required');
  else {
    const urls = [deploy?.deployment_url, health?.deployment_url].filter(Boolean).map(normalizeUrl);
    if (urls.length && !urls.includes(normalizeUrl(candidateProof.deploymentUrl))) {
      failures.push('real-delivery candidate proof deploymentUrl must match final deploy health evidence');
    }
  }
  if (!candidateProof.rollbackTarget) failures.push('real-delivery candidate proof rollbackTarget is required');
  else if (rollback?.rollback_target && candidateProof.rollbackTarget !== rollback.rollback_target) {
    failures.push('real-delivery candidate proof rollbackTarget must match final rollback evidence');
  }
  return failures;
}

function candidateProofFailures(evidence, options = {}, releaseEnv = null) {
  const loadFailures = [];
  const candidateProof = loadCandidateProof(options, loadFailures);
  if (!candidateProof) {
    return options.requireCandidateProof === true
      ? [...loadFailures, 'real-delivery candidate proof is required']
      : loadFailures;
  }
  return [
    ...loadFailures,
    ...candidateBaseFailures(candidateProof, releaseEnv),
    ...finalGithubProofFailures(candidateProof).map((failure) => `real-delivery candidate proof ${failure}`),
    ...candidateIdentityFailures(candidateProof, evidence),
    ...candidateGithubContinuityFailures(candidateProof, evidence),
    ...candidateTestFailures(candidateProof),
    ...candidateSourceIntegrityFailures(candidateProof),
    ...candidateLocalGitFailures(candidateProof),
    ...candidateScopeFailures(candidateProof, evidence),
    ...candidateArtifactContinuityFailures(candidateProof, evidence, options),
  ];
}

module.exports = {
  candidateProofFailures,
};
