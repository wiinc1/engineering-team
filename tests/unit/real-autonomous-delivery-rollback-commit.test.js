const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyRealAutonomousDeliveryEvidence } = require('../../lib/task-platform/real-autonomous-delivery-evidence');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const MERGE_COMMIT_SHA = '5a7e3c9d1b2f4a6c8e0d3b5f7a9c1e2d4f678901';
const OTHER_COMMIT_SHA = '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';
const CHANGED_FILES = [
  'lib/task-platform/real-autonomous-delivery-evidence.js',
  'tests/unit/real-autonomous-delivery-rollback-commit.test.js',
];

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

function artifactBase(artifactName, sourceSystem, commitSha = MERGE_COMMIT_SHA) {
  const payload = {
    schema_version: '1.0',
    generated_by: 'release-artifact-evidence-builder',
    generated_at: '2026-07-05T00:00:00.000Z',
    artifact_name: artifactName,
    environment: 'staging',
    source_system: sourceSystem,
  };
  if (commitSha !== null) payload.commit_sha = commitSha;
  return payload;
}

function buildArtifacts(dir, rollbackCommitSha) {
  const passed = (fileName, artifactName) => writeJson(path.join(dir, fileName), {
    ...artifactBase(artifactName, 'command'),
    status: 'passed',
    check_name: artifactName,
  });
  return {
    build: passed('build.json', 'build'),
    compatibility: passed('compatibility-report.json', 'compatibility-report'),
    vulnerability: passed('vulnerability-scan.json', 'vulnerability-scan'),
    secret: passed('secret-scan.json', 'secret-scan'),
    immutable: writeJson(path.join(dir, 'immutable-artifact.json'), {
      ...artifactBase('immutable-artifact', 'git'),
      digest: 'abc123',
      artifact_id: `wiinc1/engineering-team@${MERGE_COMMIT_SHA}`,
    }),
    deploy: writeJson(path.join(dir, 'deploy-record.json'), {
      ...artifactBase('deploy-record', 'deployment-provider'),
      deployed_sha: MERGE_COMMIT_SHA,
      deployment_url: DEPLOYMENT_URL,
      rollback_target: 'release-previous',
      status: 'deployed',
    }),
    health: writeJson(path.join(dir, 'post-deploy-health.json'), {
      ...artifactBase('post-deploy-health', 'http-health-check'),
      checked_sha: MERGE_COMMIT_SHA,
      deployment_url: DEPLOYMENT_URL,
      status: 'healthy',
      commit_verified: true,
    }),
    rollback: writeJson(path.join(dir, 'rollback-verification.json'), {
      ...artifactBase('rollback-verification', 'deployment-provider', rollbackCommitSha),
      rollback_target: 'release-previous',
      verification_status: 'verified',
    }),
  };
}

function evidence(dir, rollbackCommitSha) {
  return {
    status: 'phase6_complete',
    baseUrl: 'https://api.factory.openclaw.app',
    github: {
      repository: 'wiinc1/engineering-team',
      branchName: 'feat/autonomous-real-proof',
      commitSha: COMMIT_SHA,
      merged: true,
      mergeCommitSha: MERGE_COMMIT_SHA,
      mergedAt: '2026-07-04T12:30:00.000Z',
      prUrl: PR_URL,
      prNumber: 417,
      changedFiles: CHANGED_FILES,
      checks: ['build', 'unit tests', 'Merge readiness'].map((name) => ({ name, status: 'completed', conclusion: 'success', source: 'github_check_run' })),
      requiredChecks: ['build', 'unit tests', 'Merge readiness'],
      branchProtection: { branch: 'main', requiredChecks: ['build', 'unit tests', 'Merge readiness'], source: 'github_branch_protection' },
      mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
      evidenceSource: { provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-04T12:00:00.000Z' },
    },
    change: { kind: 'bugfix', changedFiles: CHANGED_FILES },
    phase6: { api: { validation: { ok: true, skipped: false }, autoMerge: { ok: true, skipped: false, simulated: false, merged: true, mergeCommitSha: MERGE_COMMIT_SHA, mergedAt: '2026-07-04T12:30:00.000Z', prUrl: PR_URL, prNumber: 417 } } },
    releaseEvidence: { environment: 'staging', validation: { ok: true, skipped: false }, artifacts: buildArtifacts(dir, rollbackCommitSha) },
  };
}

test('real autonomous delivery audit requires rollback evidence to name the release commit', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-rollback-missing-commit-'));
  const result = verifyRealAutonomousDeliveryEvidence({ repoRoot: tmp, evidence: evidence(tmp, null) });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /rollback-verification\.commit_sha is required/);
});

test('real autonomous delivery audit rejects rollback evidence for a different release commit', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-rollback-drift-'));
  const result = verifyRealAutonomousDeliveryEvidence({ repoRoot: tmp, evidence: evidence(tmp, OTHER_COMMIT_SHA) });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /rollback-verification\.commit_sha must match deployed SHA/);
});
