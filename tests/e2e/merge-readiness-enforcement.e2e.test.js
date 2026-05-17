const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTaskPlatformService } = require('../../lib/task-platform');
const { refreshMergeReadinessForEvent } = require('../../lib/task-platform/merge-readiness-github-check');

function fakeCheckRunClient() {
  const calls = [];
  return {
    calls,
    async createCheckRun(call) {
      calls.push(call);
      return { id: 21200 + calls.length };
    },
  };
}

test('e2e: autonomous merge-readiness refresh invalidates stale review and keeps check pending', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-readiness-enforcement-e2e-'));
  const github = fakeCheckRunClient();
  const service = createTaskPlatformService({
    baseDir,
    mergeReadinessCheckRunClient: github,
    mergeReadinessEnforcementEnabled: true,
  });
  const task = service.createTask({
    tenantId: 'engineering-team',
    actorId: 'pm-1',
    title: 'Autonomous merge readiness e2e',
    status: 'READY_FOR_REVIEW',
  });

  await service.createMergeReadinessReview({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 212,
    commitSha: 'abc2120',
    reviewStatus: 'passed',
    autonomousWorkflowPr: true,
    branchProtection: { required_status_checks: { checks: [{ context: 'Merge readiness' }] } },
  });

  await refreshMergeReadinessForEvent({
    taskPlatform: service,
    github,
    taskRefs: [{ tenantId: 'engineering-team', taskId: task.taskId }],
    eventName: 'pull_request',
    payload: {
      action: 'synchronize',
      repository: { full_name: 'wiinc1/engineering-team' },
      pull_request: { number: 212, head: { sha: 'def2120' } },
    },
  });

  const [review] = service.listMergeReadinessReviews({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 212,
  });
  assert.equal(review.reviewStatus, 'stale');
  assert.equal(github.calls.at(-1).payload.head_sha, 'def2120');
  assert.equal(github.calls.at(-1).payload.status, 'in_progress');
  assert.equal(github.calls.at(-1).payload.conclusion, undefined);
});
