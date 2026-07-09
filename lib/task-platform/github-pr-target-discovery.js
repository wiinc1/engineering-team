const { DEFAULT_GITHUB_API_BASE_URL, fetchGitHubPages } = require('./github-evidence-client');
const { githubApiBaseUrlFailures } = require('./github-evidence-source-policy');

const DEFAULT_PILOT_PR_NUMBER = 271;

function repositoryParts(repository) {
  const [owner, repo] = String(repository || '').split('/').filter(Boolean);
  return owner && repo ? { owner, repo, repository: `${owner}/${repo}` } : null;
}

function githubToken(options = {}, env = process.env) {
  return options.githubToken || env.GITHUB_TOKEN || env.GH_TOKEN || '';
}

function githubApiBaseUrl(options = {}) {
  return (options.githubApiBaseUrl || DEFAULT_GITHUB_API_BASE_URL).replace(/\/$/, '');
}

function pullRequestUrl(repository, number) {
  return `https://github.com/${repository}/pull/${Number(number)}`;
}

function assertDiscoveredPullRequest(options = {}, pull = {}) {
  const prNumber = Number(pull.number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error('discovered GitHub pull request is missing a valid number');
  if (prNumber === DEFAULT_PILOT_PR_NUMBER) throw new Error('default pilot PR #271 is not valid real evidence');
  if (!pull.head?.ref) throw new Error(`discovered GitHub PR #${prNumber} is missing a head branch`);
  if (!pull.head?.sha) throw new Error(`discovered GitHub PR #${prNumber} is missing a head SHA`);
  if (options.branchName && pull.head.ref !== options.branchName) {
    throw new Error(`discovered GitHub PR head branch ${pull.head.ref} does not match requested branch ${options.branchName}`);
  }
  if (options.implementationCommitSha && pull.head.sha !== options.implementationCommitSha) {
    throw new Error(`discovered GitHub PR head SHA ${pull.head.sha} does not match requested implementation commit ${options.implementationCommitSha}`);
  }
}

async function discoverGitHubPullRequestTarget(options = {}, env = process.env) {
  const parts = repositoryParts(options.repository || options.ciRepository);
  if (!parts) throw new Error('GitHub repository is required to discover a pull request target');
  const branchName = options.branchName || options.branch;
  if (!branchName) throw new Error('branch name is required to discover a pull request target');
  const token = githubToken(options, env);
  if (!token) throw new Error('GITHUB_TOKEN or GH_TOKEN is required to discover a pull request target');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required to discover a pull request target');
  const apiFailures = githubApiBaseUrlFailures(options, env);
  if (apiFailures.length) throw new Error(apiFailures.join('; '));
  const headOwner = options.headOwner || parts.owner;
  const apiBaseUrl = githubApiBaseUrl(options);
  const route = `/repos/${parts.owner}/${parts.repo}/pulls?state=open&head=${encodeURIComponent(`${headOwner}:${branchName}`)}`;
  const pulls = await fetchGitHubPages({ apiBaseUrl, fetchImpl, token, route, maxPages: 2 });
  if (pulls.length === 0) throw new Error(`no open GitHub pull request found for ${headOwner}:${branchName}`);
  if (pulls.length > 1) throw new Error(`multiple open GitHub pull requests found for ${headOwner}:${branchName}`);
  const pull = pulls[0];
  assertDiscoveredPullRequest({ ...options, branchName }, pull);
  const prNumber = Number(pull.number);
  return {
    repository: parts.repository,
    branchName: pull.head.ref,
    implementationCommitSha: pull.head.sha,
    prNumber,
    prUrl: pull.html_url || pullRequestUrl(parts.repository, prNumber),
    source: {
      provider: 'github',
      apiBaseUrl,
      route,
      collectedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  DEFAULT_PILOT_PR_NUMBER,
  discoverGitHubPullRequestTarget,
  pullRequestUrl,
  repositoryParts,
};
