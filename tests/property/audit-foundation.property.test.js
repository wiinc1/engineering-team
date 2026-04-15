const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuditStore, WORKFLOW_AUDIT_EVENT_TYPES } = require('../../lib/audit');

function makeStore() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-property-'));
  return createAuditStore({ baseDir, workflowEngineEnabled: false });
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

const EVENT_TYPES = WORKFLOW_AUDIT_EVENT_TYPES.filter(type => !['task.unassigned', 'task.unblocked', 'task.child_link_removed', 'task.escalation_resolved', 'task.decision_revised', 'task.rollback_recorded', 'task.closed', 'task.pm_business_context_completed'].includes(type));

function randomChoice(random, items) {
  return items[Math.floor(random() * items.length)];
}

function buildPayload(eventType, n) {
  switch (eventType) {
    case 'task.created':
      return { title: `Task ${n}`, initial_stage: 'BACKLOG', priority: 'P1' };
    case 'task.stage_changed':
      return { from_stage: 'BACKLOG', to_stage: n % 2 === 0 ? 'IN_PROGRESS' : 'ARCHITECT_REVIEW' };
    case 'task.assigned':
      return { assignee: `engineer-${n % 3}` };
    case 'task.blocked':
      return { reason: `blocker-${n}` };
    case 'task.priority_changed':
      return { priority: n % 2 === 0 ? 'P0' : 'P2' };
    case 'task.escalated':
      return { reason: `escalation-${n}`, severity: n % 2 === 0 ? 'blocking' : 'advisory' };
    case 'task.child_link_added':
      return { child_task_id: `TSK-CHILD-${n}` };
    case 'task.decision_recorded':
      return { summary: `decision-${n}` };
    case 'task.comment_workflow_recorded':
      return { comment_type: 'note', summary: `note-${n}` };
    default:
      return { sample: n };
  }
}

test('property: generated event streams preserve monotonically increasing per-task ordering', async () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const random = seededRandom(seed);
    const store = makeStore();
    const expectedByTask = new Map();

    for (let i = 0; i < 40; i += 1) {
      const taskId = `TSK-PROP-${1 + Math.floor(random() * 4)}`;
      const eventType = i === 0 && !expectedByTask.has(taskId) ? 'task.created' : randomChoice(random, EVENT_TYPES);
      const count = (expectedByTask.get(taskId) || 0) + 1;
      expectedByTask.set(taskId, count);
      const result = await store.appendEvent({
        tenantId: 'tenant-prop',
        taskId,
        eventType,
        actorType: 'agent',
        actorId: `actor-${Math.floor(random() * 3)}`,
        idempotencyKey: `seed-${seed}:${taskId}:${i}`,
        occurredAt: new Date(Date.UTC(2026, 2, 31, 12, 0, i)).toISOString(),
        payload: buildPayload(eventType, i),
      });
      assert.equal(result.event.sequence_number, count);
    }

    for (const [taskId, count] of expectedByTask.entries()) {
      const history = await store.getTaskHistory(taskId, { tenantId: 'tenant-prop' });
      assert.equal(history.length, count);
      assert.deepEqual(history.map(event => event.sequence_number), Array.from({ length: count }, (_, index) => count - index));
    }
  }
});

test('property: repeating identical idempotency keys never creates duplicate history entries', async () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const store = makeStore();
    const taskId = `TSK-IDEMP-${seed}`;
    const key = `create:${taskId}`;

    const first = await store.appendEvent({
      tenantId: 'tenant-idemp',
      taskId,
      eventType: 'task.created',
      actorType: 'agent',
      actorId: 'principal-engineer',
      idempotencyKey: key,
      payload: { title: `Idempotent ${seed}`, initial_stage: 'BACKLOG' },
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const duplicate = await store.appendEvent({
        tenantId: 'tenant-idemp',
        taskId,
        eventType: 'task.created',
        actorType: 'agent',
        actorId: 'principal-engineer',
        idempotencyKey: key,
        payload: { title: `Idempotent ${seed}`, initial_stage: 'BACKLOG' },
      });
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.event.event_id, first.event.event_id);
    }

    const history = await store.getTaskHistory(taskId, { tenantId: 'tenant-idemp' });
    assert.equal(history.length, 1);
  }
});

const invalidPayloads = [null, undefined, '', 0, false];

test('property: unsupported event types are always rejected and valid event types continue to work', async () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const store = makeStore();
    for (const bad of invalidPayloads) {
      await assert.rejects(
        async () => {
          await store.appendEvent({
            taskId: `TSK-BAD-${seed}`,
            eventType: bad,
            actorType: 'agent',
            actorId: 'validator',
            idempotencyKey: `bad:${seed}:${String(bad)}`,
          });
        },
        (err) => {
          const message = err?.message || String(err);
          return /eventType is required|Unsupported workflow audit event type|Invalid transition/.test(message);
        }
      );
    }

    for (const eventType of WORKFLOW_AUDIT_EVENT_TYPES) {
      const taskId = `TSK-GOOD-${seed}-${eventType}`;
      const result = await store.appendEvent({
        taskId,
        eventType,
        actorType: 'agent',
        actorId: 'actor-validator',
        idempotencyKey: `good:${seed}:${eventType}`,
        payload: buildPayload(eventType, seed),
      });
      assert.equal(result.duplicate, false);
      const history = await store.getTaskHistory(taskId, { tenantId: 'engineering-team' });
      assert.equal(history.length, 1);
    }
  }
});
