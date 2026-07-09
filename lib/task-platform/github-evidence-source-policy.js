const { DEFAULT_GITHUB_API_BASE_URL } = require('./github-evidence-client');

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function normalizeUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function isStrictGitHubEvidence(options = {}, env = process.env) {
  return options.requireRealEvidence === true
    || options.collectRealEvidence === true
    || options.agentDrivenPhases === true
    || parseBooleanEnv(env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE, false)
    || parseBooleanEnv(env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE, false);
}

function isTestEvidenceInjectionEnvironment(options = {}, env = process.env) {
  const value = env.NODE_ENV;
  return String(value || '').trim().toLowerCase() === 'test';
}

function allowMockGitHubEvidence(options = {}, env = process.env) {
  return options.allowMockGitHubEvidence === true
    && options.allowTestGitHubEvidenceInjection === true
    && isTestEvidenceInjectionEnvironment(options, env);
}

function mockGitHubEvidenceEnvFailures(options = {}, env = process.env) {
  const value = env.ALLOW_MOCK_GITHUB_EVIDENCE;
  return parseBooleanEnv(value, false)
    ? ['ALLOW_MOCK_GITHUB_EVIDENCE cannot be true in real-evidence mode']
    : [];
}

function githubApiBaseUrlFailures(options = {}, env = process.env) {
  const value = options.githubApiBaseUrl || env.GITHUB_API_BASE_URL || '';
  if (!value) return [];
  return normalizeUrl(value) === DEFAULT_GITHUB_API_BASE_URL
    ? []
    : ['GitHub evidence API base must be https://api.github.com'];
}

function assertTrustedGitHubEvidenceSource(options = {}, env = process.env) {
  if (!isStrictGitHubEvidence(options, env)) return;
  const envFailures = mockGitHubEvidenceEnvFailures(options, env);
  if (envFailures.length) throw new Error(envFailures.join('; '));
  if (options.allowMockGitHubEvidence === true && !allowMockGitHubEvidence(options, env)) {
    throw new Error('allowMockGitHubEvidence is test-only and cannot bypass strict real GitHub evidence');
  }
  if (allowMockGitHubEvidence(options, env)) return;
  const failures = githubApiBaseUrlFailures(options, env);
  if (failures.length) throw new Error(`Strict golden-path real evidence collection requires GitHub API base ${DEFAULT_GITHUB_API_BASE_URL}`);
  if (options.fetchImpl && options.fetchImpl !== globalThis.fetch) {
    throw new Error('Strict golden-path real evidence collection cannot use an injected fetch implementation');
  }
}

module.exports = {
  allowMockGitHubEvidence,
  assertTrustedGitHubEvidenceSource,
  githubApiBaseUrlFailures,
  isStrictGitHubEvidence,
  isTestEvidenceInjectionEnvironment,
  mockGitHubEvidenceEnvFailures,
};
