const test = require('node:test');
const assert = require('node:assert/strict');
const {
  commitShaEvidenceFailure,
  isCommitShaShape,
  isLikelyFixtureCommitSha,
  isRealCommitSha,
  normalizeCommitSha,
} = require('../../lib/task-platform/real-commit-sha');
const { assertRealImplementationEvidence, assertRealPhase6Evidence } = require('../../lib/task-platform/golden-path-real-evidence');
const { resolveImplementerArtifacts } = require('../../lib/task-platform/factory-agent-phases');

const REAL_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const FIXTURE_SHA = '0123456789abcdef0123456789abcdef01234567';
const REPEATED_CHUNK_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

test('real commit SHA helper accepts non-fixture 40-character hex values', () => {
  assert.equal(normalizeCommitSha(` ${REAL_SHA.toUpperCase()} `), REAL_SHA);
  assert.equal(isCommitShaShape(REAL_SHA), true);
  assert.equal(isLikelyFixtureCommitSha(REAL_SHA), false);
  assert.equal(isRealCommitSha(REAL_SHA), true);
  assert.equal(commitShaEvidenceFailure(REAL_SHA), null);
});

test('real commit SHA helper rejects malformed and fixture-looking values', () => {
  for (const sha of [
    'not-a-real-sha',
    '0000000000000000000000000000000000000000',
    '1111111111111111111111111111111111111111',
    FIXTURE_SHA,
    '89abcdef0123456789abcdef0123456789abcdef',
    'fedcba9876543210fedcba9876543210fedcba98',
    REPEATED_CHUNK_SHA,
  ]) {
    assert.equal(isRealCommitSha(sha), false, sha);
  }
  assert.match(commitShaEvidenceFailure(FIXTURE_SHA), /non-fixture/);
  assert.match(commitShaEvidenceFailure(REPEATED_CHUNK_SHA), /non-fixture/);
  assert.match(commitShaEvidenceFailure('not-a-real-sha'), /40-character/);
});

test('strict golden-path proof rejects fixture commit SHAs', () => {
  assert.throws(
    () => assertRealImplementationEvidence({}, {
      agentDrivenPhases: true,
      branchName: 'feat/autonomous-real-proof',
      commitSha: FIXTURE_SHA,
      prUrl: 'https://github.com/wiinc1/engineering-team/pull/417',
      prNumber: 417,
    }),
    /non-fixture 40-character commit SHA/,
  );
});

test('strict release proof rejects repeated-chunk fixture commit SHAs', () => {
  assert.throws(
    () => assertRealPhase6Evidence({}, {
      agentDrivenPhases: true,
      branchName: 'feat/autonomous-real-proof',
      commitSha: REPEATED_CHUNK_SHA,
      prUrl: 'https://github.com/wiinc1/engineering-team/pull/417',
      prNumber: 417,
      changeKind: 'bugfix',
      templateTier: 'Standard',
      changedFiles: ['lib/task-platform/factory-delivery.js'],
      checks: [{ name: 'unit tests', conclusion: 'success', source: 'github_check_run' }],
      mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
      releaseEvidenceValidator: () => ({ ok: true, environment: 'staging', stdout: 'PASS release evidence' }),
    }),
    /non-fixture 40-character commit SHA/,
  );
});

test('strict implementer artifact resolution rejects fixture commit SHAs', () => {
  assert.throws(
    () => resolveImplementerArtifacts({
      delegated: true,
      message: JSON.stringify({
        branchName: 'feat/autonomous-real-proof',
        commitSha: REPEATED_CHUNK_SHA,
        prUrl: 'https://github.com/wiinc1/engineering-team/pull/417',
        prNumber: 417,
      }),
    }, { requireRealEvidence: true }),
    /non-fixture 40-character commitSha/,
  );
});
