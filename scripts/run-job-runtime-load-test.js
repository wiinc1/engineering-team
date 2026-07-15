#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

class JobRuntimeLoadTest {
  constructor(options = {}) {
    this.durationMs = positiveInteger(options.durationMs || process.env.JOB_RUNTIME_LOAD_DURATION_MS, 600_000);
    this.targetQps = positiveInteger(options.targetQps || process.env.JOB_RUNTIME_LOAD_QPS, 50);
    this.pool = options.pool || createPgPoolFromEnv(options.connectionString);
    this.logger = options.logger || createJobRuntimeLogger({ baseDir: options.baseDir || process.cwd() });
    this.runId = `load-${Date.now().toString(36)}`;
    this.enqueueLatencies = [];
    this.readyLatencies = [];
    this.submittedAt = new Map();
    this.metrics = createMetricSink();
    this.infrastructure = createJobRuntimeInfrastructure({
      pool: this.pool,
      logger: this.logger,
      metrics: this.metrics,
      config: { claimsEnabled: true, concurrency: 4, reservedConnections: 4, shutdownDeadlineMs: 30_000 },
      handlers: { 'job_runtime.synthetic.v1': (data, context) => this.handle(data, context) },
    });
  }

  handle(data, context) {
    if (context.attempt === 1) {
      this.readyLatencies.push(Date.now() - this.submittedAt.get(data.probeId));
    }
  }

  async enqueue(index, startedAt) {
    const targetAt = startedAt + (index * 1000) / this.targetQps;
    await delay(targetAt - performance.now());
    const workloadId = `${this.runId}-${index}`;
    const correlationId = `${this.runId}-corr-${index}`;
    this.submittedAt.set(workloadId, Date.now());
    const enqueueStarted = performance.now();
    await this.infrastructure.port.enqueue({ tenantId: 'tenant-load', correlationId }, {
      task: 'job_runtime.synthetic',
      version: 1,
      workloadId,
      canonicalResource: { type: 'synthetic', id: workloadId },
      data: { probeId: workloadId, expectedOutcome: 'acknowledge' },
      runAt: new Date(),
    });
    this.enqueueLatencies.push(performance.now() - enqueueStarted);
  }

  async waitForCompletion(expected) {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const summary = await this.infrastructure.registry.summarizeCorrelationPrefix(`${this.runId}-corr-`);
      if (summary.delivery_acknowledged === expected) return summary;
      await delay(250);
    }
    throw new Error('job_runtime_load_completion_timeout');
  }

  buildReport(submitted, summary) {
    return {
      version: 1,
      duration_ms: this.durationMs,
      expected_qps: 25,
      target_qps: this.targetQps,
      load_multiplier: 2,
      submitted,
      acknowledged: summary.delivery_acknowledged || 0,
      enqueue_p95_ms: percentile(this.enqueueLatencies, 0.95),
      enqueue_p99_ms: percentile(this.enqueueLatencies, 0.99),
      ready_to_start_p95_ms: percentile(this.readyLatencies, 0.95),
      pool_max: this.pool.options.max,
      pool_peak_total: this.pool.totalCount,
      pool_waiting_at_end: this.pool.waitingCount,
    };
  }

  assertBudgets(report) {
    if (report.target_qps !== report.expected_qps * 2) throw new Error('job_runtime_load_multiplier_failed');
    if (report.acknowledged !== report.submitted) throw new Error('job_runtime_load_delivery_loss');
    if (report.enqueue_p95_ms >= 100 || report.enqueue_p99_ms >= 250) throw new Error('job_runtime_enqueue_latency_budget_failed');
    if (report.ready_to_start_p95_ms >= 2_000) throw new Error('job_runtime_ready_latency_budget_failed');
    if (report.pool_peak_total > report.pool_max || report.pool_waiting_at_end !== 0) throw new Error('job_runtime_pool_budget_failed');
  }

  async run() {
    await this.infrastructure.runtime.start();
    const submitted = Math.floor((this.durationMs / 1000) * this.targetQps);
    const startedAt = performance.now();
    for (let index = 0; index < submitted; index += 1) await this.enqueue(index, startedAt);
    const summary = await this.waitForCompletion(submitted);
    const report = this.buildReport(submitted, summary);
    this.assertBudgets(report);
    return report;
  }

  async close() {
    await this.infrastructure.runtime.drain('load test complete').catch(() => {});
    await this.pool.end();
  }
}

async function main() {
  const testRunner = new JobRuntimeLoadTest();
  try {
    const report = await testRunner.run();
    const artifactPath = path.join(process.cwd(), '.artifacts', 'job-runtime-load.json');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`job runtime load test passed: ${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`job runtime load test failed: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    await testRunner.close();
  }
}

if (require.main === module) main();

module.exports = {
  JobRuntimeLoadTest,
  main,
  percentile,
  positiveInteger,
};
