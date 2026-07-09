const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyRealAutonomousDeliveryEvidence } = require('../../lib/task-platform/real-autonomous-delivery-evidence');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const MERGE_COMMIT_SHA = '5a7e3c9d1b2f4a6c8e0d3b5f7a9c1e2d4f678901';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';

function githubProof() {
  return {
    repository: 'wiinc1/engineering-team',
    branchName: 'feat/autonomous-real-proof',
    commitSha: COMMIT_SHA,
    merged: true,
    mergeCommitSha: MERGE_COMMIT_SHA,
    mergedAt: '2026-07-04T12:30:00.000Z',
    prUrl: PR_URL,
    prNumber: 417,
    changedFiles: ['lib/task-platform/factory-delivery.js'],
    checks: ['unit tests', 'Merge readiness']
      .map((name) => ({ name, status: 'completed', conclusion: 'success', source: 'github_check_run' })),
    requiredChecks: ['unit tests', 'Merge readiness'],
    branchProtection: { branch: 'main', requiredChecks: ['unit tests', 'Merge readiness'], source: 'github_branch_protection' },
    mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
    evidenceSource: { provider: 'github', apiBaseUrl: 'https://api.github.com', collectedAt: '2026-07-04T12:00:00.000Z' },
  };
}

test('real autonomous delivery audit rejects non-GitHub auto-merge PR URLs', () => {
  const result = verifyRealAutonomousDeliveryEvidence({
    evidence: {
      status: 'phase6_complete',
      baseUrl: 'https://api.factory.openclaw.app',
      github: githubProof(),
      engineeringTeam: { templateTier: 'Standard' },
      change: { kind: 'bugfix', changedFiles: ['lib/task-platform/factory-delivery.js'] },
      phase6: {
        api: {
          validation: { ok: true, skipped: false },
          autoMerge: {
            ok: true,
            skipped: false,
            simulated: false,
            reason: 'merged',
            merged: true,
            mergeCommitSha: MERGE_COMMIT_SHA,
            mergedAt: '2026-07-04T12:30:00.000Z',
            prUrl: 'https://git.example.com/wiinc1/engineering-team/pull/417',
            prNumber: 417,
          },
        },
      },
      releaseEvidence: { environment: 'staging', validation: { ok: true, skipped: false }, artifacts: {} },
    },
    releaseEnv: 'staging',
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /phase 6 auto-merge prUrl must be a github\.com pull request URL/);
});
