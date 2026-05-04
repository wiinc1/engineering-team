const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createTaskPlatformService,
  evaluateMergeReadinessGate,
  evaluateMergeReadinessSummaryPrecedence,
  renderMergeReadinessPrSummary,
} = require('../../lib/task-platform');

function createServiceWithTask() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-platform-pr-summary-'));
  const service = createTaskPlatformService({ baseDir });
  const task = service.createTask({
    tenantId: 'engineering-team',
    actorId: 'pm-1',
    title: 'PR summary integration',
    status: 'READY_FOR_REVIEW',
  });
  return { service, task };
}

function createPassingReview(service, task) {
  return service.createMergeReadinessReview({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 116,
    commitSha: 'abc116def456',
    reviewStatus: 'passed',
    requiredChecks: [{ name: 'Repo validation', conclusion: 'success', url: 'https://github.com/checks/116' }],
    availableSources: [{ id: 'check:repo-validation', url: 'https://github.com/checks/116' }],
    reviewedLogSources: [{ name: 'Repo validation', url: 'https://github.com/checks/116/job/1' }],
    findings: [
      {
        id: 'MRR-NOTE-116',
        severity: 'info',
        summary: 'Follow-up link is informational.',
        rationale: 'The structured review remains merge-ready.',
      },
    ],
    followUpLinks: [{ label: 'Issue 116', url: 'https://github.com/wiinc1/engineering-team/issues/116' }],
  });
}

function blockReview(service, task, review) {
  return service.updateMergeReadinessReview({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    reviewId: review.reviewId,
    recordVersion: review.recordVersion,
    reviewStatus: 'blocked',
    findings: [{ id: 'MRR-BLOCK-116', severity: 'blocker', summary: 'A blocking finding superseded the comment.' }],
  });
}

function mergeReadinessGateContext() {
  return {
    includePrSummary: true,
    sourcePolicyInput: {
      requiredChecks: [{ name: 'Repo validation' }],
      availableSources: [{ id: 'check:repo-validation', url: 'https://github.com/checks/116' }],
    },
    branchProtectionInput: {
      verifyBranchProtection: true,
      branchProtection: { required_status_checks: { checks: [{ context: 'Merge readiness' }] } },
    },
    structuredReviewUrl: 'https://github.com/wiinc1/engineering-team/issues/116#structured-review',
  };
}

test('renders a persisted MergeReadinessReview PR summary without making the comment authoritative', () => {
  const { service, task } = createServiceWithTask();
  const review = createPassingReview(service, task);

  const summary = renderMergeReadinessPrSummary(review, {
    structuredReviewUrl: 'https://github.com/wiinc1/engineering-team/issues/116#structured-review',
  });
  assert.match(summary, /Review status: `passed`/);
  assert.match(summary, /Commit SHA: `abc116def456`/);
  assert.match(summary, /Repo validation/);
  assert.match(summary, /Structured MergeReadinessReview:/);

  const blockedReview = blockReview(service, task, review);
  const result = evaluateMergeReadinessSummaryPrecedence({
    review: blockedReview,
    commentBody: summary,
    commitSha: 'abc116def456',
  });

  assert.equal(result.commentStatus, 'passed');
  assert.equal(result.authoritativeStatus, 'blocked');
  assert.equal(result.commentConflict, true);
  assert.equal(result.gate.conclusion, 'failure');
});

test('evaluates the reusable merge-readiness gate through the task platform export', () => {
  const { service, task } = createServiceWithTask();
  const review = createPassingReview(service, task);
  const blockedReview = blockReview(service, task, review);

  const gate = evaluateMergeReadinessGate(blockedReview, mergeReadinessGateContext());

  assert.equal(gate.checkRun.conclusion, 'failure');
  assert.equal(gate.branchProtection.status, 'enforced');
  assert.equal(gate.sourcePolicy.status, 'satisfied');
  assert.equal(gate.findingPolicy.blockingFindings[0].id, 'MRR-BLOCK-116');
  assert.match(gate.prSummary, /Structured MergeReadinessReview:/);
});
