const { fetchGitHubJson } = require('./github-evidence-client');
const { requiredStatusCheckNames } = require('./merge-readiness-branch-protection');

function encodeBranchName(branch) {
  return encodeURIComponent(String(branch || 'main'));
}

async function collectGitHubBranchProtectionEvidence({
  apiBaseUrl,
  fetchImpl,
  token,
  repositoryBaseRoute,
  branch,
} = {}) {
  const branchName = branch || 'main';
  const protection = await fetchGitHubJson({
    apiBaseUrl,
    fetchImpl,
    token,
    route: `${repositoryBaseRoute}/branches/${encodeBranchName(branchName)}/protection`,
  });
  const requiredChecks = requiredStatusCheckNames(protection);
  return { branch: branchName, requiredChecks, source: 'github_branch_protection' };
}

module.exports = {
  collectGitHubBranchProtectionEvidence,
};
