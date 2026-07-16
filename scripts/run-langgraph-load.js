#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createLangGraphRuntime } = require('../lib/software-factory/langgraph');

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] || 0;
}

function maximum(values) {
  return values.reduce((current, value) => Math.max(current, value), 0);
}

function createLoadRuntime(pool, nodeExecutions) {
  return createLangGraphRuntime({
    pool,
    config: { enabled: true, operationTimeoutMs: 30_000, poolBudget: 2, retentionDays: 1 },
    nodes: [{
      name: 'load_checkpoint',
      execute: (state) => {
        nodeExecutions.set(state.factoryRunId, (nodeExecutions.get(state.factoryRunId) || 0) + 1);
        return { attempt: 1 };
      },
    }],
  });
}

async function runWorker(runtime, input) {
  let sequence = 0;
  while (Date.now() < input.deadline) {
    const started = Date.now();
    const factoryRunId = `${input.prefix}:${input.workerId}:${sequence}`;
    try {
      await runtime.invoke({ tenantId: `load_${input.workerId}`, factoryRunId });
      input.result.completed += 1;
      input.result.latencies.push(Date.now() - started);
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
    completed: 0, failedAfterSideEffect: 0, failureCodes: {}, failures: 0, latencies: [], poolPeak: 0,
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
  return {
    schemaVersion: 'langgraph-01-load.v1', requestedDurationMs: input.durationMs,
    actualDurationMs: input.result.actualDurationMs, concurrency: input.concurrency,
    expectedConcurrency: 2, loadMultiplier: input.concurrency / 2,
    completed: input.result.completed, failures: input.result.failures,
    failureCodes: input.result.failureCodes, failedAfterSideEffect: input.result.failedAfterSideEffect,
    measuredThroughputQps: Number((input.result.completed / (input.result.actualDurationMs / 1000)).toFixed(2)),
    invocation: distribution(input.result.latencies), checkpointWrites: distribution(writes), checkpointReads: distribution(reads),
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
    localBudgets: { checkpointWriteP95Ms: 100, checkpointReadP95Ms: 150, poolPeak: 2, duplicateSideEffects: 0 },
  };
}

async function cleanupLoad(pool, prefix) {
  await pool.query("DELETE FROM langgraph_checkpoint.checkpoint_writes WHERE thread_id IN (SELECT thread_id FROM langgraph_checkpoint.factory_threads WHERE factory_run_id LIKE $1)", [`${prefix}%`]);
  await pool.query("DELETE FROM langgraph_checkpoint.checkpoint_blobs WHERE thread_id IN (SELECT thread_id FROM langgraph_checkpoint.factory_threads WHERE factory_run_id LIKE $1)", [`${prefix}%`]);
  await pool.query("DELETE FROM langgraph_checkpoint.checkpoints WHERE thread_id IN (SELECT thread_id FROM langgraph_checkpoint.factory_threads WHERE factory_run_id LIKE $1)", [`${prefix}%`]);
  await pool.query('DELETE FROM langgraph_checkpoint.factory_threads WHERE factory_run_id LIKE $1', [`${prefix}%`]);
  const result = await pool.query(`SELECT
    (SELECT COUNT(*)::integer FROM langgraph_checkpoint.factory_threads WHERE factory_run_id LIKE $1) AS registry,
    (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoints WHERE thread_id LIKE 'lg_%') AS checkpoints,
    (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoint_blobs WHERE thread_id LIKE 'lg_%') AS blobs,
    (SELECT COUNT(*)::integer FROM langgraph_checkpoint.checkpoint_writes WHERE thread_id LIKE 'lg_%') AS writes`, [`${prefix}%`]);
  return result.rows[0];
}

function evaluateArtifact(artifact) {
  return artifact.failures === 0
    && artifact.checkpointWrites.p95Ms < artifact.localBudgets.checkpointWriteP95Ms
    && artifact.checkpointReads.p95Ms < artifact.localBudgets.checkpointReadP95Ms
    && artifact.duplicateSideEffects === 0 && artifact.sideEffectCountMatchesCompleted
    && artifact.poolPeak === artifact.poolBudget
    && artifact.endingPoolActive === 0 && artifact.endingPoolWaiters === 0 && artifact.cleanupPassed;
}

function writeArtifact(artifact) {
  fs.mkdirSync(path.join(process.cwd(), '.artifacts'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), '.artifacts', 'langgraph-01-load.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(artifact)}\n`);
}

async function main() {
  const durationMs = Number(process.env.LANGGRAPH_LOAD_DURATION_MS || 600_000);
  const concurrency = Number(process.env.LANGGRAPH_LOAD_CONCURRENCY || 4);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 8 });
  const nodeExecutions = new Map();
  const runtime = createLoadRuntime(pool, nodeExecutions);
  const prefix = `load_${Date.now()}`;
  let artifact;
  try {
    await runtime.setup();
    const result = await runWorkload(runtime, nodeExecutions, prefix, durationMs, concurrency);
    const storage = await storageEvidence(pool, prefix);
    artifact = buildArtifact({ concurrency, durationMs, nodeExecutions, result, runtime, storage });
  } finally {
    const cleanupRows = await cleanupLoad(pool, prefix);
    if (artifact) {
      artifact.cleanupRows = cleanupRows;
      artifact.cleanupPassed = Object.values(cleanupRows).every((count) => Number(count) === 0);
      artifact.passed = evaluateArtifact(artifact);
    }
    await runtime.close();
    await pool.end();
  }
  writeArtifact(artifact);
  if (!artifact.passed) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});

module.exports = { evaluateArtifact, main, maximum, percentile };
