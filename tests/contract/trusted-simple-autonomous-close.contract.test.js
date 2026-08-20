'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evidenceModeOptions } = require('../../lib/task-platform/factory-phase-runner-options');
const { buildFactoryCloseoutReport } = require('../../lib/task-platform/factory-closeout');
const { buildQaPrompt } = require('../../lib/task-platform/factory-agent-phases');
const {
  emitTrustedMergeReadiness,
  trustedPremergeFailures,
} = require('../../lib/task-platform/trusted-simple-merge');

test('trusted Simple close composes PR gates without claiming hosted release evidence', () => {
  const options = evidenceModeOptions({
    proofProfile: 'live',
    trustedDelivery: true,
    agentDrivenPhases: true,
  }, { id: 'factory-milestone-c-contract', templateTier: 'Simple' });
  assert.equal(options.trustedSimpleClose, true);
  assert.equal(options.requireRealEvidence, false);
  assert.equal(options.collectRealEvidence, false);

  assert.deepEqual(trustedPremergeFailures({
    requiredChecks: ['Repo validation', 'verify', 'Merge readiness'],
    checks: [
      { name: 'Repo validation', conclusion: 'success', source: 'github_check_run' },
      { name: 'verify', conclusion: 'success', source: 'github_check_run' },
    ],
  }), []);

  const reference = {
    path: 'observability/trusted-simple-close/TSK-901.json',
    sha256: '9'.repeat(64),
  };
  const closeout = buildFactoryCloseoutReport({
    engineeringTeam: { taskId: 'TSK-901' },
    status: 'phase6_complete',
    manualInterventions: [],
    trustedSimpleCloseEvidence: reference,
  }, { inventoryPath: '/definitely/missing/inventory.json' });
  assert.deepEqual(closeout.trustedSimpleCloseEvidence, reference);
  assert.deepEqual(closeout.manualInterventions, []);
});

test('trusted Simple readiness retains an automated workflow transport when token type blocks Checks API writes', async () => {
  let dispatched = null;
  await emitTrustedMergeReadiness({
    repository: 'wiinc1/engineering-team',
    prNumber: 901,
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/901',
    commitSha: '9'.repeat(40),
  }, {
    githubToken: 'operator-token',
    githubCheckRunClient: {
      async createCheckRun() {
        throw new Error('GitHub check-run POST failed: 403 forbidden');
      },
    },
    async githubFetchImpl(url, request) {
      dispatched = { url, body: JSON.parse(request.body) };
      return { ok: true, status: 204 };
    },
  });

  assert.match(dispatched.url, /emit-merge-readiness-check\.yml\/dispatches$/);
  assert.deepEqual(dispatched.body.inputs, { pr_number: '901', conclusion: 'success' });
});

test('trusted Simple QA receives exact immutable PR evidence and a read-only review boundary', () => {
  const commitSha = 'd3690b68a8aec49fa35194c7532a9629ba8109db';
  const prompt = buildQaPrompt({
    taskId: 'TSK-026',
    requirements: 'Create one documentation reference and run the standards check.',
    repository: 'wiinc1/engineering-team',
    branchName: 'jr/tsk-026-markdown-heading-conventions-20260819',
    commitSha,
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/362',
    changedFiles: ['docs/reference/markdown-heading-conventions.md'],
    trustedSimpleClose: true,
  });

  assert.match(prompt, /TRUSTED DELIVERY QA/);
  assert.match(prompt, new RegExp(commitSha));
  assert.match(prompt, /wiinc1\/engineering-team/);
  assert.match(prompt, /jr\/tsk-026-markdown-heading-conventions-20260819/);
  assert.match(prompt, /https:\/\/github\.com\/wiinc1\/engineering-team\/pull\/362/);
  assert.match(prompt, /docs\/reference\/markdown-heading-conventions\.md/);
  assert.match(prompt, /read-only filesystem, git, and GitHub commands/);
  assert.match(prompt, /Do not edit files or pull-request metadata/);
  assert.match(prompt, /Do not .*rerun checks.*emit Merge readiness.*merge the pull request/);
});

test('session-proof QA remains tool-free and carries no hosted identity', () => {
  const prompt = buildQaPrompt({
    taskId: 'TSK-SESSION',
    requirements: 'Review a local session-proof fixture.',
  });

  assert.match(prompt, /no tools, no file edits/);
  assert.doesNotMatch(prompt, /TRUSTED DELIVERY QA/);
  assert.doesNotMatch(prompt, /Repository:/);
  assert.doesNotMatch(prompt, /Pull request:/);
});
