'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const envelopeFixture = require('../fixtures/job-runtime/v1-valid-envelope.json');
const { captureLogger, metricRecorder, validContext, validRequest } = require('../fixtures/job-runtime/v1');
const { createPayloadValidator } = require('../../lib/job-runtime/payload-schema');
const { createJobRuntimePort } = require('../../lib/job-runtime/port');
const { createTaskCatalog } = require('../../lib/job-runtime/task-catalog');
const { assertJobRuntimeLoadBudgets } = require('../../scripts/run-job-runtime-load-test');

const EXPECTED_QPS = 25;
const LOAD_MULTIPLIER = 2;
const TARGET_QPS = EXPECTED_QPS * LOAD_MULTIPLIER;

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function performancePort() {
  let sequence = 0;
  const keys = new Set();
  const registry = {
    async createPending(input) {
      keys.add(input.semanticJobKey);
      return { created: true, record: { scheduledFor: new Date(input.scheduledFor).toISOString() } };
    },
    async attachGraphileJob(deliveryId) {
      return { deliveryId, taskIdentifier: 'job_runtime.synthetic.v1', tenantId: 'tenant-load', correlationId: 'load', scheduledFor: new Date().toISOString() };
    },
    async markFailed() {},
  };
  const port = createJobRuntimePort({
    catalog: createTaskCatalog(), registry,
    adapter: { async addJob() { return { id: String(sequence) }; }, async compensate() {} },
    logger: captureLogger(), metrics: metricRecorder(),
    idGenerator: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  });
  return { port, keys };
}

test('payload validation remains below the enqueue latency budget at 2x expected load', () => {
  const validator = createPayloadValidator();
  const definition = createTaskCatalog().resolve('job_runtime.synthetic', 1);
  const latencies = [];
  for (let index = 0; index < TARGET_QPS * 20; index += 1) {
    const started = performance.now();
    validator.validate(envelopeFixture, definition);
    latencies.push(performance.now() - started);
  }
  assert.ok(percentile(latencies, 0.95) < 100);
  assert.ok(percentile(latencies, 0.99) < 250);
});

test('application enqueue port sustains more than 2x expected QPS without key collision', async () => {
  const { port, keys } = performancePort();
  const sampleSize = TARGET_QPS * 4;
  const latencies = [];
  const started = performance.now();
  await Promise.all(Array.from({ length: sampleSize }, async (_, index) => {
    const requestStarted = performance.now();
    const workloadId = `load-${index}`;
    await port.enqueue(validContext({ tenantId: 'tenant-load', correlationId: `load-corr-${index}` }), validRequest({
      workloadId,
      canonicalResource: { type: 'synthetic', id: workloadId },
      data: { probeId: workloadId },
      runAt: new Date(),
    }));
    latencies.push(performance.now() - requestStarted);
  }));
  const durationSeconds = (performance.now() - started) / 1000;
  assert.ok(sampleSize / durationSeconds > TARGET_QPS);
  assert.ok(percentile(latencies, 0.95) < 100);
  assert.ok(percentile(latencies, 0.99) < 250);
  assert.equal(keys.size, sampleSize);
});

test('hosted load report budget evaluation remains constant-time at gate volume', () => {
  const report = {
    load_multiplier: 2, required_load_multiplier: 2,
    submitted: 30_000, acknowledged: 30_000, enqueue_p95_ms: 20, enqueue_p99_ms: 40,
    operational_read_p95_ms: 30, ready_to_start_p95_ms: 100,
    pool_peak_total: 6, pool_max: 10, pool_waiting_at_end: 0,
    runtime_pool_waiting_at_end: 0,
  };
  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) assertJobRuntimeLoadBudgets(report);
  assert.ok(performance.now() - started < 100);
});

module.exports = {
  EXPECTED_QPS,
  LOAD_MULTIPLIER,
  TARGET_QPS,
  percentile,
};
