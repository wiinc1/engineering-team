#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { makeWorkerUtils } = require('graphile-worker');
const { createJobRuntimeInfrastructure } = require('../lib/job-runtime');
const { createPgPoolFromEnv } = require('../lib/audit/postgres');
const { createJobRuntimeLogger, createMetricSink } = require('../lib/job-runtime/observability');

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function loadMeasurement({ submitted, durationMs, expectedQps, targetQps }) {
  const measuredQps = submitted / (durationMs / 1000);
  return Object.freeze({
    measuredQps,
    measuredLoadMultiplier: measuredQps / expectedQps,
    requestedLoadMultiplier: targetQps / expectedQps,
  });
}

function cancellationError(signal) {
  const reason = signal?.reason instanceof Error ? signal.reason.message : String(signal?.reason || 'cancelled');
  return new Error(`job_runtime_load_cancelled_${reason}`);
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancellationError(signal));
      return;
    }
    const complete = () => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    };
    const timer = setTimeout(complete, Math.max(0, milliseconds));
    function cancel() {
      clearTimeout(timer);
      reject(cancellationError(signal));
    }
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

async function delayUntil(deadline, signal, dependencies = {}) {
  const now = dependencies.now || performance.now.bind(performance);
  const wait = dependencies.delay || delay;
  for (let remaining = deadline - now(); remaining > 0; remaining = deadline - now()) await wait(remaining, signal);
}
function loadCanonical() {
  return {
    async lookup(input) {
      return input.resourceType === 'factory_run'
        ? { tenantId: input.tenantId, taskId: 'TSK-LOAD', threadId: 'thread-load' }
        : { tenantId: input.tenantId };
    },
    async authorize() { return true; },
  };
}
function loadWorkloads(loadTest) {
  return {
    langGraph: {
      async lookupEffect() { return { completed: false }; },
      async start() { return { code: 'started' }; },
      async resume() { return { code: 'resumed' }; },
    },
    auditStore: {
      async processProjectionQueue() { return { processed: 0 }; },
      async processOutbox(publisher, batchSize, tenantId) {
        loadTest.outboxSequence += 1;
        await publisher({
          tenant_id: tenantId,
          event_id: `load-event-${loadTest.outboxSequence}`,
          schema_version: 1,
        });
        return { processed: Math.min(1, batchSize) };
      },
      async processExpiredSreMonitoring() { return { code: 'expired' }; },
    },
    outbox: {
      effectCategory: 'notification',
      async lookupEffect() { return { completed: false }; },
      async publish() { return { code: 'published' }; },
    },
    async factoryRecovery() { return { code: 'recovered' }; },
    async pruneRegistry() { return { code: 'pruned' }; },
  };
}
function loadInfrastructure(loadTest) {
  return createJobRuntimeInfrastructure({
    pool: loadTest.pool,
    logger: loadTest.logger,
    metrics: loadTest.metrics,
    canonical: loadCanonical(),
    cronItems: [],
    scheduler: { async next() { return null; } },
    config: { claimsEnabled: true, concurrency: 4, reservedConnections: 4, shutdownDeadlineMs: 30_000 },
    workloads: loadWorkloads(loadTest),
  });
}
class JobRuntimeLoadTest {
  constructor(options = {}) {
    this.durationMs = positiveInteger(options.durationMs || process.env.JOB_RUNTIME_LOAD_DURATION_MS, 600_000);
    this.expectedQps = positiveInteger(options.expectedQps || process.env.JOB_RUNTIME_EXPECTED_QPS, 25);
    this.requiredLoadMultiplier = positiveInteger(
      options.requiredLoadMultiplier || process.env.JOB_RUNTIME_REQUIRED_LOAD_MULTIPLIER, 2,
    );
    this.targetQps = positiveInteger(
      options.targetQps || process.env.JOB_RUNTIME_LOAD_QPS,
      this.expectedQps * this.requiredLoadMultiplier,
    );
    this.pool = options.pool || createPgPoolFromEnv(options.connectionString);
    const logBaseDir = options.baseDir || process.env.RUNTIME_LOAD_LOG_DIR
      || path.join(process.cwd(), '.artifacts', 'runtime-load-logs');
    this.logger = options.logger || createJobRuntimeLogger({ baseDir: logBaseDir });
    this.runId = `load-${Date.now().toString(36)}`;
    this.tenantId = options.tenantId || process.env.JOB_RUNTIME_LOAD_TENANT_ID || `load_${Date.now().toString(36)}`;
    this.enqueueLatencies = [];
    this.operationalReadLatencies = [];
    this.readyLatencies = [];
    this.workloadCounts = new Map();
    this.outboxSequence = 0;
    this.metrics = createMetricSink();
    this.abortController = new AbortController();
    this.poolPeakTotal = this.pool.totalCount;
    this.recordPoolPeak = () => {
      this.poolPeakTotal = Math.max(this.poolPeakTotal, this.pool.totalCount);
    };
    this.pool.on('connect', this.recordPoolPeak);
    this.pool.on('acquire', this.recordPoolPeak);
    this.infrastructure = loadInfrastructure(this);
  }

  workload(index, occurrenceVersion) {
    const definitions = [
      ['factory.langgraph.start.v1', 'factoryStart', {
        runId: `run-start-${index}`, taskId: 'TSK-LOAD', threadId: 'thread-load', workflowVersion: 1,
      }],
      ['factory.langgraph.resume.v1', 'factoryResume', {
        runId: `run-resume-${index}`, taskId: 'TSK-LOAD', threadId: 'thread-load',
        workflowVersion: 1, checkpointVersion: index + 1,
      }],
      ['audit.projection.catch_up.v1', 'auditProjection', {
        occurrenceId: `projection:${occurrenceVersion}`, batchSize: 100,
      }],
      ['audit.outbox.deliver.v1', 'auditOutbox', {
        occurrenceId: `outbox:${occurrenceVersion}`, batchSize: 100,
      }],
      ['maintenance.sre_monitoring.expire.v1', 'sreMonitoringExpiry', {
        occurrenceId: `expiry:${occurrenceVersion}`, batchSize: 100,
      }],
      ['maintenance.factory.reconcile.v1', 'factoryReconciliation', {
        occurrenceId: `factory:${occurrenceVersion}`,
      }],
      ['maintenance.job_runtime.prune.v1', 'registryRetention', {
        occurrenceId: `retention:${occurrenceVersion}`,
      }],
    ];
    return definitions[index % definitions.length];
  }

  async enqueue(index, startedAt) {
    const targetAt = startedAt + (index * 1000) / this.targetQps;
    await delay(targetAt - performance.now(), this.abortController.signal);
    const correlationId = `${this.runId}-corr-${index}`;
    const [task, method, input] = this.workload(index, 1_760_000_000_000 + index);
    const enqueueStarted = performance.now();
    await this.infrastructure.producers[method]({ tenantId: this.tenantId, correlationId }, input);
    this.workloadCounts.set(task, (this.workloadCounts.get(task) || 0) + 1);
    this.enqueueLatencies.push(performance.now() - enqueueStarted);
  }

  async waitForCompletion(expected) {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const readStarted = performance.now();
      const summary = await this.infrastructure.registry.summarizeCorrelationPrefix(`${this.runId}-corr-`);
      this.operationalReadLatencies.push(performance.now() - readStarted);
      if (summary.delivery_acknowledged === expected) return summary;
      await delay(250, this.abortController.signal);
    }
    throw new Error('job_runtime_load_completion_timeout');
  }

  buildReport(submitted, summary, submissionDurationMs) {
    const observations = this.metrics.snapshot().observations;
    const measurement = loadMeasurement({
      submitted, durationMs: submissionDurationMs,
      expectedQps: this.expectedQps, targetQps: this.targetQps,
    });
    this.readyLatencies = Object.entries(observations).flatMap(([key, values]) => (
      JSON.parse(key)[0] === 'job_runtime_ready_to_start_ms' ? values : []
    ));
    return {
      version: 1, run_id: this.runId, tenant_id: this.tenantId,
      requested_duration_ms: this.durationMs,
      duration_ms: submissionDurationMs,
      expected_qps: this.expectedQps,
      target_qps: this.targetQps,
      measured_qps: measurement.measuredQps,
      requested_load_multiplier: measurement.requestedLoadMultiplier,
      load_multiplier: measurement.measuredLoadMultiplier,
      required_load_multiplier: this.requiredLoadMultiplier,
      submitted,
      submitted_by_task: Object.fromEntries([...this.workloadCounts.entries()].sort()),
      acknowledged: summary.delivery_acknowledged || 0,
      enqueue_p95_ms: percentile(this.enqueueLatencies, 0.95),
      enqueue_p99_ms: percentile(this.enqueueLatencies, 0.99),
      operational_read_p95_ms: percentile(this.operationalReadLatencies, 0.95),
      ready_to_start_p95_ms: percentile(this.readyLatencies, 0.95),
      pool_max: this.pool.options.max,
      pool_peak_total: this.poolPeakTotal,
      pool_waiting_at_end: this.pool.waitingCount,
      runtime_pool_waiting_at_end: this.infrastructure.runtimePool.waitingCount,
    };
  }

  assertBudgets(report) {
    assertJobRuntimeLoadBudgets(report);
  }

  async run() {
    await this.infrastructure.runtime.start();
    const submitted = Math.floor((this.durationMs / 1000) * this.targetQps);
    const startedAt = performance.now();
    for (let index = 0; index < submitted; index += 1) await this.enqueue(index, startedAt);
    await delayUntil(startedAt + this.durationMs, this.abortController.signal);
    const submissionDurationMs = performance.now() - startedAt;
    const summary = await this.waitForCompletion(submitted);
    const report = this.buildReport(submitted, summary, submissionDurationMs);
    this.lastReport = report;
    this.assertBudgets(report);
    return report;
  }

  cancel(reason) {
    if (!this.abortController.signal.aborted) this.abortController.abort(reason);
  }

  async close() {
    await this.infrastructure.runtime.drain('load test complete').catch(() => {});
    this.cleanupReport = await cleanupLoadData(this.pool, this.tenantId);
    this.pool.off('connect', this.recordPoolPeak);
    this.pool.off('acquire', this.recordPoolPeak);
    await this.pool.end();
  }
}
function assertJobRuntimeLoadBudgets(report) {
  const expectedSubmissions = (Number(report.duration_ms) / 1000) * Number(report.expected_qps);
  const submissionQuantum = Number.isFinite(expectedSubmissions) && expectedSubmissions > 0
    ? (expectedSubmissions - Math.floor(expectedSubmissions)) / expectedSubmissions
    : 0;
  if (!Number.isFinite(report.load_multiplier)
    || report.load_multiplier + submissionQuantum < report.required_load_multiplier) {
    throw new Error('job_runtime_load_multiplier_failed');
  }
  if (report.acknowledged !== report.submitted) throw new Error('job_runtime_load_delivery_loss');
  if (report.enqueue_p95_ms >= 100 || report.enqueue_p99_ms >= 250) throw new Error('job_runtime_enqueue_latency_budget_failed');
  if (report.operational_read_p95_ms >= 250) throw new Error('job_runtime_operational_read_latency_budget_failed');
  if (report.ready_to_start_p95_ms >= 2_000) throw new Error('job_runtime_ready_latency_budget_failed');
  if (report.pool_peak_total > report.pool_max - 4
    || report.pool_waiting_at_end !== 0
    || report.runtime_pool_waiting_at_end !== 0) {
    throw new Error('job_runtime_pool_budget_failed');
  }
}
async function cleanupGraphileBatch(workerUtils, client, batch) {
  let completed = (await workerUtils.completeJobs(batch)).length;
  let residual = await client.query(`SELECT id::text, locked_by
    FROM graphile_worker.jobs WHERE id = ANY($1::bigint[])`, [batch]);
  const workerIds = [...new Set(residual.rows.map((row) => row.locked_by).filter(Boolean))];
  if (workerIds.length) {
    await workerUtils.withPgClient((pgClient) => pgClient.query(
      'SELECT graphile_worker.force_unlock_workers($1::text[])',
      [workerIds],
    ));
  }
  if (residual.rows.length) {
    completed += (await workerUtils.completeJobs(residual.rows.map((row) => row.id))).length;
    residual = await client.query(`SELECT id::text, locked_by
      FROM graphile_worker.jobs WHERE id = ANY($1::bigint[])`, [batch]);
  }
  return Object.freeze({ completed, residual: residual.rows.length, workersUnlocked: workerIds.length });
}
async function cleanupReferencedGraphileJobs(pool, client, tenantId, dependencies) {
  const references = await client.query(`SELECT graphile_job_id
    FROM job_runtime.job_delivery_registry
    WHERE tenant_id = $1 AND graphile_job_id IS NOT NULL`, [tenantId]);
  const jobIds = [...new Set(references.rows.map((row) => String(row.graphile_job_id)))];
  if (!jobIds.length) return Object.freeze({ jobs: 0, references: 0, residual: 0, workersUnlocked: 0 });
  const workerUtils = await (dependencies.workerUtilsFactory || makeWorkerUtils)({ pgPool: pool });
  const totals = { jobs: 0, references: jobIds.length, residual: 0, workersUnlocked: 0 };
  try {
    const batchSize = positiveInteger(dependencies.batchSize, 1_000);
    for (let index = 0; index < jobIds.length; index += batchSize) {
      const result = await cleanupGraphileBatch(workerUtils, client, jobIds.slice(index, index + batchSize));
      totals.jobs += result.completed;
      totals.residual += result.residual;
      totals.workersUnlocked += result.workersUnlocked;
    }
    return Object.freeze(totals);
  } finally {
    await workerUtils.release().catch(() => {});
  }
}
async function cleanupLoadData(pool, tenantId, dependencies = {}) {
  const client = await pool.connect();
  try {
    const graphile = await cleanupReferencedGraphileJobs(pool, client, tenantId, dependencies);
    if (graphile.residual !== 0) throw new Error('job_runtime_load_graphile_cleanup_failed');
    await client.query('BEGIN');
    const actions = await client.query(`DELETE FROM job_runtime.job_operator_actions
      WHERE tenant_id = $1`, [tenantId]);
    const effects = await client.query(`DELETE FROM job_runtime.job_effect_ledger
      WHERE tenant_id = $1`, [tenantId]);
    const deliveries = await client.query(`DELETE FROM job_runtime.job_delivery_registry
      WHERE tenant_id = $1`, [tenantId]);
    const residual = await client.query(`SELECT
      (SELECT COUNT(*)::integer FROM job_runtime.job_operator_actions WHERE tenant_id = $1)
      + (SELECT COUNT(*)::integer FROM job_runtime.job_effect_ledger WHERE tenant_id = $1)
      + (SELECT COUNT(*)::integer FROM job_runtime.job_delivery_registry WHERE tenant_id = $1)
      AS count`, [tenantId]);
    await client.query('COMMIT');
    return Object.freeze({
      graphileJobs: graphile.jobs,
      graphileJobReferences: graphile.references,
      graphileJobResidual: graphile.residual,
      graphileWorkersUnlocked: graphile.workersUnlocked,
      actions: actions.rowCount, effects: effects.rowCount, deliveries: deliveries.rowCount,
      residual: Number(residual.rows[0].count),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const testRunner = new JobRuntimeLoadTest();
  const cancel = (signal) => testRunner.cancel(signal);
  const onSigterm = () => cancel('SIGTERM');
  const onSigint = () => cancel('SIGINT');
  process.once('SIGTERM', onSigterm);
  process.once('SIGINT', onSigint);
  let report;
  let failure;
  try {
    report = await testRunner.run();
  } catch (error) {
    failure = error;
  }
  try {
    await testRunner.close();
  } catch (error) {
    failure ||= error;
  }
  process.removeListener('SIGTERM', onSigterm);
  process.removeListener('SIGINT', onSigint);
  if (report) {
    report.cleanup = testRunner.cleanupReport || null;
    if (report.cleanup?.residual !== 0) failure ||= new Error('job_runtime_load_cleanup_failed');
    const artifactPath = process.env.JOB_RUNTIME_LOAD_OUTPUT
      || path.join(process.cwd(), '.artifacts', 'job-runtime-load.json');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (failure) {
    const evidence = report || testRunner.lastReport;
    process.stderr.write(`job runtime load test failed: ${failure.message}${evidence ? ` report=${JSON.stringify(evidence)}` : ''}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`job runtime load test passed: ${JSON.stringify(report)}\n`);
  }
}

if (require.main === module) main();

module.exports = {
  JobRuntimeLoadTest,
  assertJobRuntimeLoadBudgets,
  cleanupLoadData,
  delayUntil,
  loadMeasurement,
  main,
  percentile,
  positiveInteger,
};
