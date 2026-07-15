'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { captureLogger, metricRecorder } = require('../tests/fixtures/job-runtime/v1');
const { createJobRuntime } = require('../lib/job-runtime/runtime');

function chaosRuntime(overrides = {}) {
  const logger = captureLogger();
  const metrics = metricRecorder();
  const calls = { killed: 0, redelivered: 0, closed: 0 };
  const events = overrides.events || new EventEmitter();
  const runner = overrides.runner || {
    promise: new Promise(() => {}),
    stop: () => new Promise(() => {}),
    async kill() { calls.killed += 1; },
  };
  const runtime = createJobRuntime({
    logger, metrics,
    pool: { options: { max: 10 }, async query() { if (overrides.databaseFailure) throw new Error('network'); return { rows: [] }; } },
    registry: {
      async verifySchema() { if (overrides.databaseFailure) throw new Error('database'); },
      async markRunningForRedelivery() { calls.redelivered += 1; },
    },
    adapter: {
      async migrate() { if (overrides.migrationFailure) throw new Error('database unavailable'); },
      async start() { return runner; },
      async close() { calls.closed += 1; },
    },
    async verifyPrivileges() {},
    config: { claimsEnabled: true, concurrency: 2, pollIntervalMs: 100, shutdownDeadlineMs: 1000 },
    taskList: {},
    timers: { setTimeout(callback) { callback(); return 1; }, clearTimeout() {} },
    events,
  });
  return { runtime, calls, events, logger, metrics };
}

test('database outage fails startup closed and readiness stays degraded @regression', async () => {
  const fixture = chaosRuntime({ migrationFailure: true });
  await assert.rejects(() => fixture.runtime.start(), { code: 'job_runtime_unavailable' });
  assert.equal((await fixture.runtime.readiness()).ready, false);
  assert.equal(fixture.logger.entries[0].event, 'job_runtime_start_failed');
});

test('network and worker fatal events emit sanitized metrics without process exit @regression', async () => {
  const fixture = chaosRuntime({ runner: null });
  fixture.events.emit('pool:listen:error', { error: new Error('postgres://credential') });
  fixture.events.emit('pool:fatalError', { error: new Error('token=forbidden') });
  assert.deepEqual(fixture.metrics.increments.map((entry) => entry.name), [
    'job_runtime_network_error_total', 'job_runtime_worker_fatal_total',
  ]);
  assert.equal(JSON.stringify(fixture.logger.entries).includes('credential'), false);
  const failed = chaosRuntime({ databaseFailure: true });
  assert.equal((await failed.runtime.health()).database, false);
  assert.equal((await failed.runtime.health()).status, 'degraded');
});

test('shutdown deadline force-stops worker and marks active deliveries for safe redelivery @regression', async () => {
  const fixture = chaosRuntime();
  await fixture.runtime.start();
  const result = await fixture.runtime.drain('SIGTERM');
  assert.equal(result.state, 'stopped');
  assert.equal(fixture.calls.killed, 1);
  assert.equal(fixture.calls.redelivered, 1);
  assert.equal(fixture.calls.closed, 1);
  assert.equal(fixture.metrics.increments[0].name, 'job_runtime_shutdown_deadline_total');
});

test('shutdown cleanup still redelivers and closes when force-stop fails @regression', async () => {
  const fixture = chaosRuntime({ runner: {
    promise: new Promise(() => {}),
    stop: () => new Promise(() => {}),
    async kill() { fixture.calls.killed += 1; throw new Error('worker kill failed token=secret'); },
  } });
  await fixture.runtime.start();
  await assert.rejects(() => fixture.runtime.drain('SIGTERM'), { code: 'job_runtime_unavailable' });
  assert.equal(fixture.calls.killed, 1);
  assert.equal(fixture.calls.redelivered, 1);
  assert.equal(fixture.calls.closed, 1);
  assert.equal((await fixture.runtime.readiness()).state, 'failed');
  assert.equal(JSON.stringify(fixture.logger.entries).includes('token=secret'), false);
});
