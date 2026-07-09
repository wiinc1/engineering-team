const test = require('node:test');
const assert = require('node:assert/strict');
const { releasePostgresFactoryQueueItem } = require('../../lib/task-platform/factory-delivery-queue-postgres');

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

function claim(overrides = {}) {
  const attempts = overrides.attempts || 0;
  const stage = overrides.stage || 'phase1_complete';
  return {
    item: {
      id: 'factory-queue-1',
      tenantId: 'tenant-a',
      stage,
      attempts,
      maxAttempts: 3,
      metadata: {},
      _queueLease: {
        workerId: 'worker-1',
        claimedStage: stage,
        lockedAt: '2026-07-04T00:01:00.000Z',
        attempts,
        maxAttempts: 3,
      },
      ...overrides,
    },
  };
}

function poolReturning(mapRow) {
  const queries = [];
  return {
    queries,
    pool: {
      async query(sql, params) {
        queries.push({ sql: String(sql), params });
        return { rows: [queueRow(mapRow(params))] };
      },
    },
  };
}

test('postgres factory queue release persists retry backoff and clears lease', async () => {
  const db = poolReturning((params) => ({
    stage: params[3],
    attempts: params[13],
    last_error: params[12],
    locked_by: null,
    locked_at: null,
    lease_expires_at: null,
  }));

  const result = await releasePostgresFactoryQueueItem(db.pool, claim(), {
    action: 'error',
    error: new Error('transient phase failure'),
    item: { stage: 'failed', lastError: 'transient phase failure' },
  }, { factoryQueueRetryBaseSeconds: 10 });

  assert.equal(result.item.stage, 'phase1_complete');
  assert.equal(result.item.attempts, 1);
  assert.equal(result.item.lastError, 'transient phase failure');
  assert.equal(result.item.lockedBy, null);
  assert.equal(result.deadLetter, false);
  assert.match(db.queries[0].sql, /locked_by = NULL/);
  assert.match(db.queries[0].sql, /NOW\(\) \+ make_interval\(secs => \$15\)/);
  assert.equal(db.queries[0].params[14], 10);
});

test('postgres factory queue release persists dead-letter terminal state', async () => {
  const db = poolReturning((params) => ({
    stage: params[3],
    attempts: params[13],
    last_error: params[12],
    dead_lettered_at: '2026-07-04T00:02:00.000Z',
  }));

  const result = await releasePostgresFactoryQueueItem(db.pool, claim({ attempts: 2 }), {
    action: 'error',
    error: new Error('third failure'),
    item: { stage: 'failed', lastError: 'third failure' },
  });

  assert.equal(result.item.stage, 'dead_letter');
  assert.equal(result.item.attempts, 3);
  assert.equal(result.item.deadLetteredAt, '2026-07-04T00:02:00.000Z');
  assert.equal(result.deadLetter, true);
  assert.equal(result.error, 'third failure');
});

test('postgres factory queue release persists completed terminal state', async () => {
  const db = poolReturning((params) => ({
    stage: params[3],
    attempts: params[13],
    completed_at: '2026-07-04T00:02:00.000Z',
  }));

  const result = await releasePostgresFactoryQueueItem(db.pool, claim({
    stage: 'phase6_complete',
    attempts: 2,
  }), {
    action: 'complete',
    item: { stage: 'completed' },
  });

  assert.equal(result.item.stage, 'completed');
  assert.equal(result.item.attempts, 0);
  assert.equal(result.item.completedAt, '2026-07-04T00:02:00.000Z');
  assert.equal(result.deadLetter, false);
  assert.equal(result.error, null);
});

test('postgres factory queue release preserves existing real-delivery metadata when final proof is added', async () => {
  let verifierOptions = null;
  const db = poolReturning((params) => ({
    stage: params[3],
    attempts: params[13],
    completed_at: '2026-07-04T00:02:00.000Z',
    metadata: JSON.parse(params[17]),
  }));

  const result = await releasePostgresFactoryQueueItem(db.pool, claim({
    stage: 'phase6_complete',
    metadata: {
      realDelivery: {
        ciRepository: 'wiinc1/engineering-team',
        candidateProofPath: 'observability/factory-delivery/factory-queue-1-real-delivery-candidate-proof.json',
      },
    },
  }), {
    action: 'complete',
    item: {
      stage: 'completed',
      metadata: {
        realDelivery: {
          finalEvidencePath: 'observability/factory-delivery/factory-queue-1-real-autonomous-delivery-evidence.json',
        },
      },
    },
  }, {
    releaseEnv: 'staging',
    realAutonomousDeliveryVerifier: (options) => {
      verifierOptions = options;
      return { ok: true, failures: [] };
    },
  });

  assert.equal(verifierOptions.evidencePath, 'observability/factory-delivery/factory-queue-1-real-autonomous-delivery-evidence.json');
  assert.equal(verifierOptions.candidateProofPath, 'observability/factory-delivery/factory-queue-1-real-delivery-candidate-proof.json');
  assert.equal(result.item.metadata.realDelivery.ciRepository, 'wiinc1/engineering-team');
  assert.equal(
    result.item.metadata.realDelivery.candidateProofPath,
    'observability/factory-delivery/factory-queue-1-real-delivery-candidate-proof.json',
  );
  assert.equal(
    result.item.metadata.realDelivery.finalEvidencePath,
    'observability/factory-delivery/factory-queue-1-real-autonomous-delivery-evidence.json',
  );
  assert.equal(result.item.metadata.lastOutcomeAction, 'complete');
});

test('postgres factory queue release rejects real-delivery completion without final proof', async () => {
  const db = poolReturning((params) => ({
    stage: params[3],
    attempts: params[13],
  }));

  await assert.rejects(
    () => releasePostgresFactoryQueueItem(db.pool, claim({
      stage: 'phase6_complete',
      metadata: {
        realDelivery: {
          releaseEnv: 'staging',
          candidateProofPath: 'observability/factory-delivery/factory-queue-1-real-delivery-candidate-proof.json',
        },
      },
    }), {
      action: 'complete',
      item: {
        stage: 'completed',
      },
    }, {
      releaseEnv: 'staging',
    }),
    /Factory real-delivery completion proof requires an evidencePath/,
  );
  assert.equal(db.queries.length, 0);
});

test('postgres factory queue release verifies real-delivery final proof before persisting completion', async () => {
  let verifierOptions = null;
  const db = poolReturning((params) => ({
    stage: params[3],
    attempts: params[13],
    completed_at: '2026-07-04T00:02:00.000Z',
    metadata: JSON.parse(params[17]),
  }));

  const result = await releasePostgresFactoryQueueItem(db.pool, claim({
    stage: 'phase6_complete',
    metadata: {
      realDelivery: {
        releaseEnv: 'staging',
        candidateProofPath: 'observability/factory-delivery/factory-queue-1-real-delivery-candidate-proof.json',
      },
    },
  }), {
    action: 'complete',
    item: {
      stage: 'completed',
      metadata: {
        realDelivery: {
          finalEvidencePath: 'observability/factory-delivery/factory-queue-1-real-autonomous-delivery-evidence.json',
        },
      },
    },
  }, {
    releaseEnv: 'staging',
    realAutonomousDeliveryVerifier: (options) => {
      verifierOptions = options;
      return { ok: true, failures: [] };
    },
  });

  assert.equal(result.item.stage, 'completed');
  assert.equal(db.queries.length, 1);
  assert.equal(verifierOptions.releaseEnv, 'staging');
  assert.equal(verifierOptions.requireCandidateProof, true);
  assert.equal(verifierOptions.evidencePath, 'observability/factory-delivery/factory-queue-1-real-autonomous-delivery-evidence.json');
  assert.equal(verifierOptions.candidateProofPath, 'observability/factory-delivery/factory-queue-1-real-delivery-candidate-proof.json');
});
