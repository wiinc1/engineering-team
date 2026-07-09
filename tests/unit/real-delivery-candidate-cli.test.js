const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  CANDIDATE_REPORT_SCHEMA_VERSION,
  buildCandidateOptions,
  collectGithubEvidenceOption,
  resolveCandidateOptions,
  shouldPrintHelp,
  usageText,
} = require('../../scripts/verify-real-delivery-candidate');
const {
  REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION,
} = require('../../lib/task-platform/real-delivery-candidate-proof');

const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/418';
const COMMIT_SHA = '1234567890abcdef1234567890abcdef12345678';

test('real delivery candidate CLI prints help without running proof validation', () => {
  assert.equal(shouldPrintHelp(['node', 'script', '--help']), true);
  assert.match(usageText(), /--collect-github-evidence/);
  assert.match(usageText(), /--require-final-release-proof/);
  assert.match(usageText(), /observability\/real-delivery-candidate-proof\.json/);

  const result = spawnSync(process.execPath, ['scripts/verify-real-delivery-candidate.js', '--help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node scripts\/verify-real-delivery-candidate\.js/);
  assert.match(result.stdout, /--verify-deployment-health/);
  assert.equal(result.stderr, '');
});

test('real delivery candidate CLI can emit a redacted JSON verification report', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-candidate-report-'));
  const reportPath = path.join(tmp, 'candidate-report.json');
  const result = spawnSync(process.execPath, [
    'scripts/verify-real-delivery-candidate.js',
    '--json',
    '--report',
    reportPath,
    '--skip-source-integrity',
    '--branch',
    'main',
    '--implementation-commit-sha',
    COMMIT_SHA,
    '--pr-url',
    PR_URL,
    '--release-env',
    'staging',
    '--deployment-url',
    'https://factory-staging.openclaw.app',
    '--rollback-target',
    'release-previous',
    '--github-token',
    'super-secret-token',
    '--changed-file',
    'docs/runbook.md',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_TOKEN: '',
      GH_TOKEN: '',
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.stdout, /super-secret-token/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, CANDIDATE_REPORT_SCHEMA_VERSION);
  assert.equal(report.ok, false);
  assert.equal(report.releaseEnv, 'staging');
  assert.equal(report.inputs.hasGithubToken, true);
  assert.equal(report.inputs.githubToken, undefined);
  assert.equal(report.proof.schemaVersion, REAL_DELIVERY_CANDIDATE_PROOF_SCHEMA_VERSION);
  assert.match(report.failures.join('\n'), /candidate branch must not be main/);
  assert.match(report.failures.join('\n'), /candidate must include at least one implementation code file/);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), report);
});

test('real delivery candidate JSON report preserves inputs when CLI validation fails early', () => {
  const result = spawnSync(process.execPath, [
    'scripts/verify-real-delivery-candidate.js',
    '--json',
    '--require-final-release-proof',
    '--branch',
    'feat/real-proof',
    '--implementation-commit-sha',
    COMMIT_SHA,
    '--pr-url',
    PR_URL,
    '--release-env',
    'staging',
    '--deployment-url',
    'https://factory-staging.openclaw.app',
    '--github-token',
    'super-secret-token',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_TOKEN: '',
      GH_TOKEN: '',
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.stdout, /super-secret-token/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, CANDIDATE_REPORT_SCHEMA_VERSION);
  assert.equal(report.proof, null);
  assert.equal(report.prUrl, PR_URL);
  assert.equal(report.releaseEnv, 'staging');
  assert.equal(report.inputs.hasGithubToken, true);
  assert.equal(report.inputs.collectGithubEvidence, false);
  assert.equal(report.inputs.requireFinalReleaseProof, true);
  assert.match(report.failures.join('\n'), /must collect GitHub evidence/);
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function githubFetchMock(url) {
  const target = String(url);
  if (target.includes('/branches/main/protection')) {
    return jsonResponse({ required_status_checks: { checks: [{ context: 'unit tests' }, { context: 'Merge readiness' }] } });
  }
  if (target.includes('/pulls/418/files')) {
    return jsonResponse([
      { filename: 'lib/task-platform/real-delivery-candidate.js' },
      { filename: 'tests/unit/real-delivery-candidate.test.js' },
    ]);
  }
  if (target.includes('/pulls/418')) {
    return jsonResponse({
      number: 418,
      html_url: PR_URL,
      head: { ref: 'feat/real-proof', sha: COMMIT_SHA },
      base: { ref: 'main' },
      merged: false,
      merge_commit_sha: null,
      merged_at: null,
    });
  }
  if (target.includes('/check-runs')) {
    return jsonResponse({
      check_runs: [
        { id: 1, name: 'unit tests', status: 'completed', conclusion: 'success', html_url: 'https://github.example/unit' },
        { id: 2, name: 'Merge readiness', status: 'completed', conclusion: 'success', html_url: 'https://github.example/merge' },
      ],
    });
  }
  if (target.includes('/status')) return jsonResponse({ statuses: [] });
  throw new Error(`unexpected fetch ${target}`);
}

function writePrDiscoveryReport(filePath, overrides = {}) {
  const { target: targetOverrides = {}, ...reportOverrides } = overrides;
  const report = {
    schemaVersion: 'real-delivery-pr-target-discovery.v1',
    ok: true,
    failureCount: 0,
    failures: [],
    inputs: {
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/real-proof',
      implementationCommitSha: COMMIT_SHA,
      hasGithubToken: true,
    },
    target: {
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/real-proof',
      implementationCommitSha: COMMIT_SHA,
      prNumber: 418,
      prUrl: PR_URL,
      source: {
        provider: 'github',
        apiBaseUrl: 'https://api.github.com',
        collectedAt: '2026-07-05T00:00:00.000Z',
      },
      ...targetOverrides,
    },
    ...reportOverrides,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

test('real delivery candidate CLI cannot skip source integrity for final proof', () => {
  assert.throws(
    () => buildCandidateOptions(process.cwd(), [], [], [
      'node',
      'scripts/verify-real-delivery-candidate.js',
      '--require-final-release-proof',
      '--skip-source-integrity',
    ], {}),
    /final real delivery candidate proof cannot skip source integrity/,
  );
});

test('real delivery candidate CLI accepts rollback evidence path', () => {
  const options = buildCandidateOptions(process.cwd(), [], [], [
    'node',
    'scripts/verify-real-delivery-candidate.js',
    '--require-final-release-proof',
    '--collect-github-evidence',
    '--rollback-evidence',
    'observability/release/rollback-verification.json',
    '--production-safety-evidence',
    'observability/release/production-safety.json',
  ], {});

  assert.equal(options.rollbackEvidence, 'observability/release/rollback-verification.json');
  assert.equal(options.productionSafetyEvidence, 'observability/release/production-safety.json');
});

test('real delivery candidate CLI accepts repository for PR-number GitHub evidence collection', () => {
  const options = buildCandidateOptions(process.cwd(), [], [], [
    'node',
    'scripts/verify-real-delivery-candidate.js',
    '--require-final-release-proof',
    '--collect-github-evidence',
    '--repository',
    'wiinc1/engineering-team',
    '--pr-number',
    '418',
  ], {});

  assert.equal(options.repository, 'wiinc1/engineering-team');
  assert.equal(options.prNumber, 418);
});

test('real delivery candidate CLI hydrates PR identity from a discovery report', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-candidate-pr-report-'));
  const reportPath = path.join(tmp, 'pr-discovery.json');
  writePrDiscoveryReport(reportPath);

  const options = buildCandidateOptions(process.cwd(), [], [], [
    'node',
    'scripts/verify-real-delivery-candidate.js',
    '--collect-github-evidence',
    '--use-pr-discovery-report',
    '--pr-discovery-report',
    reportPath,
    '--branch',
    'feat/real-proof',
    '--implementation-commit-sha',
    COMMIT_SHA,
  ], {});

  assert.equal(options.prUrl, PR_URL);
  assert.equal(options.prNumber, 418);
  assert.equal(options.branch, 'feat/real-proof');
  assert.equal(options.repository, 'wiinc1/engineering-team');
  assert.equal(options.implementationCommitSha, COMMIT_SHA);
});

test('real delivery candidate CLI accepts diagnostic GitHub proof JSON payloads', () => {
  const checks = [{ name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' }];
  const requiredChecks = ['Merge readiness'];
  const branchProtection = {
    branch: 'main',
    requiredChecks,
    source: 'github_branch_protection',
  };
  const mergeReadiness = { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' };
  const source = { provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-05T00:00:00.000Z' };
  const options = buildCandidateOptions(process.cwd(), [], [], [
    'node',
    'scripts/verify-real-delivery-candidate.js',
    '--checks-json',
    JSON.stringify(checks),
    '--required-checks-json',
    JSON.stringify(requiredChecks),
    '--branch-protection-json',
    JSON.stringify(branchProtection),
    '--merge-readiness-json',
    JSON.stringify(mergeReadiness),
    '--github-evidence-source-json',
    JSON.stringify(source),
  ], {});

  assert.deepEqual(options.checks, checks);
  assert.deepEqual(options.requiredChecks, requiredChecks);
  assert.deepEqual(options.branchProtection, branchProtection);
  assert.deepEqual(options.mergeReadiness, mergeReadiness);
  assert.deepEqual(options.githubEvidenceSource, source);
});

test('real delivery candidate CLI requires collected GitHub evidence for final proof', () => {
  assert.throws(
    () => buildCandidateOptions(process.cwd(), [], [], [
      'node',
      'scripts/verify-real-delivery-candidate.js',
      '--require-final-release-proof',
      '--checks-json',
      JSON.stringify([{ name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' }]),
      '--github-evidence-source-json',
      JSON.stringify({ provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-05T00:00:00.000Z' }),
    ], {}),
    /final real delivery candidate proof must collect GitHub evidence with --collect-github-evidence/,
  );
});

test('real delivery candidate CLI enables GitHub evidence collection from flag or env', () => {
  assert.equal(collectGithubEvidenceOption(['node', 'script', '--collect-github-evidence'], {}), true);
  assert.equal(collectGithubEvidenceOption(['node', 'script'], { REAL_DELIVERY_COLLECT_GITHUB_EVIDENCE: 'true' }), true);
  assert.equal(collectGithubEvidenceOption(['node', 'script'], {}), false);
});

test('real delivery candidate CLI hydrates candidate options from GitHub PR evidence', async () => {
  const options = await resolveCandidateOptions({
    collectGithubEvidence: true,
    allowMockGitHubEvidence: true,
    allowTestGitHubEvidenceInjection: true,
    env: { NODE_ENV: 'test' },
    prUrl: PR_URL,
    fetchImpl: githubFetchMock,
  });

  assert.equal(options.branch, 'feat/real-proof');
  assert.equal(options.repository, 'wiinc1/engineering-team');
  assert.equal(options.implementationCommitSha, COMMIT_SHA);
  assert.equal(options.prNumber, 418);
  assert.deepEqual(options.changedFiles, [
    'lib/task-platform/real-delivery-candidate.js',
    'tests/unit/real-delivery-candidate.test.js',
  ]);
  assert.deepEqual(options.requiredChecks, ['unit tests', 'Merge readiness']);
  assert.equal(options.branchProtection.source, 'github_branch_protection');
  assert.equal(options.mergeReadiness.reviewStatus, 'passed');
  assert.equal(options.githubEvidenceSource.provider, 'github');
  assert.equal(options.githubEvidenceSource.apiBaseUrl, 'https://api.github.com');
});
