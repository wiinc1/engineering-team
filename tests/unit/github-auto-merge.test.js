const test = require('node:test');
const assert = require('node:assert/strict');
const { autoMergeEnabled, mergePullRequestWhenReady } = require('../../lib/task-platform/github-auto-merge');

test('autoMergeEnabled defaults false without env flag', () => {
  assert.equal(autoMergeEnabled({}), false);
  assert.equal(autoMergeEnabled({ autoMerge: true }), true);
});

test('mergePullRequestWhenReady simulates when auto-merge disabled', async () => {
  const result = await mergePullRequestWhenReady({
    prNumber: 271,
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/271',
    autoMerge: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.simulated, true);
  assert.equal(result.reason, 'auto_merge_disabled');
});

test('mergePullRequestWhenReady merges when PR is mergeable', async () => {
  const calls = [];
  let prLookupCount = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (url.endsWith('/pulls/42')) {
      prLookupCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          merged: prLookupCount > 1,
          mergeable: true,
          merge_commit_sha: prLookupCount > 1 ? 'abc123merge' : null,
          merged_at: prLookupCount > 1 ? '2026-07-04T12:30:00.000Z' : null,
          html_url: 'https://github.com/wiinc1/engineering-team/pull/42',
        }),
      };
    }
    if (url.endsWith('/pulls/42/merge')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ sha: 'abc123merge' }),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await mergePullRequestWhenReady({
    prNumber: 42,
    repository: 'wiinc1/engineering-team',
    autoMerge: true,
    githubToken: 'test-token',
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'merged');
  assert.equal(result.merged, true);
  assert.equal(result.mergeCommitSha, 'abc123merge');
  assert.equal(result.mergedAt, '2026-07-04T12:30:00.000Z');
  assert.equal(calls.some((call) => call.method === 'PUT'), true);
  assert.equal(calls.filter((call) => call.url.endsWith('/pulls/42')).length, 2);
});

test('mergePullRequestWhenReady uses injected fetch without mutating global fetch', async () => {
  const originalFetch = globalThis.fetch;
  let prLookupCount = 0;
  const fetchImpl = async (url, init = {}) => {
    assert.equal(globalThis.fetch, originalFetch);
    if (url.endsWith('/pulls/43')) {
      prLookupCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          merged: prLookupCount > 1,
          mergeable: true,
          merge_commit_sha: prLookupCount > 1 ? 'def456merge' : null,
          merged_at: prLookupCount > 1 ? '2026-07-04T12:45:00.000Z' : null,
          html_url: 'https://github.com/wiinc1/engineering-team/pull/43',
        }),
      };
    }
    if (url.endsWith('/pulls/43/merge')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ sha: 'def456merge' }),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await mergePullRequestWhenReady({
    prNumber: 43,
    repository: 'wiinc1/engineering-team',
    autoMerge: true,
    githubToken: 'test-token',
    fetchImpl,
  });

  assert.equal(globalThis.fetch, originalFetch);
  assert.equal(result.ok, true);
  assert.equal(result.mergeCommitSha, 'def456merge');
});

test('mergePullRequestWhenReady refuses enabled auto-merge without repository identity', async () => {
  const result = await mergePullRequestWhenReady({
    prNumber: 44,
    autoMerge: true,
    githubToken: 'test-token',
    fetchImpl: async () => { throw new Error('unexpected fetch'); },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_repository');
});

test('mergePullRequestWhenReady derives repository and PR number from GitHub PR URL', async () => {
  const calls = [];
  let prLookupCount = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (url.endsWith('/pulls/45')) {
      prLookupCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          merged: prLookupCount > 1,
          mergeable: true,
          merge_commit_sha: prLookupCount > 1 ? 'ghi789merge' : null,
          merged_at: prLookupCount > 1 ? '2026-07-04T13:00:00.000Z' : null,
          html_url: 'https://github.com/acme/widgets/pull/45',
        }),
      };
    }
    if (url.endsWith('/pulls/45/merge')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ sha: 'ghi789merge' }),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await mergePullRequestWhenReady({
    prUrl: 'https://github.com/acme/widgets/pull/45',
    autoMerge: true,
    githubToken: 'test-token',
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mergeCommitSha, 'ghi789merge');
  assert.equal(calls[0].url, 'https://api.github.com/repos/acme/widgets/pulls/45');
});

test('mergePullRequestWhenReady rejects repository and PR URL mismatch', async () => {
  const result = await mergePullRequestWhenReady({
    repository: 'wiinc1/engineering-team',
    prUrl: 'https://github.com/acme/widgets/pull/46',
    autoMerge: true,
    githubToken: 'test-token',
    fetchImpl: async () => { throw new Error('unexpected fetch'); },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'repository_pr_url_mismatch');
});
