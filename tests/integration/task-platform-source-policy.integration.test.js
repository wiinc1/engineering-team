const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTaskPlatformService } = require('../../lib/task-platform');
const { MERGE_READINESS_SOURCE_POLICY_VERSION } = require('../../lib/task-platform/merge-readiness-source-policy');

test('persists merge-readiness source policy inventory through the task-platform service factory', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-platform-source-policy-integration-'));
  const service = createTaskPlatformService({ baseDir });
  const task = service.createTask({
    tenantId: 'engineering-team',
    actorId: 'pm-1',
    title: 'Source policy integration',
    status: 'READY_FOR_REVIEW',
  });

  const review = service.createMergeReadinessReview({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 113,
    commitSha: 'abcdef1234567',
    reviewStatus: 'passed',
    changedFiles: ['lib/task-platform/index.js'],
    availableSources: [
      { id: 'pr-diff' },
      { id: 'repo-standards' },
      { id: 'migration-plan' },
    ],
  });
  const current = service.listMergeReadinessReviews({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 113,
    commitSha: 'abcdef1234567',
  })[0];

  assert.equal(review.reviewStatus, 'passed');
  assert.equal(current.sourceInventory.policy_version, MERGE_READINESS_SOURCE_POLICY_VERSION);
  assert.equal(current.sourceInventory.status, 'satisfied');
  assert.deepEqual(current.classification.source_inventory_policy.missing_required_source_ids, []);
  assert.equal(current.metadata.merge_readiness_check.conclusion, 'success');
});
