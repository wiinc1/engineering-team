const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runGoldenPathPhase6 } = require('../../lib/task-platform/golden-path-phases');
const { assertRealPhase6AutoMerge } = require('../../lib/task-platform/golden-path-phase6-auto-merge-proof');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const MERGE_COMMIT_SHA = '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';
const BRANCH_PROTECTION = { branch: 'main', requiredChecks: ['unit tests', 'Merge readiness'], source: 'github_branch_protection' };

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function githubMergeFetchWithMissingMergedAt() {
  let pullLookupCount = 0;
  return async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/pulls/417')) {
      pullLookupCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          merged: pullLookupCount > 1,
          mergeable: true,
          merge_commit_sha: pullLookupCount > 1 ? COMMIT_SHA : null,
          merged_at: null,
          html_url: PR_URL,
        }),
      };
    }
    if (target.endsWith('/pulls/417/merge') && init.method === 'PUT') {
      return { ok: true, status: 200, text: async () => JSON.stringify({ sha: COMMIT_SHA }) };
    }
    throw new Error(`unexpected fetch ${target}`);
  };
}

function githubMergeFetch({ prUrl = PR_URL } = {}) {
  let pullLookupCount = 0;
  return async (url, init = {}) => {
    const target = String(url);
    if (target === `${DEPLOYMENT_URL}/version`) return jsonResponse({ commitSha: MERGE_COMMIT_SHA });
    if (target === DEPLOYMENT_URL) return jsonResponse({ ok: true });
    if (target.endsWith('/pulls/417')) {
      pullLookupCount += 1;
      return jsonResponse({
        merged: pullLookupCount > 1,
        mergeable: true,
        merge_commit_sha: pullLookupCount > 1 ? MERGE_COMMIT_SHA : null,
        merged_at: pullLookupCount > 1 ? '2026-07-04T12:30:00.000Z' : null,
        html_url: prUrl,
      });
    }
    if (target.endsWith('/pulls/417/merge') && init.method === 'PUT') {
      return jsonResponse({ sha: MERGE_COMMIT_SHA });
    }
    throw new Error(`unexpected fetch ${target}`);
  };
}

function writePassingPackageJson(tmp) {
  fs.writeFileSync(path.join(tmp, 'package.json'), `${JSON.stringify({
    scripts: {
      lint: 'node -e ""',
      'test:unit': 'node -e ""',
      'standards:check': 'node -e ""',
    },
  }, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeRollbackEvidence(dir) {
  const filePath = path.join(dir, 'rollback-evidence.json');
  fs.writeFileSync(filePath, `${JSON.stringify({
    environment: 'staging',
    rollback_target: 'release-previous',
    verification_status: 'verified',
    verified_at: '2026-07-05T00:00:00.000Z',
  }, null, 2)}\n`);
  return filePath;
}

function realPhase6Options(overrides = {}) {
  return {
    requireRealEvidence: true,
    releaseEnv: 'staging',
    branchName: 'factory/real-phase6',
    mergeCommitSha: COMMIT_SHA,
    prUrl: PR_URL,
    prNumber: 417,
    changeKind: 'bugfix',
    templateTier: 'Standard',
    changedFiles: ['lib/task-platform/golden-path-phases.js'],
    checks: [
      { name: 'unit tests', status: 'completed', conclusion: 'success', source: 'github_check_run' },
      { name: 'Merge readiness', status: 'completed', conclusion: 'success', source: 'github_check_run' },
    ],
    requiredChecks: ['unit tests', 'Merge readiness'],
    branchProtection: BRANCH_PROTECTION,
    mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
    releaseEvidenceValidator: () => ({ ok: true, stdout: 'PASS release evidence' }),
    ...overrides,
  };
}

function mergedPhase5Evidence() {
  return {
    status: 'phase5_complete',
    phase5: { api: { sreMonitoring: { approve: { ok: true } } } },
    github: {
      repository: 'wiinc1/engineering-team',
      branchName: 'factory/real-phase6',
      commitSha: COMMIT_SHA,
      prUrl: PR_URL,
      prNumber: 417,
      checks: [
        { name: 'build', status: 'completed', conclusion: 'success', source: 'github_check_run' },
        { name: 'unit tests', status: 'completed', conclusion: 'success', source: 'github_check_run' },
        { name: 'Merge readiness', status: 'completed', conclusion: 'success', source: 'github_check_run' },
      ],
      requiredChecks: ['unit tests', 'Merge readiness'],
      branchProtection: BRANCH_PROTECTION,
      mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
    },
    change: { changedFiles: ['lib/task-platform/golden-path-phases.js'] },
  };
}

function phase6RefreshOptions(tmp, artifactDir, overrides = {}) {
  return realPhase6Options({
    autoMerge: true,
    githubToken: 'test-token',
    mergeCommitSha: '',
    implementationCommitSha: COMMIT_SHA,
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    rollbackEvidence: writeRollbackEvidence(tmp),
    healthCheckPath: '/version',
    requireHealthCommit: true,
    releaseArtifactDir: artifactDir,
    cwd: tmp,
    outputPath: path.join(tmp, 'evidence.json'),
    closeoutDir: path.join(tmp, 'closeout'),
    releaseEvidenceBuilder: () => ({ ok: true, stdout: 'PASS release evidence' }),
    ...overrides,
  });
}

test('real-evidence phase 6 rejects disabled auto-merge simulation', async () => {
  await assert.rejects(
    () => runGoldenPathPhase6(
      { baseUrl: 'https://api.example.com', fetchImpl: async () => { throw new Error('unexpected fetch'); } },
      { status: 'phase5_complete' },
      realPhase6Options({ autoMerge: false }),
    ),
    /real-evidence auto-merge cannot be simulated: auto_merge_disabled/,
  );
});

test('real-evidence phase 6 rejects missing PR target before auto-merge attempt', async () => {
  await assert.rejects(
    () => runGoldenPathPhase6(
      { baseUrl: 'https://api.example.com', fetchImpl: async () => { throw new Error('unexpected fetch'); } },
      { status: 'phase5_complete' },
      realPhase6Options({
        autoMerge: true,
        githubToken: 'test-token',
        prUrl: '',
        prNumber: undefined,
      }),
    ),
    /actual pull request URL is required.*actual pull request number is required/,
  );
});

test('real-evidence phase 6 direct calls reject skipped validation and SRE waivers', async () => {
  await assert.rejects(
    () => runGoldenPathPhase6(
      { baseUrl: 'https://api.example.com', fetchImpl: async () => { throw new Error('unexpected fetch'); } },
      { status: 'phase5_complete' },
      realPhase6Options({
        autoMerge: true,
        githubToken: 'test-token',
        skipValidation: true,
        allowSreWaiver: true,
      }),
    ),
    /Autonomous golden-path real evidence mode cannot use skip validation or SRE waiver/,
  );
});

test('real-evidence auto-merge proof rejects skipped merge results', () => {
  assert.throws(
    () => assertRealPhase6AutoMerge({ skipped: true, simulated: false, reason: 'missing_pr_target' }),
    /auto-merge cannot be skipped: missing_pr_target/,
  );
});

test('real-evidence phase 6 refreshes release artifacts to the GitHub merge commit', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase6-real-merge-'));
  const artifactDir = path.join(tmp, 'release-artifacts');
  writePassingPackageJson(tmp);

  const result = await runGoldenPathPhase6(
    { baseUrl: 'https://api.factory.openclaw.app', fetchImpl: githubMergeFetch() },
    mergedPhase5Evidence(),
    phase6RefreshOptions(tmp, artifactDir),
  );

  assert.equal(result.api.mergeCommitSha, MERGE_COMMIT_SHA);
  assert.equal(result.api.releaseEvidence.validation.ok, true);
  assert.equal(readJson(result.api.releaseEvidence.artifacts.deploy).deployed_sha, MERGE_COMMIT_SHA);
  assert.equal(readJson(result.api.releaseEvidence.artifacts.health).checked_sha, MERGE_COMMIT_SHA);
  assert.equal(readJson(result.api.releaseEvidence.artifacts.build).commit_sha, MERGE_COMMIT_SHA);
  assert.equal(readJson(result.api.releaseEvidence.artifacts.immutable).commit_sha, MERGE_COMMIT_SHA);
});

test('real-evidence phase 6 derives the GitHub repository from PR evidence', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase6-real-repo-'));
  const artifactDir = path.join(tmp, 'release-artifacts');
  const prUrl = 'https://github.com/acme/widgets/pull/417';
  const evidence = mergedPhase5Evidence();
  const calls = [];
  const githubFetch = githubMergeFetch({ prUrl });
  writePassingPackageJson(tmp);
  evidence.github = { ...evidence.github, repository: 'acme/widgets', prUrl };

  const result = await runGoldenPathPhase6(
    {
      baseUrl: 'https://api.factory.openclaw.app',
      fetchImpl: async (url, init) => {
        calls.push(String(url));
        return githubFetch(url, init);
      },
    },
    evidence,
    phase6RefreshOptions(tmp, artifactDir, { prUrl }),
  );

  assert.ok(calls.includes('https://api.github.com/repos/acme/widgets/pulls/417'));
  assert.ok(calls.includes('https://api.github.com/repos/acme/widgets/pulls/417/merge'));
  assert.equal(result.api.repository, 'acme/widgets');
});

test('real-evidence phase 6 rejects missing-token auto-merge simulation', async () => {
  const savedGithubToken = process.env.GITHUB_TOKEN;
  const savedGhToken = process.env.GH_TOKEN;
  try {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    await assert.rejects(
      () => runGoldenPathPhase6(
        { baseUrl: 'https://api.example.com', fetchImpl: async () => { throw new Error('unexpected fetch'); } },
        { status: 'phase5_complete' },
        realPhase6Options({ autoMerge: true, githubToken: null }),
      ),
      /real-evidence auto-merge cannot be simulated: missing_github_token/,
    );
  } finally {
    if (savedGithubToken == null) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = savedGithubToken;
    if (savedGhToken == null) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = savedGhToken;
  }
});

test('real-evidence phase 6 rejects incomplete confirmed auto-merge proof', async () => {
  await assert.rejects(
    () => runGoldenPathPhase6(
      { baseUrl: 'https://api.example.com', fetchImpl: githubMergeFetchWithMissingMergedAt() },
      { status: 'phase5_complete' },
      realPhase6Options({ autoMerge: true, githubToken: 'test-token' }),
    ),
    /auto-merge proof is incomplete: mergedAt timestamp is required/,
  );
});
