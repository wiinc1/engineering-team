const assert = require('node:assert/strict');

function buildSatisfyDispatchGates(authHeaders) {
  return async function satisfyDispatchGates(baseUrl, secret, taskId, {
    ux = false,
    contractVersion = 1,
  } = {}) {
    const headers = {
      'content-type': 'application/json',
      ...authHeaders(secret, { roles: ['admin', 'architect', 'ux', 'pm'] }),
    };

    if (ux) {
      const uxResponse = await fetch(`${baseUrl}/tasks/${taskId}/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          eventType: 'task.ux_implementation_review_recorded',
          actorType: 'agent',
          actorId: 'ux-lead',
          idempotencyKey: `ux-review:${taskId}:unit-test`,
          payload: {
            contract_version: contractVersion,
            status: 'approved',
            approved: true,
            comment: 'UX implementation review complete for unit test.',
          },
        }),
      });
      assert.equal(uxResponse.status, 202);
    }

    const assignmentResponse = await fetch(`${baseUrl}/tasks/${taskId}/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        eventType: 'task.architect_engineer_assignment_recorded',
        actorType: 'agent',
        actorId: 'architect-lead',
        idempotencyKey: `architect-assign:${taskId}:unit-test`,
        payload: {
          contract_version: contractVersion,
          engineer_tier: 'Sr',
          assignee: 'engineer-sr',
          tier_rationale: 'Architect engineer assignment for unit test dispatch.',
          ready_for_engineering: true,
        },
      }),
    });
    assert.equal(assignmentResponse.status, 202);
  };
}

module.exports = {
  buildSatisfyDispatchGates,
};