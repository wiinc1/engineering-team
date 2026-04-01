const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuditStore, createProjectionWorker, createOutboxWorker } = require('../../lib/audit');

function makeStore(projectionMode = 'async', extraOptions = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-worker-'));
  return { baseDir, store: createAuditStore({ baseDir, projectionMode, maxAttempts: 2, ...extraOptions }) };
}

test('async projection worker advances queue and builds projections', async () => {
  const { store } = makeStore('async');
  store.appendEvent({ taskId: 'TSK-400', tenantId: 'tenant-w', eventType: 'task.created', actorType: 'agent', actorId: 'principal-engineer', idempotencyKey: 'create:TSK-400', payload: { title: 'Queued task', initial_stage: 'BACKLOG' } });
  store.appendEvent({ taskId: 'TSK-400', tenantId: 'tenant-w', eventType: 'task.stage_changed', actorType: 'agent', actorId: 'principal-engineer', idempotencyKey: 'move:TSK-400:IN_PROGRESS', payload: { from_stage: 'BACKLOG', to_stage: 'IN_PROGRESS' } });
  assert.equal(store.getTaskHistory('TSK-400', { tenantId: 'tenant-w' }).length, 0);

  const preMetrics = store.readMetrics();
  assert.equal(preMetrics.workflow_projection_lag_seconds >= 0, true);

  const worker = createProjectionWorker(store, { batchSize: 50 });
  const result = await worker.runOnce();
  assert.equal(result.processed, 2);

  const history = store.getTaskHistory('TSK-400', { tenantId: 'tenant-w' });
  assert.equal(history.length, 2);
  assert.deepEqual(history.map(event => event.sequence_number), [2, 1]);
  const metrics = store.readMetrics();
  assert.equal(metrics.workflow_projection_events_processed_total, 2);
  assert.equal(metrics.workflow_projection_lag_seconds, 0);
});

test('outbox worker publishes events', async () => {
  const { store } = makeStore('sync');
  store.appendEvent({ taskId: 'TSK-401', tenantId: 'tenant-w', eventType: 'task.created', actorType: 'agent', actorId: 'principal-engineer', idempotencyKey: 'create:TSK-401', payload: { title: 'Outbox task', initial_stage: 'BACKLOG' } });
  const published = [];
  const worker = createOutboxWorker(store, event => published.push(event), { batchSize: 10 });
  const result = await worker.runOnce();
  assert.equal(result.processed, 1);
  assert.equal(published.length, 1);
  assert.equal(published[0].task_id, 'TSK-401');
});

test('dead-letters entries after repeated worker failures and increments failure counters', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-worker-'));
  const store = createAuditStore({ baseDir, projectionMode: 'sync', maxAttempts: 1 });
  store.appendEvent({ taskId: 'TSK-402', tenantId: 'tenant-w', eventType: 'task.created', actorType: 'agent', actorId: 'principal-engineer', idempotencyKey: 'create:TSK-402', payload: { title: 'DLQ task', initial_stage: 'BACKLOG' } });
  const worker = createOutboxWorker(store, () => { throw new Error('publisher offline'); }, { batchSize: 10 });
  const result = await worker.runOnce();
  assert.equal(result.deadLettered, 1);
  assert.equal(result.failed, 1);
  const deadLetter = fs.readFileSync(store.files.outboxDeadLetter, 'utf8');
  assert.match(deadLetter, /publisher offline/);
  const metrics = store.readMetrics();
  assert.equal(metrics.workflow_outbox_publish_failures_total, 1);
});

test('store and workers honor ff_audit_foundation kill switch', async () => {
  const { store } = makeStore('async', { auditFoundationEnabled: false });
  assert.throws(() => store.appendEvent({ taskId: 'TSK-403', tenantId: 'tenant-w', eventType: 'task.created', actorType: 'agent', actorId: 'principal-engineer', idempotencyKey: 'create:TSK-403', payload: { title: 'Disabled task', initial_stage: 'BACKLOG' } }), /ff_audit_foundation/);
  const worker = createProjectionWorker(store, { batchSize: 10 });
  await assert.rejects(() => worker.runOnce(), /ff_audit_foundation/);
});
