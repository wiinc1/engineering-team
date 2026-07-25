'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { captureLogger, deliveryRecord, metricRecorder } = require('../fixtures/job-runtime/v1');
const { createJobRuntimeInfrastructure } = require('../../lib/job-runtime');
const { poolSummary } = require('../../lib/job-runtime/runtime');

test('infrastructure composes the application port without leaking Graphile internals', () => {
  const pool = { options: { max: 10 }, async query() { return { rows: [{ present: true }] }; } };
  const registry = {
    async createPending() { return { created: false, record: deliveryRecord() }; },
    async verifySchema() {},
  };
  const adapter = { async migrate() {}, async start() { return null; }, async close() {} };
  const infrastructure = createJobRuntimeInfrastructure({
    pool, registry, adapter, logger: captureLogger(), metrics: metricRecorder(), verifyPrivileges: async () => true,
    config: { claimsEnabled: false },
  });
  assert.equal(typeof infrastructure.port.enqueue, 'function');
  assert.equal(infrastructure.graphileWorker, undefined);
  assert.equal(infrastructure.config.claimsEnabled, false);
  assert.deepEqual(poolSummary(pool), { max: 10, total: 0, idle: 0, waiting: 0 });
});

test('infrastructure default retention handler prunes bounded records and sanitizes failures', async () => {
  const logger = captureLogger();
  const metrics = metricRecorder();
  const calls = [];
  const registry = {
    async pruneTerminalBefore(cutoff, limit) { calls.push({ cutoff, limit }); return 3; },
  };
  const common = {
    pool: { options: { max: 10 }, on() {} }, registry,
    adapter: {}, logger, metrics, verifyPrivileges: async () => true,
    config: { claimsEnabled: false, retentionDays: 30, retentionBatch: 1000 },
    clock: { now: () => Date.parse('2026-07-15T12:00:00.000Z') },
    canonical: { async lookup(input) { return { tenantId: input.tenantId }; } },
    effectGuard: { async execute(input) { return input.perform('effect-key'); } },
    scheduler: { async next() {} },
  };
  const infrastructure = createJobRuntimeInfrastructure(common);
  const result = await infrastructure.handlers['maintenance.job_runtime.prune.v1'](
    { occurrenceId: 'retention:1000' },
    { tenantId: 'tenant-one', abortSignal: new AbortController().signal },
  );
  assert.deepEqual(result, { code: 'pruned', count: 3 });
  assert.equal(calls[0].limit, 1000);
  assert.equal(metrics.increments.find((entry) => entry.name === 'job_runtime_registry_pruned_total').value, 3);

  registry.pruneTerminalBefore = async () => { throw new Error('database token=secret'); };
  await assert.rejects(() => infrastructure.handlers['maintenance.job_runtime.prune.v1'](
    { occurrenceId: 'retention:2000' }, { tenantId: 'tenant-one' },
  ), { code: 'job_runtime_unavailable' });
  assert.ok(metrics.increments.some((entry) => entry.name === 'job_runtime_retention_failure_total'));
  assert.equal(JSON.stringify(logger.entries).includes('token=secret'), false);
});

test('infrastructure default privilege verifier and clock execute through the composed runtime', async () => {
  const pool = {
    options: { max: 10 },
    async query(sql) {
      if (sql.includes('has_schema_privilege')) {
        return { rows: [{ graphile_usage: true, registry_usage: true, registry_access: true, effect_access: true, operator_action_access: true, ownership_epoch_access: true }] };
      }
      return { rows: [{ '?column?': 1 }] };
    },
  };
  const registry = { async verifySchema() {} };
  const adapter = { async migrate() {}, async start() { return null; }, async close() {} };
  const infrastructure = createJobRuntimeInfrastructure({
    pool, registry, adapter, logger: captureLogger(), metrics: metricRecorder(), config: { claimsEnabled: false },
  });
  assert.equal((await infrastructure.runtime.start()).state, 'standby');
});

test('infrastructure can construct default pool logger metrics registry and effect ledger without connecting', async () => {
  const infrastructure = createJobRuntimeInfrastructure({
    connectionString: 'postgres://unused:unused@127.0.0.1:1/unused',
    adapter: { async migrate() {}, async start() { return null; }, async close() {} },
    effectGuard: { async execute(input) { return input.perform('effect-key'); } },
    canonical: { async lookup(input) { return { tenantId: input.tenantId }; } },
    config: { claimsEnabled: false },
    verifyPrivileges: async () => true,
  });
  assert.equal(infrastructure.pool.options.max, 10);
  assert.equal(typeof infrastructure.registry.findByDeliveryId, 'function');
  assert.equal(typeof infrastructure.effectLedger.begin, 'function');
  assert.deepEqual(infrastructure.metrics.snapshot().counters, {});
  await infrastructure.pool.end();
});
