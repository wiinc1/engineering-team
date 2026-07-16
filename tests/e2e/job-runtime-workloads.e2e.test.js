'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAuditStore } = require('../../lib/audit');
const { createEffectGuard } = require('../../lib/job-runtime/effect-ledger');
const { fairWorkerPlans } = require('../../lib/job-runtime/graphile-adapter');
const { createTaskCatalog } = require('../../lib/job-runtime/task-catalog');
const { createMigratedWorkloadHandlers } = require('../../lib/job-runtime/workload-handlers');
const { inventory, assertInventoryCompleteness } = require('../../lib/job-runtime/workload-inventory');
const { createWorkloadScheduler } = require('../../lib/job-runtime/workload-scheduler');
const { captureLogger, metricRecorder } = require('../fixtures/job-runtime/v1');

const CONTEXT = Object.freeze({
  tenantId: 'tenant-one', correlationId: 'corr-287', abortSignal: new AbortController().signal,
});

function memoryLedger() {
  const records = new Map();
  return {
    async begin(input) {
      let record = records.get(input.effectKey);
      if (!record) {
        record = { ...input, status: 'started' };
        records.set(input.effectKey, record);
      }
      return { owner: record.ownerToken === input.ownerToken, record };
    },
    async complete(input) {
      records.set(input.effectKey, { ...records.get(input.effectKey), status: 'completed', resultCode: input.resultCode });
    },
    async terminal(input) {
      records.set(input.effectKey, { ...records.get(input.effectKey), status: 'terminal', resultCode: input.resultCode });
    },
  };
}

function effectGuard(options = {}) {
  let sequence = 0;
  return createEffectGuard({
    ledger: options.ledger || memoryLedger(), logger: captureLogger(), metrics: metricRecorder(),
    idGenerator: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    faults: options.faults,
  });
}

function canonical(overrides = {}) {
  return {
    async lookup(input) {
      if (overrides.lookup) return overrides.lookup(input);
      return input.resourceType === 'factory_run'
        ? { tenantId: input.tenantId, taskId: 'TSK-287', threadId: 'thread-287' }
        : { tenantId: input.tenantId };
    },
    async authorize() { return true; },
  };
}

test('AC1 factory scheduling invokes tenant-bound LangGraph start/resume once at the effect boundary @regression', async () => {
  let starts = 0;
  let resumes = 0;
  const handlers = createMigratedWorkloadHandlers({
    canonical: canonical(), effectGuard: effectGuard(),
    langGraph: {
      async lookupEffect() { return { completed: false }; },
      async start(input) { starts += 1; assert.equal(input.tenantId, 'tenant-one'); return { code: 'started' }; },
      async resume(input) { resumes += 1; assert.equal(input.tenantId, 'tenant-one'); return { code: 'resumed' }; },
    },
  });
  const data = { runId: 'run-287', taskId: 'TSK-287', threadId: 'thread-287', workflowVersion: 1 };
  await handlers['factory.langgraph.start.v1'](data, CONTEXT);
  await handlers['factory.langgraph.start.v1'](data, CONTEXT);
  const resume = { ...data, checkpointVersion: 2 };
  await handlers['factory.langgraph.resume.v1'](resume, CONTEXT);
  await handlers['factory.langgraph.resume.v1'](resume, CONTEXT);
  assert.equal(starts, 1);
  assert.equal(resumes, 1);
});

test('AC2 projection and outbox handlers preserve order catch-up idempotency and audit contracts @regression', async () => {
  const published = [];
  const store = {
    async processProjectionQueue(batch) { assert.equal(batch, 100); return { processed: 2 }; },
    async processOutbox(publisher) {
      for (const eventId of ['event-1', 'event-2']) {
        await publisher({ tenant_id: 'tenant-one', event_id: eventId, schema_version: 1 });
      }
      return { processed: 2 };
    },
  };
  const handlers = createMigratedWorkloadHandlers({
    canonical: canonical(), effectGuard: effectGuard(), auditStore: store,
    outbox: {
      effectCategory: 'notification', async lookupEffect() { return { completed: false }; },
      async publish(event) { published.push(event.event_id); return { code: 'published' }; },
    },
  });
  const batch = { occurrenceId: 'audit:1000', batchSize: 100 };
  assert.deepEqual(await handlers['audit.projection.catch_up.v1'](batch, CONTEXT), { processed: 2 });
  assert.deepEqual(await handlers['audit.outbox.deliver.v1'](batch, CONTEXT), { processed: 2 });
  assert.deepEqual(published, ['event-1', 'event-2']);
});

test('AC3 cron recovery schedules bounded non-overlapping maintenance occurrences @regression', async () => {
  const calls = [];
  const producers = Object.fromEntries([
    'auditProjection', 'auditOutbox', 'sreMonitoringExpiry', 'factoryReconciliation', 'registryRetention',
  ].map((name) => [name, async (context, input) => calls.push({ name, context, input })]));
  const scheduler = createWorkloadScheduler(producers, { clock: { now: () => 2_000 } });
  await scheduler.recover('1970-01-01T00:00:01.000Z');
  await scheduler.next('audit.projection.catch_up.v1', { occurrenceId: 'projection:1000' });
  assert.equal(calls.length, 6);
  assert.equal(new Set(calls.slice(0, 5).map((call) => call.input.occurrenceId)).size, 5);
  assert.equal(calls.at(-1).input.runAt.getTime(), 6_000);
});

test('AC4 crash-after external effect reconciles canonical completion without duplicate effects @regression', async () => {
  const ledger = memoryLedger();
  let performed = 0;
  const input = {
    tenantId: 'tenant-one', taskIdentifier: 'audit.outbox.deliver.v1', effectCategory: 'github',
    resourceType: 'audit_event', resourceId: 'event-287', effectVersion: 1,
  };
  await assert.rejects(() => effectGuard({
    ledger, faults: { async afterEffect() { throw new Error('crash after effect'); } },
  }).execute({ ...input, async lookup() { return { completed: false }; }, async perform() { performed += 1; } }));
  const replay = effectGuard({ ledger });
  const result = await replay.execute({
    ...input, async lookup() { return { completed: true, code: 'github_effect_exists' }; },
    async perform() { performed += 1; },
  });
  assert.equal(result.suppressed, true);
  assert.equal(performed, 1);
});

test('AC5 worker classes improve concurrency without tenant or ordering boundary violations @regression', async () => {
  const tasks = {
    'factory.langgraph.start.v1': async () => {}, 'audit.projection.catch_up.v1': async () => {},
    'audit.outbox.deliver.v1': async () => {}, 'maintenance.factory.reconcile.v1': async () => {},
  };
  assert.deepEqual(fairWorkerPlans(tasks, 4, [])[0].classConcurrency, {
    factory: 1, projection: 1, outbox: 1, maintenance: 1,
  });
  const handlers = createMigratedWorkloadHandlers({
    canonical: canonical({ lookup: async () => ({ tenantId: 'tenant-two', taskId: 'TSK-287', threadId: 'thread-287' }) }),
    effectGuard: effectGuard(), langGraph: { async start() {} },
  });
  await assert.rejects(() => handlers['factory.langgraph.start.v1']({
    runId: 'run-287', taskId: 'TSK-287', threadId: 'thread-287', workflowVersion: 1,
  }, CONTEXT), { safeDetails: { reason: 'tenant_mismatch' } });
});

test('AC6 omitted inventory workload blocks static and runtime completeness @regression', () => {
  const handlers = Object.fromEntries(inventory.workloads.slice(1).map((entry) => [entry.taskIdentifier, () => {}]));
  assert.throws(() => assertInventoryCompleteness(createTaskCatalog(), handlers), {
    safeDetails: { reason: 'inventory_handler_gap' },
  });
});

test('AC7 Graphile delivery preserves current status next-action audit and error consumers @regression', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphile-287-api-'));
  const store = createAuditStore({ baseDir, backend: 'file', projectionMode: 'async' });
  await store.appendEvent({
    tenantId: 'tenant-one', taskId: 'TSK-287', eventType: 'task.created', actorId: 'e2e', actorType: 'system',
    idempotencyKey: 'graphile-287-api', payload: { title: 'Compatibility', initial_stage: 'BACKLOG' },
  });
  const handlers = createMigratedWorkloadHandlers({ canonical: canonical(), auditStore: store });
  await handlers['audit.projection.catch_up.v1']({ occurrenceId: 'projection:1000', batchSize: 100 }, CONTEXT);
  const state = store.getTaskCurrentState('TSK-287', { tenantId: 'tenant-one' });
  const history = store.getTaskHistory('TSK-287', { tenantId: 'tenant-one' });
  assert.equal(state.current_stage, 'BACKLOG');
  assert.equal(history[0].event_type, 'task.created');
  assert.equal(state.tenant_id, 'tenant-one');
});
