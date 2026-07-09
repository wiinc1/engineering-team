const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { isImplementationCodeFile } = require('./golden-path-real-scope');
const { gitOutput, gitRawOutput, localGitEvidence, parsePorcelainStatus, requiredLocalGitWorktreeFailure } = require('./local-git-proof-inputs');
const { realBranchEvidenceFailure } = require('./real-branch');
const { commitShaEvidenceFailure } = require('./real-commit-sha');
const { loadRollbackEvidenceReference, rollbackEvidenceFailures } = require('./rollback-evidence');
const { loadProductionSafetyEvidenceReference, productionSafetyEvidenceFailures } = require('./production-safety-evidence');
const { candidateGithubProofOptions, finalGithubProofFailures } = require('./real-delivery-candidate-github-proof');
const { isLocalOrPrivateDeploymentUrl, isPlaceholderDeploymentUrl } = require('./real-delivery-candidate-url');

const REAL_DELIVERY_CANDIDATE_SCHEMA_VERSION = 'real-delivery-candidate.v1';
const HOSTED_RELEASE_ENVIRONMENTS = new Set(['staging', 'prod']);
const DEFAULT_PILOT_PR_NUMBER = 271;
const DEFAULT_MAX_CHANGED_FILES = 40;
const EXCLUDED_CANDIDATE_ROOT_PATTERN = /^(?:\.artifacts|coverage|dist|generated|node_modules|observability|playwright-report|test-results)\//;
const TEST_FILE_PATTERN = /(^|\/)(tests?|__tests__|chaos)\/|[.-](test|spec)\.[cm]?[jt]sx?$|[.-](test|spec)\.py$/i;

function normalizeReleaseEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'production') return 'prod';
  return normalized;
}

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function parseBoolean(value) {
  if (value === true) return true;
  if (value === false || value == null || value === '') return false;
  return ['1', 'true', 'yes', 'on', 'verified'].includes(String(value).trim().toLowerCase());
}

function isCandidateChangedFile(filePath) {
  return !EXCLUDED_CANDIDATE_ROOT_PATTERN.test(normalizePath(filePath));
}

function readGitCandidateState(root = process.cwd()) {
  const inGitWorktree = gitOutput(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
  const branch = gitOutput(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const commitSha = gitOutput(root, ['rev-parse', 'HEAD']);
  const status = inGitWorktree ? gitRawOutput(root, ['status', '--porcelain=v1', '--untracked-files=all']) : '';
  const dirtyFiles = parsePorcelainStatus(status).map((entry) => entry.path);
  return {
    branch,
    commitSha,
    changedFiles: dirtyFiles.filter(isCandidateChangedFile),
    workingTreeClean: inGitWorktree ? dirtyFiles.length === 0 : null,
    dirtyFileCount: inGitWorktree ? dirtyFiles.length : null,
    dirtyFiles: dirtyFiles.slice(0, 20),
  };
}

function isTestFile(filePath) {
  return TEST_FILE_PATTERN.test(normalizePath(filePath));
}

function uniqueNormalizedPaths(files = []) {
  return [...new Set(files.map(normalizePath).filter(Boolean))].sort();
}

function normalizeStringArray(value) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.map((entry) => String(entry || '').trim()).filter(Boolean);
}

function readRealDeliveryCandidateManifest(root, manifestPath) {
  const resolved = path.resolve(root, manifestPath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function prNumberFromUrl(prUrl) { const match = String(prUrl || '').match(/\/pull\/(\d+)(?:$|[/?#])/); return match ? Number(match[1]) : null; }

function parseGitHubPullRequestUrl(prUrl) {
  const match = String(prUrl || '').match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/);
  return match ? { repository: `${match[1]}/${match[2]}`, prNumber: Number(match[3]) } : null;
}

function isGitHubPullRequestUrl(prUrl) { return Boolean(parseGitHubPullRequestUrl(prUrl)); }

function normalizeRepository(value) { const normalized = String(value || '').trim(); return /^[^/\s]+\/[^/\s]+$/.test(normalized) ? normalized : ''; }

function normalizePrNumber(value, prUrl) {
  const direct = Number(value);
  if (Number.isInteger(direct) && direct > 0) return direct;
  return prNumberFromUrl(prUrl);
}

function candidateOptionsFromManifest(manifest = {}) {
  const release = manifest.release || {};
  const rollback = manifest.rollback || {};
  const scope = manifest.scope || {};
  const tests = manifest.tests || {};
  const risk = manifest.risk || {};
  const source = manifest.source || manifest.github || {};
  const prUrl = manifest.prUrl || source.prUrl || source.pullRequestUrl;
  return {
    manifest,
    manifestProvided: true,
    releaseEnv: manifest.releaseEnv || release.environment,
    branch: manifest.branch || manifest.branchName || source.branch || source.branchName,
    commitSha: manifest.commitSha || manifest.implementationCommitSha || source.commitSha || source.implementationCommitSha,
    repository: manifest.repository || manifest.ciRepository || source.repository || source.ciRepository,
    prUrl,
    prNumber: normalizePrNumber(manifest.prNumber || source.prNumber || source.pullRequestNumber, prUrl),
    checks: manifest.checks || source.checks,
    requiredChecks: manifest.requiredChecks || source.requiredChecks || source.required_checks || source.branchProtection?.requiredChecks,
    branchProtection: manifest.branchProtection || manifest.branch_protection || source.branchProtection || source.branch_protection,
    mergeReadiness: manifest.mergeReadiness || manifest.merge_readiness || source.mergeReadiness || source.merge_readiness,
    githubEvidenceSource: manifest.githubEvidenceSource || manifest.evidenceSource || source.evidenceSource,
    deploymentUrl: manifest.deploymentUrl || release.deploymentUrl || release.deployment_url,
    rollbackTarget: manifest.rollbackTarget || rollback.target || rollback.rollbackTarget,
    rollbackPlan: manifest.rollbackPlan || rollback.plan || rollback.rollbackPlan,
    rollbackEvidence: manifest.rollbackEvidence
      || manifest.rollback_evidence
      || rollback.evidence
      || rollback.rollbackEvidence
      || rollback.rollback_evidence
      || rollback.artifact
      || rollback.verification,
    productionSafetyEvidence: manifest.productionSafetyEvidence || manifest.production_safety_evidence || release.productionSafetyEvidence || release.production_safety_evidence || risk.productionSafetyEvidence || risk.production_safety_evidence,
    changedFiles: manifest.changedFiles || scope.changedFiles || scope.files,
    testCommands: manifest.testCommands || tests.commands,
    riskLevel: manifest.riskLevel || risk.level,
    productionSafe: manifest.productionSafe ?? risk.productionSafe ?? release.productionSafe,
    healthCheckPath: manifest.healthCheckPath || release.healthCheckPath || release.health_check_path,
    requireHealthCommit: manifest.requireHealthCommit ?? release.requireHealthCommit ?? release.require_health_commit,
    rollbackVerified: manifest.rollbackVerified ?? rollback.verified ?? rollback.rollbackVerified,
    maxChangedFiles: manifest.maxChangedFiles || scope.maxChangedFiles,
  };
}

function withoutUndefinedValues(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ''));
}

function tailText(value, maxLength = 2000) {
  const text = String(value || '');
  return text.length > maxLength ? text.slice(text.length - maxLength) : text;
}

function runCandidateTestCommands(root, commands = [], options = {}) {
  const timeoutMs = Number.parseInt(options.testCommandTimeoutMs || process.env.REAL_DELIVERY_TEST_COMMAND_TIMEOUT_MS || 120000, 10);
  return normalizeStringArray(commands).map((command) => {
    const startedAt = Date.now();
    const result = spawnSync(command, {
      cwd: root,
      shell: true,
      encoding: 'utf8',
      timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000,
      env: { ...process.env, ...(options.env || {}) },
    });
    return {
      command,
      ok: result.status === 0,
      exitCode: result.status,
      signal: result.signal || null,
      durationMs: Date.now() - startedAt,
      stdout: tailText(result.stdout),
      stderr: tailText(result.stderr || result.error?.message),
    };
  });
}

function buildCandidateFacts(options = {}) {
  const env = options.env || process.env;
  const releaseEnv = normalizeReleaseEnv(options.releaseEnv || env.RELEASE_ENV);
  const changedFiles = uniqueNormalizedPaths(options.changedFiles || []);
  const prUrl = options.prUrl || env.PR_URL || env.GITHUB_PR_URL || '';
  const prRepository = parseGitHubPullRequestUrl(prUrl)?.repository || '';
  return {
    branch: String(options.branch || '').trim(),
    releaseEnv,
    commitSha: options.commitSha || options.implementationCommitSha || env.IMPLEMENTATION_COMMIT_SHA || env.COMMIT_SHA || env.GITHUB_SHA || '',
    repository: normalizeRepository(options.repository || options.ciRepository || env.CI_REPOSITORY || env.GITHUB_REPOSITORY || prRepository),
    prUrl,
    prNumber: normalizePrNumber(options.prNumber || env.PR_NUMBER || env.GITHUB_PR_NUMBER, prUrl),
    deploymentUrl: options.deploymentUrl || env.DEPLOYMENT_URL || env.PRODUCTION_URL || '',
    rollbackTarget: options.rollbackTarget || env.ROLLBACK_TARGET || '',
    rollbackPlan: options.rollbackPlan || env.ROLLBACK_PLAN || '',
    maxChangedFiles: Number.parseInt(
      options.maxChangedFiles || env.MAX_REAL_DELIVERY_CHANGED_FILES || DEFAULT_MAX_CHANGED_FILES,
      10,
    ),
    testCommands: normalizeStringArray(options.testCommands),
    riskLevel: String(options.riskLevel || '').trim().toLowerCase(),
    productionSafe: options.productionSafe === true,
    productionSafetyEvidence: options.productionSafetyEvidence || null,
    healthCheckPath: options.healthCheckPath || '',
    requireHealthCommit: options.requireHealthCommit === true,
    requireFinalReleaseProof: options.requireFinalReleaseProof === true,
    rollbackVerified: parseBoolean(options.rollbackVerified),
    rollbackEvidence: options.rollbackEvidence || null,
    verifyDeploymentHealth: options.verifyDeploymentHealth === true,
    ...candidateGithubProofOptions(options),
    changedFiles,
    implementationFiles: changedFiles.filter(isImplementationCodeFile),
    testFiles: changedFiles.filter(isTestFile),
  };
}

function coreCandidateFailures(facts) {
  const failures = [];

  const branchFailure = realBranchEvidenceFailure(facts.branch);
  if (branchFailure) failures.push(branchFailure);

  if (!HOSTED_RELEASE_ENVIRONMENTS.has(facts.releaseEnv)) {
    failures.push(`release environment must be staging or prod; got ${facts.releaseEnv || 'none'}`);
  }
  if (!facts.deploymentUrl) failures.push('hosted deployment URL is required');
  else if (isLocalOrPrivateDeploymentUrl(facts.deploymentUrl)) {
    failures.push('hosted deployment URL must be non-local and non-private');
  } else if (isPlaceholderDeploymentUrl(facts.deploymentUrl)) {
    failures.push('hosted deployment URL must not use placeholder or reserved domains');
  }
  if (!facts.rollbackTarget && !facts.rollbackPlan) {
    failures.push('rollback target or rollback plan is required before real delivery');
  }
  if (facts.changedFiles.length === 0) failures.push('candidate must include changed files');
  if (Number.isFinite(facts.maxChangedFiles) && facts.maxChangedFiles > 0 && facts.changedFiles.length > facts.maxChangedFiles) {
    failures.push(`candidate has ${facts.changedFiles.length} changed files, above low-risk limit ${facts.maxChangedFiles}`);
  }
  if (facts.implementationFiles.length === 0) failures.push('candidate must include at least one implementation code file');
  if (facts.testFiles.length === 0) failures.push('candidate must include at least one test file');
  if (facts.riskLevel !== 'low') failures.push('candidate risk level must be low');
  if (facts.productionSafe !== true) failures.push('candidate must mark productionSafe true');
  if (facts.testCommands.length === 0) failures.push('candidate must list executable test commands');
  return failures;
}

function manifestCandidateFailures(options, facts) {
  if (!options.manifestProvided) return [];
  const schemaVersion = options.manifest?.schemaVersion || options.manifest?.schema_version || '';
  const failures = [];
  if (schemaVersion !== REAL_DELIVERY_CANDIDATE_SCHEMA_VERSION) {
    failures.push(`candidate manifest schemaVersion must be ${REAL_DELIVERY_CANDIDATE_SCHEMA_VERSION}`);
  }
  return failures;
}

function finalReleaseProofFailures(facts) {
  if (!facts.requireFinalReleaseProof) return [];
  const failures = [];
  const commitFailure = commitShaEvidenceFailure(facts.commitSha);
  if (commitFailure) failures.push(`final real delivery candidate ${commitFailure}`);
  const prNumberInUrl = prNumberFromUrl(facts.prUrl);
  const prRepository = parseGitHubPullRequestUrl(facts.prUrl)?.repository || '';
  if (!facts.repository) failures.push('actual GitHub repository evidence is required for final real delivery candidate');
  if (!facts.prUrl && !facts.prNumber) failures.push('actual pull request evidence is required for final real delivery candidate');
  if (facts.prUrl && !prNumberInUrl) failures.push('candidate pull request URL must include /pull/<number>');
  if (facts.prUrl && !isGitHubPullRequestUrl(facts.prUrl)) failures.push('candidate pull request URL must be a GitHub pull request URL');
  if (facts.repository && prRepository && facts.repository !== prRepository) failures.push('candidate repository must match pull request URL');
  if (facts.prNumber && prNumberInUrl && facts.prNumber !== prNumberInUrl) {
    failures.push('candidate pull request number must match pull request URL');
  }
  if (facts.prNumber === DEFAULT_PILOT_PR_NUMBER || prNumberInUrl === DEFAULT_PILOT_PR_NUMBER) {
    failures.push('default pilot PR #271 is not valid real delivery candidate evidence');
  }
  if (facts.rollbackVerified !== true) {
    failures.push('verified rollback evidence is required for final real delivery candidate');
  }
  if (facts.verifyDeploymentHealth !== true) {
    failures.push('live deployment health verification is required for final real delivery candidate');
  }
  if (HOSTED_RELEASE_ENVIRONMENTS.has(facts.releaseEnv) && facts.requireHealthCommit !== true) failures.push('health commit verification is required for final real delivery candidate');
  return failures;
}

function gitStateConsistencyFailures(facts, gitState = {}) {
  const failures = [];
  const gitBranch = String(gitState.branch || '').trim();
  const gitCommitSha = String(gitState.commitSha || '').trim();
  if (gitBranch && facts.branch && facts.branch !== gitBranch) {
    failures.push('candidate branch must match current git branch');
  }
  if (gitCommitSha && facts.commitSha && facts.commitSha !== gitCommitSha) {
    failures.push('candidate commitSha must match current git HEAD');
  }
  return failures;
}

function finalGitStateEvidenceFailures(facts, gitState = {}) {
  if (facts.requireFinalReleaseProof !== true) return [];
  const failure = requiredLocalGitWorktreeFailure(gitState, 'final real delivery candidate proof');
  return failure ? [failure] : [];
}

function markResultFailures(result, failures = []) {
  for (const failure of failures.filter(Boolean)) {
    result.failures.push(failure);
    result.ok = false;
  }
}

function manifestFileStateFailures(result, gitState = {}) {
  const gitChangedFiles = new Set(uniqueNormalizedPaths(gitState.changedFiles || []));
  const missing = result.changedFiles.filter((filePath) => !gitChangedFiles.has(filePath));
  return missing.length
    ? [`candidate manifest files are not changed in the current git state: ${missing.join(', ')}`]
    : [];
}

function evaluateRealDeliveryCandidate(options = {}) {
  const facts = buildCandidateFacts(options);
  const failures = [
    ...coreCandidateFailures(facts),
    ...manifestCandidateFailures(options, facts),
    ...finalReleaseProofFailures(facts),
    ...finalGithubProofFailures(facts),
    ...rollbackEvidenceFailures({ required: facts.requireFinalReleaseProof, releaseEnv: facts.releaseEnv, commitSha: facts.commitSha, rollbackTarget: facts.rollbackTarget, rollbackEvidence: facts.rollbackEvidence }),
    ...productionSafetyEvidenceFailures({ required: facts.requireFinalReleaseProof, releaseEnv: facts.releaseEnv, deploymentUrl: facts.deploymentUrl, commitSha: facts.commitSha, productionSafetyEvidence: facts.productionSafetyEvidence }),
  ];
  return {
    ok: failures.length === 0,
    ...facts,
    repository: facts.repository || null,
    commitSha: facts.commitSha || null,
    prUrl: facts.prUrl || null,
    prNumber: facts.prNumber || null,
    deploymentUrl: facts.deploymentUrl || null,
    rollbackTarget: facts.rollbackTarget || null,
    rollbackPlan: facts.rollbackPlan || null,
    riskLevel: facts.riskLevel || null,
    rollbackEvidence: facts.rollbackEvidence || null,
    productionSafetyEvidence: facts.productionSafetyEvidence || null,
    checks: facts.checks,
    requiredChecks: facts.requiredChecks,
    branchProtection: facts.branchProtection,
    mergeReadiness: facts.mergeReadiness,
    githubEvidenceSource: facts.githubEvidenceSource,
    failures,
  };
}

function verifyRealDeliveryCandidate(options = {}) {
  const root = options.root || process.cwd();
  const explicitOptions = withoutUndefinedValues(options);
  const manifest = options.manifestData || (options.manifestPath ? readRealDeliveryCandidateManifest(root, options.manifestPath) : null);
  const manifestOptions = manifest ? candidateOptionsFromManifest(manifest) : {};
  const gitState = options.gitState || readGitCandidateState(root);
  const changedFiles = explicitOptions.changedFiles || manifestOptions.changedFiles || gitState.changedFiles;
  const rollbackEvidenceLoadFailures = [];
  const rollbackEvidence = loadRollbackEvidenceReference(root, explicitOptions.rollbackEvidence || manifestOptions.rollbackEvidence, rollbackEvidenceLoadFailures);
  const productionSafetyEvidenceLoadFailures = [];
  const productionSafetyEvidence = loadProductionSafetyEvidenceReference(root, explicitOptions.productionSafetyEvidence || manifestOptions.productionSafetyEvidence, productionSafetyEvidenceLoadFailures);
  const result = evaluateRealDeliveryCandidate({
    ...manifestOptions,
    ...explicitOptions,
    manifest, manifestProvided: Boolean(manifest),
    branch: explicitOptions.branch || manifestOptions.branch || gitState.branch,
    commitSha: explicitOptions.commitSha || explicitOptions.implementationCommitSha || manifestOptions.commitSha || gitState.commitSha,
    repository: explicitOptions.repository || explicitOptions.ciRepository || manifestOptions.repository,
    prUrl: explicitOptions.prUrl || manifestOptions.prUrl, prNumber: explicitOptions.prNumber || manifestOptions.prNumber,
    rollbackEvidence, productionSafetyEvidence,
    changedFiles,
  });
  markResultFailures(result, rollbackEvidenceLoadFailures);
  markResultFailures(result, productionSafetyEvidenceLoadFailures);
  if (manifest && options.requireManifestFilesInGitState !== false) {
    markResultFailures(result, manifestFileStateFailures(result, gitState));
  }
  markResultFailures(result, gitStateConsistencyFailures(result, gitState));
  result.localGit = localGitEvidence(gitState);
  markResultFailures(result, finalGitStateEvidenceFailures(result, gitState));
  if (options.runTestCommands === true) {
    result.testCommandResults = runCandidateTestCommands(root, result.testCommands, options);
    markResultFailures(result, result.testCommandResults
      .filter((entry) => !entry.ok)
      .map((entry) => `test command failed: ${entry.command}`));
  }
  if (typeof options.sourceIntegrity === 'function') {
    const integrity = options.sourceIntegrity(root);
    result.sourceIntegrity = integrity;
    if (integrity?.failures?.length) markResultFailures(result, [`source integrity gate failed with ${integrity.failures.length} findings`]);
  }
  return result;
}

module.exports = {
  REAL_DELIVERY_CANDIDATE_SCHEMA_VERSION,
  candidateOptionsFromManifest,
  evaluateRealDeliveryCandidate,
  isCandidateChangedFile,
  isLocalOrPrivateDeploymentUrl,
  isPlaceholderDeploymentUrl,
  isTestFile,
  parsePorcelainStatus,
  readGitCandidateState,
  readRealDeliveryCandidateManifest,
  runCandidateTestCommands,
  finalGitStateEvidenceFailures,
  gitStateConsistencyFailures,
  rollbackEvidenceFailures,
  productionSafetyEvidenceFailures,
  verifyRealDeliveryCandidate,
};
