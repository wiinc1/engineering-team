#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createPgPoolFromEnv } = require('../lib/audit/postgres');
const { createLangGraphRuntime } = require('../lib/software-factory/langgraph');

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] || 0;
}

function maximum(values) {
  return values.reduce((current, value) => Math.max(current, value), 0);
}

function environmentBudget(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createLoadRuntime(pool, nodeExecutions, nodeDurations) {
  return createLangGraphRuntime({
    baseDir: process.env.RUNTIME_LOAD_LOG_DIR || path.join(process.cwd(), '.artifacts', 'runtime-load-logs'),
    pool,
    config: { enabled: true, operationTimeoutMs: 30_000, poolBudget: 2, retentionDays: 1 },
    interruptAfter: ['load_checkpoint'],
    nodes: [
      {
        name: 'load_checkpoint',
        execute: (state) => {
          const startedAt = Date.now();
          nodeExecutions.set(state.factoryRunId, (nodeExecutions.get(state.factoryRunId) || 0) + 1);
          nodeDurations.push(Date.now() - startedAt);
          return { attempt: 1 };
        },
      },
      { name: 'load_complete', execute: () => ({ lifecycleStatus: 'succeeded' }) },
    ],
  });
}

async function runWorker(runtime, input) {
  let sequence = 0;
  while (Date.now() < input.deadline) {
    const started = Date.now();
    const factoryRunId = `${input.prefix}:${input.workerId}:${sequence}`;
    const tenantId = `load_${input.workerId}`;
    try {
      const state = await runtime.invoke({ tenantId, factoryRunId });
      input.result.latencies.push(Date.now() - started);
      const statusStarted = Date.now();
      await runtime.runStatus({ tenantId, threadId: state.threadId });
      input.result.statusLatencies.push(Date.now() - statusStarted);
      const resumeStarted = Date.now();
      await runtime.resume({ tenantId, threadId: state.threadId });
      input.result.resumeLatencies.push(Date.now() - resumeStarted);
      input.result.completed += 1;
    } catch (error) {
      input.result.failures += 1;
      const code = typeof error?.code === 'string' ? error.code : 'unknown';
      input.result.failureCodes[code] = (input.result.failureCodes[code] || 0) + 1;
      if (input.nodeExecutions.has(factoryRunId)) input.result.failedAfterSideEffect += 1;
    }
    sequence += 1;
  }
}

async function runWorkload(runtime, nodeExecutions, prefix, durationMs, concurrency) {
  const startedAt = Date.now();
  const result = {
    completed: 0, failedAfterSideEffect: 0, failureCodes: {}, failures: 0, latencies: [],
    poolPeak: 0, resumeLatencies: [], statusLatencies: [],
  };
  const sampler = setInterval(() => {
    result.poolPeak = Math.max(result.poolPeak, runtime.checkpointer.pool.langGraphBudget?.active() || 0);
  }, 5);
  try {
    await Promise.all(Array.from({ length: concurrency }, (_, workerId) => runWorker(runtime, {
      deadline: startedAt + durationMs, nodeExecutions, prefix, result, workerId,
    })));
  } finally {
    clearInterval(sampler);
  }
  result.actualDurationMs = Date.now() - startedAt;
  return result;
}

function metricValues(snapshot, collection, name) {
  return Object.entries(snapshot[collection])
    .filter(([key]) => key.includes(`\"${name}\"`)).flatMap(([, values]) => values);
}

function metricCount(snapshot, name) {
  return metricValues(snapshot, 'counters', name).reduce((sum, value) => sum + value, 0);
}

function distribution(values) {
  return { count: values.length, p95Ms: percentile(values, 0.95), p99Ms: percentile(values, 0.99) };
}

function checkpointSizes(values) {
  const average = values.length ? Math.round(values.reduce((sum, size) => sum + size, 0) / values.length) : 0;
  return { average, p95: percentile(values, 0.95), p99: percentile(values, 0.99), maximum: maximum(values) };
}

async function storageEvidence(pool, prefix) {
  const result = await pool.query(`SELECT
    COALESCE(SUM(checkpoint_size_bytes), 0)::bigint AS latest_checkpoint_bytes,
    pg_total_relation_size('langgraph_checkpoint.checkpoints')::bigint AS checkpoints_relation_bytes,
    pg_total_relation_size('langgraph_checkpoint.checkpoint_blobs')::bigint AS blobs_relation_bytes,
    pg_total_relation_size('langgraph_checkpoint.checkpoint_writes')::bigint AS writes_relation_bytes
    FROM langgraph_checkpoint.factory_threads WHERE factory_run_id LIKE $1`, [`${prefix}%`]);
  return result.rows[0];
}

function buildArtifact(input) {
  const snapshot = input.runtime.metrics.snapshot();
  const writes = metricValues(snapshot, 'histograms', 'langgraph_checkpoint_write_latency_ms');
  const reads = metricValues(snapshot, 'histograms', 'langgraph_checkpoint_read_latency_ms');
  const sizes = checkpointSizes(metricValues(snapshot, 'histograms', 'langgraph_checkpoint_size_bytes'));
  const observed = [...input.nodeExecutions.values()].reduce((sum, count) => sum + count, 0);
  const duplicates = [...input.nodeExecutions.values()].reduce((sum, count) => sum + Math.max(count - 1, 0), 0);
  const invocation = distribution(input.result.latencies);
  const checkpointP95Ms = Math.max(percentile(writes, 0.95), percentile(reads, 0.95));
  const nodeP95Ms = percentile(input.nodeDurations, 0.95);
  const graphOverheadPercent = Number((
    Math.max(0, invocation.p95Ms - checkpointP95Ms - nodeP95Ms) / 2_000 * 100
  ).toFixed(2));
  return {
    schemaVersion: 'langgraph-01-load.v1', requestedDurationMs: input.durationMs,
    actualDurationMs: input.result.actualDurationMs, concurrency: input.concurrency,
    expectedConcurrency: 2, loadMultiplier: input.concurrency / 2,
    completed: input.result.completed, failures: input.result.failures,
    failureCodes: input.result.failureCodes, failedAfterSideEffect: input.result.failedAfterSideEffect,
    measuredThroughputQps: Number((input.result.completed / (input.result.actualDurationMs / 1000)).toFixed(2)),
    invocation, status: distribution(input.result.statusLatencies), resume: distribution(input.result.resumeLatencies),
    checkpointWrites: distribution(writes), checkpointReads: distribution(reads),
    nodeExecution: distribution(input.nodeDurations), graphOverheadPercent,
    graphOverheadBasis: 'percentage-of-2000ms-resume-slo-after-checkpoint-and-node-time',
    expectedSideEffects: input.result.completed, observedSideEffects: observed, duplicateSideEffects: duplicates,
    sideEffectCountMatchesCompleted: observed === input.result.completed,
    poolBudget: 2, poolPeak: input.result.poolPeak,
    endingPoolActive: input.runtime.checkpointer.pool.langGraphBudget?.active() || 0,
    endingPoolWaiters: input.runtime.checkpointer.pool.langGraphBudget?.waiting() || 0,
    poolSaturationEvents: metricCount(snapshot, 'langgraph_pool_saturation_total'),
    checkpointSizeBytes: sizes, storageEvidence: input.storage,
    storageProjection: { threads: 10_000, checkpointsPerThread: 8,
      primaryBytesAtObservedAverage: sizes.average * 80_000,
      provisionedBytesWithMvccAndTwoBackups: sizes.average * 320_000 },
    localBudgets: {
      checkpointWriteP95Ms: environmentBudget('LANGGRAPH_CHECKPOINT_WRITE_P95_BUDGET_MS', 100),
      checkpointReadP95Ms: environmentBudget('LANGGRAPH_CHECKPOINT_READ_P95_BUDGET_MS', 150),
      poolPeak: 2,
      duplicateSideEffects: 0,
    },
  };
}

async function cleanupLoad(pool, prefix) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const threads = await client.query(
      'SELECT thread_id FROM langgraph_checkpoint.factory_threads WHERE factory_run_id LIKE $1',
      [`${prefix}%`],
    );
    const threadIds = threads.rows.map((row) => row.thread_id);
    await client.query('DELETE FROM langgraph_checkpoint.checkpoint_writes WHERE thread_id = ANY($1::text[])', [threadIds]);
    await client.query('DELETE FROM langgraph_checkpoint.checkpoint_blobs WHERE thread_id = ANY($1::text[])', [threadIds]);
    await client.query('DELETE FROM langgraph_checkpoint.checkpoints WHERE thread_id = ANY($1::text[])', [threadIds]);
    await client.query('DELETE FROM langgraph_checkpoint.factory_threads WHERE factory_run_id LIKE $1', [`${prefix}%`]);
    const result = await client.query(`SELECT
      (SELECT COUNT(*)::integer FROM langgraph_checkpoint.factory_threads WHERE factory_run_id LIKE $1) AS registry,
      (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoints WHERE thread_id = ANY($2::text[])) AS checkpoints,
      (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoint_blobs WHERE thread_id = ANY($2::text[])) AS blobs,
      (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoint_writes WHERE thread_id = ANY($2::text[])) AS writes`, [`${prefix}%`, threadIds]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function evaluateArtifact(artifact) {
  return artifact.failures === 0
    && artifact.checkpointWrites.p95Ms < artifact.localBudgets.checkpointWriteP95Ms
    && artifact.checkpointReads.p95Ms < artifact.localBudgets.checkpointReadP95Ms
    && artifact.status.p95Ms < 250 && artifact.resume.p95Ms < 2_000
    && artifact.graphOverheadPercent < 10
    && artifact.duplicateSideEffects === 0 && artifact.sideEffectCountMatchesCompleted
    && artifact.poolPeak === artifact.poolBudget
    && artifact.endingPoolActive === 0 && artifact.endingPoolWaiters === 0 && artifact.cleanupPassed;
}

function writeArtifact(artifact) {
  const outputPath = process.env.LANGGRAPH_LOAD_OUTPUT
    || path.join(process.cwd(), '.artifacts', 'langgraph-01-load.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(artifact)}\n`);
}

async function main() {
  const durationMs = Number(process.env.LANGGRAPH_LOAD_DURATION_MS || 600_000);
  const concurrency = Number(process.env.LANGGRAPH_LOAD_CONCURRENCY || 4);
  const pool = createPgPoolFromEnv(process.env.DATABASE_URL);
  const nodeExecutions = new Map();
  const nodeDurations = [];
  const runtime = createLoadRuntime(pool, nodeExecutions, nodeDurations);
  const prefix = `load_${Date.now()}`;
  let artifact;
  try {
    await runtime.setup();
    const result = await runWorkload(runtime, nodeExecutions, prefix, durationMs, concurrency);
    const storage = await storageEvidence(pool, prefix);
    artifact = buildArtifact({ concurrency, durationMs, nodeDurations, nodeExecutions, result, runtime, storage });
  } finally {
    try {
      const cleanupRows = await cleanupLoad(pool, prefix);
      if (artifact) {
        artifact.cleanupRows = cleanupRows;
        artifact.cleanupPassed = Object.values(cleanupRows).every((count) => Number(count) === 0);
        artifact.passed = evaluateArtifact(artifact);
      }
    } finally {
      try {
        await runtime.close();
      } finally {
        await pool.end();
      }
    }
  }
  writeArtifact(artifact);
  if (!artifact.passed) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});

module.exports = { cleanupLoad, evaluateArtifact, main, maximum, percentile };
