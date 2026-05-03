const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFileTaskPlatformService } = require('../../lib/task-platform/service');
const {
  MERGE_READINESS_CHECK_NAME,
  buildMergeReadinessCheckRunPayload,
  deriveMergeReadinessEvent,
  evidenceFingerprint,
  mapReviewToCheckRun,
  refreshMergeReadinessForEvent,
} = require('../../lib/task-platform/merge-readiness-github-check');

function fakeGitHub() {
  const calls = [];
  return {
    calls,
    async createCheckRun(call) {
      calls.push(call);
      return { id: calls.length, html_url: `https://github.example/checks/${calls.length}` };
    },
  };
}

function serviceWithTask() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-readiness-github-check-'));
  const service = createFileTaskPlatformService({ baseDir });
  const task = service.createTask({
    tenantId: 'engineering-team',
    actorId: 'pm-1',
    title: 'Merge readiness check task',
    status: 'READY_FOR_REVIEW',
  });
  return { service, task };
}

function createReview(service, task, body = {}) {
  return service.createMergeReadinessReview({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 114,
    commitSha: 'abc114def456',
    reviewStatus: 'passed',
    ...body,
  });
}

test('maps authoritative review status to GitHub check-run pass/fail/incomplete states', () => {
  assert.deepEqual(mapReviewToCheckRun({ reviewStatus: 'passed', isCurrent: true, commitSha: 'abc1140' }, { commitSha: 'abc1140' }), {
    status: 'completed',
    conclusion: 'success',
    reason: 'passed',
    title: 'Merge readiness passed',
    summary: 'Structured MergeReadinessReview passed for the current PR evidence.',
  });
  assert.equal(mapReviewToCheckRun({ reviewStatus: 'blocked', isCurrent: true }).conclusion, 'failure');
  assert.equal(mapReviewToCheckRun({ reviewStatus: 'error', isCurrent: true }).conclusion, 'failure');
  assert.equal(mapReviewToCheckRun({ reviewStatus: 'stale', isCurrent: true }).status, 'in_progress');
  assert.equal(mapReviewToCheckRun(null).status, 'in_progress');
});

test('builds a check run named Merge readiness from the structured review', () => {
  const payload = buildMergeReadinessCheckRunPayload({
    review: { reviewId: 'MRR-1', reviewStatus: 'passed', isCurrent: true, commitSha: 'abc1140' },
    commitSha: 'abc1140',
    completedAt: '2026-05-03T00:00:00.000Z',
  });
  assert.equal(payload.name, MERGE_READINESS_CHECK_NAME);
  assert.equal(payload.head_sha, 'abc1140');
  assert.equal(payload.status, 'completed');
  assert.equal(payload.conclusion, 'success');
  assert.equal(payload.completed_at, '2026-05-03T00:00:00.000Z');
});

test('refreshes on pull request, check result, and deployment evidence events', () => {
  const pullRequest = deriveMergeReadinessEvent('pull_request', {
    action: 'synchronize',
    repository: { full_name: 'wiinc1/engineering-team' },
    pull_request: { number: 114, head: { sha: 'abc1140' } },
  });
  assert.equal(pullRequest.shouldRefresh, true);
  assert.equal(pullRequest.headSha, 'abc1140');
  const check = deriveMergeReadinessEvent('check_run', {
    repository: { full_name: 'wiinc1/engineering-team' },
    check_run: { name: 'Repo validation', head_sha: 'abc1140', pull_requests: [{ number: 114 }] },
  });
  assert.equal(check.shouldRefresh, true);
  assert.equal(check.pullRequestNumber, 114);
  const deployment = deriveMergeReadinessEvent('deployment_status', {
    repository: { full_name: 'wiinc1/engineering-team' },
    deployment: { sha: 'abc1140' },
    deployment_status: { state: 'success', environment_url: 'https://preview.example/114' },
  });
  assert.equal(deployment.shouldRefresh, true);
  assert.equal(deployment.headSha, 'abc1140');
  assert.equal(deployment.evidence.deployment.state, 'success');
});

test('commit SHA changes mark the prior review stale and return Merge readiness to pending', async () => {
  const { service, task } = serviceWithTask();
  createReview(service, task);
  const github = fakeGitHub();

  const result = await refreshMergeReadinessForEvent({
    taskPlatform: service,
    github,
    taskRefs: [{ tenantId: 'engineering-team', taskId: task.taskId }],
    eventName: 'pull_request',
    payload: {
      action: 'synchronize',
      repository: { full_name: 'wiinc1/engineering-team' },
      pull_request: { number: 114, head: { sha: 'new114def456' } },
    },
  });

  const [review] = service.listMergeReadinessReviews({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 114,
  });
  assert.equal(result.results[0].stale, true);
  assert.equal(review.reviewStatus, 'stale');
  assert.equal(github.calls[0].payload.status, 'in_progress');
  assert.equal(github.calls[0].payload.conclusion, undefined);
});

test('evidence changes invalidate a passing review and keep the GitHub check incomplete', async () => {
  const { service, task } = serviceWithTask();
  const oldEvidence = { requiredChecks: [{ name: 'Repo validation', conclusion: 'success' }] };
  createReview(service, task, {
    metadata: { github_merge_readiness_gate: { evidence_fingerprint: evidenceFingerprint(oldEvidence) } },
  });
  const github = fakeGitHub();

  await refreshMergeReadinessForEvent({
    taskPlatform: service,
    github,
    taskRefs: [{ tenantId: 'engineering-team', taskId: task.taskId }],
    eventName: 'check_run',
    payload: {
      repository: { full_name: 'wiinc1/engineering-team' },
      check_run: {
        name: 'Repo validation',
        conclusion: 'failure',
        head_sha: 'abc114def456',
        pull_requests: [{ number: 114 }],
      },
    },
  });

  const [review] = service.listMergeReadinessReviews({ tenantId: 'engineering-team', taskId: task.taskId });
  assert.equal(review.reviewStatus, 'stale');
  assert.equal(review.metadata.github_merge_readiness_gate.invalidated_reason, 'evidence_changed');
  assert.equal(github.calls[0].payload.status, 'in_progress');
});
