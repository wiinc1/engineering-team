const test = require('node:test');
const assert = require('node:assert/strict');
const {
  allowMockGitHubEvidence,
  assertTrustedGitHubEvidenceSource,
  mockGitHubEvidenceEnvFailures,
} = require('../../lib/task-platform/github-evidence-source-policy');
const { assertGoldenPathRealEvidencePreflight } = require('../../lib/task-platform/golden-path-real-evidence-preflight');

const STRICT_OPTIONS = Object.freeze({
  collectRealEvidence: true,
  branchName: 'feat/autonomous-real-proof',
  implementationCommitSha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
  prUrl: 'https://github.com/wiinc1/engineering-team/pull/417',
  releaseEnv: 'staging',
  deploymentUrl: 'https://factory-staging.openclaw.app',
  rollbackTarget: 'release-previous',
});

test('strict GitHub evidence ignores mock evidence environment bypasses', () => {
  const env = { ALLOW_MOCK_GITHUB_EVIDENCE: 'true' };
  assert.equal(allowMockGitHubEvidence({}, env), false);
  assert.deepEqual(mockGitHubEvidenceEnvFailures({}, env), [
    'ALLOW_MOCK_GITHUB_EVIDENCE cannot be true in real-evidence mode',
  ]);
  assert.throws(
    () => assertTrustedGitHubEvidenceSource(STRICT_OPTIONS, env),
    /ALLOW_MOCK_GITHUB_EVIDENCE cannot be true/,
  );
});

test('real-evidence preflight rejects mock GitHub evidence env before collection', () => {
  const saved = process.env.ALLOW_MOCK_GITHUB_EVIDENCE;
  process.env.ALLOW_MOCK_GITHUB_EVIDENCE = 'true';
  try {
    assert.throws(
      () => assertGoldenPathRealEvidencePreflight(STRICT_OPTIONS, { context: 'test replay' }),
      /test replay preflight failed: ALLOW_MOCK_GITHUB_EVIDENCE cannot be true/,
    );
  } finally {
    if (saved == null) delete process.env.ALLOW_MOCK_GITHUB_EVIDENCE;
    else process.env.ALLOW_MOCK_GITHUB_EVIDENCE = saved;
  }
});

test('real-evidence preflight rejects placeholder deployment URLs', () => {
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight({
      ...STRICT_OPTIONS,
      deploymentUrl: 'https://factory.example.test',
    }, { context: 'test replay' }),
    /test replay preflight failed: hosted staging deployment URL must not use placeholder or reserved domains/,
  );
});

test('explicit mock GitHub evidence option remains a local test-only injection point', () => {
  assert.equal(allowMockGitHubEvidence({ allowMockGitHubEvidence: true }), false);
  assert.throws(() => assertTrustedGitHubEvidenceSource({
    ...STRICT_OPTIONS,
    allowMockGitHubEvidence: true,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }),
  }, {}), /test-only.*cannot bypass/);

  assert.equal(allowMockGitHubEvidence({
    allowMockGitHubEvidence: true,
    allowTestGitHubEvidenceInjection: true,
  }, { NODE_ENV: '' }), false);
  assert.equal(allowMockGitHubEvidence({
    allowMockGitHubEvidence: true,
    allowTestGitHubEvidenceInjection: true,
    env: { NODE_ENV: 'test' },
  }, { NODE_ENV: '' }), false);
  assert.equal(allowMockGitHubEvidence({
    allowMockGitHubEvidence: true,
    allowTestGitHubEvidenceInjection: true,
  }, { NODE_ENV: 'test' }), true);
  assert.throws(() => assertTrustedGitHubEvidenceSource({
    ...STRICT_OPTIONS,
    allowMockGitHubEvidence: true,
    allowTestGitHubEvidenceInjection: true,
    env: { NODE_ENV: 'test' },
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }),
  }, { NODE_ENV: '' }), /test-only.*cannot bypass/);
  assert.doesNotThrow(() => assertTrustedGitHubEvidenceSource({
    ...STRICT_OPTIONS,
    allowMockGitHubEvidence: true,
    allowTestGitHubEvidenceInjection: true,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{}' }),
  }, { NODE_ENV: 'test' }));
});
