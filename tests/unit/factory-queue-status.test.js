const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAuditApiServer } = require('../../lib/audit/http-projects');
const {
  normalizeFactoryQueueStatusItem,
  queryFactoryQueueStatus,
} = require('../../lib/task-platform/factory-delivery-queue-status');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, claims = {}) {
  return {
    authorization: `Bearer ${sign({
      sub: 'factory-operator',
      tenant_id: 'tenant-a',
      roles: ['sre', 'reader'],
      exp: Math.floor(Date.now() / 1000) + 60,
      ...claims,
    }, secret)}`,
  };
}

const HOSTED_STATUS_CONFIG = {
  baseUrl: 'https://api.factory.openclaw.app',
  operatorUrl: 'https://operator.factory.openclaw.app',
  forgeAdapterUrl: 'https://forgeadapter.factory.openclaw.app',
  githubToken: 'test-github-token',
};

function realDeliveryMetadata() {
  return {
    realDelivery: {
      ciRepository: 'wiinc1/engineering-team',
      branchName: 'factory/queue-proof',
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
      releaseArtifactDir: 'observability/release',
      useExistingReleaseArtifacts: true,
      releaseArtifactCommands: {
        build: 'npm run build',
        compatibility: 'npm run test:unit',
        vulnerability: 'npm audit --audit-level=high',
        secret: 'npm run secrets:scan',
      },
      candidateProofPath: 'observability/factory-delivery/factory-queue-1-real-delivery-candidate-proof.json',
      finalEvidencePath: 'observability/factory-delivery/factory-queue-1-real-autonomous-delivery-evidence.json',
      checks: [{ name: 'unit tests', conclusion: 'success' }],
      requiredChecks: ['unit tests', 'Merge readiness'],
      branchProtection: { branch: 'main', requiredChecks: ['unit tests', 'Merge readiness'], source: 'github_branch_protection' },
      mergeReadiness: { name: 'Merge readiness', reviewStatus: 'passed' },
      testCommands: ['node --test tests/unit/factory-queue-status.test.js'],
    },
  };
}

function queueRow(overrides = {}) {
  return {
    tenant_id: 'tenant-a',
    queue_id: 'factory-queue-1',
    idempotency_key: 'factory-queue-1',
    title: 'Queue status',
    requirements: 'Expose durable queue status.',
    template_tier: 'Standard',
    change_kind: 'bugfix',
    changed_files: ['lib/task-platform/factory-delivery-queue-status.js'],
    github_issue_url: null,
    stage: 'phase1_complete',
    task_id: 'TSK-QUEUE-1',
    project_id: 'PRJ-QUEUE-1',
    project_name: 'Factory Queue',
    evidence_path: 'observability/factory-delivery/factory-queue-1.json',
    persist_dir: null,
    forge_task_id: 'TSK-GOLDENQUEUE1',
    evidence_status: 'phase1_complete',
    last_action: 'phases_2_6',
    last_error: 'transient validation error',
    attempts: 1,
    max_attempts: 5,
    available_at: '2099-07-05T12:00:00.000Z',
    locked_at: '2026-07-05T11:59:00.000Z',
    locked_by: 'worker-1',
    lease_expires_at: '2099-07-05T12:15:00.000Z',
    dead_lettered_at: null,
    completed_at: null,
    metadata: realDeliveryMetadata(),
    created_at: '2026-07-05T11:00:00.000Z',
    updated_at: '2026-07-05T11:59:00.000Z',
    ...overrides,
  };
}

async function withServer(callback, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-queue-http-'));
  const secret = 'factory-queue-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await callback({ baseUrl: `http://127.0.0.1:${server.address().port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
}

function queueStatusPool(queries) {
  return {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('COUNT(*)::integer AS total_count')) {
        return {
          rows: [{
            total_count: 4,
            pending_count: 2,
            leased_count: 1,
            expired_lease_count: 1,
            retrying_count: 1,
            completed_count: 1,
            dead_letter_count: 1,
            queued_count: 1,
            phase1_complete_count: 1,
          }],
        };
      }
      return { rows: [queueRow()] };
    },
  };
}

function assertRealDeliveryProof(proof) {
  assert.equal(proof.requested, true);
  assert.equal(proof.repository, 'wiinc1/engineering-team');
  assert.equal(proof.prNumber, 418);
  assert.equal(proof.autoMerge, true);
  assert.equal(proof.releaseEnv, 'staging');
  assert.equal(proof.rollbackTarget, 'release-previous');
  assert.equal(proof.rollbackVerified, true);
  assert.equal(proof.rollbackEvidenceProvided, true);
  assert.equal(proof.riskLevel, 'low');
  assert.equal(proof.productionSafe, true);
  assert.equal(proof.productionSafetyEvidenceProvided, true);
  assert.equal(proof.healthCheckPath, '/version');
  assert.equal(proof.requireHealthCommit, true);
  assert.equal(proof.releaseArtifactDir, 'observability/release');
  assert.equal(proof.useExistingReleaseArtifacts, true);
  assert.equal(proof.releaseArtifactCommandsCount, 4);
  assert.equal(proof.candidateProofPath, 'observability/factory-delivery/factory-queue-1-real-delivery-candidate-proof.json');
  assert.equal(proof.finalEvidencePath, 'observability/factory-delivery/factory-queue-1-real-autonomous-delivery-evidence.json');
  assert.equal(proof.checksCount, 1);
  assert.equal(proof.requiredChecksCount, 2);
  assert.equal(proof.branchProtectionProvided, true);
  assert.equal(proof.branchProtectionSource, 'github_branch_protection');
  assert.equal(proof.mergeReadinessProvided, true);
  assert.equal(proof.testCommandsCount, 1);
  assert.equal(proof.preflight.required, true);
  assert.equal(proof.preflight.ok, true);
  assert.deepEqual(proof.preflight.failures, []);
}

function assertQueueStatus(status, queries) {
  assert.equal(status.schemaVersion, 'factory-queue-status.v1');
  assert.equal(status.queueBackend, 'postgres');
  assert.equal(status.filter.stage, 'phase1_complete');
  assert.equal(status.summary.total, 4);
  assert.equal(status.summary.pending, 2);
  assert.equal(status.summary.retrying, 1);
  assert.equal(status.items[0].id, 'factory-queue-1');
  assert.equal(status.items[0].leaseActive, true);
  assert.equal(status.items[0].retrying, true);
  assertRealDeliveryProof(status.items[0].realDelivery);
  assert.equal(queries[0].params[0], 'tenant-a');
  assert.equal(queries[1].params[1], 'phase1_complete');
  assert.equal(queries[1].params[2], 10);
}

test('queue status derives default proof paths for real-delivery rows', () => {
  const item = {
    id: 'factory-default-proof',
    title: 'Default proof paths',
    stage: 'queued',
    metadata: {
      realDelivery: {
        branchName: 'factory/default-proof',
        releaseEnv: 'staging',
      },
    },
  };
  const statusItem = normalizeFactoryQueueStatusItem(item, Date.parse('2026-07-05T12:00:00.000Z'), {
    deliveryDir: 'observability/factory-delivery',
  });

  assert.equal(
    statusItem.realDelivery.candidateProofPath,
    'observability/factory-delivery/factory-default-proof-real-delivery-candidate-proof.json',
  );
  assert.equal(
    statusItem.realDelivery.finalEvidencePath,
    'observability/factory-delivery/factory-default-proof-real-autonomous-delivery-evidence.json',
  );
  assert.equal(statusItem.realDelivery.preflight.required, true);
  assert.equal(statusItem.realDelivery.preflight.ok, false);
  assert.match(statusItem.realDelivery.preflight.failures.join('\n'), /actual pull request target/);
});

function factoryQueueHttpOptions(calls, requeueCalls = []) {
  return {
    factoryQueueStatusReader: async (options) => {
      calls.push(options);
      return {
        schemaVersion: 'factory-queue-status.v1',
        queueBackend: 'postgres',
        queueTable: 'factory_delivery_queue',
        tenantId: options.tenantId,
        generatedAt: '2026-07-05T12:00:00.000Z',
        filter: { stage: options.stage || null, limit: options.limit || null },
        summary: { total: 1, pending: 0, leased: 0, expiredLeases: 0, retrying: 0, completed: 0, deadLetter: 1 },
        items: [],
      };
    },
    factoryQueueRequeue: async (options) => {
      requeueCalls.push(options);
      return {
        action: 'operator_requeued',
        item: { id: options.queueId, stage: 'phase1_complete' },
      };
    },
  };
}

test('factory queue status summarizes operational states and recent items', async () => {
  const queries = [];
  const status = await queryFactoryQueueStatus(queueStatusPool(queries), {
    tenantId: 'tenant-a',
    stage: 'phase1_complete',
    limit: 10,
    ...HOSTED_STATUS_CONFIG,
  });

  assertQueueStatus(status, queries);
});

test('factory queue status rejects unsupported stage filters', async () => {
  await assert.rejects(
    () => queryFactoryQueueStatus({ query: async () => ({ rows: [] }) }, { tenantId: 'tenant-a', stage: 'failed' }),
    error => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'invalid_factory_queue_stage');
      return true;
    },
  );
});

test('factory queue status item marks expired leases and terminal rows', () => {
  const item = normalizeFactoryQueueStatusItem({
    id: 'factory-dead',
    title: 'Dead letter item',
    stage: 'dead_letter',
    taskId: 'TSK-DEAD',
    projectId: null,
    projectName: null,
    evidencePath: 'observability/factory-delivery/factory-dead.json',
    forgeTaskId: null,
    evidenceStatus: 'phase1_failed',
    lastAction: 'error',
    lastError: 'permanent failure',
    attempts: 5,
    maxAttempts: 5,
    availableAt: '2026-07-05T12:00:00.000Z',
    lockedAt: '2026-07-05T12:00:00.000Z',
    lockedBy: 'worker-old',
    leaseExpiresAt: '2026-07-05T12:15:00.000Z',
    deadLetteredAt: '2026-07-05T12:16:00.000Z',
    completedAt: null,
    createdAt: '2026-07-05T11:00:00.000Z',
    updatedAt: '2026-07-05T12:16:00.000Z',
  }, Date.parse('2026-07-05T12:30:00.000Z'));

  assert.equal(item.leaseActive, false);
  assert.equal(item.leaseExpired, true);
  assert.equal(item.terminal, true);
  assert.equal(item.retrying, false);
});

test('factory queue HTTP route is tenant scoped and permissioned', async () => {
  const calls = [];
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/api/v1/factory/queue?stage=dead_letter&limit=5`, {
      headers: authHeaders(secret),
    });
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.equal(payload.data.tenantId, 'tenant-a');
    assert.equal(payload.data.filter.stage, 'dead_letter');
    assert.equal(payload.data.filter.limit, '5');
    assert.equal(calls[0].tenantId, 'tenant-a');
    assert.equal(calls[0].stage, 'dead_letter');

    response = await fetch(`${baseUrl}/api/v1/factory/queue`, {
      headers: authHeaders(secret, { roles: ['reader'] }),
    });
    assert.equal(response.status, 403);
    payload = await response.json();
    assert.equal(payload.error.code, 'forbidden');
  }, factoryQueueHttpOptions(calls));
});

test('factory queue HTTP requeue action is tenant scoped and permissioned', async () => {
  const calls = [];
  const requeueCalls = [];
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/api/v1/factory/queue/factory-queue-1/requeue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret) },
      body: JSON.stringify({ reason: 'transient dependency recovered' }),
    });
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.equal(payload.data.action, 'operator_requeued');
    assert.equal(payload.data.item.stage, 'phase1_complete');
    assert.equal(requeueCalls[0].tenantId, 'tenant-a');
    assert.equal(requeueCalls[0].queueId, 'factory-queue-1');
    assert.equal(requeueCalls[0].actorId, 'factory-operator');
    assert.equal(requeueCalls[0].reason, 'transient dependency recovered');

    response = await fetch(`${baseUrl}/api/v1/factory/queue/factory-queue-1/requeue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, { roles: ['reader'] }) },
      body: JSON.stringify({ reason: 'should not be allowed' }),
    });
    assert.equal(response.status, 403);
    payload = await response.json();
    assert.equal(payload.error.details.permission, 'factory-queue:write');
    assert.equal(requeueCalls.length, 1);

    response = await fetch(`${baseUrl}/api/v1/factory/queue/factory-queue-1/requeue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret) },
      body: JSON.stringify({ reason: '   ' }),
    });
    assert.equal(response.status, 400);
    payload = await response.json();
    assert.equal(payload.error.code, 'missing_requeue_reason');
    assert.equal(requeueCalls.length, 1);
  }, factoryQueueHttpOptions(calls, requeueCalls));
});

test('factory queue HTTP requeue preserves real-delivery preflight failure details', async () => {
  const calls = [];
  const requeueCalls = [];
  const options = {
    ...factoryQueueHttpOptions(calls, requeueCalls),
    factoryQueueRequeue: async (requeueOptions) => {
      requeueCalls.push(requeueOptions);
      const error = new Error('Factory queue real-delivery item is not ready to requeue.');
      error.statusCode = 409;
      error.code = 'factory_queue_requeue_preflight_failed';
      error.details = {
        queueId: requeueOptions.queueId,
        targetStage: 'phase1_complete',
        failures: [
          'actual pull request target is required (--pr-url or --repository/--pr-number)',
          'hosted staging release evidence requires --rollback-target',
        ],
      };
      throw error;
    },
  };

  await withServer(async ({ baseUrl, secret }) => {
    const response = await fetch(`${baseUrl}/api/v1/factory/queue/factory-real-blocked/requeue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret) },
      body: JSON.stringify({ reason: 'operator verified hosted inputs are still missing' }),
    });
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.error.code, 'factory_queue_requeue_preflight_failed');
    assert.equal(payload.error.message, 'Factory queue real-delivery item is not ready to requeue.');
    assert.equal(payload.error.details.queueId, 'factory-real-blocked');
    assert.equal(payload.error.details.targetStage, 'phase1_complete');
    assert.deepEqual(payload.error.details.failures, [
      'actual pull request target is required (--pr-url or --repository/--pr-number)',
      'hosted staging release evidence requires --rollback-target',
    ]);
    assert.equal(payload.error.requestId, response.headers.get('x-request-id'));
    assert.equal(requeueCalls.length, 1);
    assert.equal(requeueCalls[0].tenantId, 'tenant-a');
    assert.equal(requeueCalls[0].actorId, 'factory-operator');
    assert.equal(requeueCalls[0].queueId, 'factory-real-blocked');
  }, options);
});
