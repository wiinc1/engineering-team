const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  detectPmArchitectAgentDisagreement,
  evaluatePmArchitectHumanReviewGate,
  PM_ARCHITECT_HUMAN_REVIEW_POLICY_VERSION,
} = require('../../lib/audit/pm-architect-human-review-gate');

const {
  evaluateExecutionContractApprovalReadiness,
  evaluateExecutionContractAutoApprovalPolicy,
} = require('../../lib/audit/execution-contracts');

function baseContract(overrides = {}) {
  return {
    version: 1,
    template_tier: 'Simple',
    validation: { status: 'valid' },
    reviewers: {},
    reviewer_routing: { required_role_approvals: [] },
    review_feedback: { questions: [], comments: [] },
    sections: {
      1: { body: 'As an operator I need a docs-only change.' },
      2: { body: 'Business context for a reversible docs pilot.' },
      4: { body: 'Given docs change when merged then checks pass.' },
      11: { body: 'Rollback by git revert.' },
      12: { body: 'No prod observability change.' },
      15: { body: 'Done when docs merge and checks pass.' },
      16: { body: 'Validate with unit tests.' },
      17: { body: 'Operator handoff includes PR link.' },
    },
    ...overrides,
  };
}

test('detects PM/Architect agent status conflict as disagreement', () => {
  const detection = detectPmArchitectAgentDisagreement(baseContract({
    reviewers: {
      pm: { status: 'approved', actorId: 'pm-agent', actorType: 'agent' },
      architect: { status: 'changes_requested', actorId: 'architect-agent', actorType: 'agent' },
    },
  }));
  assert.equal(detection.active, true);
  assert.ok(detection.disagreements.some((item) => item.source === 'reviewer_status_conflict'));
});

test('detects explicit agent_disagreement records', () => {
  const detection = detectPmArchitectAgentDisagreement(baseContract({
    agent_disagreement: {
      summary: 'PM agent wants Simple; Architect agent wants Standard with new API.',
      roles: ['pm', 'architect'],
    },
  }));
  assert.equal(detection.active, true);
  assert.equal(detection.disagreements[0].source, 'agent_disagreement');
});

test('detects open blocking feedback from both PM and Architect', () => {
  const detection = detectPmArchitectAgentDisagreement(baseContract({
    review_feedback: {
      questions: [
        { id: 'q-pm', role: 'pm', blocking: true, state: 'open', body: 'Scope too large?' },
        { id: 'q-arch', role: 'architect', blocking: true, state: 'open', body: 'API boundary unclear?' },
      ],
    },
  }));
  assert.equal(detection.active, true);
  assert.ok(detection.disagreements.some((item) => item.source === 'cross_role_blocking_feedback'));
});

test('human review gate blocks until human PM and Architect accept', () => {
  const contract = baseContract({
    reviewers: {
      pm: { status: 'approved', actorId: 'pm-agent', actorType: 'agent' },
      architect: { status: 'changes_requested', actorId: 'architect-agent', actorType: 'agent' },
    },
  });
  const blocked = evaluatePmArchitectHumanReviewGate(contract);
  assert.equal(blocked.policy_version, PM_ARCHITECT_HUMAN_REVIEW_POLICY_VERSION);
  assert.equal(blocked.required, true);
  assert.equal(blocked.satisfied, false);
  assert.deepEqual(
    blocked.missingHumanReviews.map((item) => item.code),
    ['missing_human_pm_review', 'missing_human_architect_review']
  );

  const resolved = evaluatePmArchitectHumanReviewGate({
    ...contract,
    human_reviews: {
      pm: { status: 'approved', actorId: 'human-pm-1', actorType: 'user' },
      architect: { status: 'approved', actorId: 'human-arch-1', actorType: 'human' },
    },
  });
  assert.equal(resolved.required, true);
  assert.equal(resolved.satisfied, true);
  assert.equal(resolved.canApprove, true);
});

test('wired approval readiness blocks on agent disagreement and clears after human reviews', () => {
  const disagree = baseContract({
    reviewers: {
      pm: { status: 'approved', actorId: 'pm-agent', actorType: 'agent' },
      architect: { status: 'changes_requested', actorId: 'architect-agent', actorType: 'agent' },
    },
  });
  const blocked = evaluateExecutionContractApprovalReadiness(disagree);
  assert.equal(blocked.canApprove, false);
  assert.equal(blocked.status, 'blocked_human_review');
  assert.ok(blocked.pmArchitectHumanReviewGate);
  assert.ok(
    blocked.missingRequiredApprovals.some((item) => item.code === 'missing_human_pm_review')
  );
  assert.ok(
    blocked.missingRequiredApprovals.some((item) => item.code === 'missing_human_architect_review')
  );

  const ready = evaluateExecutionContractApprovalReadiness({
    ...disagree,
    human_reviews: {
      pm: { status: 'approved', actorId: 'human-pm-1', actorType: 'user' },
      architect: { status: 'approved', actorId: 'human-arch-1', actorType: 'human' },
    },
  });
  assert.equal(ready.canApprove, true);
  assert.equal(ready.pmArchitectHumanReviewGate.satisfied, true);
});

test('wired auto-approval policy is blocked while agent disagreement lacks human reviews', () => {
  const disagree = baseContract({
    template_tier: 'Simple',
    agent_disagreement: {
      summary: 'Agents disagree on rollout risk.',
      roles: ['pm', 'architect'],
    },
    auto_approval_signals: {
      touchesProductionAuth: false,
      touchesSecurityPaths: false,
      touchesDataModel: false,
      hasUnresolvedDependencies: false,
      hasClearRollbackPath: true,
    },
  });
  const blocked = evaluateExecutionContractAutoApprovalPolicy({ contract: disagree });
  assert.equal(blocked.pmArchitectHumanReviewGate.required, true);
  assert.equal(blocked.pmArchitectHumanReviewGate.satisfied, false);
  assert.equal(blocked.eligible === true && blocked.approved === true, false);
  assert.ok(
    (blocked.blocked_reasons || []).includes('pm_architect_agent_disagreement_requires_human_review')
    || blocked.blocked === true
    || blocked.approved_by_policy === false
  );

  const cleared = evaluateExecutionContractAutoApprovalPolicy({
    contract: {
      ...disagree,
      human_reviews: {
        pm: { status: 'approved', actorId: 'human-pm-1', actorType: 'user' },
        architect: { status: 'approved', actorId: 'human-arch-1', actorType: 'human' },
      },
    },
  });
  assert.equal(cleared.pmArchitectHumanReviewGate.satisfied, true);
});

test('no disagreement keeps human gate optional', () => {
  const gate = evaluatePmArchitectHumanReviewGate(baseContract({
    reviewers: {
      pm: { status: 'approved', actorId: 'human-pm', actorType: 'user' },
      architect: { status: 'approved', actorId: 'human-arch', actorType: 'user' },
    },
  }));
  assert.equal(gate.required, false);
  assert.equal(gate.satisfied, true);
  assert.equal(gate.disagreementActive, false);
});
