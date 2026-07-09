const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyRealAutonomousDeliveryEvidence } = require('../../lib/task-platform/real-autonomous-delivery-evidence');
const { productionSafetyEvidence } = require('./helpers/production-safety-fixture');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const MERGE_COMMIT_SHA = '5a7e3c9d1b2f4a6c8e0d3b5f7a9c1e2d4f678901';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';
const CHANGED_FILES = [
  'lib/task-platform/factory-delivery.js',
  'tests/unit/real-autonomous-delivery-github-identity.test.js',
];

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

function releaseArtifactBase(artifactName, sourceSystem) {
  return {
    schema_version: '1.0',
    generated_by: 'release-artifact-evidence-builder',
    generated_at: '2026-07-05T00:00:00.000Z',
    artifact_name: artifactName,
    environment: 'staging',
    commit_sha: MERGE_COMMIT_SHA,
    source_system: sourceSystem,
  };
}

function buildArtifacts(dir, overrides = {}) {
  const checkArtifact = (name, artifactName) => ({
    ...releaseArtifactBase(artifactName, 'command'),
    status: 'passed',
    check_name: name,
  });
  return {
    build: writeJson(path.join(dir, 'build.json'), { ...checkArtifact('build', 'build'), ...(overrides.build || {}) }),
    compatibility: writeJson(path.join(dir, 'compatibility-report.json'), { ...checkArtifact('unit tests', 'compatibility-report'), ...(overrides.compatibility || {}) }),
    vulnerability: writeJson(path.join(dir, 'vulnerability-scan.json'), { ...checkArtifact('Dependency vulnerability scan', 'vulnerability-scan'), ...(overrides.vulnerability || {}) }),
    secret: writeJson(path.join(dir, 'secret-scan.json'), { ...checkArtifact('Secret scan', 'secret-scan'), ...(overrides.secret || {}) }),
    immutable: writeJson(path.join(dir, 'immutable-artifact.json'), {
      ...releaseArtifactBase('immutable-artifact', 'git'),
      digest: 'abc123',
      artifact_id: `wiinc1/engineering-team@${MERGE_COMMIT_SHA}`,
      ...(overrides.immutable || {}),
    }),
    deploy: writeJson(path.join(dir, 'deploy-record.json'), {
      ...releaseArtifactBase('deploy-record', 'deployment-provider'),
      deployed_sha: MERGE_COMMIT_SHA,
      deployment_url: DEPLOYMENT_URL,
      rollback_target: 'release-previous',
      status: 'deployed',
      ...(overrides.deploy || {}),
    }),
    health: writeJson(path.join(dir, 'post-deploy-health.json'), {
      ...releaseArtifactBase('post-deploy-health', 'http-health-check'),
      checked_sha: MERGE_COMMIT_SHA,
      deployment_url: DEPLOYMENT_URL,
      status: 'healthy',
      commit_verified: true,
      ...(overrides.health || {}),
    }),
    rollback: writeJson(path.join(dir, 'rollback-verification.json'), {
      ...releaseArtifactBase('rollback-verification', 'deployment-provider'),
      rollback_target: 'release-previous',
      verification_status: 'verified',
      ...(overrides.rollback || {}),
    }),
  };
}

function githubEvidence(overrides = {}) {
  return {
    repository: 'wiinc1/engineering-team',
    branchName: 'feat/autonomous-real-proof',
    commitSha: COMMIT_SHA,
    merged: true,
    mergeCommitSha: MERGE_COMMIT_SHA,
    mergedAt: '2026-07-04T12:30:00.000Z',
    prUrl: PR_URL,
    prNumber: 417,
    changedFiles: CHANGED_FILES,
    checks: ['build', 'unit tests', 'Merge readiness']
      .map((name) => ({ name, status: 'completed', conclusion: 'success', source: 'github_check_run' })),
    requiredChecks: ['build', 'unit tests', 'Merge readiness'],
    branchProtection: {
      branch: 'main',
      requiredChecks: ['build', 'unit tests', 'Merge readiness'],
      source: 'github_branch_protection',
    },
    mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
    evidenceSource: { provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-04T12:00:00.000Z' },
    ...overrides,
  };
}

function autoMergeEvidence(overrides = {}) {
  return {
    ok: true,
    skipped: false,
    simulated: false,
    reason: 'merged',
    merged: true,
    mergeCommitSha: MERGE_COMMIT_SHA,
    mergedAt: '2026-07-04T12:30:00.000Z',
    prUrl: PR_URL,
    prNumber: 417,
    ...overrides,
  };
}

function realEvidence(dir, overrides = {}) {
  return {
    status: 'phase6_complete',
    baseUrl: 'https://api.factory.openclaw.app',
    operatorUrl: DEPLOYMENT_URL,
    github: githubEvidence(overrides.github),
    engineeringTeam: { templateTier: 'Standard' },
    change: { kind: 'bugfix', changedFiles: CHANGED_FILES },
    phase6: { api: { validation: { ok: true }, autoMerge: autoMergeEvidence(overrides.autoMerge) } },
    releaseEvidence: {
      environment: 'staging',
      artifacts: buildArtifacts(dir, overrides.artifacts),
      validation: { ok: true, skipped: false },
    },
  };
}

function candidateProof() {
  return {
    schemaVersion: 'real-delivery-candidate-proof.v1',
    ok: true,
    branch: 'feat/autonomous-real-proof',
    commitSha: COMMIT_SHA,
    prUrl: PR_URL,
    prNumber: 417,
    ...githubEvidence(),
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    deploymentHealth: { ok: true, url: DEPLOYMENT_URL, status: 200, commitVerified: true },
    requireHealthCommit: true,
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    rollbackEvidence: { environment: 'staging', commit_sha: COMMIT_SHA, rollback_target: 'release-previous', verification_status: 'verified', verified_at: '2026-07-05T00:00:00.000Z' },
    riskLevel: 'low',
    productionSafe: true,
    productionSafetyEvidence: productionSafetyEvidence({ deploymentUrl: DEPLOYMENT_URL, commitSha: COMMIT_SHA }),
    changedFiles: CHANGED_FILES,
    implementationFiles: ['lib/task-platform/factory-delivery.js'],
    testFiles: ['tests/unit/real-autonomous-delivery-github-identity.test.js'],
    testCommands: ['node --test tests/unit/real-autonomous-delivery-github-identity.test.js'],
    testCommandResults: [{ command: 'node --test tests/unit/real-autonomous-delivery-github-identity.test.js', ok: true, exitCode: 0 }],
    githubEvidenceSource: githubEvidence().evidenceSource,
    localGit: { branch: 'feat/autonomous-real-proof', commitSha: COMMIT_SHA, workingTreeClean: true, dirtyFileCount: 0, dirtyFiles: [] },
    sourceIntegrity: { checkedFiles: 2, nodeCheckedFiles: 2, failureCount: 0, failures: [] },
  };
}

test('real autonomous delivery audit directly requires final GitHub identity proof', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-missing-github-identity-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      github: { branchName: ' ', commitSha: '', prUrl: '', prNumber: 'abc', changedFiles: [] },
    }),
    requireCandidateProof: false,
  });
  const failures = result.failures.join('\n');
  assert.equal(result.ok, false);
  assert.match(failures, /GitHub branchName is required/);
  assert.match(failures, /GitHub commitSha is required/);
  assert.match(failures, /GitHub prUrl is required/);
  assert.match(failures, /GitHub prNumber is required/);
  assert.match(failures, /GitHub changedFiles are required/);
});

test('real autonomous delivery audit requires final GitHub repository proof', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-missing-github-repo-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, { github: { repository: '' } }),
    requireCandidateProof: false,
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /GitHub repository is required/);
});

test('real autonomous delivery audit requires github.com PR URL to match repository', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-github-repo-pr-mismatch-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      github: { repository: 'other/repo', prUrl: PR_URL },
    }),
    requireCandidateProof: false,
  });
  const failures = result.failures.join('\n');

  assert.equal(result.ok, false);
  assert.match(failures, /GitHub repository must match GitHub prUrl/);
});

test('real autonomous delivery audit rejects non-GitHub PR URLs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-non-github-pr-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      github: { prUrl: 'https://git.example.com/wiinc1/engineering-team/pull/417', prNumber: 417 },
    }),
    requireCandidateProof: false,
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /GitHub prUrl must be a github.com pull request URL/);
});

test('real autonomous delivery audit rejects the default pilot PR in final GitHub proof', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-default-pr-'));
  const defaultPrUrl = 'https://github.com/wiinc1/engineering-team/pull/271';
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      github: { prUrl: defaultPrUrl, prNumber: 271 },
      autoMerge: { prUrl: defaultPrUrl, prNumber: 271 },
    }),
    requireCandidateProof: false,
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /default pilot PR #271 is not valid real delivery evidence/);
});

test('real autonomous delivery audit rejects default and detached final GitHub branches', () => {
  for (const branchName of ['main', 'master', 'HEAD']) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-default-branch-'));
    const result = verifyRealAutonomousDeliveryEvidence({
      repoRoot: tmp,
      evidence: realEvidence(tmp, { github: { branchName } }),
      requireCandidateProof: false,
    });
    assert.equal(result.ok, false);
    assert.match(result.failures.join('\n'), /GitHub branchName (must not be|cannot be)/);
  }
});

test('real autonomous delivery audit directly requires final GitHub checks and merge readiness', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-missing-github-checks-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      github: { checks: [], requiredChecks: [], mergeReadiness: null },
    }),
    requireCandidateProof: false,
  });
  const failures = result.failures.join('\n');
  assert.equal(result.ok, false);
  assert.match(failures, /GitHub checks are required/);
  assert.match(failures, /GitHub requiredChecks inventory is required/);
  assert.match(failures, /GitHub mergeReadiness proof is required/);
});

test('real autonomous delivery audit rejects manual or failing GitHub check proof', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-manual-github-checks-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      github: {
        checks: [{ name: 'unit tests', conclusion: 'success', source: 'manual' }],
        requiredChecks: ['build', 'unit tests'],
        mergeReadiness: { name: 'Merge readiness', reviewStatus: 'pending', source: 'manual' },
      },
    }),
    requireCandidateProof: false,
  });
  const failures = result.failures.join('\n');
  assert.equal(result.ok, false);
  assert.match(failures, /GitHub checks must include at least one passing GitHub check run or status/);
  assert.match(failures, /GitHub mergeReadiness proof must come from a GitHub check run or status/);
  assert.match(failures, /GitHub mergeReadiness proof must pass/);
  assert.match(failures, /GitHub requiredChecks must include Merge readiness/);
});

test('real autonomous delivery audit requires every required check to pass from GitHub', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-missing-required-checks-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      github: {
        checks: [
          { name: 'build', conclusion: 'success', source: 'github_check_run' },
          { name: 'unit tests', conclusion: 'neutral', source: 'github_check_run' },
        ],
        requiredChecks: ['build', 'unit tests', 'Merge readiness'],
        mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
      },
    }),
    requireCandidateProof: false,
  });
  const failures = result.failures.join('\n');
  assert.equal(result.ok, false);
  assert.match(failures, /GitHub requiredChecks must pass from GitHub: unit tests, Merge readiness/);
});

test('real autonomous delivery audit requires branch protection as the required-check source', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-missing-branch-protection-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      github: {
        branchProtection: null,
      },
    }),
    requireCandidateProof: false,
  });
  const failures = result.failures.join('\n');
  assert.equal(result.ok, false);
  assert.match(failures, /GitHub branchProtection evidence is required/);
});

test('real autonomous delivery audit requires requiredChecks to match branch protection', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-branch-protection-drift-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      github: {
        requiredChecks: ['build', 'unit tests', 'Merge readiness'],
        branchProtection: {
          branch: 'main',
          requiredChecks: ['build', 'unit tests', 'Merge readiness', 'Secret scan'],
          source: 'github_branch_protection',
        },
      },
    }),
    requireCandidateProof: false,
  });
  const failures = result.failures.join('\n');
  assert.equal(result.ok, false);
  assert.match(failures, /GitHub requiredChecks must include branch-protection checks: Secret scan/);
});

test('real autonomous delivery audit requires mergeReadiness to identify the Merge readiness check', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-merge-readiness-name-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      github: {
        mergeReadiness: { name: 'build', reviewStatus: 'passed', source: 'github_check_run' },
      },
    }),
    requireCandidateProof: false,
  });
  const failures = result.failures.join('\n');
  assert.equal(result.ok, false);
  assert.match(failures, /GitHub mergeReadiness proof must be the Merge readiness check/);
});

test('real autonomous delivery audit rejects malformed supporting release artifacts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-malformed-release-artifact-'));
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      artifacts: { secret: { generated_by: 'test-fixture', artifact_name: 'secret' } },
    }),
    candidateProof: candidateProof(),
  });
  const failures = result.failures.join('\n');
  assert.equal(result.ok, false);
  assert.match(failures, /secret-scan\.generated_by must be a release evidence generator/);
  assert.match(failures, /secret-scan\.artifact_name must be secret-scan/);
});

test('real autonomous delivery audit rejects malformed deploy health and rollback artifacts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-malformed-runtime-artifacts-'));
  const malformed = { generated_by: 'test-fixture', artifact_name: 'fixture' };
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence: realEvidence(tmp, {
      artifacts: { deploy: malformed, health: malformed, rollback: malformed },
    }),
    candidateProof: candidateProof(),
  });
  const failures = result.failures.join('\n');
  assert.equal(result.ok, false);
  assert.match(failures, /deploy-record\.generated_by must be a release evidence generator/);
  assert.match(failures, /post-deploy-health\.artifact_name must be post-deploy-health/);
  assert.match(failures, /rollback-verification\.artifact_name must be rollback-verification/);
});
