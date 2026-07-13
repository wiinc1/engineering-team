'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createExecutionContractDraft, evaluateExecutionContractAutoApprovalPolicy } = require('../../lib/audit/execution-contracts');
const { applyFactoryHumanPmArchitectContractFields } = require('../../lib/task-platform/factory-human-pm-architect');

test('createExecutionContractDraft preserves factory human_reviews for Q6 auto-approval (#275/#276)', () => {
  const base = {
    templateTier: 'Simple',
    title: 'Pilot docs change',
    sections: {
      1: { body: 'As an operator I need a docs-only change for pilot.' },
      2: { body: 'Business context for reversible docs pilot work item here.' },
      4: { body: 'Given docs change when merged then checks pass on main.' },
      11: { body: 'Rollback by git revert of the docs change commit.' },
      12: { body: 'No production observability change is required for pilot.' },
      15: { body: 'Done when docs merge and automated checks pass green.' },
      16: { body: 'Validate with unit tests and standards gates only.' },
      17: { body: 'Operator handoff includes PR link and evidence package.' },
    },
    autoApprovalSignals: {
      unresolvedDependencies: [],
      productionSensitivePaths: [],
    },
  };
  const { contract: body } = applyFactoryHumanPmArchitectContractFields(base, {
    agentDrivenPhase1: true,
    actorId: 'factory-operator',
  });
  assert.ok(body.human_reviews?.pm);
  assert.ok(body.human_reviews?.architect);

  const draft = createExecutionContractDraft({
    taskId: 'TSK-276',
    summary: {
      title: 'Pilot docs change',
      operator_intake_requirements: 'docs only pilot change for factory trusted cohort',
    },
    history: [],
    body,
    actorId: 'factory-operator',
  });

  assert.equal(draft.contract.require_human_pm_architect_review, true);
  assert.equal(draft.contract.human_reviews.pm.actorType, 'human');
  assert.equal(draft.contract.human_reviews.architect.actorType, 'human');
  assert.deepEqual(draft.contract.agent_proposals, { pm: true, architect: true });

  const auto = evaluateExecutionContractAutoApprovalPolicy({ contract: draft.contract });
  assert.equal(auto.canAutoApprove, true);
  assert.equal(auto.pmArchitectHumanReviewGate.satisfied, true);
});
