const test = require('node:test');
const assert = require('node:assert/strict');
const { assertRealImplementationEvidence } = require('../../lib/task-platform/golden-path-real-evidence');

const REAL_PROOF = Object.freeze({
  branchName: 'feat/autonomous-real-proof',
  commitSha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
  prUrl: 'https://github.com/wiinc1/engineering-team/pull/417',
  prNumber: 417,
});

test('golden-path implementation proof rejects default and detached branches', () => {
  for (const [branchName, message] of [
    ['main', /actual branch name must not be main/],
    ['master', /actual branch name must not be master/],
    ['HEAD', /actual branch name cannot be detached HEAD/],
  ]) {
    assert.throws(
      () => assertRealImplementationEvidence({}, { agentDrivenPhases: true, ...REAL_PROOF, branchName }),
      message,
    );
  }
});
