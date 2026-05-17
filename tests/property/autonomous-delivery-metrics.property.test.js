const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyOperatorInterventions } = require('../../lib/audit/autonomous-delivery-metrics');

function event(sequence, event_type, payload = {}, actor = {}) {
  return {
    event_id: `evt-${sequence}`,
    event_type,
    occurred_at: new Date(Date.parse('2026-05-01T10:00:00.000Z') + sequence * 60000).toISOString(),
    sequence_number: sequence,
    actor_id: actor.actor_id || 'operator-1',
    actor_type: actor.actor_type || 'operator',
    payload,
    correlation_id: payload.correlation_id || `corr-${sequence}`,
  };
}

test('property: routine approvals and closeout acknowledgements never count as operator interventions', () => {
  const routineTypes = [
    'task.execution_contract_approved',
    'task.contract_coverage_audit_validated',
    'task.sre_approval_recorded',
    'task.github_pr_synced',
    'task.closed',
  ];
  const approval = event(1, 'task.execution_contract_approved', { version: 1 });

  for (let index = 0; index < routineTypes.length; index += 1) {
    const type = routineTypes[index];
    const result = classifyOperatorInterventions([
      approval,
      event(index + 2, type, { reason: 'Operator acknowledged required workflow gate.' }),
    ], { approvalOccurredAt: approval.occurred_at });
    assert.equal(result.count, 0, `${type} should remain routine`);
  }
});

test('property: repeated operator actions with the same root cause are deduplicated', () => {
  const approval = event(1, 'task.execution_contract_approved', { version: 1 });
  const history = [
    approval,
    event(2, 'task.reassigned', { reason: 'Manual reroute.', root_cause_id: 'cause-1' }),
    event(3, 'task.stage_changed', { from_stage: 'QA_TESTING', to_stage: 'IMPLEMENTATION', reason: 'Manual reroute.', root_cause_id: 'cause-1' }),
    event(4, 'task.stage_changed', { from_stage: 'QA_TESTING', to_stage: 'IMPLEMENTATION', reason: 'Manual reroute.', root_cause_id: 'cause-2' }),
  ];

  const result = classifyOperatorInterventions(history, { approvalOccurredAt: approval.occurred_at });

  assert.equal(result.count, 2);
  assert.deepEqual(result.items.map(item => item.root_cause_key).sort(), ['cause-1', 'cause-2']);
});
