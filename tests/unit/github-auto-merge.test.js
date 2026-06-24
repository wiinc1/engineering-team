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
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (url.endsWith('/pulls/42')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          merged: false,
          mergeable: true,
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
    autoMerge: true,
    githubToken: 'test-token',
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'merged');
  assert.equal(result.mergeCommitSha, 'abc123merge');
  assert.equal(calls.some((call) => call.method === 'PUT'), true);
});