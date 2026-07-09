const test = require('node:test');
const assert = require('node:assert/strict');
const {
  requeueDeadLetterPostgresFactoryQueueItem,
  requeuePostgresFactoryQueueItem,
} = require('../../lib/task-platform/factory-delivery-queue-requeue');

function queueRow(overrides = {}) {
  return {
    tenant_id: 'tenant-a',
    queue_id: 'factory-queue-1',
    idempotency_key: 'factory-queue-1',
    title: 'Durable queue',
    requirements: 'Advance factory work durably.',
    template_tier: 'Simple',
    changed_files: [],
    stage: 'phase1_complete',
    attempts: 0,
    max_attempts: 3,
    metadata: {},
    ...overrides,
  };
}

const HOSTED_REQUEUE_CONFIG = {
  baseUrl: 'https://api.factory.openclaw.app',
  operatorUrl: 'https://operator.factory.openclaw.app',
  forgeAdapterUrl: 'https://forgeadapter.factory.openclaw.app',
  githubToken: 'test-github-token',
};

function readyRealDeliveryMetadata() {
  return {
    realDelivery: {
      ciRepository: 'wiinc1/engineering-team',
      branchName: 'factory/requeue-proof',
      implementationCommitSha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
      prUrl: 'https://github.com/wiinc1/engineering-team/pull/418',
      prNumber: 418,
      autoMerge: true,
      releaseEnv: 'staging',
      deploymentUrl: 'https://factory-staging.openclaw.app',
      rollbackTarget: 'release-previous',
      rollbackVerified: true,
      rollbackEvidence: 'observability/release/rollback-verification.json',
      riskLevel: 'low',
      productionSafe: true,
      productionSafetyEvidence: 'observability/release/production-safety.json',
      healthCheckPath: '/version',
      requireHealthCommit: true,
      releaseArtifactCommands: {
        build: 'npm run build',
        compatibility: 'npm run test:unit',
        vulnerability: 'npm audit --audit-level=high',
        secret: 'npm run secrets:scan',
      },
      candidateProofPath: 'observability/factory-delivery/factory-queue-1-real-delivery-candidate-proof.json',
      checks: [{ name: 'unit tests', conclusion: 'success' }],
      requiredChecks: ['unit tests', 'Merge readiness'],
      branchProtection: { branch: 'main', requiredChecks: ['unit tests', 'Merge readiness'], source: 'github_branch_protection' },
      mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed' },
      testCommands: ['node --test tests/unit/factory-delivery-queue-requeue.test.js'],
    },
    deadLetter: { failedStage: 'phase1_complete', failureAttempts: 3 },
  };
}

function requeuePool(queries) {
  return {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).startsWith('\n  SELECT')) {
        return {
          rows: [queueRow({
            stage: 'dead_letter',
            target_stage: 'phase1_complete',
            metadata: { deadLetter: { failedStage: 'phase1_complete', failureAttempts: 3 } },
          })],
        };
      }
      return {
        rows: [queueRow({
          last_action: 'operator_requeued',
          locked_by: null,
          dead_lettered_at: null,
          metadata: {
            deadLetterRecovery: {
              actorId: params[3],
              reason: params[4],
              recoveredDeadLetter: { failedStage: 'phase1_complete', failureAttempts: 3 },
            },
          },
        })],
      };
    },
  };
}

function rowsPool(queries, selectedRow, updatedRow) {
  return {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return String(sql).startsWith('\n  SELECT')
        ? { rows: selectedRow ? [selectedRow] : [] }
        : { rows: updatedRow ? [updatedRow] : [] };
    },
  };
}

test('postgres factory queue requeues dead-lettered items to recorded failed stage', async () => {
  const queries = [];
  const result = await requeueDeadLetterPostgresFactoryQueueItem(requeuePool(queries), {
    tenantId: 'tenant-a',
    queueId: 'factory-queue-1',
    actorId: 'sre-1',
    reason: 'transient dependency recovered',
  });

  assert.equal(result.action, 'operator_requeued');
  assert.equal(result.item.stage, 'phase1_complete');
  assert.equal(result.item.attempts, 0);
  assert.equal(result.item.lastAction, 'operator_requeued');
  assert.equal(result.item.lockedBy, null);
  assert.equal(result.item.deadLetteredAt, null);
  assert.equal(result.item.metadata.deadLetter, undefined);
  assert.equal(result.item.metadata.deadLetterRecovery.actorId, 'sre-1');
  assert.equal(result.item.metadata.deadLetterRecovery.reason, 'transient dependency recovered');
  assert.equal(result.item.metadata.deadLetterRecovery.recoveredDeadLetter.failedStage, 'phase1_complete');
  assert.equal(result.item.metadata.deadLetterRecovery.recoveredDeadLetter.failureAttempts, 3);
  assert.match(queries[0].sql, /FOR UPDATE/);
  assert.match(queries[1].sql, /stage = 'dead_letter'/);
  assert.match(queries[1].sql, /last_action = 'operator_requeued'/);
  assert.match(queries[1].sql, /- 'deadLetter'/);
  assert.match(queries[1].sql, /'recoveredDeadLetter'/);
  assert.deepEqual(queries[1].params.slice(0, 4), [
    'tenant-a',
    'factory-queue-1',
    ['queued', 'intake_complete', 'phase1_complete', 'phase6_complete'],
    'sre-1',
  ]);
  assert.equal(queries[1].params[4], 'transient dependency recovered');
});

test('postgres factory queue requeues preflight-ready real-delivery items', async () => {
  const queries = [];
  const selected = queueRow({
    stage: 'dead_letter',
    target_stage: 'phase1_complete',
    template_tier: 'Standard',
    metadata: readyRealDeliveryMetadata(),
  });
  const updated = queueRow({
    stage: 'phase1_complete',
    last_action: 'operator_requeued',
    metadata: {
      ...readyRealDeliveryMetadata(),
      deadLetter: undefined,
      deadLetterRecovery: { actorId: 'sre-1', reason: 'real evidence restored' },
    },
  });

  const result = await requeueDeadLetterPostgresFactoryQueueItem(rowsPool(queries, selected, updated), {
    ...HOSTED_REQUEUE_CONFIG,
    tenantId: 'tenant-a',
    queueId: 'factory-queue-1',
    actorId: 'sre-1',
    reason: 'real evidence restored',
  });

  assert.equal(result.action, 'operator_requeued');
  assert.equal(result.item.stage, 'phase1_complete');
  assert.equal(queries.length, 2);
});

test('postgres factory queue requeue uses a transaction when the pool supports clients', async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      return String(sql).startsWith('\n  SELECT')
        ? { rows: [queueRow({ stage: 'dead_letter', target_stage: 'queued' })] }
        : { rows: [queueRow({ stage: 'queued', last_action: 'operator_requeued' })] };
    },
    release() {
      released = true;
    },
  };
  const pool = { async connect() { return client; } };

  const result = await requeueDeadLetterPostgresFactoryQueueItem(pool, {
    tenantId: 'tenant-a',
    queueId: 'factory-queue-1',
    actorId: 'sre-1',
    reason: 'transactional recovery',
  });

  assert.equal(result.item.stage, 'queued');
  assert.deepEqual(calls.map((entry) => entry.sql === 'BEGIN' || entry.sql === 'COMMIT' ? entry.sql : entry.sql.match(/^\s*(\w+)/)[1]), [
    'BEGIN',
    'SELECT',
    'WITH',
    'COMMIT',
  ]);
  assert.equal(released, true);
});

test('postgres factory queue rejects unready real-delivery requeue before updating', async () => {
  const queries = [];
  const selected = queueRow({
    stage: 'dead_letter',
    target_stage: 'phase1_complete',
    template_tier: 'Standard',
    metadata: {
      realDelivery: {
        releaseEnv: 'staging',
        deploymentUrl: 'https://factory-staging.openclaw.app',
      },
      deadLetter: { failedStage: 'phase1_complete', failureAttempts: 3 },
    },
  });

  await assert.rejects(
    () => requeueDeadLetterPostgresFactoryQueueItem(rowsPool(queries, selected, null), {
      ...HOSTED_REQUEUE_CONFIG,
      tenantId: 'tenant-a',
      queueId: 'factory-queue-1',
      actorId: 'sre-1',
      reason: 'reviewed but still missing evidence',
    }),
    error => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'factory_queue_requeue_preflight_failed');
      assert.equal(error.details.targetStage, 'phase1_complete');
      assert.match(error.details.failures.join('\n'), /actual pull request target/);
      return true;
    },
  );
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /FOR UPDATE/);
});

test('postgres factory queue rejects requeue when item is not dead-lettered', async () => {
  const pool = { async query() { return { rows: [] }; } };

  await assert.rejects(
    () => requeueDeadLetterPostgresFactoryQueueItem(pool, {
      tenantId: 'tenant-a',
      queueId: 'factory-queue-1',
      actorId: 'sre-1',
      reason: 'reviewed dead-letter evidence',
    }),
    error => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, 'factory_queue_item_not_requeueable');
      return true;
    },
  );
});

test('postgres factory queue requires a requeue recovery reason before querying', async () => {
  let queried = false;
  const pool = {
    async query() {
      queried = true;
      return { rows: [] };
    },
  };

  await assert.rejects(
    () => requeueDeadLetterPostgresFactoryQueueItem(pool, {
      tenantId: 'tenant-a',
      queueId: 'factory-queue-1',
      actorId: 'sre-1',
      reason: '   ',
    }),
    error => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'missing_requeue_reason');
      return true;
    },
  );
  assert.equal(queried, false);
});

test('top-level postgres factory queue requeue validates reason before resolving a pool', async () => {
  await assert.rejects(
    () => requeuePostgresFactoryQueueItem({
      tenantId: 'tenant-a',
      queueId: 'factory-queue-1',
      actorId: 'sre-1',
      reason: '',
    }),
    error => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'missing_requeue_reason');
      return true;
    },
  );
});
