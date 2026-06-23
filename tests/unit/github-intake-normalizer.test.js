const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGithubIssueIntakeIdempotencyKey,
  buildRawRequirementsFromIssue,
  isFactoryIntakeIssue,
  normalizeIssueIntakeBody,
  resolveIntakeTenantForRepository,
} = require('../../lib/audit/github-intake-normalizer');

test('buildGithubIssueIntakeIdempotencyKey is stable per repository and issue number', () => {
  assert.equal(
    buildGithubIssueIntakeIdempotencyKey('wiinc1/engineering-team', 272),
    'github-issue-intake:wiinc1/engineering-team:272',
  );
});

test('isFactoryIntakeIssue requires the opt-in label', () => {
  const payload = {
    issue: {
      labels: [{ name: 'factory-intake' }, { name: 'enhancement' }],
    },
  };
  assert.equal(isFactoryIntakeIssue(payload), true);
  assert.equal(isFactoryIntakeIssue({ issue: { labels: [{ name: 'enhancement' }] } }), false);
});

test('buildRawRequirementsFromIssue falls back when body is empty', () => {
  const text = buildRawRequirementsFromIssue(
    { title: 'Pilot', html_url: 'https://github.com/wiinc1/engineering-team/issues/9' },
    'wiinc1/engineering-team',
    9,
  );
  assert.match(text, /GitHub issue intake \(body empty\)/);
  assert.match(text, /Pilot/);
});

test('normalizeIssueIntakeBody maps issue fields and idempotency key', () => {
  const body = normalizeIssueIntakeBody({
    repository: { full_name: 'wiinc1/engineering-team' },
    issue: {
      number: 42,
      title: 'Factory intake task',
      body: 'Acceptance criteria here.',
      html_url: 'https://github.com/wiinc1/engineering-team/issues/42',
    },
  });
  assert.equal(body.rawRequirements, 'Acceptance criteria here.');
  assert.equal(body.githubIssueUrl, 'https://github.com/wiinc1/engineering-team/issues/42');
  assert.equal(body.idempotencyKey, 'github-issue-intake:wiinc1/engineering-team:42');
});

test('resolveIntakeTenantForRepository uses repo map then default tenant', () => {
  assert.equal(
    resolveIntakeTenantForRepository('wiinc1/engineering-team', {
      githubIntakeRepoTenantMap: '{"wiinc1/engineering-team":"engineering-team"}',
    }),
    'engineering-team',
  );
  assert.equal(
    resolveIntakeTenantForRepository('other/repo', { githubIntakeDefaultTenant: 'tenant-default' }),
    'tenant-default',
  );
});