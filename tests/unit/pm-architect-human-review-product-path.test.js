'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluatePmArchitectHumanReviewGate,
  applyHumanPmArchitectReviewsToContract,
  buildHumanReviewRecord,
  mergeDispatchReadinessWithHumanReviewGate,
} = require('../../lib/audit/pm-architect-human-review-gate');

const {
  evaluateExecutionContractApprovalReadiness,
  evaluateExecutionContractAutoApprovalPolicy,
  evaluateExecutionContractDispatchReadiness,
} = require('../../lib/audit/execution-contracts');

const {
  recordPmArchitectHumanReviews,
  canRecordPmArchitectHumanReview,
  PM_ARCHITECT_HUMAN_REVIEW_EVENT,
} = require('../../lib/audit/pm-architect-human-review-record');

const { isWorkflowAuditEventType } = require('../../lib/audit/event-types');

function agentProposalContract(overrides = {}) {
  return {
    version: 1,
    status: 'draft',
    template_tier: 'Simple',
    validation: { status: 'valid' },
    require_human_pm_architect_review: true,
    agent_proposals: { pm: true, architect: true },
    reviewers: {
      pm: { status: 'approved', actorId: 'pm-agent', actorType: 'agent' },
      architect: { status: 'approved', actorId: 'architect-agent', actorType: 'agent' },
    },
    reviewer_routing: { required_role_approvals: [] },
    review_feedback: { questions: [], comments: [] },
    sections: {
      1: { body: 'As an operator I need a docs-only change for pilot.' },
      2: { body: 'Business context for reversible docs pilot work.' },
      4: { body: 'Given docs change when merged then checks pass.' },
      11: { body: 'Rollback by git revert of the docs change.' },
      12: { body: 'No production observability change required.' },
      15: { body: 'Done when docs merge and automated checks pass.' },
      16: { body: 'Validate with unit tests and standards gates.' },
      17: { body: 'Operator handoff includes PR link and evidence.' },
    },
    ...overrides,
  };
}

function createMemoryStore(initialHistory = []) {
  const history = [...initialHistory];
  let seq = history.length;
  return {
    history,
    async getTaskHistory() {
      return [...history].sort((a, b) => Number(b.sequence_number || 0) - Number(a.sequence_number || 0));
    },
    async appendEvent(input) {
      seq += 1;
      const event = {
        event_id: `evt-${seq}`,
        tenant_id: input.tenantId || 'engineering-team',
        task_id: input.taskId,
        event_type: input.eventType,
        actor_id: input.actorId,
        actor_type: input.actorType,
        sequence_number: seq,
        occurred_at: new Date().toISOString(),
        recorded_at: new Date().toISOString(),
        payload: input.payload || {},
        source: input.source || 'test',
        idempotency_key: input.idempotencyKey,
      };
      history.push(event);
      return { event, duplicate: false };
    },
  };
}

describe('product path human PM/Architect gate (GitLab #275)', () => {
  it('registers durable audit event type', () => {
    assert.equal(isWorkflowAuditEventType(PM_ARCHITECT_HUMAN_REVIEW_EVENT), true);
  });

  it('rejects agent actors from building human review records', () => {
    assert.throws(
      () => buildHumanReviewRecord({
        role: 'pm',
        actorId: 'pm-agent',
        actorType: 'agent',
        approved: true,
      }),
      (error) => error.code === 'agent_cannot_record_human_review',
    );
  });

  it('blocks approval, auto-approval, and dispatch for agent-only proposals', () => {
    const contract = agentProposalContract();
    const gate = evaluatePmArchitectHumanReviewGate(contract);
    assert.equal(gate.required, true);
    assert.equal(gate.satisfied, false);

    const approval = evaluateExecutionContractApprovalReadiness(contract);
    assert.equal(approval.canApprove, false);
    assert.equal(approval.status, 'blocked_human_review');

    const auto = evaluateExecutionContractAutoApprovalPolicy({ contract });
    assert.equal(auto.pmArchitectHumanReviewGate.satisfied, false);
    assert.notEqual(auto.eligible === true && auto.approved === true, true);

    const dispatch = evaluateExecutionContractDispatchReadiness({ contract: { ...contract, status: 'approved' } });
    assert.equal(dispatch.canDispatch, false);
    assert.ok(dispatch.pmArchitectHumanReviewGate);
    assert.equal(dispatch.pmArchitectHumanReviewGate.satisfied, false);
    assert.ok((dispatch.blockedReasons || []).some((item) => item.code === 'pm_architect_human_review_required'
      || item.code === 'missing_human_pm_review'));
  });

  it('clears approval and dispatch after pure human review application', () => {
    const contract = agentProposalContract();
    const applied = applyHumanPmArchitectReviewsToContract(contract, {
      role: 'both',
      reason: 'Operator accepts agent PM/Architect proposals',
    }, {
      actorId: 'operator-1',
      actorType: 'human',
    });
    assert.equal(applied.gate.satisfied, true);
    assert.equal(applied.human_reviews.pm.actorType, 'human');
    assert.equal(applied.human_reviews.architect.actorType, 'human');

    const approval = evaluateExecutionContractApprovalReadiness(applied.contract);
    assert.equal(approval.canApprove, true);
    assert.equal(approval.pmArchitectHumanReviewGate.satisfied, true);

    const dispatch = evaluateExecutionContractDispatchReadiness({
      contract: { ...applied.contract, status: 'approved' },
    });
    assert.equal(dispatch.canDispatch, true);
    assert.equal(dispatch.pmArchitectHumanReviewGate.satisfied, true);
  });

  it('mergeDispatchReadinessWithHumanReviewGate blocks and unblocks via shipped helper', () => {
    const contract = agentProposalContract({ status: 'approved' });
    const base = { canDispatch: true, blockedReasons: [], dispatchPolicy: { canDispatch: true } };
    const blocked = mergeDispatchReadinessWithHumanReviewGate(base, contract);
    assert.equal(blocked.canDispatch, false);

    const clearedContract = applyHumanPmArchitectReviewsToContract(contract, { role: 'both' }, {
      actorId: 'human-op',
      actorType: 'user',
    }).contract;
    const cleared = mergeDispatchReadinessWithHumanReviewGate(base, clearedContract);
    assert.equal(cleared.canDispatch, true);
  });

  it('recordPmArchitectHumanReviews writes contract version + human review audit events', async () => {
    const contract = agentProposalContract();
    const created = {
      event_id: 'evt-create',
      tenant_id: 'engineering-team',
      task_id: 'TSK-275',
      event_type: 'task.created',
      actor_id: 'operator',
      actor_type: 'user',
      sequence_number: 1,
      occurred_at: new Date().toISOString(),
      payload: {
        title: 'Issue 275 human gate',
        raw_requirements: 'As an operator I need human PM/Architect acceptance before dispatch.',
      },
    };
    const version = {
      event_id: 'evt-version',
      tenant_id: 'engineering-team',
      task_id: 'TSK-275',
      event_type: 'task.execution_contract_version_recorded',
      actor_id: 'pm-agent',
      actor_type: 'agent',
      sequence_number: 2,
      occurred_at: new Date().toISOString(),
      payload: {
        version: 1,
        contract,
      },
    };
    const store = createMemoryStore([created, version]);
    assert.equal(canRecordPmArchitectHumanReview({ roles: ['pm'] }), true);
    assert.equal(canRecordPmArchitectHumanReview({ roles: ['reader'] }), false);

    const result = await recordPmArchitectHumanReviews({
      store,
      taskId: 'TSK-275',
      tenantId: 'engineering-team',
      context: { actorId: 'human-operator-1', roles: ['pm', 'operator'], actorType: 'user' },
      body: {
        role: 'both',
        reason: 'Human accepts agent proposals for Simple docs task',
        actorType: 'human',
      },
      source: 'test',
    });

    assert.equal(result.gate.satisfied, true);
    assert.ok(result.human_reviews.pm);
    assert.ok(result.human_reviews.architect);
    assert.equal(result.versionResult.event.event_type, 'task.execution_contract_version_recorded');
    assert.equal(result.reviewResult.event.event_type, PM_ARCHITECT_HUMAN_REVIEW_EVENT);
    assert.equal(result.reviewResult.event.payload.issue, 275);
    assert.ok(result.versionResult.event.payload.contract.human_reviews.pm.actorId);

    // Approval/dispatch now green via recorded contract fields.
    const after = result.versionResult.event.payload.contract;
    assert.equal(evaluateExecutionContractApprovalReadiness(after).canApprove, true);
    assert.equal(
      evaluateExecutionContractDispatchReadiness({ contract: { ...after, status: 'approved' } }).canDispatch,
      true,
    );

    // Agent body is rejected on product path.
    await assert.rejects(
      () => recordPmArchitectHumanReviews({
        store,
        taskId: 'TSK-275',
        tenantId: 'engineering-team',
        context: { actorId: 'pm-agent', roles: ['pm'], actorType: 'agent' },
        body: { role: 'pm', actorType: 'agent', actorId: 'pm-agent' },
      }),
      (error) => error.code === 'agent_cannot_record_human_review' || error.statusCode === 403,
    );
  });
});
