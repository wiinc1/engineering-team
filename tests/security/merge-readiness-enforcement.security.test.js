const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGitHubCheckRunClient,
} = require('../../lib/task-platform/merge-readiness-github-check');
const {
  createGitHubBranchProtectionClient,
} = require('../../lib/task-platform/merge-readiness-branch-protection');
const {
  renderMergeReadinessPrSummary,
} = require('../../lib/task-platform/merge-readiness-pr-summary');

test('merge-readiness GitHub clients fail closed when tokens are missing', () => {
  const token = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    assert.throws(() => createGitHubCheckRunClient({ fetch: async () => ({ ok: true }) }), /GITHUB_TOKEN is required/);
    assert.throws(() => createGitHubBranchProtectionClient({ fetch: async () => ({ ok: true }) }), /GITHUB_TOKEN is required/);
  } finally {
    if (token === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = token;
  }
});

test('merge-readiness PR summaries do not leak raw logs or token-like evidence fields', () => {
  const summary = renderMergeReadinessPrSummary({
    reviewId: 'MRR-SEC-212',
    reviewStatus: 'blocked',
    commitSha: 'abc2120',
    reviewedLogSources: [{
      name: 'Repo validation',
      url: 'https://github.example/checks/212',
      rawLog: 'ghp_exampleSecretTokenValue1234567890',
    }],
    findings: [{ id: 'MRR-BLOCK', severity: 'blocker', summary: 'Evidence is inaccessible.' }],
    metadata: { token: 'ghp_exampleSecretTokenValue1234567890' },
  });

  assert.match(summary, /Structured MergeReadinessReview/);
  assert.doesNotMatch(summary, /ghp_exampleSecretTokenValue/);
  assert.doesNotMatch(summary, /rawLog/);
  assert.doesNotMatch(summary, /token/);
});
