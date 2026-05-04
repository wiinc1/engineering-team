const { MERGE_READINESS_CHECK_NAME } = require('./merge-readiness-github-check');

const MERGE_READINESS_BRANCH_PROTECTION_VERSION = 'merge-readiness-branch-protection.v1';

function readAny(input, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input || {}, key)) return input[key];
  }
  return undefined;
}

function toArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
  if (typeof value === 'object') return Object.values(value).flatMap(toArray);
  return [];
}

function cloneJson(value, fallback = null) {
  if (value === undefined) return fallback;
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function slug(value) {
  return String(value || 'branch-protection').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'branch-protection';
}

function repositoryParts(repository) {
  const [owner, repo] = String(repository || '').split('/');
  return owner && repo ? { owner, repo } : null;
}

function normalizeCheckName(check) {
  if (check == null) return '';
  if (typeof check === 'string') return check.trim();
  return String(
    check.context
      || check.name
      || check.checkName
      || check.check_name
      || check.app?.name
      || ''
  ).trim();
}

function uniqueNames(values) {
  return [...new Set(values.map(normalizeCheckName).filter(Boolean))];
}

function requiredStatusCheckNames(branchProtection = {}) {
  if (Array.isArray(branchProtection) || typeof branchProtection === 'string') {
    return uniqueNames(toArray(branchProtection));
  }
  const checks = readAny(branchProtection, 'requiredStatusChecks', 'required_status_checks') || branchProtection;
  const contexts = [
    ...toArray(readAny(checks, 'contexts', 'requiredStatusCheckContexts', 'required_status_check_contexts')),
    ...toArray(readAny(checks, 'checks', 'requiredStatusChecks', 'required_status_checks')),
    ...toArray(checks?.nodes),
  ];
  return uniqueNames(contexts);
}

function branchProtectionInput(input = {}) {
  return readAny(input, 'branchProtection', 'branch_protection', 'defaultBranchProtection', 'default_branch_protection');
}

function verificationRequested(input = {}) {
  return branchProtectionInput(input) !== undefined
    || readAny(input, 'verifyBranchProtection', 'verify_branch_protection') === true;
}

function evaluateMergeReadinessBranchProtection(input = {}) {
  const checkName = readAny(input, 'checkName', 'check_name') || MERGE_READINESS_CHECK_NAME;
  const branch = readAny(input, 'defaultBranch', 'default_branch', 'branch') || 'main';
  const protection = branchProtectionInput(input);
  if (!verificationRequested(input)) {
    return policyResult({ status: 'not_evaluated', branch, checkName, active: false });
  }
  if (!protection) {
    return policyResult({
      status: 'error',
      branch,
      checkName,
      reason: readAny(input, 'verificationError', 'verification_error') || 'branch_protection_unavailable',
    });
  }
  const requiredChecks = requiredStatusCheckNames(protection);
  if (requiredChecks.includes(checkName)) {
    return policyResult({ status: 'enforced', branch, checkName, requiredChecks, enforced: true });
  }
  return policyResult({
    status: 'policy_blocked',
    branch,
    checkName,
    requiredChecks,
    reason: 'merge_readiness_not_required',
  });
}

function policyResult(options = {}) {
  const enforced = options.enforced === true;
  const active = options.active !== false;
  const result = {
    policyVersion: MERGE_READINESS_BRANCH_PROTECTION_VERSION,
    status: options.status,
    active,
    enforced,
    branch: options.branch || 'main',
    requiredCheckName: options.checkName || MERGE_READINESS_CHECK_NAME,
    requiredChecks: options.requiredChecks || [],
    reason: options.reason || null,
    reviewStatus: null,
    findings: [],
    exceptions: [],
  };
  if (!active || enforced) return result;
  const finding = branchProtectionFinding(result);
  result.findings.push(finding);
  if (result.status === 'error') {
    result.reviewStatus = 'error';
    return result;
  }
  result.reviewStatus = 'blocked';
  result.exceptions.push({
    type: 'policy_blocked',
    status: 'open',
    sourceId: 'github-branch-protection',
    owner: 'repo-admin',
    reason: result.reason || 'merge_readiness_not_required',
    policyVersion: MERGE_READINESS_BRANCH_PROTECTION_VERSION,
  });
  return result;
}

function branchProtectionFinding(result) {
  const kind = result.status === 'error' ? 'branch_protection_verification_error' : 'policy_blocked';
  return {
    id: `MRR-BRANCH-PROTECTION-${slug(result.requiredCheckName)}`,
    type: kind,
    severity: result.status === 'error' ? 'error' : 'blocker',
    sourceId: 'github-branch-protection',
    policyVersion: MERGE_READINESS_BRANCH_PROTECTION_VERSION,
    owner: 'repo-admin',
    summary: result.status === 'error'
      ? `Default branch protection for ${result.branch} could not be verified for ${result.requiredCheckName}.`
      : `Default branch protection for ${result.branch} must require ${result.requiredCheckName}.`,
  };
}

function mergeObject(base, additions) {
  return base && typeof base === 'object' && !Array.isArray(base) ? { ...base, ...additions } : additions;
}

function applyMergeReadinessBranchProtectionPolicy(review, input = {}) {
  const policy = evaluateMergeReadinessBranchProtection(input);
  if (!policy.active) return review;
  review.classification = mergeObject(review.classification, {
    branch_protection_policy: {
      version: policy.policyVersion,
      status: policy.status,
      enforced: policy.enforced,
      branch: policy.branch,
      required_check_name: policy.requiredCheckName,
      required_status_checks: policy.requiredChecks,
      exceptions: policy.exceptions,
    },
  });
  review.metadata = mergeObject(review.metadata, {
    github_merge_readiness_branch_protection: {
      policy_version: policy.policyVersion,
      status: policy.status,
      enforced: policy.enforced,
      branch: policy.branch,
      required_check_name: policy.requiredCheckName,
      reason: policy.reason,
    },
  });
  review.findings = [...toArray(review.findings), ...policy.findings, ...policy.exceptions.map(exception => ({ ...exception, severity: 'blocker' }))];
  if (policy.reviewStatus) review.review_status = policy.reviewStatus;
  return review;
}

function createGitHubBranchProtectionClient(options = {}) {
  const token = options.token || process.env.GITHUB_TOKEN;
  const fetchImpl = options.fetch || globalThis.fetch;
  const apiBaseUrl = (options.apiBaseUrl || 'https://api.github.com').replace(/\/$/, '');
  if (!token) throw new Error('GITHUB_TOKEN is required for GitHub branch-protection verification');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  return {
    async getBranchProtection({ repository, branch = 'main' }) {
      const parts = repositoryParts(repository);
      if (!parts) throw new Error('repository must be in owner/name form');
      const response = await fetchImpl(`${apiBaseUrl}/repos/${parts.owner}/${parts.repo}/branches/${branch}/protection`, {
        method: 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
        },
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        const body = typeof response.text === 'function' ? await response.text() : '';
        throw new Error(`GitHub branch protection GET failed: ${response.status} ${body}`.trim());
      }
      return response.json();
    },
  };
}

async function verifyMergeReadinessBranchProtection(options = {}) {
  try {
    const protection = await options.github.getBranchProtection({
      repository: options.repository,
      branch: options.branch || options.defaultBranch || options.default_branch || 'main',
    });
    return evaluateMergeReadinessBranchProtection({
      branchProtection: protection,
      branch: options.branch || options.defaultBranch || options.default_branch || 'main',
      checkName: options.checkName,
      verifyBranchProtection: true,
    });
  } catch (error) {
    return evaluateMergeReadinessBranchProtection({
      branchProtection: null,
      branch: options.branch || options.defaultBranch || options.default_branch || 'main',
      checkName: options.checkName,
      verifyBranchProtection: true,
      verificationError: error.message,
    });
  }
}

module.exports = {
  MERGE_READINESS_BRANCH_PROTECTION_VERSION,
  applyMergeReadinessBranchProtectionPolicy,
  createGitHubBranchProtectionClient,
  evaluateMergeReadinessBranchProtection,
  requiredStatusCheckNames,
  verifyMergeReadinessBranchProtection,
};
