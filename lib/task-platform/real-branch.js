const DEFAULT_BRANCHES = new Set(['main', 'master']);

function normalizeBranchName(value) {
  return String(value || '').trim();
}

function realBranchEvidenceFailure(value, label = 'candidate branch') {
  const branch = normalizeBranchName(value);
  if (!branch) return `${label} is required`;
  if (branch === 'HEAD') return `${label} cannot be detached HEAD`;
  if (DEFAULT_BRANCHES.has(branch)) return `${label} must not be ${branch}`;
  return null;
}

function isRealCandidateBranch(value) {
  return realBranchEvidenceFailure(value) === null;
}

module.exports = {
  DEFAULT_BRANCHES,
  isRealCandidateBranch,
  normalizeBranchName,
  realBranchEvidenceFailure,
};
