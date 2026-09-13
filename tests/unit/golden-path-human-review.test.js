'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractFactoryApprovalProvenance,
  attachFactoryApprovalProvenance,
} = require('../../lib/task-platform/golden-path-human-review');

function provenanceHistory() {
  return { items: [
    {
      event_id: 'approval-1', event_type: 'task.execution_contract_approved',
      occurred_at: '2026-08-19T18:00:00.000Z', actor_id: 'policy', actor_type: 'system',
      payload: { approval_mode: 'policy' },
    },
    {
      event_id: 'review-1', event_type: 'task.pm_architect_human_review_recorded',
      occurred_at: '2026-08-19T17:59:00.000Z', actor_id: 'operator-1', actor_type: 'user',
      payload: { reviews: {
        pm: { actorId: 'operator-1', actorType: 'human', reviewedAt: '2026-08-19T17:59:00.000Z' },
        architect: { actorId: 'operator-1', actorType: 'human', reviewedAt: '2026-08-19T17:59:00.000Z' },
      } },
    },
  ] };
}

it('extracts human PM/Architect and approval event identities from task history', () => {
  const provenance = extractFactoryApprovalProvenance(provenanceHistory());
  assert.equal(provenance.humanReview.roles.pm.eventId, 'review-1');
  assert.equal(provenance.humanReview.roles.architect.actorType, 'human');
  assert.equal(provenance.approval.eventId, 'approval-1');
});

it('attaches task-history provenance to the policy object returned by approval', async () => {
  const response = { body: { data: { autoApprovalPolicy: { status: 'ready' } } } };
  const attached = await attachFactoryApprovalProvenance(response, {
    ctx: {}, taskId: 'TSK-320',
    apiSend: async () => ({ ok: true, body: provenanceHistory() }),
  });
  const audit = attached.body.data.autoApprovalPolicy.auditProvenance;
  assert.equal(audit.humanReview.eventId, 'review-1');
  assert.equal(audit.approval.eventId, 'approval-1');
});
