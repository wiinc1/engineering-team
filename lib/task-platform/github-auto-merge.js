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

function parseRepository(repository) {
  const normalized = String(repository || '').trim();
  const match = normalized.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    repository: `${match[1]}/${match[2]}`,
  };
}

function parsePullRequestUrl(prUrl) {
  const normalized = String(prUrl || '').trim();
  const match = normalized.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    repository: `${match[1]}/${match[2]}`,
    prNumber: Number(match[3]),
    prUrl: `https://github.com/${match[1]}/${match[2]}/pull/${Number(match[3])}`,
  };
}

function resolvePullRequestTarget({ repository, prNumber, prUrl }) {
  const repositoryProvided = String(repository || '').trim() !== '';
  const prUrlProvided = String(prUrl || '').trim() !== '';
  const parsedRepository = parseRepository(repository);
  const parsedPrUrl = parsePullRequestUrl(prUrl);
  if (repositoryProvided && !parsedRepository) {
    return autoMergeResponse({ reason: 'invalid_repository', repository, prNumber, prUrl });
  }
  if (prUrlProvided && !parsedPrUrl) {
    return autoMergeResponse({ reason: 'invalid_pr_url', repository, prNumber, prUrl });
  }
  if (parsedRepository && parsedPrUrl && parsedRepository.repository !== parsedPrUrl.repository) {
    return autoMergeResponse({
      reason: 'repository_pr_url_mismatch',
      repository: parsedRepository.repository,
      prNumber,
      prUrl,
    });
  }
  const targetRepository = parsedRepository || parsedPrUrl;
  if (!targetRepository) {
    return autoMergeResponse({ reason: 'missing_repository', repository, prNumber, prUrl });
  }
  const targetPrNumber = Number.isFinite(Number(prNumber)) ? Number(prNumber) : parsedPrUrl?.prNumber;
  if (!Number.isFinite(Number(targetPrNumber))) {
    return autoMergeResponse({ reason: 'missing_pr_number', repository: targetRepository.repository, prNumber, prUrl });
  }
  return {
    ok: true,
    owner: targetRepository.owner,
    repo: targetRepository.repo,
    repository: targetRepository.repository,
    prNumber: Number(targetPrNumber),
    prUrl: parsedPrUrl?.prUrl || prUrl || null,
  };
}

async function fetchGithubJson(url, token, { method = 'GET', body, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(url, {
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
  return fetchGithubJson(url, token, { fetchImpl });
}

function autoMergeResponse(base = {}) {
  return {
    ok: false,
    skipped: false,
    simulated: false,
    ...base,
  };
}

async function lookupPullRequest({ owner, repo, prNumber, prUrl, token, fetchImpl }) {
  const prState = await fetchPullRequestMergeState({
    owner,
    repo,
    prNumber: Number(prNumber),
    token,
    fetchImpl,
  });
  if (!prState.ok) {
    return autoMergeResponse({ reason: 'pr_lookup_failed', status: prState.status, body: prState.body, prNumber, prUrl });
  }
  if (prState.body?.merged) {
    return autoMergeResponse({
      ok: true,
      skipped: true,
      reason: 'already_merged',
      merged: true,
      mergeCommitSha: prState.body?.merge_commit_sha || null,
      mergedAt: prState.body?.merged_at || null,
      prNumber,
      prUrl: prState.body?.html_url || prUrl,
    });
  }
  if (prState.body?.mergeable === false) {
    return autoMergeResponse({
      reason: 'not_mergeable',
      mergeableState: prState.body?.mergeable_state || null,
      prNumber,
      prUrl,
    });
  }
  return { ok: true, prState };
}

async function requestPullRequestMerge({ owner, repo, prNumber, token, fetchImpl, commitTitle, commitMessage }) {
  const mergeUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${Number(prNumber)}/merge`;
  const mergeResult = await fetchGithubJson(mergeUrl, token, {
    fetchImpl,
    method: 'PUT',
    body: {
      merge_method: 'squash',
      commit_title: commitTitle,
      commit_message: commitMessage,
    },
  });
  return mergeResult.ok ? { ok: true, mergeResult } : { ok: false, mergeResult };
}

async function confirmPostMerge({ owner, repo, prNumber, prUrl, token, fetchImpl, prState, mergeResult }) {
  const postMergeState = await fetchPullRequestMergeState({ owner, repo, prNumber: Number(prNumber), token, fetchImpl });
  if (!postMergeState.ok) {
    return autoMergeResponse({
      reason: 'post_merge_lookup_failed', status: postMergeState.status, body: postMergeState.body,
      prNumber, prUrl: prState.body?.html_url || prUrl,
    });
  }
  if (postMergeState.body?.merged !== true) {
    return autoMergeResponse({
      reason: 'post_merge_not_confirmed', body: postMergeState.body,
      prNumber, prUrl: postMergeState.body?.html_url || prState.body?.html_url || prUrl,
    });
  }
  return autoMergeResponse({
    ok: true, reason: 'merged', merged: true,
    mergeCommitSha: postMergeState.body?.merge_commit_sha || mergeResult.body?.sha || null,
    mergedAt: postMergeState.body?.merged_at || null,
    prNumber, prUrl: postMergeState.body?.html_url || prState.body?.html_url || prUrl,
    body: mergeResult.body,
  });
}

async function mergePullRequestWhenReady(options = {}) {
  const {
    repository, prNumber, prUrl = null,
    commitTitle = 'Factory delivery auto-merge',
    commitMessage = 'Automated merge after validation gates passed.', fetchImpl = fetch,
  } = options;
  const token = resolveGithubToken(options);
  if (!autoMergeEnabled(options)) {
    return autoMergeResponse({ ok: true, skipped: true, simulated: true, reason: 'auto_merge_disabled', prNumber, prUrl });
  }
  if (!token) {
    return autoMergeResponse({ ok: true, skipped: true, simulated: true, reason: 'missing_github_token', prNumber, prUrl });
  }
  const target = resolvePullRequestTarget({ repository, prNumber, prUrl });
  if (!target.ok) return target;
  const { owner, repo } = target;
  const lookup = await lookupPullRequest({ owner, repo, prNumber: target.prNumber, prUrl: target.prUrl, token, fetchImpl });
  if (lookup.reason) return lookup;
  const request = await requestPullRequestMerge({ owner, repo, prNumber: target.prNumber, token, fetchImpl, commitTitle, commitMessage });
  if (!request.ok) {
    return autoMergeResponse({ reason: 'merge_request_failed', status: request.mergeResult.status, body: request.mergeResult.body, prNumber: target.prNumber, prUrl: target.prUrl });
  }
  return confirmPostMerge({ owner, repo, prNumber: target.prNumber, prUrl: target.prUrl, token, fetchImpl, prState: lookup.prState, mergeResult: request.mergeResult });
}

module.exports = {
  autoMergeEnabled,
  mergePullRequestWhenReady,
};
