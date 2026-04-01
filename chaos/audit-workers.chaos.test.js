const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFileAuditStore } = require('../lib/audit/store');

function makeStore(options = {}) {
  return createFileAuditStore({
    baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'audit-chaos-')),
    projectionMode: 'async',
    maxAttempts: 3,
    ...options,
  });
}

test('outbox retries transient publisher failures and eventually succeeds without dead-lettering', () => {
  const store = makeStore();
  store.appendEvent({
    tenantId: 'tenant-chaos',
    taskId: 'TSK-CHAOS-1',
    eventType: 'task.created',
    actorId: 'chaos-runner',
    actorType: 'agent',
    idempotencyKey: 'chaos:create:1',
    payload: { title: 'Chaos task', initial_stage: 'BACKLOG' },
  });

  let attempts = 0;
  const publisher = () => {
    attempts += 1;
    if (attempts < 2) throw new Error(`transient failure ${attempts}`);
  };

  let result = store.processOutbox(publisher, 10);
  assert.equal(result.processed, 0);

  const queuePath = store.files.outbox;
  const retryQueue = fs.readFileSync(queuePath, 'utf8');
  assert.match(retryQueue, /pending/);
  assert.match(retryQueue, /transient failure/);

  const queued = JSON.parse(retryQueue.trim().split('\n')[0]);
  queued.available_at = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(queuePath, `${JSON.stringify(queued)}\n`);

  result = store.processOutbox(publisher, 10);
  assert.equal(result.processed, 1);
  assert.equal(result.deadLettered, 0);
});

test('outbox dead-letters poison events after max attempts', () => {
  const store = makeStore({ maxAttempts: 2 });
  store.appendEvent({
    tenantId: 'tenant-chaos',
    taskId: 'TSK-CHAOS-2',
    eventType: 'task.created',
    actorId: 'chaos-runner',
    actorType: 'agent',
    idempotencyKey: 'chaos:create:2',
    payload: { title: 'Poison task', initial_stage: 'BACKLOG' },
  });

  const publisher = () => { throw new Error('permanent downstream outage'); };
  let result = store.processOutbox(publisher, 10);
  assert.equal(result.processed, 0);

  const queuePath = store.files.outbox;
  let queued = JSON.parse(fs.readFileSync(queuePath, 'utf8').trim().split('\n')[0]);
  queued.available_at = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(queuePath, `${JSON.stringify(queued)}\n`);

  result = store.processOutbox(publisher, 10);
  assert.equal(result.processed, 0);
  assert.equal(result.deadLettered, 1);

  const deadLetter = fs.readFileSync(store.files.outboxDeadLetter, 'utf8');
  assert.match(deadLetter, /permanent downstream outage/);
  assert.equal(fs.readFileSync(queuePath, 'utf8'), '');
});
