const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTaskPlatformService } = require('../../lib/task-platform');
const { buildImplementerPrompt } = require('../../lib/task-platform/factory-agent-phases');
const { buildPhaseRunnerOptions } = require('../../lib/task-platform/factory-phase-runner-options');

function serviceWithTask() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-platform-branch-protection-'));
  const service = createTaskPlatformService({ baseDir });
  const task = service.createTask({
    tenantId: 'engineering-team',
    actorId: 'pm-1',
    title: 'Branch protection integration',
    status: 'READY_FOR_REVIEW',
  });
  return { service, task };
}

function createReview(service, task, branchProtection) {
  return service.createMergeReadinessReview({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 115,
    commitSha: 'abc115def789',
    reviewStatus: 'passed',
    branchProtection,
  });
}

test('persists enforced branch-protection state through the task-platform service factory', () => {
  const { service, task } = serviceWithTask();
  const review = createReview(service, task, {
    required_status_checks: {
      contexts: ['Pull request metadata', 'Repo validation', 'Browser validation'],
      checks: [{ context: 'Merge readiness' }],
    },
  });

  assert.equal(review.reviewStatus, 'passed');
  assert.equal(review.classification.branch_protection_policy.status, 'enforced');
  assert.equal(review.classification.branch_protection_policy.enforced, true);
  assert.equal(review.metadata.github_merge_readiness_branch_protection.policy_version, 'merge-readiness-branch-protection.v1');
});

test('persists policy_blocked branch-protection state when Merge readiness is not required', () => {
  const { service, task } = serviceWithTask();
  const review = createReview(service, task, {
    required_status_checks: {
      contexts: ['Pull request metadata', 'Repo validation', 'Browser validation'],
    },
  });

  assert.equal(review.reviewStatus, 'blocked');
  assert.equal(review.classification.branch_protection_policy.status, 'policy_blocked');
  assert.equal(review.classification.branch_protection_policy.enforced, false);
  assert.ok(review.findings.some(finding => finding.type === 'policy_blocked'));
});

test('propagates trusted queue scope into the first-pass implementer PR contract', () => {
  const githubIssueUrl = 'https://github.com/wiinc1/engineering-team/issues/388';
  const changedFiles = ['docs/reference/example.md'];
  const options = buildPhaseRunnerOptions(
    { deliveryDir: 'observability/factory-delivery', ciRepository: 'wiinc1/engineering-team' },
    {
      id: 'factory-metadata-context',
      title: 'Document a repository convention',
      requirements: 'Add one documentation reference.',
      templateTier: 'Simple',
      githubIssueUrl,
      changedFiles,
    },
  );
  const prompt = buildImplementerPrompt({
    taskId: 'TSK-050',
    requirements: options.requirements,
    repository: options.ciRepository,
    githubIssueUrl: options.githubIssueUrl,
    changedFiles: options.changedFiles,
    trustedSimpleClose: true,
  });

  assert.match(prompt, /Repository: wiinc1\/engineering-team/);
  assert.match(prompt, /Source GitHub issue: https:\/\/github\.com\/wiinc1\/engineering-team\/issues\/388/);
  assert.match(prompt, /Expected changed files: docs\/reference\/example\.md/);
  assert.match(prompt, /repository rejects `None`, `N\/A`, `TBD`, `TODO`, and `unknown`/);
  assert.match(prompt, /No gaps or exceptions; rationale: <specific reason this change conforms>/);
  assert.match(prompt, /Do not write only `None`/);
  assert.match(prompt, /Closes #388/);
});
