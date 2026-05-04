const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTaskPlatformService } = require('../../lib/task-platform');

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
