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
      return { id: 9100 + calls.length, html_url: `https://github.example/checks/${9100 + calls.length}` };
    },
  };
}

test('emits and persists GitHub Merge readiness check-run metadata from the service factory', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-platform-github-check-'));
  const client = fakeCheckRunClient();
  const service = createTaskPlatformService({ baseDir, mergeReadinessCheckRunClient: client });
  const task = service.createTask({
    tenantId: 'engineering-team',
    actorId: 'pm-1',
    title: 'GitHub check integration',
    status: 'READY_FOR_REVIEW',
  });

  const review = await service.createMergeReadinessReview({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 114,
    commitSha: 'abc114def456',
    reviewStatus: 'passed',
    requiredChecks: [{ name: 'Repo validation', conclusion: 'success' }],
    availableSources: [{ id: 'check:repo-validation' }],
  });

  assert.equal(client.calls[0].payload.name, 'Merge readiness');
  assert.equal(client.calls[0].payload.conclusion, 'success');
  assert.equal(review.githubCheckRunId, 9101);
  assert.equal(review.metadata.github_merge_readiness_gate.policy_version, 'merge-readiness-github-check.v1');
  assert.ok(review.metadata.github_merge_readiness_gate.evidence_fingerprint);
});

test('blocked reviews emit a failing Merge readiness check run', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-platform-github-check-blocked-'));
  const client = fakeCheckRunClient();
  const service = createTaskPlatformService({ baseDir, mergeReadinessCheckRunClient: client });
  const task = service.createTask({
    tenantId: 'engineering-team',
    actorId: 'pm-1',
    title: 'Blocked GitHub check integration',
    status: 'READY_FOR_REVIEW',
  });

  await service.createMergeReadinessReview({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 114,
    commitSha: 'abc114def457',
    reviewStatus: 'blocked',
    findings: [{ id: 'MRR-BLOCKED', severity: 'blocker' }],
  });

  assert.equal(client.calls[0].payload.name, 'Merge readiness');
  assert.equal(client.calls[0].payload.status, 'completed');
  assert.equal(client.calls[0].payload.conclusion, 'failure');
});

test('wrapped refresh marks stale once and emits one pending check for the latest SHA', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-platform-github-check-refresh-'));
  const client = fakeCheckRunClient();
  const service = createTaskPlatformService({ baseDir, mergeReadinessCheckRunClient: client });
  const task = service.createTask({
    tenantId: 'engineering-team',
    actorId: 'pm-1',
    title: 'Refresh GitHub check integration',
    status: 'READY_FOR_REVIEW',
  });

  await service.createMergeReadinessReview({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 114,
    commitSha: 'abc114def458',
    reviewStatus: 'passed',
  });
  assert.equal(client.calls.length, 1);

  await refreshMergeReadinessForEvent({
    taskPlatform: service,
    github: client,
    taskRefs: [{ tenantId: 'engineering-team', taskId: task.taskId }],
    eventName: 'pull_request',
    payload: {
      action: 'synchronize',
      repository: { full_name: 'wiinc1/engineering-team' },
      pull_request: { number: 114, head: { sha: 'abc114def459' } },
    },
  });

  const [review] = service.listMergeReadinessReviews({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 114,
  });
  assert.equal(review.reviewStatus, 'stale');
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[1].payload.head_sha, 'abc114def459');
  assert.equal(client.calls[1].payload.status, 'in_progress');
});
