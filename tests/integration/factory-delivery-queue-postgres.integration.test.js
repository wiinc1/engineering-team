const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPgPoolFromEnv } = require('../../lib/audit/postgres');
const {
  claimPostgresFactoryQueueItems,
  countPendingPostgresFactoryQueueItems,
  releasePostgresFactoryQueueItem,
  submitPostgresFactoryRequirements,
} = require('../../lib/task-platform/factory-delivery-queue-postgres');
const { requeueDeadLetterPostgresFactoryQueueItem } = require('../../lib/task-platform/factory-delivery-queue-requeue');
const { queryFactoryQueueStatus } = require('../../lib/task-platform/factory-delivery-queue-status');

const connectionString = process.env.DATABASE_URL;
const pgTest = connectionString ? test : test.skip;

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function readMigrationSql(fileName) {
  return fs.readFileSync(path.join(__dirname, '../..', 'db/migrations', fileName), 'utf8');
}

function clientBackedPool(client) {
  return {
    query(sql, params) {
      return client.query(sql, params);
    },
    async connect() {
      return {
        query(sql, params) {
          return client.query(sql, params);
        },
        release() {},
      };
    },
  };
}

function requirement(id, overrides = {}) {
  return {
    id,
    idempotencyKey: id,
    title: `Factory queue ${id}`,
    requirements: 'Exercise the durable factory queue against live Postgres.',
    templateTier: 'Standard',
    changeKind: 'bugfix',
    changedFiles: [
      'lib/task-platform/factory-delivery-queue-postgres.js',
      'tests/integration/factory-delivery-queue-postgres.integration.test.js',
    ],
    metadata: { queueKind: 'durable-postgres' },
    ...overrides,
  };
}

async function rowCount(client, tenantId) {
  const result = await client.query(
    'SELECT COUNT(*)::integer AS count FROM factory_delivery_queue WHERE tenant_id = $1',
    [tenantId],
  );
  return result.rows[0].count;
}

async function setupQueueSchema(client, schemaIdentifier) {
  await client.query(`CREATE SCHEMA ${schemaIdentifier}`);
  await client.query(`SET search_path TO ${schemaIdentifier}`);
  await client.query(readMigrationSql('015_factory_delivery_queue.sql'));
}

async function assertDatabaseRejectsBlankIdentity(client) {
  const insert = (column, value) => {
    const row = {
      tenant_id: 'tenant-factory-it',
      queue_id: `queue-${column}`,
      idempotency_key: `key-${column}`,
      title: 'Durable queue',
      requirements: 'Reject blank durable queue identity.',
      template_tier: 'Simple',
      [column]: value,
    };
    return client.query(
      `INSERT INTO factory_delivery_queue (
        tenant_id, queue_id, idempotency_key, title, requirements, template_tier
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.tenant_id, row.queue_id, row.idempotency_key, row.title, row.requirements, row.template_tier],
    );
  };
  await assert.rejects(() => insert('queue_id', '   '), /check constraint/);
  await assert.rejects(() => insert('idempotency_key', '   '), /check constraint/);
}

async function claimBatch(queuePool, tenantId, workerId) {
  return claimPostgresFactoryQueueItems(queuePool, {
    tenantId,
    workerId,
    factoryQueueLeaseSeconds: 60,
  });
}

async function assertIdempotentSubmit({ client, queuePool, tenantId }) {
  const first = await submitPostgresFactoryRequirements(
    queuePool,
    [requirement('factory-live-retry')],
    { tenantId, factoryQueueMaxAttempts: 2 },
  );
  const duplicate = await submitPostgresFactoryRequirements(
    queuePool,
    [requirement('factory-live-retry', { title: 'Duplicate submit should not create a row' })],
    { tenantId, factoryQueueMaxAttempts: 2 },
  );
  assert.equal(first.created.length, 1);
  assert.equal(duplicate.created.length, 1);
  assert.equal(duplicate.created[0].id, first.created[0].id);
  assert.equal(duplicate.created[0].title, first.created[0].title);
  assert.equal(await rowCount(client, tenantId), 1);
}

async function exerciseRetryToDeadLetter({ client, queuePool, tenantId }) {
  let claims = await claimBatch(queuePool, tenantId, 'worker-live-1');
  assert.equal(claims.length, 1);
  assert.deepEqual(claims.recovery, { recovered: 0, deadLettered: 0 });
  assert.equal(claims[0].item.lockedBy, 'worker-live-1');
  assert.equal(claims[0].item.metadata.queueKind, 'durable-postgres');
  const retry = await releasePostgresFactoryQueueItem(queuePool, claims[0], {
    action: 'error',
    error: new Error('integration retry'),
    item: { ...claims[0].item, stage: 'failed', lastError: 'integration retry' },
  }, { factoryQueueRetryBaseSeconds: 1 });
  assert.equal(retry.item.stage, 'queued');
  assert.equal(retry.item.attempts, 1);
  await client.query(
    "UPDATE factory_delivery_queue SET available_at = NOW() - interval '1 second' WHERE queue_id = $1",
    [retry.item.id],
  );
  claims = await claimBatch(queuePool, tenantId, 'worker-live-2');
  const exhausted = await releasePostgresFactoryQueueItem(queuePool, claims[0], {
    action: 'error',
    error: new Error('integration exhausted'),
    item: { ...claims[0].item, stage: 'failed', lastError: 'integration exhausted' },
  }, { factoryQueueMaxAttempts: 2 });
  assert.equal(exhausted.item.stage, 'dead_letter');
  assert.equal(exhausted.deadLetter, true);
  return exhausted.item;
}

async function exerciseDeadLetterRequeue({ queuePool, tenantId, deadLetterItem }) {
  const requeued = await requeueDeadLetterPostgresFactoryQueueItem(queuePool, {
    tenantId,
    queueId: deadLetterItem.id,
    actorId: 'sre-integration',
    reason: 'integration failure reviewed and dependency recovered',
  });
  assert.equal(requeued.action, 'operator_requeued');
  assert.equal(requeued.item.stage, 'queued');
  assert.equal(requeued.item.attempts, 0);
  assert.equal(requeued.item.lastAction, 'operator_requeued');
  assert.equal(requeued.item.lastError, null);
  assert.equal(requeued.item.deadLetteredAt, null);
  assert.deepEqual(requeued.item.metadata.deadLetterRecovery.actorId, 'sre-integration');
  assert.equal(
    requeued.item.metadata.deadLetterRecovery.reason,
    'integration failure reviewed and dependency recovered',
  );

  const claims = await claimBatch(queuePool, tenantId, 'worker-live-requeued');
  assert.equal(claims.length, 1);
  assert.equal(claims[0].item.id, deadLetterItem.id);
  const released = await releasePostgresFactoryQueueItem(queuePool, claims[0], {
    action: 'complete',
    item: {
      ...claims[0].item,
      stage: 'completed',
      evidenceStatus: 'phase6_complete',
    },
  });
  assert.equal(released.item.stage, 'completed');
  assert.equal(released.item.attempts, 0);
  assert.ok(released.item.completedAt);
}

async function exerciseCompletion({ queuePool, tenantId }) {
  await submitPostgresFactoryRequirements(
    queuePool,
    [requirement('factory-live-complete')],
    { tenantId, factoryQueueMaxAttempts: 2 },
  );
  const claims = await claimBatch(queuePool, tenantId, 'worker-live-3');
  assert.equal(claims.length, 1);
  const released = await releasePostgresFactoryQueueItem(queuePool, claims[0], {
    action: 'complete',
    item: {
      ...claims[0].item,
      stage: 'completed',
      taskId: 'TSK-FACTORY-IT',
      projectId: 'PRJ-FACTORY-IT',
      evidenceStatus: 'phase6_complete',
    },
  });
  assert.equal(released.item.stage, 'completed');
  assert.equal(released.item.attempts, 0);
  assert.ok(released.item.completedAt);
}

async function exerciseExpiredLeaseRecovery({ client, queuePool, tenantId }) {
  await submitPostgresFactoryRequirements(
    queuePool,
    [requirement('factory-live-expired')],
    { tenantId, factoryQueueMaxAttempts: 1 },
  );
  let claims = await claimBatch(queuePool, tenantId, 'worker-live-expired');
  assert.equal(claims.length, 1);
  await client.query(
    "UPDATE factory_delivery_queue SET lease_expires_at = NOW() - interval '1 second' WHERE queue_id = $1",
    [claims[0].item.id],
  );
  claims = await claimBatch(queuePool, tenantId, 'worker-live-recovery');
  assert.equal(claims.length, 0);
  assert.deepEqual(claims.recovery, { recovered: 1, deadLettered: 1 });
  assert.equal(await countPendingPostgresFactoryQueueItems(queuePool, { tenantId }), 0);
}

async function assertQueueStatus(queuePool, tenantId) {
  const status = await queryFactoryQueueStatus(queuePool, { tenantId, limit: 10 });
  assert.equal(status.summary.total, 3);
  assert.equal(status.summary.pending, 0);
  assert.equal(status.summary.completed, 2);
  assert.equal(status.summary.deadLetter, 1);
  assert.equal(status.summary.byStage.completed, 2);
  assert.equal(status.summary.byStage.dead_letter, 1);
  assert.deepEqual(
    status.items.map((item) => item.stage).sort(),
    ['completed', 'completed', 'dead_letter'],
  );
}

pgTest('factory delivery queue runs durable lifecycle on live postgres', async () => {
  const pool = createPgPoolFromEnv(connectionString);
  const client = await pool.connect();
  const schemaName = `factory_queue_${process.pid}_${Date.now()}`.toLowerCase();
  const schemaIdentifier = quoteIdentifier(schemaName);
  const tenantId = 'tenant-factory-it';
  const queuePool = clientBackedPool(client);
  try {
    await setupQueueSchema(client, schemaIdentifier);
    await assertDatabaseRejectsBlankIdentity(client);
    await assertIdempotentSubmit({ client, queuePool, tenantId });
    const deadLetterItem = await exerciseRetryToDeadLetter({ client, queuePool, tenantId });
    await exerciseDeadLetterRequeue({ queuePool, tenantId, deadLetterItem });
    await exerciseCompletion({ queuePool, tenantId });
    await exerciseExpiredLeaseRecovery({ client, queuePool, tenantId });
    await assertQueueStatus(queuePool, tenantId);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schemaIdentifier} CASCADE`).catch(() => {});
    client.release();
    await pool.end();
  }
});

test('factory proof profile surface is loadable for claim-path orchestration', () => {
  const {
    FACTORY_PROOF_ERROR_CODES,
    isFixtureDelegationRunner,
  } = require('../../lib/task-platform/factory-proof-profile');
  assert.equal(
    FACTORY_PROOF_ERROR_CODES.GATEWAY_UNAVAILABLE,
    'FACTORY_PROOF_GATEWAY_UNAVAILABLE',
  );
  assert.equal(
    isFixtureDelegationRunner('node tests/fixtures/specialist-runtime-runner.js'),
    true,
  );
});

// Note: local live OpenClaw C/D proof keeps postgres queue path (STAGING_SKIP_FORGE_*).
