'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createTaskCatalog } = require('../../lib/job-runtime/task-catalog');
const {
  assertInventoryCompleteness,
  inventory,
  inventoryDigest,
  stable,
  verifyDiscoverySources,
  verifySignature,
} = require('../../lib/job-runtime/workload-inventory');
const {
  SCHEDULES,
  createScheduleBridge,
  createWorkloadScheduler,
  occurrence,
  scheduleContext,
} = require('../../lib/job-runtime/workload-scheduler');

const root = path.join(__dirname, '../..');

function signed(value) {
  const candidate = structuredClone(value);
  candidate.signature = { algorithm: 'sha256', digest: inventoryDigest(candidate) };
  return candidate;
}

test('signed inventory covers every catalog workload and every discovered legacy mechanism', () => {
  assert.equal(verifySignature(), true);
  assert.equal(inventoryDigest().length, 64);
  assert.deepEqual(verifyDiscoverySources(root), []);
  assert.equal(assertInventoryCompleteness(createTaskCatalog(), null), true);
  const handlers = Object.fromEntries(inventory.workloads.map((entry) => [entry.taskIdentifier, () => {}]));
  assert.equal(assertInventoryCompleteness(createTaskCatalog(), handlers), true);
  assert.deepEqual(stable({ z: 1, a: { y: 2, b: 3 } }), { a: { b: 3, y: 2 }, z: 1 });
});

test('inventory gate fails closed on tampering catalog omission handler omission or stale sources', () => {
  const tampered = structuredClone(inventory);
  tampered.workloads.pop();
  assert.equal(verifySignature(tampered), false);
  assert.throws(() => assertInventoryCompleteness(createTaskCatalog(), null, { inventory: tampered }), {
    code: 'job_runtime_unavailable', safeDetails: { reason: 'inventory_signature' },
  });
  const catalogGap = signed({ ...inventory, workloads: inventory.workloads.slice(1) });
  assert.throws(() => assertInventoryCompleteness(createTaskCatalog(), null, { inventory: catalogGap }), {
    code: 'job_runtime_unavailable', safeDetails: { reason: 'inventory_catalog_gap' },
  });
  const handlers = Object.fromEntries(inventory.workloads.slice(1).map((entry) => [entry.taskIdentifier, () => {}]));
  assert.throws(() => assertInventoryCompleteness(createTaskCatalog(), handlers), {
    code: 'job_runtime_unavailable', safeDetails: { reason: 'inventory_handler_gap' },
  });
  assert.throws(() => assertInventoryCompleteness(createTaskCatalog(), null, { producers: {} }), {
    code: 'job_runtime_unavailable', safeDetails: { reason: 'inventory_producer_gap' },
  });
  assert.ok(verifyDiscoverySources('/directory/that/does/not/exist').length > 0);
});

function producerRecorder() {
  const calls = [];
  const producer = (name) => async (context, input) => { calls.push({ name, context, input }); return input; };
  return {
    calls,
    producers: {
      auditProjection: producer('auditProjection'),
      auditOutbox: producer('auditOutbox'),
      sreMonitoringExpiry: producer('sreMonitoringExpiry'),
      factoryReconciliation: producer('factoryReconciliation'),
      registryRetention: producer('registryRetention'),
    },
  };
}

test('Graphile cron recovery schedules every bounded workload with deterministic occurrence identity', async () => {
  const fixture = producerRecorder();
  const scheduler = createWorkloadScheduler(fixture.producers, {
    clock: { now: () => 2_000 }, systemTenantId: 'engineering-team',
  });
  await scheduler.recover('1970-01-01T00:00:01.000Z');
  assert.equal(fixture.calls.length, Object.keys(SCHEDULES).length);
  assert.equal(new Set(fixture.calls.map((call) => call.input.occurrenceId)).size, fixture.calls.length);
  assert.ok(fixture.calls.every((call) => call.context.tenantId === 'engineering-team'));
  assert.equal(fixture.calls[0].input.runAt.toISOString(), new Date(1000).toISOString());
  assert.match(occurrence('audit.projection.catch_up.v1', 1000), /^audit-projection-catch_up:1000$/);
  assert.match(scheduleContext('tenant-one', 'audit.outbox.deliver.v1', 1000).correlationId, /^schedule:/);
});

test('self-scheduling uses prior occurrence plus interval and catches up without overlap drift', async () => {
  const fixture = producerRecorder();
  const scheduler = createWorkloadScheduler(fixture.producers, { clock: { now: () => 10_000 } });
  await scheduler.next('audit.projection.catch_up.v1', { occurrenceId: 'projection:1000' });
  assert.equal(fixture.calls[0].input.runAt.getTime(), 10_000);
  await scheduler.next('maintenance.job_runtime.prune.v1', { occurrenceId: 'retention:10000' });
  assert.equal(fixture.calls[1].input.runAt.getTime(), 3_610_000);
  assert.equal(await scheduler.next('factory.langgraph.start.v1', {}), null);
});

test('schedule bridge accepts only the exact Graphile cron payload and fails missing producers closed', async () => {
  const fixture = producerRecorder();
  const scheduler = createWorkloadScheduler(fixture.producers);
  const bridge = createScheduleBridge(() => scheduler);
  await bridge({ scheduleVersion: 1, _cron: { ts: '1970-01-01T00:00:01.000Z' } });
  await assert.rejects(() => bridge({ scheduleVersion: 1, _cron: { ts: 'invalid' } }), { code: 'job_payload_invalid' });
  await assert.rejects(() => bridge({ scheduleVersion: 1, _cron: { ts: new Date().toISOString() }, extra: true }), {
    code: 'job_payload_invalid',
  });
  await assert.rejects(() => createScheduleBridge(() => null)({
    scheduleVersion: 1, _cron: { ts: new Date().toISOString() },
  }), { code: 'job_runtime_unavailable' });
  const incomplete = createWorkloadScheduler({}, { clock: { now: () => 1 } });
  await assert.rejects(() => incomplete.next('audit.outbox.deliver.v1', { occurrenceId: 'outbox:1' }), {
    code: 'job_runtime_unavailable', safeDetails: { reason: 'schedule_contract' },
  });
});
