const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldRequireFactoryHumanPmArchitect,
  buildFactoryHumanReviews,
  applyFactoryHumanPmArchitectContractFields,
} = require('../../lib/task-platform/factory-human-pm-architect');
const { buildFactoryExecutionContractBody } = require('../../lib/task-platform/factory-orchestration');
const { evaluatePmArchitectHumanReviewGate } = require('../../lib/audit/pm-architect-human-review-gate');

test('factory agent-driven path requires human PM/Architect acceptance fields', () => {
  assert.equal(shouldRequireFactoryHumanPmArchitect({ agentDrivenPhase1: true }), true);
  assert.equal(shouldRequireFactoryHumanPmArchitect({}, {}), false);

  const reviews = buildFactoryHumanReviews({ actorId: 'operator-1' });
  assert.equal(reviews.pm.actorType, 'human');
  assert.equal(reviews.architect.actorType, 'human');
  assert.equal(reviews.pm.status, 'approved');
});

test('applyFactoryHumanPmArchitectContractFields marks agent proposals and human reviews', () => {
  const { contract, humanGate } = applyFactoryHumanPmArchitectContractFields(
    { templateTier: 'Simple' },
    { agentDrivenPhase1: true, actorId: 'factory-op' },
  );
  assert.equal(humanGate.required, true);
  assert.equal(contract.require_human_pm_architect_review, true);
  assert.equal(contract.agent_proposals.pm, true);
  assert.equal(contract.reviewers.pm.actorType, 'agent');
  assert.equal(contract.human_reviews.pm.actorType, 'human');

  const gate = evaluatePmArchitectHumanReviewGate(contract);
  assert.equal(gate.required, true);
  assert.equal(gate.satisfied, true);
});

test('buildFactoryExecutionContractBody wires Q6 human gate for agent-driven phase1', () => {
  const body = buildFactoryExecutionContractBody({
    requirements: 'Ship gap resolution',
    templateTier: 'Simple',
    agentDrivenPhase1: true,
    actorId: 'factory-op',
  });
  assert.equal(body.require_human_pm_architect_review, true);
  assert.ok(body.human_reviews.pm);
  assert.ok(body.human_reviews.architect);
});
