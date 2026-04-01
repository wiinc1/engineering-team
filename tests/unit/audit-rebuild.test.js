const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuditStore } = require('../../lib/audit');

function makeStore() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-rebuild-'));
  return { baseDir, store: createAuditStore({ baseDir }) };
}

test('rebuilds projections and idempotency index from the append-only event stream', () => {
  const { baseDir, store } = makeStore();

  store.appendEvent({
    taskId: 'TSK-300',
    tenantId: 'tenant-r',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'create:TSK-300',
    payload: { title: 'Rebuild me', initial_stage: 'BACKLOG' },
  });

  store.appendEvent({
    taskId: 'TSK-300',
    tenantId: 'tenant-r',
    eventType: 'task.stage_changed',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'move:TSK-300',
    payload: { from_stage: 'BACKLOG', to_stage: 'IN_PROGRESS' },
  });

  fs.rmSync(path.join(baseDir, 'data', 'task-history-projection.json'));
  fs.rmSync(path.join(baseDir, 'data', 'task-current-state-projection.json'));
  fs.rmSync(path.join(baseDir, 'data', 'task-relationship-projection.json'));
  fs.rmSync(path.join(baseDir, 'data', 'workflow-audit-idempotency.json'));

  const result = store.rebuildProjections();
  assert.equal(result.rebuiltEvents, 2);
  assert.equal(result.rebuiltTasks, 1);

  const state = store.getTaskCurrentState('TSK-300', { tenantId: 'tenant-r' });
  assert.equal(state.current_stage, 'IN_PROGRESS');

  const history = store.getTaskHistory('TSK-300', { tenantId: 'tenant-r' });
  assert.equal(history.length, 2);

  const duplicate = store.appendEvent({
    taskId: 'TSK-300',
    tenantId: 'tenant-r',
    eventType: 'task.stage_changed',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'move:TSK-300',
    payload: { from_stage: 'BACKLOG', to_stage: 'IN_PROGRESS' },
  });
  assert.equal(duplicate.duplicate, true);
});
