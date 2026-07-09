const test = require('node:test');
const assert = require('node:assert/strict');
const { assertRealPhase6Evidence } = require('../../lib/task-platform/golden-path-real-evidence');

const REAL_PROOF = Object.freeze({
  branchName: 'feat/autonomous-real-proof',
  commitSha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
  prUrl: 'https://github.com/wiinc1/engineering-team/pull/417',
  prNumber: 417,
  changeKind: 'bugfix',
  templateTier: 'Standard',
  changedFiles: ['lib/task-platform/factory-delivery.js'],
  releaseEvidenceValidator: () => ({ ok: true, environment: 'staging', stdout: 'PASS release evidence' }),
});

test('strict release proof rejects hand-fed check and merge-readiness evidence', () => {
  assert.throws(
    () => assertRealPhase6Evidence({}, {
      agentDrivenPhases: true,
      ...REAL_PROOF,
      checks: [{ name: 'unit tests', conclusion: 'success' }],
      requiredChecks: ['unit tests', 'Merge readiness'],
      mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed' },
    }),
    /branch-protection required checks must pass.*GitHub Merge readiness/s,
  );
});

test('strict release proof does not treat required-check inventory as executed checks', () => {
  assert.throws(
    () => assertRealPhase6Evidence({}, {
      agentDrivenPhases: true,
      ...REAL_PROOF,
      requiredChecks: [{ name: 'unit tests', conclusion: 'success', source: 'github_check_run' }, 'Merge readiness'],
      mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
    }),
    /branch-protection required checks must pass.*unit tests.*Merge readiness/s,
  );
});

test('strict release proof accepts checks collected from GitHub check runs', () => {
  const proof = assertRealPhase6Evidence({}, {
    agentDrivenPhases: true,
    ...REAL_PROOF,
    checks: [
      { name: 'unit tests', conclusion: 'success', source: 'github_check_run' },
      { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
    ],
    requiredChecks: ['unit tests', 'Merge readiness'],
    branchProtection: { branch: 'main', requiredChecks: ['unit tests', 'Merge readiness'], source: 'github_branch_protection' },
    mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed', source: 'github_check_run' },
  });
  assert.equal(proof.prNumber, REAL_PROOF.prNumber);
});
