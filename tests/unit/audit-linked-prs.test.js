const assert = require('node:assert/strict');
const test = require('node:test');
const {
  collectLinkedPrs,
  orderLinkedPrHistoryEvents,
} = require('../../lib/audit/linked-prs');

test('orderLinkedPrHistoryEvents sorts by sequence then occurred_at', () => {
  const ordered = orderLinkedPrHistoryEvents([
    { sequence_number: 2, occurred_at: '2026-06-23T20:00:00.000Z', payload: { pr_number: 2 } },
    { sequence_number: 1, occurred_at: '2026-06-23T21:00:00.000Z', payload: { pr_number: 1 } },
  ]);
  assert.equal(ordered[0].payload.pr_number, 1);
  assert.equal(ordered[1].payload.pr_number, 2);
});

test('collectLinkedPrs applies later github_pr_synced merge state', () => {
  const history = [
    {
      sequence_number: 1,
      event_type: 'task.engineer_submission_recorded',
      payload: { pr_number: 271, pr_url: 'https://github.com/wiinc1/engineering-team/pull/271', pr_state: 'open', pr_merged: false },
    },
    {
      sequence_number: 2,
      event_type: 'task.github_pr_synced',
      payload: {
        pr_number: 271,
        pr_url: 'https://github.com/wiinc1/engineering-team/pull/271',
        pr_state: 'merged',
        pr_merged: true,
        pr_repository: 'wiinc1/engineering-team',
        linked_prs: [{
          number: 271,
          url: 'https://github.com/wiinc1/engineering-team/pull/271',
          repository: 'wiinc1/engineering-team',
          state: 'merged',
          merged: true,
        }],
      },
    },
  ];
  const linked = collectLinkedPrs(history, {}, 'TSK-PILOT');
  assert.equal(linked.length, 1);
  assert.equal(linked[0].merged, true);
  assert.equal(linked[0].state, 'merged');
});