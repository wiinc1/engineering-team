'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { collectArtifact, evidenceDigest } = require('../../lib/release-gates/evidence-collector');
const { assertJobRuntimeLoadBudgets, cleanupLoadData } = require('../../scripts/run-job-runtime-load-test');
const { cleanupLoad } = require('../../scripts/run-langgraph-load');
const {
  configuration: cleanupConfiguration,
  exactRunPrefix,
  exactSyntheticTenant,
  exactTenantPattern,
  tenantPattern,
} = require('../../scripts/cleanup-runtime-soak-run');
const {
  buildComponent, childProcess, configuration, positiveInteger, redactDiagnostic, summarizeWindows,
} = require('../../scripts/run-runtime-soak');

const REVISION = 'a'.repeat(40);

function summary(overrides = {}) {
  return {
    violations: 0, leaks: 0, windows: 288,
    graphilePasses: 288, langgraphPasses: 288,
    baselineConnections: 3, finalConnections: 3, peakConnections: 11,
    ...overrides,
  };
}

test('soak configuration defaults to a full day and accepts bounded smoke overrides', () => {
  const defaults = configuration({ SOAK_REVISION: REVISION });
  assert.equal(defaults.durationSeconds, 86_400);
  assert.equal(defaults.windowSeconds, 300);
  assert.equal(defaults.graphileQps, 25);
  assert.equal(defaults.langgraphConcurrency, 2);
  assert.equal(defaults.childTerminationGraceMs, 30_000);

  const smoke = configuration({
    SOAK_REVISION: REVISION,
    SOAK_DURATION_SECONDS: '3',
    SOAK_WINDOW_SECONDS: '30',
    SOAK_GRAPHILE_QPS: '1',
  });
  assert.equal(smoke.durationSeconds, 3);
  assert.equal(smoke.windowSeconds, 3);
  assert.equal(smoke.graphileQps, 1);
  assert.equal(positiveInteger('invalid', 7), 7);
});

test('soak summary counts runtime violations and connection leaks exactly', () => {
  const windows = [
    { graphile: { ok: true }, langgraph: { ok: true } },
    { graphile: { ok: false }, langgraph: { ok: true } },
  ];
  const samples = [{ connections: 3 }, { connections: 12 }];
  assert.deepEqual(summarizeWindows(
    windows, samples,
    { connections: 3, idleInTransaction: 0 },
    { connections: 8, idleInTransaction: 1 },
    4,
  ), {
    violations: 1, leaks: 2, windows: 2,
    graphilePasses: 1, langgraphPasses: 2,
    baselineConnections: 3, finalConnections: 8, peakConnections: 12,
  });
});

test('soak component is redacted, revision-bound, digest-valid, and threshold-complete', () => {
  const component = buildComponent({
    runtime: 'graphile', revision: REVISION, deploymentId: 'dpl_staging',
    runId: 'runtime-soak-1', environment: 'staging',
    startedAt: '2026-07-18T00:00:00.000Z', completedAt: '2026-07-19T00:00:00.000Z',
    durationSeconds: 86_400, sampleCount: 289, summary: summary(),
  });
  assert.equal(component.status, 'passed');
  assert.equal(component.digest, evidenceDigest(component.evidence));
  assert.equal(component.summary.durationSeconds, 86_400);
  assert.equal(collectArtifact(component, { runtime: 'graphile', revision: REVISION }).kind, 'soak_24h');
  assert.equal(buildComponent({
    runtime: 'langgraph', revision: REVISION, deploymentId: 'dpl_staging',
    runId: 'runtime-soak-2', environment: 'staging',
    startedAt: '2026-07-18T00:00:00.000Z', completedAt: '2026-07-19T00:00:00.000Z',
    durationSeconds: 86_400, sampleCount: 289, summary: summary({ violations: 1 }),
  }).status, 'failed');
});

test('Graphile load cleanup is tenant-scoped, transactional, and verifies no residual rows', async () => {
  const calls = [];
  const workerCalls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql: String(sql), values });
      if (String(sql).startsWith('SELECT graphile_job_id')) {
        return { rows: [{ graphile_job_id: '41' }, { graphile_job_id: '42' }] };
      }
      if (String(sql).includes('FROM graphile_worker.jobs')) return { rows: [] };
      if (String(sql).includes('AS count')) return { rows: [{ count: 0 }] };
      return { rowCount: String(sql).startsWith('DELETE') ? 2 : 0, rows: [] };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  const result = await cleanupLoadData({ connect: async () => client }, 'soak_tenant', {
    workerUtilsFactory: async () => ({
      async completeJobs(ids) { workerCalls.push(ids); return ids.map((id) => ({ id })); },
      async release() { workerCalls.push('release'); },
    }),
  });
  assert.deepEqual(result, {
    graphileJobs: 2, graphileJobReferences: 2, graphileJobResidual: 0, graphileWorkersUnlocked: 0,
    actions: 2, effects: 2, deliveries: 2, residual: 0,
  });
  assert.deepEqual(workerCalls, [['41', '42'], 'release']);
  assert.equal(calls.find((call) => call.sql === 'BEGIN').sql, 'BEGIN');
  assert.equal(calls.at(-2).sql, 'COMMIT');
  assert.equal(calls.at(-1).sql, 'RELEASE');
  assert.ok(calls.filter((call) => typeof call.values?.[0] === 'string')
    .every((call) => call.values[0] === 'soak_tenant'));
});

test('Graphile load cleanup unlocks only residual workers and retries completion', async () => {
  let residualReads = 0;
  const workerCalls = [];
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text.startsWith('SELECT graphile_job_id')) return { rows: [{ graphile_job_id: '41' }] };
      if (text.includes('FROM graphile_worker.jobs')) {
        residualReads += 1;
        return { rows: residualReads === 1 ? [{ id: '41', locked_by: 'worker-soak-1' }] : [] };
      }
      if (text.includes('AS count')) return { rows: [{ count: 0 }] };
      return { rowCount: text.startsWith('DELETE') ? 1 : 0, rows: [] };
    },
    release() {},
  };
  let completion = 0;
  const result = await cleanupLoadData({ connect: async () => client }, 'soak_tenant', {
    workerUtilsFactory: async () => ({
      async completeJobs(ids) {
        workerCalls.push(['complete', ...ids]);
        completion += 1;
        return completion === 1 ? [] : ids.map((id) => ({ id }));
      },
      async withPgClient(callback) {
        return callback({ async query(sql, values) { workerCalls.push(['unlock', String(sql), ...values[0]]); } });
      },
      async release() {},
    }),
  });
  assert.equal(result.graphileWorkersUnlocked, 1);
  assert.equal(result.graphileJobs, 1);
  assert.deepEqual(workerCalls[1], [
    'unlock', 'SELECT graphile_worker.force_unlock_workers($1::text[])', 'worker-soak-1',
  ]);
  assert.deepEqual(workerCalls[2], ['complete', '41']);
});

test('soak diagnostics redact credentials and timed-out children cannot pass', async () => {
  assert.equal(
    redactDiagnostic('DATABASE_URL=postgres://user:secret@localhost/runtime'),
    'DATABASE_URL=[redacted]',
  );
  const result = await childProcess(
    'tests/fixtures/runtime-soak-timeout-child.js',
    process.env,
    200,
    1_000,
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
  assert.match(result.stderr, /termination observed/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /secret/);
});

test('Graphile throughput budget allows only the fractional remainder and rejects a whole-job shortfall', () => {
  const report = {
    duration_ms: 59_988.926,
    expected_qps: 2,
    load_multiplier: 119 / (59.988926 * 2),
    required_load_multiplier: 1,
    submitted: 119,
    acknowledged: 119,
    enqueue_p95_ms: 20,
    enqueue_p99_ms: 36,
    operational_read_p95_ms: 1,
    ready_to_start_p95_ms: 86,
    pool_peak_total: 6,
    pool_max: 10,
    pool_waiting_at_end: 0,
    runtime_pool_waiting_at_end: 0,
  };
  assert.doesNotThrow(() => assertJobRuntimeLoadBudgets(report));
  assert.throws(() => assertJobRuntimeLoadBudgets({
    ...report,
    load_multiplier: 118 / (59.988926 * 2),
  }), /load_multiplier_failed/);
});

test('scoped soak cleanup requires an exact run prefix and matching destructive confirmation', () => {
  const prefix = 'soak_mt1wx5qx_172ab4';
  assert.equal(exactRunPrefix(prefix), prefix);
  assert.equal(tenantPattern(prefix), '^soak_mt1wx5qx_172ab4_[0-9]+$');
  assert.equal(exactSyntheticTenant('load_mt1r8qer'), 'load_mt1r8qer');
  assert.equal(exactTenantPattern('load_mt1r8qer'), '^load_mt1r8qer$');
  assert.throws(() => exactRunPrefix('soak_%'), /exact synthetic run prefix/);
  assert.throws(() => cleanupConfiguration({
    SOAK_CLEANUP_RUN_PREFIX: prefix,
    SOAK_CLEANUP_CONFIRM: 'delete:another-run',
    SOAK_CLEANUP_OUTPUT: '/tmp/evidence.json',
  }), /exactly confirm/);
  assert.equal(cleanupConfiguration({
    SOAK_CLEANUP_RUN_PREFIX: prefix,
    SOAK_CLEANUP_CONFIRM: `delete:${prefix}`,
    SOAK_CLEANUP_OUTPUT: '/tmp/evidence.json',
  }).tenantPattern, '^soak_mt1wx5qx_172ab4_[0-9]+$');
  assert.equal(cleanupConfiguration({
    SOAK_CLEANUP_TENANT: 'load_mt1r8qer',
    SOAK_CLEANUP_CONFIRM: 'delete:load_mt1r8qer',
    SOAK_CLEANUP_OUTPUT: '/tmp/evidence.json',
  }).tenantPattern, '^load_mt1r8qer$');
});

test('LangGraph load cleanup is transactionally scoped to the run thread IDs', async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql: String(sql), values });
      if (String(sql).startsWith('SELECT thread_id')) {
        return { rows: [{ thread_id: 'lg_run_1' }, { thread_id: 'lg_run_2' }] };
      }
      if (String(sql).includes('AS registry')) {
        return { rows: [{ registry: 0, checkpoints: 0, blobs: 0, writes: 0 }] };
      }
      return { rows: [], rowCount: 2 };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  const result = await cleanupLoad({ connect: async () => client }, 'load_123');
  assert.deepEqual(result, { registry: 0, checkpoints: 0, blobs: 0, writes: 0 });
  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls.at(-2).sql, 'COMMIT');
  assert.equal(calls.at(-1).sql, 'RELEASE');
  const scopedDeletes = calls.filter((call) => call.sql.startsWith('DELETE') && call.sql.includes('ANY'));
  assert.equal(scopedDeletes.length, 3);
  assert.ok(scopedDeletes.every((call) => call.values[0].join(',') === 'lg_run_1,lg_run_2'));
  assert.ok(calls.every((call) => !call.sql.includes("thread_id LIKE 'lg_%'")));
});
