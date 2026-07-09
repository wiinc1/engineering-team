const test = require('node:test');
const assert = require('node:assert/strict');
const {
  contractRequiresUxImplementationReview,
  evaluateUxImplementationDispatchGate,
  augmentDispatchReadinessWithUxGate,
  approvalPayloadForContract,
  findLatestUxImplementationReview,
} = require('../../lib/audit/execution-contract-ux-dispatch');
const {
  evaluateExecutionContractDispatchReadiness,
} = require('../../lib/audit/execution-contracts');

function uiUxContract(overrides = {}) {
  return {
    status: 'approved',
    version: 10,
    template_tier: 'Standard',
    title: 'UI Update',
    risk_flags: [{ id: 'human_workflow' }, { id: 'desktop_visual_validation' }],
    reviewer_routing: {
      reviewers: {
        ux: { required: true, approvalRequired: true, status: 'approved', approved: true },
      },
    },
    sections: {
      3: { body: 'Queue-first Command Center journey for desktop operators.' },
      10: { body: 'UI/UX requirements for navigation, inspector, and design tokens.' },
    },
    ...overrides,
  };
}

test('contractRequiresUxImplementationReview detects UI/UX-facing approved contracts', () => {
  assert.equal(contractRequiresUxImplementationReview(uiUxContract()), true);
  assert.equal(contractRequiresUxImplementationReview({
    status: 'approved',
    template_tier: 'Simple',
    sections: { 1: { body: 'Backend-only cron adjustment.' } },
    reviewer_routing: { reviewers: { ux: { required: false } } },
  }), false);
});

test('approvalPayloadForContract routes UI work to UX implementation review', () => {
  const payload = approvalPayloadForContract(uiUxContract());
  assert.equal(payload.waiting_state, 'ux_implementation_review');
  assert.match(payload.next_required_action, /UX Designer/);
  assert.equal(payload.ux_implementation_review_required, true);
});

test('augmentDispatchReadinessWithUxGate blocks engineer dispatch until UX review is recorded', () => {
  const readiness = evaluateExecutionContractDispatchReadiness({
    contract: uiUxContract(),
    verificationReport: { path: 'docs/reports/TSK-011-ui-update-verification.md', report_id: 'VR-TSK-011-v10' },
  });

  const blocked = augmentDispatchReadinessWithUxGate(readiness, {
    contract: uiUxContract(),
    uxImplementationReview: null,
  });

  assert.equal(blocked.canDispatch, false);
  assert.ok(blocked.missingRequiredArtifacts.includes('ux_implementation_review'));
  assert.equal(blocked.dispatchPolicy.uxDispatch.required, true);
  assert.equal(blocked.dispatchPolicy.uxDispatch.assignee, 'ux-designer');
  assert.equal(blocked.dispatchPolicy.preDispatchAssignee, 'ux-designer');
  assert.equal(blocked.dispatchPolicy.selectedAssignee, 'engineer-sr');

  const history = [{
    event_type: 'task.ux_implementation_review_recorded',
    occurred_at: '2026-06-26T01:00:00.000Z',
    actor_id: 'ux-designer',
    payload: {
      contract_version: 10,
      status: 'approved',
      approved: true,
      comment: 'Ready for engineer implementation.',
    },
  }];
  const review = findLatestUxImplementationReview(history, 10);
  const unblocked = augmentDispatchReadinessWithUxGate(readiness, {
    contract: uiUxContract(),
    uxImplementationReview: review,
  });

  assert.equal(unblocked.uxImplementationReview.satisfied, true);
  assert.equal(unblocked.dispatchPolicy.uxDispatch.satisfied, true);
  assert.equal(unblocked.canDispatch, true);
});

test('evaluateUxImplementationDispatchGate treats changes_requested as unsatisfied', () => {
  const gate = evaluateUxImplementationDispatchGate({
    contract: uiUxContract(),
    uxImplementationReview: {
      status: 'changes_requested',
      approved: false,
    },
  });
  assert.equal(gate.required, true);
  assert.equal(gate.satisfied, false);
});