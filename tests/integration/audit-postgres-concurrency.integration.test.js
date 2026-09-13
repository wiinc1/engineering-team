const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPgPoolFromEnv,
  createPostgresAuditStore,
} = require('../../lib/audit');

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? test : test.skip;
const TENANT_ID = 'tenant-audit-sequence-concurrency';
const TASK_ID = 'TSK-PG-CONCURRENT-SEQUENCE';
const APPEND_COUNT = 24;

function uniqueAppend(store, index) {
  return store.appendEvent({
    tenantId: TENANT_ID,
    taskId: TASK_ID,
    eventType: index === 0 ? 'task.created' : 'task.decision_recorded',
    actorType: 'agent',
    actorId: 'factory-orchestrator',
    idempotencyKey: `concurrent-sequence:${TASK_ID}:${index}`,
    payload: index === 0
      ? { title: 'Concurrent sequence allocation', initial_stage: 'BACKLOG' }
      : { decision: `Concurrent event ${index}` },
  });
}

function duplicateAppend(store) {
  return store.appendEvent({
    tenantId: TENANT_ID,
    taskId: TASK_ID,
    eventType: 'task.decision_recorded',
    actorType: 'agent',
    actorId: 'factory-orchestrator',
    idempotencyKey: `concurrent-idempotency:${TASK_ID}`,
    payload: { decision: 'Record this concurrent command once.' },
  });
}

async function readSequences(pool) {
  const result = await pool.query(
    'SELECT sequence_number FROM audit_events WHERE tenant_id = $1 AND task_id = $2 ORDER BY sequence_number',
    [TENANT_ID, TASK_ID],
  );
  return result.rows.map(row => Number(row.sequence_number));
}

function sequenceRange(count) {
  return Array.from({ length: count }, (_, index) => index + 1);
}

integration('postgres serializes concurrent sequence allocation per tenant and task', async () => {
  const pool = createPgPoolFromEnv(connectionString);
  const store = createPostgresAuditStore({ pool, baseDir: process.cwd() });

  try {
    await store.runMigrations({ baseDir: process.cwd() });
    await pool.query(
      'DELETE FROM audit_events WHERE tenant_id = $1 AND task_id = $2',
      [TENANT_ID, TASK_ID],
    );

    const results = await Promise.all(
      Array.from({ length: APPEND_COUNT }, (_, index) => uniqueAppend(store, index)),
    );
    assert.equal(results.length, APPEND_COUNT);
    assert.ok(results.every(result => result.duplicate === false));
    assert.deepEqual(await readSequences(pool), sequenceRange(APPEND_COUNT));

    const duplicateResults = await Promise.all(
      Array.from({ length: 12 }, () => duplicateAppend(store)),
    );
    assert.equal(duplicateResults.filter(result => result.duplicate === false).length, 1);
    assert.equal(duplicateResults.filter(result => result.duplicate === true).length, 11);
    assert.deepEqual(await readSequences(pool), sequenceRange(APPEND_COUNT + 1));
  } finally {
    await pool.end();
  }
});
