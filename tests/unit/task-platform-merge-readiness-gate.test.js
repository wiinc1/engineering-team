const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFileTaskPlatformService } = require('../../lib/task-platform/service');
const { createTaskPlatformService } = require('../../lib/task-platform');
const {
  shouldEnforceMergeReadiness,
} = require('../../lib/task-platform/merge-readiness-enforcement');
const {
  evaluateMergeReadinessBranchProtection,
} = require('../../lib/task-platform/merge-readiness-branch-protection');
const {
  buildMergeReadinessCheckRunPayload,
  mapReviewToCheckRun,
  refreshMergeReadinessForEvent,
} = require('../../lib/task-platform/merge-readiness-github-check');
const {
  evaluateBlockingFindingDeferral,
  evaluateMergeReadinessFindingPolicy,
} = require('../../lib/task-platform/merge-readiness-gate');
const { renderMergeReadinessPrSummary } = require('../../lib/task-platform/merge-readiness-pr-summary');
const {
  evaluateMergeReadinessSourcePolicy,
  selectRequiredSources,
} = require('../../lib/task-platform/merge-readiness-source-policy');

function requiredSourceIds() {
  return selectRequiredSources({
    changedFiles: ['lib/task-platform/service.js', 'src/app/App.jsx', 'db/migrations/010_merge_readiness_reviews.sql'],
    requiredChecks: [{ name: 'Repo validation' }],
    executionContractEvidence: [{ id: 'contract-audit', label: 'Contract coverage audit' }],
    previewDeployment: { url: 'https://preview.example/117' },
    deployment: { url: 'https://deploy.example/117' },
    riskFlags: ['security', 'deployment', 'accessibility', 'performance'],
  }).map(source => source.id).sort();
}

function serviceWithReview() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-readiness-gate-'));
  const service = createFileTaskPlatformService({ baseDir });
  const task = service.createTask({ tenantId: 'engineering-team', actorId: 'pm-1', title: 'Gate coverage', status: 'READY_FOR_REVIEW' });
  service.createMergeReadinessReview({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 117,
    commitSha: 'abc1170',
    reviewStatus: 'passed',
  });
  return { service, task };
}

function validDeferredFinding(overrides = {}) {
  return {
    id: 'MRR-DEFER-117',
    severity: 'critical',
    owner: 'technical_owner',
    summary: 'High-risk rollout blocker is deferred with explicit acceptance.',
    deferralAllowed: true,
    followUpLinks: [{ url: 'https://github.com/wiinc1/engineering-team/issues/118' }],
    approvals: [
      { role: 'pm', type: 'risk_acceptance', actorId: 'pm-1' },
      { role: 'technical_owner', type: 'risk_acceptance', actorId: 'tech-1' },
      { role: 'principal_engineer', actorId: 'principal-1' },
    ],
    ...overrides,
  };
}

test('source-inventory policy covers all reusable gate source selectors', () => {
  assert.deepEqual(requiredSourceIds(), [
    'accessibility-validation',
    'browser-validation',
    'check:repo-validation',
    'deployment-evidence',
    'execution-contract:contract-audit',
    'migration-plan',
    'performance-validation',
    'pr-diff',
    'preview-deployment',
    'repo-standards',
    'runtime-observability',
    'security-review',
  ]);
});

test('status transitions map pending, passed, blocked, stale, and error to check-run states', () => {
  const statusMap = Object.fromEntries(['pending', 'passed', 'blocked', 'stale', 'error'].map(status => {
    const mapping = mapReviewToCheckRun({ reviewStatus: status, isCurrent: true, commitSha: 'abc1170' }, { commitSha: 'abc1170' });
    return [status, [mapping.status, mapping.conclusion, mapping.reason]];
  }));

  assert.deepEqual(statusMap.pending, ['in_progress', null, 'pending']);
  assert.deepEqual(statusMap.passed, ['completed', 'success', 'passed']);
  assert.deepEqual(statusMap.blocked, ['completed', 'failure', 'blocked']);
  assert.deepEqual(statusMap.stale, ['in_progress', null, 'stale']);
  assert.deepEqual(statusMap.error, ['completed', 'failure', 'error']);
});

test('new pull request commits invalidate prior reviews and return Merge readiness to pending', async () => {
  const { service, task } = serviceWithReview();
  const calls = [];
  await refreshMergeReadinessForEvent({
    taskPlatform: service,
    github: { async createCheckRun(call) { calls.push(call); return { id: 11701 }; } },
    taskRefs: [{ tenantId: 'engineering-team', taskId: task.taskId }],
    eventName: 'pull_request',
    payload: {
      action: 'synchronize',
      repository: { full_name: 'wiinc1/engineering-team' },
      pull_request: { number: 117, head: { sha: 'def1170' } },
    },
  });

  const [review] = service.listMergeReadinessReviews({ tenantId: 'engineering-team', taskId: task.taskId });
  assert.equal(review.reviewStatus, 'stale');
  assert.equal(calls[0].payload.status, 'in_progress');
  assert.equal(calls[0].payload.conclusion, undefined);
});

test('inaccessible required evidence errors, fails the check, and raises policy_blocked ownership', () => {
  const sourcePolicy = evaluateMergeReadinessSourcePolicy({
    changedFiles: ['lib/auth/jwt.js'],
    evidenceAccess: { 'security-review': { status: 'inaccessible', reason: 'permission_denied' } },
  });
  const check = mapReviewToCheckRun({ reviewStatus: sourcePolicy.reviewStatus, isCurrent: true, commitSha: 'abc1170' }, { commitSha: 'abc1170' });

  assert.equal(sourcePolicy.status, 'error');
  assert.equal(sourcePolicy.reviewStatus, 'error');
  assert.equal(check.conclusion, 'failure');
  assert.equal(sourcePolicy.exceptions[0].type, 'policy_blocked');
  assert.equal(sourcePolicy.exceptions[0].owner, 'repo-admin');
});

test('finding policy distinguishes blocking and non-blocking findings with rationale and ownership', () => {
  const result = evaluateMergeReadinessFindingPolicy({
    findings: [
      { id: 'MRR-BLOCK', severity: 'blocker', owner: 'sre', summary: 'Deployment is blocked.' },
      { id: 'MRR-NOTE', severity: 'info', owner: 'pm', rationale: 'Follow-up is informational.' },
      { id: 'MRR-MISSING', severity: 'info' },
    ],
  });

  assert.deepEqual(result.blockingFindings.map(finding => finding.id), ['MRR-BLOCK']);
  assert.deepEqual(result.nonBlockingFindings.map(finding => finding.id), ['MRR-NOTE', 'MRR-MISSING']);
  assert.deepEqual(result.invalidFindings[0].missingRequirements, ['owner', 'non_blocking_rationale']);
});

test('blocking-finding deferral requires risk acceptance, follow-up, permission, and high-risk approval', () => {
  const valid = evaluateBlockingFindingDeferral(validDeferredFinding());
  const invalid = evaluateBlockingFindingDeferral(validDeferredFinding({
    deferralAllowed: false,
    followUpLinks: [],
    approvals: [{ role: 'reader', actorId: 'reader-1' }],
  }));

  assert.equal(valid.valid, true);
  assert.equal(valid.approvals.pmRiskAcceptance, true);
  assert.equal(valid.approvals.technicalOwnerRiskAcceptance, true);
  assert.equal(valid.approvals.principalOrSreHighRiskApproval, true);
  assert.deepEqual(invalid.missingRequirements, [
    'policy_permission',
    'follow_up_link',
    'pm_risk_acceptance',
    'technical_owner_risk_acceptance',
    'principal_or_sre_high_risk_approval',
  ]);
});

test('persisted reviews remain blocked when blocking-finding deferral lacks policy approvals', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-readiness-deferral-policy-'));
  const calls = [];
  const service = createTaskPlatformService({
    baseDir,
    mergeReadinessCheckRunClient: {
      async createCheckRun(call) {
        calls.push(call);
        return { id: 21201 };
      },
    },
  });
  const task = service.createTask({ tenantId: 'engineering-team', actorId: 'pm-1', title: 'Deferral policy', status: 'READY_FOR_REVIEW' });

  const review = await service.createMergeReadinessReview({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 212,
    commitSha: 'abc2120',
    reviewStatus: 'passed',
    findings: [validDeferredFinding({ deferralAllowed: false, followUpLinks: [], approvals: [] })],
  });

  assert.equal(review.reviewStatus, 'blocked');
  assert.equal(review.classification.finding_deferral_policy.status, 'blocked');
  assert.deepEqual(review.classification.finding_deferral_policy.invalid_deferrals[0].missing_requirements, [
    'policy_permission',
    'follow_up_link',
    'pm_risk_acceptance',
    'technical_owner_risk_acceptance',
    'principal_or_sre_high_risk_approval',
  ]);
  assert.equal(calls[0].payload.conclusion, 'failure');
});

test('ff_merge_readiness_enforcement targets autonomous workflow PRs for branch-protection gating', () => {
  assert.equal(shouldEnforceMergeReadiness({ autonomousWorkflowPr: true }, { mergeReadinessEnforcementEnabled: true }), true);
  assert.equal(shouldEnforceMergeReadiness({ autonomousWorkflowPr: true }, { mergeReadinessEnforcementEnabled: false }), false);
  assert.equal(shouldEnforceMergeReadiness({ labels: ['documentation'] }, { mergeReadinessEnforcementEnabled: true }), false);
});

test('autonomous enforcement reports policy_blocked until branch protection requires Merge readiness', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-readiness-enforcement-'));
  const service = createTaskPlatformService({ baseDir, mergeReadinessEnforcementEnabled: true });
  const task = service.createTask({ tenantId: 'engineering-team', actorId: 'pm-1', title: 'Autonomous enforcement', status: 'READY_FOR_REVIEW' });

  const review = service.createMergeReadinessReview({
    tenantId: 'engineering-team',
    taskId: task.taskId,
    repository: 'wiinc1/engineering-team',
    pullRequestNumber: 212,
    commitSha: 'abc2121',
    reviewStatus: 'passed',
    autonomousWorkflowPr: true,
    branchProtection: { required_status_checks: { contexts: ['Repo validation'] } },
  });

  assert.equal(review.reviewStatus, 'blocked');
  assert.equal(review.classification.branch_protection_policy.status, 'policy_blocked');
  assert.equal(review.metadata.merge_readiness_enforcement.flag, 'ff_merge_readiness_enforcement');
  assert.equal(review.metadata.merge_readiness_enforcement.scope, 'autonomous_workflow_pr');
});

test('GitHub Merge readiness check-run emission covers pass, fail, and incomplete states', () => {
  const passed = buildMergeReadinessCheckRunPayload({ review: { reviewId: 'MRR-PASS', reviewStatus: 'passed', isCurrent: true, commitSha: 'abc1170' } });
  const blocked = buildMergeReadinessCheckRunPayload({ review: { reviewId: 'MRR-BLOCK', reviewStatus: 'blocked', isCurrent: true, commitSha: 'abc1170' } });
  const pending = buildMergeReadinessCheckRunPayload({ review: { reviewId: 'MRR-PEND', reviewStatus: 'pending', isCurrent: true, commitSha: 'abc1170' } });

  assert.equal(passed.conclusion, 'success');
  assert.equal(blocked.conclusion, 'failure');
  assert.equal(pending.status, 'in_progress');
  assert.equal(pending.conclusion, undefined);
});

test('branch-protection enforcement detection covers required and missing configurations', () => {
  const enforced = evaluateMergeReadinessBranchProtection({ verifyBranchProtection: true, branchProtection: { required_status_checks: { checks: [{ context: 'Merge readiness' }] } } });
  const missing = evaluateMergeReadinessBranchProtection({ verifyBranchProtection: true, branchProtection: { required_status_checks: { contexts: ['Repo validation'] } } });

  assert.equal(enforced.status, 'enforced');
  assert.equal(enforced.enforced, true);
  assert.equal(missing.status, 'policy_blocked');
  assert.equal(missing.reviewStatus, 'blocked');
});

test('PR summary rendering covers the allowlist and no-full-logs rule', () => {
  const summary = renderMergeReadinessPrSummary({
    reviewId: 'MRR-SUMMARY-117',
    reviewStatus: 'passed',
    commitSha: 'abc1170',
    reviewedLogSources: [{ name: 'Repo validation', url: 'https://github.com/checks/117', rawLog: 'FULL LOG MUST NOT RENDER' }],
    findings: [{ id: 'MRR-NOTE', severity: 'info', owner: 'pm', summary: 'Non-blocking note.', rationale: 'Safe to defer.' }],
    followUpLinks: [{ label: 'Issue 117', url: 'https://github.com/wiinc1/engineering-team/issues/117' }],
    metadata: { rawLog: 'METADATA LOG MUST NOT RENDER', structuredReviewUrl: 'https://github.com/wiinc1/engineering-team/issues/117#review' },
  });

  assert.match(summary, /Review status: `passed`/);
  assert.match(summary, /Non-blocking findings with rationale:/);
  assert.doesNotMatch(summary, /FULL LOG MUST NOT RENDER/);
  assert.doesNotMatch(summary, /METADATA LOG MUST NOT RENDER/);
});
