const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildFactoryQueueImport,
  buildFactoryQueueInsert,
  claimPostgresFactoryQueueItems,
  importPostgresFactoryQueue,
  recoverExpiredFactoryQueueLeases,
  releaseParamsForOutcome,
  releasePostgresFactoryQueueItem,
  resolveFactoryQueueConnectionString,
} = require('../../lib/task-platform/factory-delivery-queue-postgres');
const {
  runFactoryOrchestratorTick,
  submitFactoryRequirementsForQueue,
} = require('../../lib/task-platform/factory-delivery');
const { buildImportDryRun } = require('../../scripts/migrate-factory-queue-postgres');

function queueRow(overrides = {}) {
  return {
    tenant_id: 'tenant-a',
    queue_id: 'factory-queue-1',
    idempotency_key: 'factory-queue-1',
    title: 'Durable queue',
    requirements: 'Advance factory work durably.',
    template_tier: 'Simple',
    change_kind: 'bugfix',
    changed_files: ['lib/task-platform/factory-delivery.js'],
    github_issue_url: null,
    stage: 'phase6_complete',
    task_id: 'TSK-QUEUE1',
    project_id: 'PRJ-QUEUE1',
    project_name: 'Factory Queue',
    evidence_path: 'observability/factory-delivery/factory-queue-1.json',
    persist_dir: null,
    forge_task_id: 'TSK-GOLDENQUEUE1',
    evidence_status: 'phase6_complete',
    last_action: null,
    last_error: null,
    attempts: 0,
    max_attempts: 3,
    available_at: '2026-07-04T00:00:00.000Z',
    locked_at: null,
    locked_by: null,
    lease_expires_at: null,
    dead_lettered_at: null,
    completed_at: null,
    metadata: {},
    created_at: '2026-07-04T00:00:00.000Z',
    updated_at: '2026-07-04T00:00:00.000Z',
    ...overrides,
  };
}

function queueStoreWithRecovery(released = []) {
  return {
    async claim() {
      const claims = [{
        item: {
          ...queueRow(),
          id: 'factory-queue-1',
          tenantId: 'tenant-a',
          stage: 'phase6_complete',
          _queueLease: {
            workerId: 'worker-1',
            claimedStage: 'phase6_complete',
            attempts: 0,
            maxAttempts: 3,
          },
        },
      }];
      Object.defineProperty(claims, 'recovery', {
        value: { recovered: 1, deadLettered: 0 },
        enumerable: false,
      });
      return claims;
    },
    async release(claim, outcome) {
      released.push({ claim, outcome });
      return {
        item: { ...claim.item, stage: 'completed', attempts: 0 },
        deadLetter: false,
      };
    },
    async pendingCount() {
      return 0;
    },
  };
}

test('factory queue insert uses stable idempotency for duplicate requirement content', () => {
  const requirement = {
    title: 'Queue durability',
    requirements: 'Persist factory queue entries in Postgres.',
    templateTier: 'Simple',
    changeKind: 'bugfix',
    changedFiles: ['lib/task-platform/factory-delivery.js'],
  };
  const first = buildFactoryQueueInsert(requirement, 0, { tenantId: 'tenant-a' });
  const second = buildFactoryQueueInsert(requirement, 0, { tenantId: 'tenant-a' });
  const docsOnly = buildFactoryQueueInsert({ ...requirement, changeKind: 'docs-only', changedFiles: ['docs/runbook.md'] }, 0, { tenantId: 'tenant-a' });

  assert.equal(first.params[2], second.params[2]);
  assert.notEqual(first.params[2], docsOnly.params[2]);
  assert.equal(first.params[0], 'tenant-a');
  assert.equal(first.params[6], 'bugfix');
  assert.deepEqual(JSON.parse(first.params[7]), ['lib/task-platform/factory-delivery.js']);
  assert.equal(first.params[15], 5);
});

test('factory queue import maps failed legacy file queue state into durable dead-letter metadata', () => {
  const failed = buildFactoryQueueImport({
    id: 'factory-failed',
    title: 'Failed file item',
    requirements: 'Preserve terminal failure from JSON queue.',
    templateTier: 'Simple',
    stage: 'failed',
    lastAction: 'error',
    lastError: 'invalid jwt signature',
    evidencePath: 'observability/factory-delivery/factory-failed.json',
    createdAt: '2026-06-24T01:44:29.798Z',
    updatedAt: '2026-06-24T01:44:37.063Z',
  }, 0, { tenantId: 'tenant-a' });

  assert.equal(failed.params[9], 'dead_letter');
  assert.equal(failed.params[18], 'invalid jwt signature');
  assert.equal(failed.params[19], 1);
  assert.equal(failed.params[22], '2026-06-24T01:44:37.063Z');
  const failedMetadata = JSON.parse(failed.params[24]);
  assert.equal(failedMetadata.deadLetter.failedStage, 'queued');
  assert.equal(failedMetadata.deadLetter.failedAction, 'error');
  assert.equal(failedMetadata.deadLetter.failureAttempts, 1);
  const phaseFailed = buildFactoryQueueImport({
    id: 'factory-dead-lettered-phase',
    title: 'Failed phase item',
    requirements: 'Preserve retry target.',
    stage: 'failed',
    evidenceStatus: 'phase4_fix_applied',
    lastAction: 'phases_2_6',
    attempts: 2,
    metadata: { deadLetter: { failedAction: 'existing_failure' } },
  }, 2, { tenantId: 'tenant-a' });
  const phaseMetadata = JSON.parse(phaseFailed.params[24]);
  assert.equal(phaseMetadata.deadLetter.failedStage, 'phase1_complete');
  assert.equal(phaseMetadata.deadLetter.failedAction, 'existing_failure');
  assert.equal(phaseMetadata.deadLetter.failureAttempts, 2);
});

test('factory queue import upserts existing JSON queue items into postgres', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return {
        rows: [queueRow({
          queue_id: params[1],
          idempotency_key: params[2],
          title: params[3],
          requirements: params[4],
          template_tier: params[5],
          stage: params[9],
          task_id: params[10],
          project_id: params[11],
          evidence_path: params[13],
          last_error: params[18],
          attempts: params[19],
        })],
      };
    },
  };

  const result = await importPostgresFactoryQueue(pool, {
    schemaVersion: '1.0',
    kind: 'factory-delivery-queue',
    items: [{
      id: 'factory-json-1',
      title: 'JSON queue item',
      requirements: 'Move the existing queue file row into Postgres.',
      templateTier: 'Standard',
      stage: 'queued',
      evidencePath: 'observability/factory-delivery/factory-json-1.json',
    }],
  }, { tenantId: 'tenant-a' });

  assert.equal(result.queueBackend, 'postgres');
  assert.equal(result.queueTable, 'factory_delivery_queue');
  assert.equal(result.sourceItems, 1);
  assert.equal(result.imported.length, 1);
  assert.equal(result.imported[0].id, 'factory-json-1');
  assert.match(queries[0].sql, /ON CONFLICT \(tenant_id, idempotency_key\) DO UPDATE/);
  assert.equal(queries[0].params[0], 'tenant-a');
  assert.equal(queries[0].params[9], 'queued');
});

test('factory queue migration dry-run summarizes normalized postgres stages', () => {
  const dryRun = buildImportDryRun({
    items: [{
      id: 'factory-failed',
      title: 'Failed legacy item',
      requirements: 'Preserve failed legacy work as terminal.',
      stage: 'failed',
      lastError: 'phase failed',
    }, {
      id: 'factory-complete',
      title: 'Completed legacy item',
      requirements: 'Preserve completed work.',
      stage: 'phase6_complete',
      completedAt: '2026-07-04T00:00:00.000Z',
      taskId: 'TSK-COMPLETE',
    }],
  }, { tenantId: 'tenant-a' });

  assert.equal(dryRun.sourceItems, 2);
  assert.deepEqual(dryRun.stageCounts, { dead_letter: 1, phase6_complete: 1 });
  assert.equal(dryRun.items[0].stage, 'dead_letter');
  assert.equal(dryRun.items[0].attempts, 1);
  assert.equal(dryRun.items[1].stage, 'phase6_complete');
  assert.equal(dryRun.items[1].taskId, 'TSK-COMPLETE');
});

test('postgres factory queue requires explicit database URL when no pool is injected', () => {
  const savedFactoryUrl = process.env.FACTORY_QUEUE_DATABASE_URL;
  const savedDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.FACTORY_QUEUE_DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    assert.throws(
      () => resolveFactoryQueueConnectionString({}),
      /FACTORY_QUEUE_DATABASE_URL or DATABASE_URL is required/,
    );
    assert.equal(
      resolveFactoryQueueConnectionString({ factoryQueueDatabaseUrl: 'postgres://queue.example/db' }),
      'postgres://queue.example/db',
    );
  } finally {
    if (savedFactoryUrl == null) delete process.env.FACTORY_QUEUE_DATABASE_URL;
    else process.env.FACTORY_QUEUE_DATABASE_URL = savedFactoryUrl;
    if (savedDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
  }
});

test('factory requirement submission defaults to postgres queue store', async () => {
  const calls = [];
  const queueStore = {
    async submit(requirements, config) {
      calls.push({ requirements, config });
      return {
        queueBackend: 'postgres',
        queueTable: 'factory_delivery_queue',
        created: [{
          id: 'factory-submit-default',
          title: requirements[0].title,
          stage: 'queued',
          evidencePath: 'observability/factory-delivery/factory-submit-default.json',
        }],
      };
    },
  };

  const result = await submitFactoryRequirementsForQueue([
    { title: 'Durable submit', requirements: 'Persist this requirement in Postgres.' },
  ], {
    queueStore,
    tenantId: 'tenant-a',
  });

  assert.equal(result.queueBackend, 'postgres');
  assert.equal(result.queueTable, 'factory_delivery_queue');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.queueBackend, 'postgres');
  assert.equal(calls[0].config.tenantId, 'tenant-a');
});

test('factory requirement submission fails closed without postgres database URL', async () => {
  const savedFactoryUrl = process.env.FACTORY_QUEUE_DATABASE_URL;
  const savedDatabaseUrl = process.env.DATABASE_URL;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-queue-default-'));
  const queuePath = path.join(tmp, 'queue.json');
  delete process.env.FACTORY_QUEUE_DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await assert.rejects(
      () => submitFactoryRequirementsForQueue([
        { title: 'No silent fallback', requirements: 'This must not write a JSON queue.' },
      ], {
        tenantId: 'tenant-a',
        queuePath,
      }),
      /FACTORY_QUEUE_DATABASE_URL or DATABASE_URL is required/,
    );
    assert.equal(fs.existsSync(queuePath), false);
  } finally {
    if (savedFactoryUrl == null) delete process.env.FACTORY_QUEUE_DATABASE_URL;
    else process.env.FACTORY_QUEUE_DATABASE_URL = savedFactoryUrl;
    if (savedDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
  }
});

test('factory queue claim recovers expired leases and uses skip-locked row claims', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('RETURNING stage')) {
        return { rowCount: 2, rows: [{ stage: 'queued' }, { stage: 'dead_letter' }] };
      }
      if (String(sql).includes('WITH claimed AS')) {
        return { rows: [queueRow({ locked_by: 'worker-1', locked_at: '2026-07-04T00:01:00.000Z' })] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };

  const claims = await claimPostgresFactoryQueueItems(pool, {
    tenantId: 'tenant-a',
    workerId: 'worker-1',
    maxItems: 2,
    factoryQueueLeaseSeconds: 60,
  });

  assert.equal(claims.length, 1);
  assert.deepEqual(claims.recovery, { recovered: 2, deadLettered: 1 });
  assert.equal(claims[0].item._queueLease.workerId, 'worker-1');
  assert.equal(claims[0].item._queueLease.lockedAt, '2026-07-04T00:01:00.000Z');
  assert.equal(claims[0].item._queueLease.claimedStage, 'phase6_complete');
  assert.equal(claims[0].item.changeKind, 'bugfix');
  assert.deepEqual(claims[0].item.changedFiles, ['lib/task-platform/factory-delivery.js']);
  const executedSql = queries.map((query) => query.sql).join('\n');
  assert.match(executedSql, /lease_expires_at <= NOW\(\)/);
  assert.match(executedSql, /attempts = attempts \+ 1/);
  assert.match(executedSql, /last_action = 'lease_expired'/);
  assert.match(executedSql, /FOR UPDATE SKIP LOCKED/);
  assert.match(executedSql, /locked_at = date_trunc\('milliseconds', NOW\(\)\)/);
  assert.match(executedSql, /lease_expires_at = date_trunc\('milliseconds', NOW\(\)\) \+ make_interval/);
  assert.match(executedSql, /make_interval\(secs => \$4\)/);
});

test('expired lease recovery schedules retries and dead-letters exhausted rows', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: [] };
    },
  };

  const recovery = await recoverExpiredFactoryQueueLeases(client, {
    tenantId: 'tenant-a',
    retryBaseSeconds: 10,
  });

  assert.deepEqual(recovery, { recovered: 0, deadLettered: 0 });
  assert.equal(queries.length, 1);
  assert.equal(queries[0].params[0], 'tenant-a');
  assert.deepEqual(queries[0].params[1], ['completed', 'dead_letter']);
  assert.equal(queries[0].params[2], 10);
  assert.match(queries[0].sql, /stage = CASE WHEN attempts \+ 1 >= max_attempts THEN 'dead_letter' ELSE stage END/);
  assert.match(queries[0].sql, /available_at = CASE/);
  assert.match(queries[0].sql, /LEAST\(15 \* 60, \$3::integer \* \(attempts \+ 1\)\)/);
  assert.match(queries[0].sql, /last_error = 'factory queue lease expired before release'/);
  assert.match(queries[0].sql, /dead_lettered_at = CASE WHEN attempts \+ 1 >= max_attempts THEN NOW\(\)/);
  assert.match(queries[0].sql, /'failedStage', stage/);
  assert.match(queries[0].sql, /'failedAction', 'lease_expired'/);
});

test('factory queue release retries from the claimed stage instead of storing failed', () => {
  const claim = {
    item: {
      id: 'factory-queue-1',
      tenantId: 'tenant-a',
      stage: 'phase1_complete',
      attempts: 0,
      maxAttempts: 3,
      metadata: {},
      _queueLease: {
        workerId: 'worker-1',
        claimedStage: 'phase1_complete',
        attempts: 0,
        maxAttempts: 3,
      },
    },
  };

  const release = releaseParamsForOutcome(claim, {
    action: 'error',
    error: new Error('transient phase failure'),
    item: { ...claim.item, stage: 'failed', lastError: 'transient phase failure' },
  }, { factoryQueueRetryBaseSeconds: 10 });

  assert.equal(release.params[3], 'phase1_complete');
  assert.equal(release.params[13], 1);
  assert.equal(release.params[14], 10);
  assert.equal(release.params[15], false);
});

test('factory queue release dead-letters after max attempts', () => {
  const claim = {
    item: {
      id: 'factory-queue-1',
      tenantId: 'tenant-a',
      stage: 'phase1_complete',
      attempts: 2,
      maxAttempts: 3,
      metadata: {},
      _queueLease: {
        workerId: 'worker-1',
        claimedStage: 'phase1_complete',
        attempts: 2,
        maxAttempts: 3,
      },
    },
  };

  const release = releaseParamsForOutcome(claim, {
    action: 'error',
    error: new Error('third failure'),
    item: { ...claim.item, stage: 'failed', lastError: 'third failure' },
  });

  assert.equal(release.params[3], 'dead_letter');
  assert.equal(release.params[13], 3);
  assert.equal(release.params[15], true);
  assert.equal(release.deadLetter, true);
  const metadata = JSON.parse(release.params[17]);
  assert.equal(metadata.deadLetter.failedStage, 'phase1_complete');
  assert.equal(metadata.deadLetter.failedAction, 'error');
  assert.equal(metadata.deadLetter.failureAttempts, 3);
});

test('postgres factory queue release requires an unexpired lease', async () => {
  const queries = [];
  const claim = {
    item: {
      id: 'factory-queue-1',
      tenantId: 'tenant-a',
      stage: 'phase6_complete',
      metadata: {},
      _queueLease: { workerId: 'worker-1', claimedStage: 'phase6_complete', lockedAt: '2026-07-04T00:01:00.000Z' },
    },
  };
  const pool = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: [] };
    },
  };

  await assert.rejects(
    () => releasePostgresFactoryQueueItem(pool, claim, {
      action: 'complete',
      item: { ...claim.item, stage: 'completed' },
    }),
    /Factory queue lease was lost/,
  );
  assert.match(queries[0].sql, /lease_expires_at > NOW\(\)/);
  assert.match(queries[0].sql, /locked_at = \$19::timestamptz/);
  assert.equal(queries[0].params[18], '2026-07-04T00:01:00.000Z');
});

test('postgres-backed orchestrator tick claims and releases durable queue items', async () => {
  const released = [];

  const tick = await runFactoryOrchestratorTick({
    queueBackend: 'postgres',
    queueStore: queueStoreWithRecovery(released),
    jwtSecret: 'factory-test-secret',
    tenantId: 'tenant-a',
    workerId: 'worker-1',
  });

  assert.equal(tick.queueBackend, 'postgres');
  assert.equal(tick.processed, 1);
  assert.deepEqual(tick.recovery, { recovered: 1, deadLettered: 0 });
  assert.equal(tick.pendingCount, 0);
  assert.equal(tick.results[0].stage, 'completed');
  assert.equal(released[0].outcome.action, 'complete');
});
