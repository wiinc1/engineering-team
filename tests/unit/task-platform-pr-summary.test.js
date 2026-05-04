const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateMergeReadinessSummaryPrecedence,
  extractPrSummaryReviewStatus,
  renderMergeReadinessPrSummary,
} = require('../../lib/task-platform/merge-readiness-pr-summary');

function sourceInventoryFixture() {
  return {
    required_sources: [
      {
        id: 'check:repo-validation',
        label: 'Repo validation',
        status: 'present',
        source_url: 'https://github.com/wiinc1/engineering-team/actions/runs/116',
        logText: 'RAW FULL LOG LINE THAT MUST NOT APPEAR',
      },
      {
        id: 'security-review',
        label: 'Security review evidence',
        status: 'inaccessible',
        access_reason: 'forbidden',
      },
    ],
  };
}

function findingsFixture() {
  return [
    { id: 'MRR-BLOCK-1', severity: 'blocker', summary: 'Required security evidence is inaccessible.' },
    {
      id: 'MRR-NOTE-1',
      severity: 'info',
      summary: 'Docs-only follow-up noted.',
      rationale: 'The follow-up does not affect merge safety.',
    },
    {
      id: 'MRR-DEFER-1',
      severity: 'blocker',
      status: 'deferred',
      summary: 'Runtime observation continues after merge.',
      approvals: [{ actorId: 'sre-1', approvedAt: '2026-05-04T12:00:00.000Z', rationale: 'Approved for post-merge monitoring.' }],
    },
  ];
}

function reviewFixture(overrides = {}) {
  return {
    reviewId: 'MRR-116',
    reviewStatus: 'blocked',
    isCurrent: true,
    commitSha: 'abc116def456',
    sourceInventory: sourceInventoryFixture(),
    reviewedLogSources: [{ name: 'Repo validation', url: 'https://github.com/wiinc1/engineering-team/actions/runs/116/job/1', content: 'COMPLETE JOB LOG THAT MUST NOT APPEAR' }],
    findings: findingsFixture(),
    followUpLinks: [{ label: 'Follow-up issue', url: 'https://github.com/wiinc1/engineering-team/issues/117' }],
    approvals: [{ actorId: 'pm-1' }],
    metadata: {
      structuredReviewUrl: 'https://github.com/wiinc1/engineering-team/issues/116#merge-readiness-review',
      rawLog: 'RAW METADATA LOG THAT MUST NOT APPEAR',
    },
    ...overrides,
  };
}

test('renders the PR comment summary from allowlisted MergeReadinessReview fields', () => {
  const summary = renderMergeReadinessPrSummary(reviewFixture());

  assert.match(summary, /Review status: `blocked`/);
  assert.match(summary, /Commit SHA: `abc116def456`/);
  assert.match(summary, /Required sources reviewed:/);
  assert.match(summary, /\[Repo validation\]\(https:\/\/github.com\/wiinc1\/engineering-team\/actions\/runs\/116\)/);
  assert.match(summary, /Blocking findings:/);
  assert.match(summary, /`MRR-BLOCK-1`/);
  assert.match(summary, /Non-blocking findings with rationale:/);
  assert.match(summary, /The follow-up does not affect merge safety/);
  assert.match(summary, /Deferred blocking findings with approvals:/);
  assert.match(summary, /`sre-1`/);
  assert.match(summary, /Inaccessible evidence:/);
  assert.match(summary, /Security review evidence/);
  assert.match(summary, /Follow-up links:/);
  assert.match(summary, /Structured MergeReadinessReview:/);
});

test('does not paste copied source logs or unallowlisted review metadata into the PR comment', () => {
  const summary = renderMergeReadinessPrSummary(reviewFixture());

  assert.doesNotMatch(summary, /RAW FULL LOG LINE/);
  assert.doesNotMatch(summary, /COMPLETE JOB LOG/);
  assert.doesNotMatch(summary, /RAW METADATA LOG/);
  assert.doesNotMatch(summary, /rawLog/);
  assert.doesNotMatch(summary, /logText/);
  assert.doesNotMatch(summary, /content:/);
});

test('extracts status from the rendered PR summary for diagnostics only', () => {
  const summary = renderMergeReadinessPrSummary(reviewFixture({ reviewStatus: 'passed' }));

  assert.equal(extractPrSummaryReviewStatus(summary), 'passed');
});

test('keeps the structured review authoritative when a PR summary conflicts', () => {
  const conflictingComment = renderMergeReadinessPrSummary(reviewFixture({ reviewStatus: 'passed' }));
  const result = evaluateMergeReadinessSummaryPrecedence({
    review: reviewFixture({ reviewStatus: 'blocked' }),
    commentBody: conflictingComment,
    commitSha: 'abc116def456',
  });

  assert.equal(result.sourceOfTruth, 'structured_review');
  assert.equal(result.authoritativeStatus, 'blocked');
  assert.equal(result.commentStatus, 'passed');
  assert.equal(result.commentConflict, true);
  assert.equal(result.gate.conclusion, 'failure');
  assert.equal(result.gate.reason, 'blocked');
});
