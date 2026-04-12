const test = require('node:test');
const assert = require('node:assert/strict');

const { createTaskLockPayload, getActiveTaskLock } = require('../../lib/audit/task-locks');

test('task locks expire once their TTL window passes', () => {
  const now = Date.parse('2026-04-12T18:00:00.000Z');
  const payload = createTaskLockPayload({
    actorId: 'engineer-user',
    reason: 'Editing task detail',
    action: 'task_detail_edit',
    ttlSeconds: 30,
    now,
  });

  const state = {
    lock_owner: payload.owner_id,
    lock_acquired_at: payload.acquired_at,
    lock_expires_at: payload.expires_at,
    lock_reason: payload.reason,
    lock_action: payload.action,
  };

  assert.equal(getActiveTaskLock(state, now + 10_000).ownerId, 'engineer-user');
  assert.equal(getActiveTaskLock(state, now + 31_000), null);
});
