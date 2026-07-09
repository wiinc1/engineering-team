const { commitShaEvidenceFailure } = require('./real-commit-sha');
const { realBranchEvidenceFailure } = require('./real-branch');
const { MERGE_READINESS_CHECK_NAME } = require('./merge-readiness-github-check');

const DEFAULT_PILOT_PR_NUMBER = 271;
const GITHUB_CHECK_SOURCES = new Set(['github_check_run', 'github_status']);

function prNumberFromUrl(prUrl) {
  const match = String(prUrl || '').match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : null;
}

function parseGitHubPullRequestUrl(prUrl) {
  const match = String(prUrl || '').match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/);
  return match ? { repository: `${match[1]}/${match[2]}`, prNumber: Number(match[3]) } : null;
}

function repositoryFormatFailure(repository) {
  if (!repository) return 'GitHub repository is required';
  return /^[^/\s]+\/[^/\s]+$/.test(String(repository)) ? null : 'GitHub repository must use owner/repo format';
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

function normalizeChangedFiles(value) {
  const entries = Array.isArray(value) ? value : [value];
  return entries
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (!isPlainObject(entry)) return null;
      return entry.filename || entry.file || entry.path || entry.name || null;
    })
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function checkPassed(check = {}) {
  const conclusion = String(check.conclusion || '').trim().toLowerCase();
  const status = String(check.status || '').trim().toLowerCase();
  const reviewStatus = String(check.reviewStatus || check.review_status || '').trim().toLowerCase();
  return conclusion === 'success'
    || status === 'success'
    || reviewStatus === 'passed';
}

function checkHasGithubSource(check = {}) {
  return GITHUB_CHECK_SOURCES.has(String(check.source || check.provider || '').trim().toLowerCase());
}

function checkName(check = {}) {
  return String(check.name || check.context || check.checkName || check.check_name || '').trim();
}

function requiredCheckNames(github = {}) {
  return normalizeArray(
    github.requiredChecks
      || github.required_checks
      || github.branchProtection?.requiredChecks
      || github.branch_protection?.requiredChecks
      || github.branch_protection?.required_checks,
  )
    .map((entry) => (typeof entry === 'string' ? entry : checkName(entry)))
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function branchProtectionRequiredCheckNames(branchProtection = {}) {
  const statusChecks = branchProtection.requiredStatusChecks || branchProtection.required_status_checks || {};
  return requiredCheckNames({
    requiredChecks: branchProtection.requiredChecks
      || branchProtection.required_checks
      || statusChecks.checks
      || statusChecks.contexts
      || branchProtection.checks,
  });
}

function namesMissingFrom(sourceNames = [], targetNames = []) {
  const target = new Set(targetNames.map((name) => name.toLowerCase()));
  return sourceNames.filter((name) => !target.has(name.toLowerCase()));
}

function missingRequiredCheckNames(requiredChecks = [], checks = []) {
  const passedChecks = new Set(checks
    .filter((check) => checkPassed(check) && checkHasGithubSource(check))
    .map((check) => checkName(check).toLowerCase())
    .filter(Boolean));
  return requiredChecks.filter((name) => !passedChecks.has(name.toLowerCase()));
}

function branchProtectionFailures(github = {}, requiredChecks = []) {
  const branchProtection = github.branchProtection || github.branch_protection || null;
  const failures = [];
  if (!branchProtection) return ['GitHub branchProtection evidence is required'];
  if (branchProtection.source !== 'github_branch_protection') {
    failures.push('GitHub branchProtection evidence must come from GitHub branch protection');
  }
  const protectedChecks = branchProtectionRequiredCheckNames(branchProtection);
  if (!protectedChecks.length) {
    failures.push('GitHub branchProtection requiredChecks inventory is required');
    return failures;
  }
  const omitted = namesMissingFrom(protectedChecks, requiredChecks);
  if (omitted.length) {
    failures.push(`GitHub requiredChecks must include branch-protection checks: ${omitted.join(', ')}`);
  }
  const unprotected = namesMissingFrom(requiredChecks, protectedChecks);
  if (unprotected.length) {
    failures.push(`GitHub requiredChecks must come from branch protection: ${unprotected.join(', ')}`);
  }
  return failures;
}

function mergeReadinessNameMatches(check = {}) {
  return checkName(check).toLowerCase() === MERGE_READINESS_CHECK_NAME.toLowerCase();
}

function githubIdentityFailures(evidence) {
  const failures = [];
  const github = evidence.github || {};
  const repository = String(github.repository || '').trim();
  const repositoryFailure = repositoryFormatFailure(repository);
  const prNumber = normalizePrNumber(github.prNumber, github.prUrl);
  const directPrNumber = Number(github.prNumber);
  const hasDirectPrNumber = Number.isInteger(directPrNumber) && directPrNumber > 0;
  const githubPr = parseGitHubPullRequestUrl(github.prUrl);
  const prNumberFromUrlValue = githubPr?.prNumber || null;

  if (repositoryFailure) failures.push(repositoryFailure);

  const branchFailure = realBranchEvidenceFailure(github.branchName, 'GitHub branchName');
  if (branchFailure) failures.push(branchFailure);

  const commitFailure = commitShaFieldFailure('GitHub commitSha', github.commitSha);
  if (!github.commitSha) failures.push('GitHub commitSha is required');
  else if (commitFailure) failures.push(commitFailure);

  if (!github.prUrl) failures.push('GitHub prUrl is required');
  else if (!githubPr) failures.push('GitHub prUrl must be a github.com pull request URL');
  else if (repository && githubPr.repository !== repository) failures.push('GitHub repository must match GitHub prUrl');

  if (!hasDirectPrNumber) failures.push('GitHub prNumber is required');
  if (hasDirectPrNumber && prNumberFromUrlValue && directPrNumber !== prNumberFromUrlValue) {
    failures.push('GitHub prNumber must match GitHub prUrl');
  }
  if (prNumber === DEFAULT_PILOT_PR_NUMBER) {
    failures.push('default pilot PR #271 is not valid real delivery evidence');
  }
  if (normalizeChangedFiles(github.changedFiles || github.changed_files).length === 0) {
    failures.push('GitHub changedFiles are required');
  }

  return failures;
}

function githubCheckFailures(evidence) {
  const failures = [];
  const github = evidence.github || {};
  const checks = normalizeArray(github.checks);
  const requiredChecks = requiredCheckNames(github);
  const mergeReadiness = github.mergeReadiness || github.merge_readiness || null;

  if (!checks.length) failures.push('GitHub checks are required');
  if (checks.length && !checks.some((check) => checkPassed(check) && checkHasGithubSource(check))) {
    failures.push('GitHub checks must include at least one passing GitHub check run or status');
  }
  if (!requiredChecks.length) failures.push('GitHub requiredChecks inventory is required');
  failures.push(...branchProtectionFailures(github, requiredChecks));
  const missingRequiredChecks = missingRequiredCheckNames(requiredChecks, checks);
  if (missingRequiredChecks.length) {
    failures.push(`GitHub requiredChecks must pass from GitHub: ${missingRequiredChecks.join(', ')}`);
  }
  if (!mergeReadiness) {
    failures.push('GitHub mergeReadiness proof is required');
  } else {
    if (!checkHasGithubSource(mergeReadiness)) {
      failures.push('GitHub mergeReadiness proof must come from a GitHub check run or status');
    }
    if (!mergeReadinessNameMatches(mergeReadiness)) {
      failures.push('GitHub mergeReadiness proof must be the Merge readiness check');
    }
    if (!checkPassed(mergeReadiness)) {
      failures.push('GitHub mergeReadiness proof must pass');
    }
  }
  if (requiredChecks.length && !requiredChecks.some((name) => name.toLowerCase() === 'merge readiness')) {
    failures.push('GitHub requiredChecks must include Merge readiness');
  }

  return failures;
}

module.exports = {
  branchProtectionFailures,
  githubCheckFailures,
  githubIdentityFailures,
};
