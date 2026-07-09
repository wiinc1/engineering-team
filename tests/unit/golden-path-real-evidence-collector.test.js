const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  collectGitHubPullRequestEvidence,
  parseGitHubPullRequestUrl,
  prepareGoldenPathRealEvidence,
  shouldCollectGoldenPathRealEvidence,
} = require('../../lib/task-platform/golden-path-real-evidence-collector');

const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';

function git(cwd, args) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function createReleaseWorkspace(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  git(repoRoot, ['init']);
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'release evidence proof\n');
  git(repoRoot, ['add', 'README.md']);
  git(repoRoot, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'init']);
  return {
    tmp,
    repoRoot,
    commitSha: git(repoRoot, ['rev-parse', 'HEAD']),
    releaseArtifactDir: path.join(tmp, 'release-artifacts'),
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function githubFetchMock({
  healthy = true,
  includeSecurityChecks = true,
  includeTestCheck = true,
  includeMergeReadiness = true,
  merged = false,
  headSha = COMMIT_SHA,
  mergeCommitSha = '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210',
  requiredChecks = ['build', 'unit tests', 'Merge readiness', 'Secret scan', 'Dependency vulnerability scan'],
} = {}) {
  return async (url) => {
    const target = String(url);
    if (target === `${DEPLOYMENT_URL}/version`) {
      return jsonResponse({ commitSha: merged ? mergeCommitSha : headSha }, healthy ? 200 : 503);
    }
    if (target === DEPLOYMENT_URL) return jsonResponse({ ok: healthy }, healthy ? 200 : 503);
    if (target.includes('/branches/main/protection')) {
      return jsonResponse({ required_status_checks: { checks: requiredChecks.map((context) => ({ context })) } });
    }
    if (target.includes('/pulls/417/files')) {
      return jsonResponse([{ filename: 'lib/task-platform/factory-delivery.js' }]);
    }
    if (target.includes('/pulls/417')) {
      return jsonResponse({
        number: 417,
        html_url: PR_URL,
        head: { ref: 'feat/autonomous-real-proof', sha: headSha },
        base: { ref: 'main' },
        merged,
        merge_commit_sha: mergeCommitSha,
        merged_at: merged ? '2026-07-04T12:30:00.000Z' : null,
      });
    }
    if (target.includes('/check-runs')) {
      const securityChecks = includeSecurityChecks ? [checkRun('Secret scan', 'completed', 'success'), checkRun('Dependency vulnerability scan', 'completed', 'success')] : [];
      const testChecks = includeTestCheck ? [checkRun('unit tests', 'completed', 'success')] : [];
      const mergeReadinessChecks = includeMergeReadiness ? [checkRun('Merge readiness', 'completed', 'success')] : [];
      return jsonResponse({
        check_runs: [
          checkRun('build', 'completed', 'success'),
          ...testChecks,
          ...mergeReadinessChecks,
          ...securityChecks,
        ],
      });
    }
    if (target.includes('/status')) return jsonResponse({ statuses: [] });
    throw new Error(`unexpected fetch ${target}`);
  };
}

function checkRun(name, status, conclusion) {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    status,
    conclusion,
    html_url: `https://github.example/checks/${encodeURIComponent(name)}`,
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeRollbackEvidence(dir, overrides = {}) {
  const filePath = path.join(dir, 'rollback-evidence.json');
  fs.writeFileSync(filePath, `${JSON.stringify({
    environment: 'staging',
    rollback_target: 'release-previous',
    verification_status: 'verified',
    verified_at: '2026-07-05T00:00:00.000Z',
    ...overrides,
  }, null, 2)}\n`);
  return filePath;
}

function paginatedGithubFetchMock() {
  return async (url) => {
    const target = String(url);
    if (target.includes('/pulls/417/files') && target.endsWith('page=1')) {
      return jsonResponse(Array.from({ length: 100 }, (_, index) => ({ filename: `tests/fixtures/page-one-${index}.js` })));
    }
    if (target.includes('/pulls/417/files') && target.endsWith('page=2')) {
      return jsonResponse([{ filename: 'lib/task-platform/paginated-proof.js' }]);
    }
    if (target.includes('/pulls/417')) {
      return jsonResponse({
        number: 417,
        html_url: PR_URL,
        head: { ref: 'feat/autonomous-real-proof', sha: COMMIT_SHA },
        base: { ref: 'main' },
      });
    }
    if (target.includes('/branches/main/protection')) {
      return jsonResponse({ required_status_checks: { checks: [{ context: 'unit tests' }, { context: 'Merge readiness' }] } });
    }
    if (target.includes('/check-runs') && target.endsWith('page=1')) {
      return jsonResponse({ check_runs: Array.from({ length: 100 }, (_, index) => checkRun(`lint shard ${index}`, 'completed', 'success')) });
    }
    if (target.includes('/check-runs') && target.endsWith('page=2')) {
      return jsonResponse({ check_runs: [checkRun('Merge readiness', 'completed', 'success'), checkRun('unit tests', 'completed', 'success')] });
    }
    if (target.includes('/status')) return jsonResponse({ statuses: [] });
    throw new Error(`unexpected fetch ${target}`);
  };
}

test('parseGitHubPullRequestUrl extracts repository and PR number', () => {
  assert.deepEqual(parseGitHubPullRequestUrl(`${PR_URL}?foo=bar`), {
    owner: 'wiinc1',
    repo: 'engineering-team',
    repository: 'wiinc1/engineering-team',
    prNumber: 417,
    prUrl: PR_URL,
  });
  assert.equal(parseGitHubPullRequestUrl('https://github.com/wiinc1/engineering-team/issues/417'), null);
});

test('collectGitHubPullRequestEvidence fetches PR head, changed files, checks, and Merge readiness', async () => {
  const proof = await collectGitHubPullRequestEvidence({
    prUrl: PR_URL,
    fetchImpl: githubFetchMock(),
  });

  assert.equal(proof.branchName, 'feat/autonomous-real-proof');
  assert.equal(proof.commitSha, COMMIT_SHA);
  assert.equal(proof.merged, false);
  assert.equal(proof.mergeCommitSha, null);
  assert.deepEqual(proof.changedFiles, ['lib/task-platform/factory-delivery.js']);
  assert.equal(proof.mergeReadiness.reviewStatus, 'passed');
  assert.deepEqual(proof.requiredChecks, ['build', 'unit tests', 'Merge readiness', 'Secret scan', 'Dependency vulnerability scan']);
  assert.equal(proof.branchProtection.branch, 'main');
  assert.equal(proof.evidenceSource.provider, 'github');
  assert.equal(proof.evidenceSource.apiBaseUrl, 'https://api.github.com');
  assert.ok(proof.checks.some((check) => check.name === 'unit tests'));
});

test('collectGitHubPullRequestEvidence records GitHub merge commit only for merged PRs', async () => {
  const mergeCommitSha = '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210';
  const proof = await collectGitHubPullRequestEvidence({
    prUrl: PR_URL,
    fetchImpl: githubFetchMock({ merged: true, mergeCommitSha }),
  });

  assert.equal(proof.merged, true);
  assert.equal(proof.commitSha, COMMIT_SHA);
  assert.equal(proof.mergeCommitSha, mergeCommitSha);
  assert.equal(proof.mergedAt, '2026-07-04T12:30:00.000Z');
});

test('collectGitHubPullRequestEvidence reads paginated changed files and check runs', async () => {
  const proof = await collectGitHubPullRequestEvidence({
    prUrl: PR_URL,
    fetchImpl: paginatedGithubFetchMock(),
  });

  assert.ok(proof.changedFiles.includes('lib/task-platform/paginated-proof.js'));
  assert.equal(proof.mergeReadiness.reviewStatus, 'passed');
  assert.ok(proof.checks.some((check) => check.name === 'unit tests'));
});

test('collectGitHubPullRequestEvidence rejects mismatched requested PR number', async () => {
  await assert.rejects(
    () => collectGitHubPullRequestEvidence({
      prUrl: PR_URL,
      prNumber: 418,
      fetchImpl: githubFetchMock(),
    }),
    /does not match requested PR #418/,
  );
});

test('collectGitHubPullRequestEvidence rejects mismatched requested implementation commit', async () => {
  await assert.rejects(
    () => collectGitHubPullRequestEvidence({
      prUrl: PR_URL,
      implementationCommitSha: '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210',
      fetchImpl: githubFetchMock(),
    }),
    /does not match requested implementation commit/,
  );
});

test('collectGitHubPullRequestEvidence rejects mismatched requested branch name', async () => {
  await assert.rejects(
    () => collectGitHubPullRequestEvidence({
      prUrl: PR_URL,
      branchName: 'feat/different-branch',
      fetchImpl: githubFetchMock(),
    }),
    /does not match requested branch/,
  );
});

test('agent-driven phases collect real evidence without an extra collection flag', () => {
  const previousCollect = process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE;
  try {
    delete process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE;
    assert.equal(shouldCollectGoldenPathRealEvidence({}), false);
    assert.equal(shouldCollectGoldenPathRealEvidence({ requireRealEvidence: true }), true);
    assert.equal(shouldCollectGoldenPathRealEvidence({ agentDrivenPhases: true }), true);
  } finally {
    if (previousCollect == null) delete process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE;
    else process.env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE = previousCollect;
  }
});

test('prepareGoldenPathRealEvidence hard-fails missing PR target when collection is requested', async () => {
  await assert.rejects(
    () => prepareGoldenPathRealEvidence({
      evidence: {},
      options: { collectRealEvidence: true },
    }),
    /requires an actual pull request target/,
  );
});

test('strict real evidence collection rejects mocked GitHub sources by default', async () => {
  await assert.rejects(
    () => prepareGoldenPathRealEvidence({
      evidence: {},
      options: {
        collectRealEvidence: true,
        prUrl: PR_URL,
        githubApiBaseUrl: 'http://127.0.0.1:9999',
        fetchImpl: githubFetchMock(),
      },
    }),
    /requires GitHub API base https:\/\/api\.github\.com/,
  );
  await assert.rejects(
    () => prepareGoldenPathRealEvidence({
      evidence: {},
      options: {
        collectRealEvidence: true,
        prUrl: PR_URL,
        fetchImpl: githubFetchMock(),
      },
    }),
    /cannot use an injected fetch implementation/,
  );
});

test('prepareGoldenPathRealEvidence writes release artifacts and runner proof options', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-'));
  let builtRelease = null;
  const result = await prepareGoldenPathRealEvidence({
    evidence: {
      engineeringTeam: { templateTier: 'Standard' },
      change: { kind: 'bugfix' },
    },
    options: {
      collectRealEvidence: true,
      requireRealEvidence: true,
      prUrl: PR_URL,
      releaseEnv: 'staging',
      changeKind: 'bugfix',
      templateTier: 'Standard',
      deploymentUrl: DEPLOYMENT_URL,
      rollbackTarget: 'release-previous',
      rollbackVerified: true,
      rollbackEvidence: writeRollbackEvidence(tmp),
      healthCheckPath: '/version',
      requireHealthCommit: true,
      releaseArtifactDir: tmp,
      allowMockGitHubEvidence: true,
      allowTestGitHubEvidenceInjection: true, env: { NODE_ENV: 'test' },
      fetchImpl: githubFetchMock(),
      releaseEvidenceBuilder: (artifactResult) => {
        builtRelease = artifactResult;
        return { ok: true, stdout: 'PASS release evidence' };
      },
    },
  });

  assert.equal(result.options.branchName, 'feat/autonomous-real-proof');
  assert.equal(result.options.implementationCommitSha, COMMIT_SHA);
  assert.equal(result.options.mergeCommitSha, '');
  assert.equal(result.options.mergeReadiness.reviewStatus, 'passed');
  assert.ok(result.options.requiredChecks.includes('Merge readiness'));
  assert.deepEqual(result.options.changedFiles, ['lib/task-platform/factory-delivery.js']);
  assert.equal(result.evidence.github.evidenceSource.provider, 'github');
  assert.equal(result.evidence.github.mergeCommitSha, undefined);
  assert.equal(result.evidence.releaseEvidence.environment, 'staging');
  assert.equal(result.evidence.releaseEvidence.validation.ok, true);
  assert.equal(result.evidence.releaseEvidence.artifacts.deploy, builtRelease.artifacts.deploy);
  for (const artifactName of ['build', 'compatibility', 'vulnerability', 'secret', 'immutable', 'deploy', 'health']) {
    assert.ok(fs.existsSync(builtRelease.artifacts[artifactName]), `${artifactName} artifact exists`);
  }
  assert.equal(JSON.parse(fs.readFileSync(builtRelease.artifacts.deploy, 'utf8')).rollback_target, 'release-previous');
  assert.equal(JSON.parse(fs.readFileSync(builtRelease.artifacts.health, 'utf8')).status, 'healthy');
});

test('prepareGoldenPathRealEvidence keys release artifacts to GitHub merge commit', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-merged-'));
  const mergeCommitSha = '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210';
  let builtRelease = null;
  const result = await prepareGoldenPathRealEvidence({
    evidence: { engineeringTeam: { templateTier: 'Standard' }, change: { kind: 'bugfix' } },
    options: {
      collectRealEvidence: true,
      requireRealEvidence: true,
      prUrl: PR_URL,
      releaseEnv: 'staging',
      changeKind: 'bugfix',
      templateTier: 'Standard',
      deploymentUrl: DEPLOYMENT_URL,
      rollbackTarget: 'release-previous',
      rollbackVerified: true,
      rollbackEvidence: writeRollbackEvidence(tmp),
      healthCheckPath: '/version',
      requireHealthCommit: true,
      releaseArtifactDir: tmp,
      allowMockGitHubEvidence: true,
      allowTestGitHubEvidenceInjection: true, env: { NODE_ENV: 'test' },
      fetchImpl: githubFetchMock({ merged: true, mergeCommitSha }),
      releaseEvidenceBuilder: (artifactResult) => {
        builtRelease = artifactResult;
        return { ok: true, stdout: 'PASS release evidence' };
      },
    },
  });

  assert.equal(result.options.implementationCommitSha, COMMIT_SHA);
  assert.equal(result.options.mergeCommitSha, mergeCommitSha);
  assert.equal(result.evidence.github.mergeCommitSha, mergeCommitSha);
  assert.equal(readJson(builtRelease.artifacts.deploy).deployed_sha, mergeCommitSha);
  assert.equal(readJson(builtRelease.artifacts.health).checked_sha, mergeCommitSha);
  assert.equal(readJson(builtRelease.artifacts.build).commit_sha, mergeCommitSha);
  assert.equal(readJson(builtRelease.artifacts.immutable).commit_sha, mergeCommitSha);
});

test('prepareGoldenPathRealEvidence rejects caller-supplied checks that are not collected from GitHub', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-fake-checks-'));
  await assert.rejects(
    () => prepareGoldenPathRealEvidence({
      evidence: {
        engineeringTeam: { templateTier: 'Standard' },
        change: { kind: 'bugfix' },
      },
      options: {
        collectRealEvidence: true,
        requireRealEvidence: true,
        prUrl: PR_URL,
        releaseEnv: 'staging',
        changeKind: 'bugfix',
        templateTier: 'Standard',
        deploymentUrl: DEPLOYMENT_URL,
        rollbackTarget: 'release-previous',
        rollbackVerified: true,
        rollbackEvidence: writeRollbackEvidence(tmp),
        healthCheckPath: '/version',
        requireHealthCommit: true,
        releaseArtifactDir: tmp,
        allowMockGitHubEvidence: true,
        allowTestGitHubEvidenceInjection: true, env: { NODE_ENV: 'test' },
        checks: [{ name: 'unit tests', conclusion: 'success' }],
        mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed' },
        fetchImpl: githubFetchMock({ includeTestCheck: false, includeMergeReadiness: false }),
        releaseEvidenceBuilder: () => ({ ok: true, stdout: 'PASS release evidence' }),
      },
    }),
    /branch-protection required checks must pass.*unit tests.*Merge readiness/s,
  );
});

test('prepareGoldenPathRealEvidence rejects skipped release validation in strict mode', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-skipped-validation-'));
  await assert.rejects(
    () => prepareGoldenPathRealEvidence({
      evidence: { engineeringTeam: { templateTier: 'Standard' }, change: { kind: 'bugfix' } },
      options: {
        collectRealEvidence: true,
        requireRealEvidence: true,
        prUrl: PR_URL,
        releaseEnv: 'staging',
        changeKind: 'bugfix',
        templateTier: 'Standard',
        deploymentUrl: DEPLOYMENT_URL,
        rollbackTarget: 'release-previous',
        rollbackVerified: true,
        rollbackEvidence: writeRollbackEvidence(tmp),
        healthCheckPath: '/version',
        requireHealthCommit: true,
        releaseArtifactDir: tmp,
        allowMockGitHubEvidence: true,
        allowTestGitHubEvidenceInjection: true, env: { NODE_ENV: 'test' },
        fetchImpl: githubFetchMock(),
        releaseEvidenceBuilder: () => ({ skipped: true, reason: 'builder_not_run' }),
      },
    }),
    /real release evidence validation failed: builder_not_run/,
  );
});

test('prepareGoldenPathRealEvidence rejects skipped validation when collection is requested', async () => {
  await assert.rejects(
    () => prepareGoldenPathRealEvidence({
      evidence: { engineeringTeam: { templateTier: 'Standard' }, change: { kind: 'bugfix' } },
      options: {
        collectRealEvidence: true,
        prUrl: PR_URL,
        releaseEnv: 'staging',
        changeKind: 'bugfix',
        templateTier: 'Standard',
        deploymentUrl: DEPLOYMENT_URL,
        rollbackTarget: 'release-previous',
        rollbackVerified: true,
        rollbackEvidence: writeRollbackEvidence(fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-skipped-validation-collect-rollback-'))),
        healthCheckPath: '/version',
        requireHealthCommit: true,
        releaseArtifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-skipped-validation-collect-')),
        allowMockGitHubEvidence: true,
        allowTestGitHubEvidenceInjection: true, env: { NODE_ENV: 'test' },
        fetchImpl: githubFetchMock(),
        releaseEvidenceBuilder: () => ({ skipped: true, reason: 'builder_not_run' }),
      },
    }),
    /real release evidence validation failed: builder_not_run/,
  );
});
