const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGithubIssueProjectIdempotencyKey,
  buildProjectName,
  isProjectBootstrapIssue,
  metadataMatchesGithubIssue,
} = require('../../lib/audit/github-intake-project-bootstrap');

test('isProjectBootstrapIssue accepts factory-intake and golden-path labels', () => {
  assert.equal(isProjectBootstrapIssue({ issue: { labels: [{ name: 'factory-intake' }] } }), true);
  assert.equal(isProjectBootstrapIssue({ issue: { labels: [{ name: 'golden-path' }] } }), true);
  assert.equal(isProjectBootstrapIssue({ issue: { labels: [{ name: 'enhancement' }] } }), false);
});

test('buildGithubIssueProjectIdempotencyKey is stable per repository and issue number', () => {
  assert.equal(
    buildGithubIssueProjectIdempotencyKey('wiinc1/engineering-team', 42),
    'github-issue-project:wiinc1/engineering-team:42',
  );
});

test('buildProjectName prefers issue title when present', () => {
  assert.match(buildProjectName(42, 'Pilot intake'), /Pilot intake/);
  assert.match(buildProjectName(42), /Issue 42/);
});

test('metadataMatchesGithubIssue matches canonical metadata fields', () => {
  const url = 'https://github.com/wiinc1/engineering-team/issues/42';
  assert.equal(metadataMatchesGithubIssue({ metadata: { githubIssueUrl: url } }, url), true);
  assert.equal(metadataMatchesGithubIssue({ metadata: { github_issue_url: url } }, url), true);
  assert.equal(metadataMatchesGithubIssue({ metadata: {} }, url), false);
});