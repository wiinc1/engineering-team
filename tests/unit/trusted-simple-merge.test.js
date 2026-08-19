'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkPassed,
  emitTrustedMergeReadiness,
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

test('trusted readiness falls back to the permissioned workflow when direct check creation is forbidden', async () => {
  const requests = [];
  const result = await emitTrustedMergeReadiness({
    repository: 'wiinc1/engineering-team',
    prNumber: 500,
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/500',
    commitSha: 'c'.repeat(40),
  }, {
    githubToken: 'token',
    githubCheckRunClient: {
      async createCheckRun() {
        throw new Error('GitHub check-run POST failed: 403 Resource not accessible by personal access token');
      },
    },
    async githubFetchImpl(url, request) {
      requests.push({ url, request });
      return { ok: true, status: 204 };
    },
  });

  assert.equal(result.workflowDispatched, true);
  assert.equal(requests[0].url, 'https://api.github.com/repos/wiinc1/engineering-team/actions/workflows/emit-merge-readiness-check.yml/dispatches');
  assert.deepEqual(JSON.parse(requests[0].request.body), {
    ref: 'main',
    inputs: { pr_number: '500', conclusion: 'success' },
  });
});
