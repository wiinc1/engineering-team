'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkPassed,
  trustedMergeTarget,
  trustedPremergeFailures,
} = require('../../lib/task-platform/trusted-simple-merge');

test('trusted Simple pre-merge gate excludes only factory-owned Merge readiness', () => {
  const github = {
    requiredChecks: ['Repo validation', 'verify', 'Merge readiness'],
    checks: [
      { name: 'Repo validation', status: 'completed', conclusion: 'success' },
      { name: 'verify', status: 'completed', conclusion: 'success' },
    ],
  };
  assert.deepEqual(trustedPremergeFailures(github), []);
  assert.equal(checkPassed(github.checks[0]), true);
});

test('trusted Simple pre-merge gate fails closed for missing protected checks', () => {
  assert.deepEqual(
    trustedPremergeFailures({
      requiredChecks: ['Repo validation', 'verify', 'Merge readiness'],
      checks: [{ name: 'Repo validation', conclusion: 'success' }],
    }),
    ['verify is not successful'],
  );
  assert.deepEqual(trustedPremergeFailures({ checks: [] }), [
    'branch protection required-check inventory is missing',
  ]);
});

test('trusted merge target follows the latest evidence head after an agent update', () => {
  assert.deepEqual(trustedMergeTarget({
    github: {
      repository: 'wiinc1/engineering-team',
      branchName: 'agent/task',
      commitSha: 'b'.repeat(40),
      prUrl: 'https://github.com/wiinc1/engineering-team/pull/500',
      prNumber: 500,
    },
  }, {
    implementationCommitSha: 'a'.repeat(40),
  }), {
    repository: 'wiinc1/engineering-team',
    branchName: 'agent/task',
    implementationCommitSha: 'b'.repeat(40),
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/500',
    prNumber: 500,
  });
});
