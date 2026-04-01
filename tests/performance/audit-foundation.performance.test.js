const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { createFileAuditStore } = require('../../lib/audit/store');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'audit-perf-'));
}

test('file-backed audit store stays within baseline append/query budgets', () => {
  const store = createFileAuditStore({ baseDir: makeTempDir(), projectionMode: 'sync' });
  const totalEvents = 250;

  const appendStart = performance.now();
  for (let index = 0; index < totalEvents; index += 1) {
    store.appendEvent({
      tenantId: 'tenant-perf',
      taskId: `TSK-PERF-${String(index % 25).padStart(3, '0')}`,
      eventType: index % 5 === 0 ? 'task.stage_changed' : 'task.comment_workflow_recorded',
      actorId: 'perf-runner',
      actorType: 'agent',
      idempotencyKey: `perf:${index}`,
      payload: index % 5 === 0
        ? { from_stage: 'BACKLOG', to_stage: 'IN_PROGRESS' }
        : { comment_type: 'note', body: `event-${index}` },
    });
  }
  const appendDuration = performance.now() - appendStart;

  const historyStart = performance.now();
  const history = store.getTaskHistory('TSK-PERF-001', { tenantId: 'tenant-perf' });
  const historyDuration = performance.now() - historyStart;

  const stateStart = performance.now();
  const state = store.getTaskCurrentState('TSK-PERF-001', { tenantId: 'tenant-perf' });
  const stateDuration = performance.now() - stateStart;

  assert.equal(history.length > 0, true);
  assert.ok(state);
  assert.ok(appendDuration < 2500, `append budget exceeded: ${appendDuration}ms`);
  assert.ok(historyDuration < 150, `history query budget exceeded: ${historyDuration}ms`);
  assert.ok(stateDuration < 150, `state query budget exceeded: ${stateDuration}ms`);
});

test('async projection worker drains a bounded backlog within baseline budget', async () => {
  const store = createFileAuditStore({ baseDir: makeTempDir(), projectionMode: 'async' });
  const totalEvents = 150;

  for (let index = 0; index < totalEvents; index += 1) {
    store.appendEvent({
      tenantId: 'tenant-perf',
      taskId: 'TSK-PERF-ASYNC',
      eventType: index === 0 ? 'task.created' : 'task.comment_workflow_recorded',
      actorId: 'perf-runner',
      actorType: 'agent',
      idempotencyKey: `async:${index}`,
      payload: index === 0 ? { title: 'Async perf task', initial_stage: 'BACKLOG' } : { comment_type: 'note', body: `note-${index}` },
    });
  }

  const started = performance.now();
  const result = await store.processProjectionQueue(200);
  const duration = performance.now() - started;

  assert.equal(result.processed, totalEvents);
  assert.ok(duration < 2500, `projection queue budget exceeded: ${duration}ms`);
  assert.equal(store.getTaskHistory('TSK-PERF-ASYNC', { tenantId: 'tenant-perf' }).length, totalEvents);
});
