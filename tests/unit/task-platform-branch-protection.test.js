const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTaskPlatformService } = require('../../lib/task-platform');
const {
  MERGE_READINESS_BRANCH_PROTECTION_VERSION,
  createGitHubBranchProtectionClient,
  evaluateMergeReadinessBranchProtection,
  requiredStatusCheckNames,
  verifyMergeReadinessBranchProtection,
} = require('../../lib/task-platform/merge-readiness-branch-protection');

function serviceWithTask() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-readiness-branch-protection-'));
  const service = createTaskPlatformService({ baseDir });
  const task = service.createTask({
    tenantId: 'engineering-team',
    actorId: 'pm-1',
    title: 'Merge readiness branch protection',
    status: 'READY_FOR_REVIEW',
  });
  return { service, task };
}

function createReview(service, task, body = {}) {
  return service.createMergeReadinessReview({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 115,
    commitSha: 'abc115def456',
    reviewStatus: 'passed',
    ...body,
  });
}

test('parses GitHub branch protection required status checks', () => {
  assert.deepEqual(requiredStatusCheckNames({
    required_status_checks: {
      contexts: ['Repo validation'],
      checks: [{ context: 'Merge readiness' }],
    },
  }), ['Repo validation', 'Merge readiness']);
});

test('represents Merge readiness as enforced only when branch protection requires it', () => {
  const result = evaluateMergeReadinessBranchProtection({
    verifyBranchProtection: true,
    branchProtection: {
      required_status_checks: {
        contexts: ['Pull request metadata', 'Repo validation'],
        checks: [{ context: 'Merge readiness' }],
      },
    },
  });

  assert.equal(result.policyVersion, MERGE_READINESS_BRANCH_PROTECTION_VERSION);
  assert.equal(result.status, 'enforced');
  assert.equal(result.enforced, true);
  assert.equal(result.reviewStatus, null);
  assert.deepEqual(result.findings, []);
});

test('reports policy_blocked when Merge readiness is not required by branch protection', () => {
  const result = evaluateMergeReadinessBranchProtection({
    verifyBranchProtection: true,
    branchProtection: {
      required_status_checks: {
        contexts: ['Pull request metadata', 'Repo validation', 'Browser validation'],
      },
    },
  });

  assert.equal(result.status, 'policy_blocked');
  assert.equal(result.enforced, false);
  assert.equal(result.reviewStatus, 'blocked');
  assert.equal(result.exceptions[0].type, 'policy_blocked');
  assert.equal(result.exceptions[0].owner, 'repo-admin');
});

test('reports error when branch-protection verification cannot read default-branch settings', () => {
  const result = evaluateMergeReadinessBranchProtection({
    verifyBranchProtection: true,
    branchProtection: null,
    verificationError: 'forbidden',
  });

  assert.equal(result.status, 'error');
  assert.equal(result.reviewStatus, 'error');
  assert.equal(result.findings[0].type, 'branch_protection_verification_error');
});

test('service factory persists branch-protection enforcement in merge-readiness review metadata', () => {
  const { service, task } = serviceWithTask();
  const review = createReview(service, task, {
    branchProtection: {
      required_status_checks: {
        contexts: ['Pull request metadata', 'Repo validation', 'Browser validation'],
        checks: [{ context: 'Merge readiness' }],
      },
    },
  });

  assert.equal(review.reviewStatus, 'passed');
  assert.equal(review.classification.branch_protection_policy.status, 'enforced');
  assert.equal(review.classification.branch_protection_policy.enforced, true);
  assert.equal(review.metadata.github_merge_readiness_branch_protection.enforced, true);
});

test('service factory blocks reviews when branch protection does not require Merge readiness', () => {
  const { service, task } = serviceWithTask();
  const review = createReview(service, task, {
    branchProtection: {
      required_status_checks: {
        contexts: ['Pull request metadata', 'Repo validation', 'Browser validation'],
      },
    },
  });

  assert.equal(review.reviewStatus, 'blocked');
  assert.equal(review.classification.branch_protection_policy.status, 'policy_blocked');
  assert.equal(review.metadata.github_merge_readiness_branch_protection.enforced, false);
  assert.ok(review.findings.some(finding => finding.type === 'policy_blocked'));
});

test('GitHub branch-protection client and verifier detect required Merge readiness check', async () => {
  const requests = [];
  const client = createGitHubBranchProtectionClient({
    token: 'token-115',
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { required_status_checks: { checks: [{ context: 'Merge readiness' }] } };
        },
      };
    },
  });

  const result = await verifyMergeReadinessBranchProtection({
    github: client,
    repository: 'wiinc1/engineering-team',
    branch: 'main',
  });

  assert.equal(requests[0].url, 'https://api.github.com/repos/wiinc1/engineering-team/branches/main/protection');
  assert.equal(requests[0].options.headers.authorization, 'Bearer token-115');
  assert.equal(result.status, 'enforced');
  assert.equal(result.enforced, true);
});
