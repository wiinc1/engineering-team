const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePhase2ImplementationEvidence,
  resolvePhase5ImplementationEvidence,
  resolvePhase6ReleaseEvidence,
} = require('../../lib/task-platform/golden-path-real-evidence');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';

test('non-strict golden-path proof resolution does not synthesize default PR 271', () => {
  const phase2 = resolvePhase2ImplementationEvidence({}, {}, null, COMMIT_SHA);
  assert.equal(phase2.prUrl, null);
  assert.equal(phase2.prNumber, null);

  const phase5 = resolvePhase5ImplementationEvidence({ github: { mergeCommitSha: COMMIT_SHA } }, {});
  assert.equal(phase5.prUrl, null);
  assert.equal(phase5.prNumber, null);

  const phase6 = resolvePhase6ReleaseEvidence({ github: { mergeCommitSha: COMMIT_SHA } }, {});
  assert.equal(phase6.prUrl, null);
  assert.equal(phase6.prNumber, null);
});
