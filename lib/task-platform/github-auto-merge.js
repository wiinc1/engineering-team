function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function autoMergeEnabled(options = {}) {
  if (typeof options.autoMerge === 'boolean') return options.autoMerge;
  return parseBooleanEnv(process.env.FF_FACTORY_AUTO_MERGE, false);
}

function resolveGithubToken(options = {}) {
  return options.githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

function parseRepository(repository = 'wiinc1/engineering-team') {
  const [owner, repo] = String(repository).split('/').filter(Boolean);
  return {
    owner: owner || 'wiinc1',
    repo: repo || 'engineering-team',
  };
}

async function fetchGithubJson(url, token, { method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { message: text };
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

async function fetchPullRequestMergeState({ owner, repo, prNumber, token, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return fetchGithubJson(url, token);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function mergePullRequestWhenReady(options = {}) {
  const {
    repository = 'wiinc1/engineering-team',
    prNumber,
    prUrl = null,
    commitTitle = 'Factory delivery auto-merge',
    commitMessage = 'Automated merge after validation gates passed.',
    fetchImpl = fetch,
  } = options;

  const enabled = autoMergeEnabled(options);
  const token = resolveGithubToken(options);
  const { owner, repo } = parseRepository(repository);

  if (!enabled) {
    return {
      ok: true,
      skipped: true,
      simulated: true,
      reason: 'auto_merge_disabled',
      prNumber,
      prUrl,
    };
  }
  if (!token) {
    return {
      ok: true,
      skipped: true,
      simulated: true,
      reason: 'missing_github_token',
      prNumber,
      prUrl,
    };
  }
  if (!Number.isFinite(Number(prNumber))) {
    return {
      ok: false,
      skipped: true,
      simulated: true,
      reason: 'missing_pr_number',
      prNumber,
      prUrl,
    };
  }

  const prState = await fetchPullRequestMergeState({
    owner,
    repo,
    prNumber: Number(prNumber),
    token,
    fetchImpl,
  });
  if (!prState.ok) {
    return {
      ok: false,
      skipped: false,
      simulated: false,
      reason: 'pr_lookup_failed',
      status: prState.status,
      body: prState.body,
      prNumber,
      prUrl,
    };
  }
  if (prState.body?.merged) {
    return {
      ok: true,
      skipped: true,
      simulated: false,
      reason: 'already_merged',
      mergeCommitSha: prState.body?.merge_commit_sha || null,
      prNumber,
      prUrl: prState.body?.html_url || prUrl,
    };
  }
  if (prState.body?.mergeable === false) {
    return {
      ok: false,
      skipped: false,
      simulated: false,
      reason: 'not_mergeable',
      mergeableState: prState.body?.mergeable_state || null,
      prNumber,
      prUrl,
    };
  }

  const mergeUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${Number(prNumber)}/merge`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  let mergeResult;
  try {
    mergeResult = await fetchGithubJson(mergeUrl, token, {
      method: 'PUT',
      body: {
        merge_method: 'squash',
        commit_title: commitTitle,
        commit_message: commitMessage,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  if (!mergeResult.ok) {
    return {
      ok: false,
      skipped: false,
      simulated: false,
      reason: 'merge_request_failed',
      status: mergeResult.status,
      body: mergeResult.body,
      prNumber,
      prUrl,
    };
  }

  return {
    ok: true,
    skipped: false,
    simulated: false,
    reason: 'merged',
    mergeCommitSha: mergeResult.body?.sha || prState.body?.merge_commit_sha || null,
    prNumber,
    prUrl: prState.body?.html_url || prUrl,
    body: mergeResult.body,
  };
}

module.exports = {
  autoMergeEnabled,
  mergePullRequestWhenReady,
};