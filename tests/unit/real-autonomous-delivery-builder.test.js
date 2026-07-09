const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  buildCliOptions,
} = require('../../scripts/build-real-autonomous-delivery-evidence');
const {
  buildRealAutonomousDeliveryEvidence,
  finalEvidencePreflightOptions,
  writeRealAutonomousDeliveryEvidence,
} = require('../../lib/task-platform/real-autonomous-delivery-builder');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const MERGE_COMMIT_SHA = '5a7e3c9d1b2f4a6c8e0d3b5f7a9c1e2d4f678901';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';
const CHANGED_FILES = [
  'lib/task-platform/factory-delivery.js',
  'tests/unit/real-autonomous-delivery-builder.test.js',
];
const CANDIDATE_CHECKS = [
  { name: 'build', status: 'completed', conclusion: 'success', source: 'github_check_run' },
  { name: 'unit tests', status: 'completed', conclusion: 'success', source: 'github_check_run' },
  { name: 'Merge readiness', status: 'completed', conclusion: 'success', source: 'github_check_run' },
  { name: 'Secret scan', status: 'completed', conclusion: 'success', source: 'github_check_run' },
  { name: 'Dependency vulnerability scan', status: 'completed', conclusion: 'success', source: 'github_check_run' },
];
const CANDIDATE_REQUIRED_CHECKS = ['build', 'unit tests', 'Merge readiness', 'Secret scan', 'Dependency vulnerability scan'];
const CANDIDATE_BRANCH_PROTECTION = { branch: 'main', requiredChecks: CANDIDATE_REQUIRED_CHECKS, source: 'github_branch_protection' };
const CANDIDATE_PRODUCTION_SAFETY = productionSafetyEvidence({ deploymentUrl: DEPLOYMENT_URL, commitSha: COMMIT_SHA });
const CANDIDATE_TEST_RESULT = {
  command: 'node --test tests/unit/real-autonomous-delivery-builder.test.js',
  ok: true,
  exitCode: 0,
};

function jsonResponse(body, status = 200, textBody = JSON.stringify(body)) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => textBody,
  };
}

function checkRun(name) {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.example/checks/${encodeURIComponent(name)}`,
  };
}

function githubFetchMock({ merged = true, changedFiles = CHANGED_FILES } = {}) {
  return async (url) => {
    const target = String(url);
    if (target.startsWith(DEPLOYMENT_URL)) {
      return jsonResponse({ commit: MERGE_COMMIT_SHA }, 200, `deployed ${MERGE_COMMIT_SHA}`);
    }
    if (target.includes('/branches/main/protection')) {
      const required = ['build', 'unit tests', 'Merge readiness', 'Secret scan', 'Dependency vulnerability scan'];
      return jsonResponse({ required_status_checks: { checks: required.map((context) => ({ context })) } });
    }
    if (target.includes('/pulls/417/files')) {
      return jsonResponse(changedFiles.map((filename) => ({ filename })));
    }
    if (target.includes('/pulls/417')) {
      return jsonResponse({
        number: 417,
        html_url: PR_URL,
        head: { ref: 'feat/autonomous-real-proof', sha: COMMIT_SHA },
        base: { ref: 'main' },
        merged,
        merge_commit_sha: MERGE_COMMIT_SHA,
        merged_at: merged ? '2026-07-04T12:30:00.000Z' : null,
      });
    }
    if (target.includes('/check-runs')) {
      return jsonResponse({
        check_runs: [
          checkRun('build'),
          checkRun('unit tests'),
          checkRun('Merge readiness'),
          checkRun('Secret scan'),
          checkRun('Dependency vulnerability scan'),
        ],
      });
    }
    if (target.includes('/status')) return jsonResponse({ statuses: [] });
    throw new Error(`unexpected fetch ${target}`);
  };
}

function candidateProof(overrides = {}) {
  return {
    schemaVersion: 'real-delivery-candidate-proof.v1',
    ok: true,
    branch: 'feat/autonomous-real-proof',
    commitSha: COMMIT_SHA,
    prUrl: PR_URL,
    prNumber: 417,
    checks: CANDIDATE_CHECKS,
    requiredChecks: CANDIDATE_REQUIRED_CHECKS,
    branchProtection: CANDIDATE_BRANCH_PROTECTION,
    mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
    githubEvidenceSource: { provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-04T12:00:00.000Z' },
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    deploymentHealth: { ok: true, url: DEPLOYMENT_URL, status: 200, commitVerified: true },
    requireHealthCommit: true,
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    rollbackEvidence: rollbackEvidence(),
    riskLevel: 'low',
    productionSafe: true,
    productionSafetyEvidence: CANDIDATE_PRODUCTION_SAFETY,
    changedFiles: CHANGED_FILES,
    implementationFiles: ['lib/task-platform/factory-delivery.js'],
    testFiles: ['tests/unit/real-autonomous-delivery-builder.test.js'],
    testCommands: ['node --test tests/unit/real-autonomous-delivery-builder.test.js'],
    testCommandResults: [CANDIDATE_TEST_RESULT],
    localGit: { branch: 'feat/autonomous-real-proof', commitSha: COMMIT_SHA, workingTreeClean: true, dirtyFileCount: 0, dirtyFiles: [] },
    sourceIntegrity: { checkedFiles: 2, nodeCheckedFiles: 2, failureCount: 0, failures: [] },
    failures: [],
    ...overrides,
  };
}

function rollbackEvidence() {
  return {
    environment: 'staging',
    commit_sha: COMMIT_SHA,
    rollback_target: 'release-previous',
    verification_status: 'verified',
    verified_at: '2026-07-05T00:00:00.000Z',
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

function writeExistingCommandArtifacts(outDir) {
  for (const [artifactName, fileName] of [
    ['build', 'build.json'],
    ['compatibility-report', 'compatibility-report.json'],
    ['vulnerability-scan', 'vulnerability-scan.json'],
    ['secret-scan', 'secret-scan.json'],
  ]) {
    writeJson(path.join(outDir, fileName), {
      schema_version: '1.0',
      generated_by: 'release-artifact-evidence-builder',
      generated_at: '2026-07-05T00:00:00.000Z',
      artifact_name: artifactName,
      commit_sha: MERGE_COMMIT_SHA,
      environment: 'staging',
      source_system: 'command',
      status: 'passed',
    });
  }
}

function sourcePhase6Evidence(overrides = {}) {
  return {
    status: 'phase6_complete',
    engineeringTeam: { templateTier: 'Standard' },
    change: { kind: 'bugfix' },
    phase6: {
      api: {
        autoMerge: {
          ok: true,
          skipped: false,
          simulated: false,
          reason: 'merged',
          merged: true,
          mergeCommitSha: MERGE_COMMIT_SHA,
          mergedAt: '2026-07-04T12:30:00.000Z',
          prUrl: PR_URL,
          prNumber: 417,
          ...(overrides.autoMerge || {}),
        },
      },
    },
  };
}

function buildOptions(tmp, overrides = {}) {
  writeExistingCommandArtifacts(path.join(tmp, 'release-artifacts'));
  return {
    cwd: tmp,
    env: {},
    evidence: sourcePhase6Evidence(),
    branchName: 'feat/autonomous-real-proof',
    implementationCommitSha: COMMIT_SHA,
    prUrl: PR_URL,
    releaseEnv: 'staging',
    changeKind: 'bugfix',
    templateTier: 'Standard',
    operatorUrl: DEPLOYMENT_URL,
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    rollbackEvidence: rollbackEvidence(),
    rollbackVerified: true,
    githubToken: 'test-token',
    healthCheckPath: '/version',
    requireHealthCommit: true,
    releaseArtifactDir: 'release-artifacts',
    useExistingReleaseArtifacts: true,
    allowMockGitHubEvidence: true,
    allowTestGitHubEvidenceInjection: true,
    env: { NODE_ENV: 'test' },
    fetchImpl: githubFetchMock(),
    releaseEvidenceBuilder: () => ({ ok: true, stdout: 'PASS release evidence' }),
    candidateProof: candidateProof(),
    ...overrides,
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function cliPreflightArgs(tmp, candidatePath) {
  const sourceEvidencePath = writeJson(path.join(tmp, 'source-evidence.json'), sourcePhase6Evidence());
  return [
    'scripts/build-real-autonomous-delivery-evidence.js',
    '--preflight-only',
    '--source-evidence', sourceEvidencePath,
    '--branch', 'feat/autonomous-real-proof',
    '--implementation-commit-sha', COMMIT_SHA,
    '--pr-url', PR_URL,
    '--release-env', 'staging',
    '--operator-url', DEPLOYMENT_URL,
    '--deployment-url', DEPLOYMENT_URL,
    '--rollback-target', 'release-previous',
    '--rollback-evidence', path.join(tmp, 'rollback.json'),
    '--rollback-verified',
    '--candidate-proof', candidatePath,
    '--github-token', 'gh-token',
    '--health-check-path', '/version',
    '--require-health-commit',
    '--release-build-command', 'npm run build',
    '--release-compatibility-command', 'npm run test:unit',
    '--release-vulnerability-command', 'npm audit --audit-level=high',
    '--release-secret-command', 'npm run secrets:scan',
  ];
}

function cleanGithubEnv() {
  return {
    ...process.env,
    GITHUB_API_BASE_URL: '',
    GITHUB_TOKEN: '',
    GH_TOKEN: '',
    ALLOW_MOCK_GITHUB_EVIDENCE: '',
  };
}

test('real autonomous delivery builder writes verifier-clean final evidence for a merged PR', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-autonomous-builder-'));
  const candidateProofPath = writeJson(path.join(tmp, 'candidate-proof.json'), candidateProof());
  const result = await buildRealAutonomousDeliveryEvidence(buildOptions(tmp, { candidateProofPath }));
  const written = writeRealAutonomousDeliveryEvidence(tmp, 'final-evidence.json', result.evidence);
  const deploy = readJson(path.join(tmp, result.releaseArtifacts.deploy));

  assert.equal(result.verification.ok, true);
  assert.equal(result.evidence.realDelivery.candidateProofPath, candidateProofPath);
  assert.equal(result.github.merged, true);
  assert.equal(result.evidence.status, 'phase6_complete');
  assert.equal(result.evidence.phase6.api.autoMerge.reason, 'merged');
  assert.equal(result.evidence.phase6.api.autoMerge.mergeCommitSha, MERGE_COMMIT_SHA);
  assert.equal(deploy.deployed_sha, MERGE_COMMIT_SHA);
  assert.equal(readJson(written).github.prUrl, PR_URL);
});

test('real autonomous delivery builder rejects open PRs before final evidence is written', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-autonomous-open-pr-'));

  await assert.rejects(
    () => buildRealAutonomousDeliveryEvidence(buildOptions(tmp, {
      fetchImpl: githubFetchMock({ merged: false }),
    })),
    /requires merged GitHub PR proof/,
  );
  assert.equal(fs.existsSync(path.join(tmp, 'release-artifacts', 'deploy-record.json')), false);
});

test('real autonomous delivery final preflight uses the source merge commit for reused artifacts', () => {
  const options = finalEvidencePreflightOptions({
    evidence: sourcePhase6Evidence(),
    implementationCommitSha: COMMIT_SHA,
  });

  assert.equal(options.mergeCommitSha, MERGE_COMMIT_SHA);
});

test('real autonomous delivery builder preflights missing proof before GitHub collection', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-autonomous-preflight-'));
  let fetched = false;

  await assert.rejects(
    () => buildRealAutonomousDeliveryEvidence({
      cwd: tmp,
      env: {},
      fetchImpl: async () => {
        fetched = true;
        throw new Error('unexpected GitHub collection');
      },
    }),
    /Real autonomous delivery final evidence build preflight failed: .*actual pull request target.*deployment-url.*candidate-proof/s,
  );
  assert.equal(fetched, false);
});

test('real autonomous delivery builder rejects skipped source auto-merge proof before GitHub collection', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-autonomous-skipped-merge-'));
  let fetched = false;
  await assert.rejects(
    () => buildRealAutonomousDeliveryEvidence(buildOptions(tmp, {
      evidence: sourcePhase6Evidence({
        autoMerge: { skipped: true, reason: 'already_merged' },
      }),
      fetchImpl: async () => {
        fetched = true;
        throw new Error('unexpected GitHub collection');
      },
    })),
    /source phase 6 auto-merge proof cannot be skipped/,
  );
  assert.equal(fetched, false);
});

test('real autonomous delivery builder rejects non-GitHub source auto-merge PR URLs before collection', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-autonomous-non-github-merge-'));
  let fetched = false;
  await assert.rejects(
    () => buildRealAutonomousDeliveryEvidence(buildOptions(tmp, {
      evidence: sourcePhase6Evidence({
        autoMerge: { prUrl: 'https://git.example.com/wiinc1/engineering-team/pull/417' },
      }),
      fetchImpl: async () => {
        fetched = true;
        throw new Error('unexpected GitHub collection');
      },
    })),
    /source phase 6 auto-merge prUrl must be a github\.com pull request URL/,
  );
  assert.equal(fetched, false);
});

test('real autonomous delivery builder reports unreadable source evidence before GitHub collection', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-autonomous-missing-source-'));
  let fetched = false;
  await assert.rejects(
    () => buildRealAutonomousDeliveryEvidence(buildOptions(tmp, {
      evidence: null,
      sourceEvidencePath: 'missing-source-evidence.json',
      fetchImpl: async () => {
        fetched = true;
        throw new Error('unexpected GitHub collection');
      },
    })),
    /source phase 6 evidence cannot be read/,
  );
  assert.equal(fetched, false);
});

test('real autonomous delivery builder surfaces candidate continuity failures', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-autonomous-candidate-fail-'));

  await assert.rejects(
    () => buildRealAutonomousDeliveryEvidence(buildOptions(tmp, {
      candidateProof: candidateProof({
        changedFiles: ['lib/task-platform/factory-delivery.js'],
        testFiles: [],
      }),
    })),
    /real autonomous delivery evidence failed: .*test files are required.*must stay within real-delivery candidate proof scope/s,
  );
});

test('real autonomous delivery build CLI maps hosted proof options', () => {
  const options = buildCliOptions([
    'node',
    'scripts/build-real-autonomous-delivery-evidence.js',
    '--out',
    'observability/final.json',
    '--source-evidence',
    'observability/source-phase6.json',
    '--pr-url',
    PR_URL,
    '--release-env',
    'staging',
    '--deployment-url',
    DEPLOYMENT_URL,
    '--rollback-target',
    'release-previous',
    '--rollback-evidence',
    'observability/release/rollback.json',
    '--rollback-verified',
    '--candidate-proof',
    'observability/candidate.json',
    '--release-build-command',
    'npm run build',
    '--require-health-commit',
    '--health-check-path',
    '/version',
  ], {});

  assert.equal(options.outPath, 'observability/final.json');
  assert.equal(options.prUrl, PR_URL);
  assert.equal(options.rollbackVerified, true);
  assert.equal(options.requireHealthCommit, true);
  assert.equal(options.releaseArtifactCommands.build, 'npm run build');
  assert.equal(options.candidateProofPath, 'observability/candidate.json');
  assert.equal(options.sourceEvidencePath, 'observability/source-phase6.json');
});

test('real autonomous delivery build CLI supports preflight-only mode', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-autonomous-cli-preflight-'));
  const candidatePath = path.join(tmp, 'candidate.json');
  writeJson(candidatePath, candidateProof());
  const result = spawnSync(process.execPath, cliPreflightArgs(tmp, candidatePath), {
    cwd: path.join(__dirname, '../..'),
    env: cleanGithubEnv(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS  real-autonomous-delivery-preflight/);
  assert.match(result.stdout, new RegExp(PR_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
