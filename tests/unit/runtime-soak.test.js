'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { collectArtifact, evidenceDigest } = require('../../lib/release-gates/evidence-collector');
const { cleanupLoadData } = require('../../scripts/run-job-runtime-load-test');
const { cleanupLoad } = require('../../scripts/run-langgraph-load');
const {
  buildComponent, configuration, positiveInteger, summarizeWindows,
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
  const client = {
    async query(sql, values) {
      calls.push({ sql: String(sql), values });
      if (String(sql).includes('AS count')) return { rows: [{ count: 0 }] };
      return { rowCount: String(sql).startsWith('DELETE') ? 2 : 0, rows: [] };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  const result = await cleanupLoadData({ connect: async () => client }, 'soak_tenant');
  assert.deepEqual(result, { actions: 2, effects: 2, deliveries: 2, residual: 0 });
  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls.at(-2).sql, 'COMMIT');
  assert.equal(calls.at(-1).sql, 'RELEASE');
  assert.ok(calls.filter((call) => call.values).every((call) => call.values[0] === 'soak_tenant'));
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
