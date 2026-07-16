'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalAuthorization } = require('../../lib/job-runtime');
const { JobRuntimeError } = require('../../lib/job-runtime/errors');
const { createMigratedWorkloadHandlers } = require('../../lib/job-runtime/workload-handlers');
const { createWorkloadProducers } = require('../../lib/job-runtime/workload-producers');

const CONTEXT = Object.freeze({
  tenantId: 'tenant-one', correlationId: 'corr-287', requestId: 'request-287',
  abortSignal: new AbortController().signal,
});

function producerHarness() {
  const calls = [];
  const producers = createWorkloadProducers({ async enqueue(context, request) { calls.push({ context, request }); return request; } });
  return { calls, producers };
}

test('all inventoried producers emit strict identifier-only v1 requests through the shared port', async () => {
  const { calls, producers } = producerHarness();
  await producers.factoryStart(CONTEXT, { runId: 'run-1', taskId: 'TSK-1', threadId: 'thread-1', workflowVersion: 2 });
  await producers.factoryResume(CONTEXT, {
    runId: 'run-1', taskId: 'TSK-1', threadId: 'thread-1', workflowVersion: 2, checkpointVersion: 7,
  });
  const batch = { occurrenceId: 'audit:1000', batchSize: 100, runAt: new Date(1000) };
  await producers.auditProjection(CONTEXT, batch);
  await producers.auditOutbox(CONTEXT, batch);
  await producers.sreMonitoringExpiry(CONTEXT, batch);
  await producers.factoryReconciliation(CONTEXT, { occurrenceId: 'factory:1000', runAt: new Date(1000) });
  await producers.registryRetention(CONTEXT, { occurrenceId: 'retention:1000', runAt: new Date(1000) });
  assert.deepEqual(calls.map((call) => call.request.task), [
    'factory.langgraph.start', 'factory.langgraph.resume', 'audit.projection.catch_up',
    'audit.outbox.deliver', 'maintenance.sre_monitoring.expire',
    'maintenance.factory.reconcile', 'maintenance.job_runtime.prune',
  ]);
  assert.equal(calls[1].request.workloadId, 'run-1:7');
  assert.deepEqual(calls[0].request, {
    task: 'factory.langgraph.start', version: 1, workloadId: 'run-1',
    canonicalResource: { type: 'factory_run', id: 'run-1' },
    data: { runId: 'run-1', taskId: 'TSK-1', threadId: 'thread-1', workflowVersion: 2 },
  });
  assert.deepEqual(calls[1].request, {
    task: 'factory.langgraph.resume', version: 1, workloadId: 'run-1:7',
    canonicalResource: { type: 'factory_run', id: 'run-1' },
    data: {
      runId: 'run-1', taskId: 'TSK-1', threadId: 'thread-1', workflowVersion: 2, checkpointVersion: 7,
    },
  });
  assert.deepEqual(calls[2].request.canonicalResource, { type: 'audit_runtime', id: 'global' });
  assert.equal(calls[2].request.runAt.toISOString(), new Date(1000).toISOString());
  assert.equal(JSON.stringify(calls).includes('token'), false);
  assert.deepEqual(calls[5].request, {
    task: 'maintenance.factory.reconcile', version: 1, workloadId: 'factory:1000',
    canonicalResource: { type: 'factory_tenant', id: 'tenant-one' },
    data: { occurrenceId: 'factory:1000' }, runAt: new Date(1000),
  });
  assert.deepEqual(calls[6].request, {
    task: 'maintenance.job_runtime.prune', version: 1, workloadId: 'retention:1000',
    canonicalResource: { type: 'job_runtime', id: 'tenant-one' },
    data: { occurrenceId: 'retention:1000' }, runAt: new Date(1000),
  });
});

test('producer contracts reject missing identity and unavailable ports', () => {
  assert.throws(() => createWorkloadProducers(null), { code: 'job_runtime_unavailable' });
  const { producers } = producerHarness();
  assert.throws(() => producers.factoryStart(CONTEXT, { runId: 'run-1' }), {
    code: 'job_payload_invalid', safeDetails: { reason: 'producer_contract' },
  });
  assert.throws(() => producers.auditProjection(CONTEXT, { occurrenceId: 'audit:1' }), {
    code: 'job_payload_invalid',
  });
});

function canonical(overrides = {}) {
  return {
    async lookup(input) {
      if (overrides.lookup) return overrides.lookup(input);
      if (input.resourceType === 'factory_run') {
        return { tenantId: input.tenantId, taskId: 'TSK-1', threadId: 'thread-1' };
      }
      return { tenantId: input.tenantId };
    },
    async authorize(input) { return overrides.authorize ? overrides.authorize(input) : true; },
  };
}

function handlerHarness(overrides = {}) {
  const calls = [];
  const auditStore = {
    async processProjectionQueue(batch) { calls.push(['projection', batch]); return { processed: 2 }; },
    async processOutbox(publisher, batch) {
      calls.push(['outbox', batch]);
      await publisher({ tenant_id: 'tenant-two', event_id: 'event-1', schema_version: 1 });
      return { processed: 1 };
    },
    async processExpiredSreMonitoring(batch) { calls.push(['expiry', batch]); return { code: 'expired' }; },
  };
  const langGraph = {
    async lookupEffect(input) { calls.push(['lookup', input.effectKey]); return { completed: false }; },
    async start(input) { calls.push(['start', input]); return { code: 'started' }; },
    async resume(input) { calls.push(['resume', input]); return { code: 'resumed' }; },
  };
  const effectGuard = {
    async execute(input) { calls.push(['guard', input.effectCategory, input.tenantId]); return input.perform('effect-key'); },
  };
  const handlers = createMigratedWorkloadHandlers({
    canonical: overrides.canonical || canonical(),
    effectGuard: Object.hasOwn(overrides, 'effectGuard') ? overrides.effectGuard : effectGuard,
    langGraph: overrides.langGraph || langGraph,
    auditStore: overrides.auditStore || auditStore,
    outbox: overrides.outbox || {
      effectCategory: 'notification',
      async lookupEffect() { return { completed: false }; },
      async publish(event, options) { calls.push(['publish', event.event_id, options.effectKey]); return { code: 'published' }; },
    },
    factoryRecovery: Object.hasOwn(overrides, 'factoryRecovery') ? overrides.factoryRecovery : async (input) => {
      calls.push(['recovery', input.tenantId]); return { code: 'recovered' };
    },
    pruneRegistry: Object.hasOwn(overrides, 'pruneRegistry') ? overrides.pruneRegistry : async (input) => {
      calls.push(['prune', input.tenantId]); return { code: 'pruned' };
    },
    async scheduleNext(identifier) { calls.push(['next', identifier]); },
  });
  return { calls, handlers };
}

const START = Object.freeze({ runId: 'run-1', taskId: 'TSK-1', threadId: 'thread-1', workflowVersion: 2 });
const RESUME = Object.freeze({ ...START, checkpointVersion: 7 });
const BATCH = Object.freeze({ occurrenceId: 'audit:1000', batchSize: 100 });

test('factory handlers reauthorize canonical runs and invoke typed start/resume at the guarded boundary', async () => {
  const { calls, handlers } = handlerHarness();
  await handlers['factory.langgraph.start.v1'](START, CONTEXT);
  await handlers['factory.langgraph.resume.v1'](RESUME, CONTEXT);
  assert.equal(calls.filter(([name]) => name === 'start').length, 1);
  assert.equal(calls.filter(([name]) => name === 'resume').length, 1);
  assert.ok(calls.some(([name, category]) => name === 'guard' && category === 'langgraph_checkpoint'));
  assert.ok(calls.some(([name, identifier]) => name === 'next' && identifier === 'factory.langgraph.start.v1'));
});

function exactContractHarness() {
  const canonicalCalls = [];
  const effectCalls = [];
  const adapterCalls = [];
  const fixture = handlerHarness({
    canonical: {
      async lookup(input) {
        canonicalCalls.push(['lookup', input]);
        return input.resourceType === 'factory_run'
          ? { tenantId: input.tenantId, taskId: 'TSK-1', threadId: 'thread-1' }
          : { tenantId: input.tenantId };
      },
      async authorize(input) { canonicalCalls.push(['authorize', input]); return true; },
    },
    effectGuard: {
      async execute(input) {
        effectCalls.push(input);
        if (input.lookup) await input.lookup('effect-key');
        return input.perform('effect-key');
      },
    },
    langGraph: {
      async lookupEffect(input) { adapterCalls.push(['lookupEffect', input]); return { completed: false }; },
      async start(input) { adapterCalls.push(['start', input]); return { code: 'started' }; },
      async resume(input) { adapterCalls.push(['resume', input]); return { code: 'resumed' }; },
    },
    outbox: {
      effectCategory: 'github',
      async lookupEffect(input) { adapterCalls.push(['outboxLookup', input]); return { completed: false }; },
      async publish(event, input) { adapterCalls.push(['publish', event, input]); return { code: 'published' }; },
    },
  });
  return { adapterCalls, canonicalCalls, effectCalls, fixture };
}

function assertExactContractCalls({ adapterCalls, canonicalCalls, effectCalls }) {
  assert.deepEqual(effectCalls.slice(0, 2).map((input) => ({
    tenantId: input.tenantId, taskIdentifier: input.taskIdentifier, effectCategory: input.effectCategory,
    resourceType: input.resourceType, resourceId: input.resourceId, effectVersion: input.effectVersion,
  })), [
    { tenantId: 'tenant-one', taskIdentifier: 'factory.langgraph.start.v1', effectCategory: 'langgraph_checkpoint', resourceType: 'factory_run', resourceId: 'run-1', effectVersion: 2 },
    { tenantId: 'tenant-one', taskIdentifier: 'factory.langgraph.resume.v1', effectCategory: 'langgraph_checkpoint', resourceType: 'factory_run', resourceId: 'run-1', effectVersion: 7 },
  ]);
  assert.deepEqual(adapterCalls[0], ['lookupEffect', { ...START, tenantId: 'tenant-one', effectKey: 'effect-key' }]);
  assert.deepEqual(adapterCalls[1], ['start', {
    ...START, tenantId: 'tenant-one', effectKey: 'effect-key', abortSignal: CONTEXT.abortSignal,
  }]);
  assert.deepEqual(adapterCalls[2], ['lookupEffect', { ...RESUME, tenantId: 'tenant-one', effectKey: 'effect-key' }]);
  assert.deepEqual(adapterCalls[3], ['resume', {
    ...RESUME, tenantId: 'tenant-one', effectKey: 'effect-key', abortSignal: CONTEXT.abortSignal,
  }]);
  const outboxEffect = effectCalls[2];
  assert.deepEqual({
    tenantId: outboxEffect.tenantId, taskIdentifier: outboxEffect.taskIdentifier,
    effectCategory: outboxEffect.effectCategory, resourceType: outboxEffect.resourceType,
    resourceId: outboxEffect.resourceId, effectVersion: outboxEffect.effectVersion,
  }, {
    tenantId: 'tenant-two', taskIdentifier: 'audit.outbox.deliver.v1', effectCategory: 'github',
    resourceType: 'audit_event', resourceId: 'event-1', effectVersion: 1,
  });
  assert.deepEqual(adapterCalls.at(-2), ['outboxLookup', {
    event: { tenant_id: 'tenant-two', event_id: 'event-1', schema_version: 1 }, effectKey: 'effect-key',
  }]);
  assert.deepEqual(adapterCalls.at(-1), ['publish',
    { tenant_id: 'tenant-two', event_id: 'event-1', schema_version: 1 },
    { effectKey: 'effect-key', abortSignal: CONTEXT.abortSignal }]);
  assert.ok(canonicalCalls.some(([name, input]) => name === 'lookup'
    && input.resourceType === 'audit_event' && input.resourceId === 'event-1' && input.tenantId === 'tenant-two'));
  assert.ok(canonicalCalls.some(([name, input]) => name === 'authorize' && input.action === 'publish'));
}

test('handler authorization and effect adapters receive exact tenant-bound contracts', async () => {
  const harness = exactContractHarness();
  await harness.fixture.handlers['factory.langgraph.start.v1'](START, CONTEXT);
  await harness.fixture.handlers['factory.langgraph.resume.v1'](RESUME, CONTEXT);
  await harness.fixture.handlers['audit.outbox.deliver.v1'](BATCH, CONTEXT);
  assertExactContractCalls(harness);
});

test('factory handlers reject cross-tenant or mismatched canonical references and absent LangGraph', async () => {
  const mismatch = handlerHarness({ canonical: canonical({ lookup: async () => ({ tenantId: 'tenant-one', taskId: 'other', threadId: 'thread-1' }) }) });
  await assert.rejects(() => mismatch.handlers['factory.langgraph.start.v1'](START, CONTEXT), { code: 'job_payload_invalid' });
  const threadMismatch = handlerHarness({ canonical: canonical({ lookup: async () => ({ tenantId: 'tenant-one', taskId: 'TSK-1', threadId: 'other' }) }) });
  await assert.rejects(() => threadMismatch.handlers['factory.langgraph.start.v1'](START, CONTEXT), { code: 'job_payload_invalid' });
  const denied = handlerHarness({ canonical: canonical({ authorize: async () => false }) });
  await assert.rejects(() => denied.handlers['factory.langgraph.start.v1'](START, CONTEXT), { code: 'job_payload_invalid' });
  const missing = handlerHarness({ canonical: canonical({ lookup: async () => null }) });
  await assert.rejects(() => missing.handlers['factory.langgraph.start.v1'](START, CONTEXT), {
    code: 'job_payload_invalid', safeDetails: { reason: 'tenant_mismatch' },
  });
  const unavailable = handlerHarness({ langGraph: {} });
  await assert.rejects(() => unavailable.handlers['factory.langgraph.start.v1'](START, CONTEXT), {
    code: 'job_runtime_unavailable', safeDetails: { reason: 'langgraph_unavailable' },
  });
});

test('audit projection and outbox handlers preserve global order and tenant-bind each external effect', async () => {
  const { calls, handlers } = handlerHarness();
  await handlers['audit.projection.catch_up.v1'](BATCH, CONTEXT);
  await handlers['audit.outbox.deliver.v1'](BATCH, CONTEXT);
  assert.deepEqual(calls.find(([name]) => name === 'projection'), ['projection', 100]);
  assert.ok(calls.some((entry) => entry.join(':') === 'guard:notification:tenant-two'));
  assert.ok(calls.some((entry) => entry.join(':') === 'publish:event-1:effect-key'));
});

test('maintenance handlers execute bounded guarded effects and schedule their next occurrence', async () => {
  const { calls, handlers } = handlerHarness();
  await handlers['maintenance.sre_monitoring.expire.v1'](BATCH, CONTEXT);
  await handlers['maintenance.factory.reconcile.v1']({ occurrenceId: 'factory:1000' }, CONTEXT);
  await handlers['maintenance.job_runtime.prune.v1']({ occurrenceId: 'retention:1000' }, CONTEXT);
  assert.ok(calls.some(([name]) => name === 'expiry'));
  assert.ok(calls.some(([name]) => name === 'recovery'));
  assert.ok(calls.some(([name]) => name === 'prune'));
  assert.equal(calls.filter(([name]) => name === 'next').length, 3);
});

test('handler dependency and canonical failures are stable and sanitized', async () => {
  const missingCanonical = createMigratedWorkloadHandlers();
  await assert.rejects(() => missingCanonical['audit.projection.catch_up.v1'](BATCH, CONTEXT), {
    code: 'job_runtime_unavailable', safeDetails: { reason: 'canonical_lookup_unavailable' },
  });
  const missingStore = handlerHarness({ auditStore: {} });
  await assert.rejects(() => missingStore.handlers['audit.projection.catch_up.v1'](BATCH, CONTEXT), {
    code: 'job_runtime_unavailable', safeDetails: { reason: 'audit_store_unavailable' },
  });
  const invalidOutbox = handlerHarness({ auditStore: {
    async processProjectionQueue() {},
    async processOutbox(publisher) { await publisher({ event_id: null }); },
    async processExpiredSreMonitoring() {},
  } });
  await assert.rejects(() => invalidOutbox.handlers['audit.outbox.deliver.v1'](BATCH, CONTEXT), { code: 'job_payload_invalid' });
  const missingOutboxLookup = handlerHarness({ outbox: { async publish() {} } });
  await assert.rejects(() => missingOutboxLookup.handlers['audit.outbox.deliver.v1'](BATCH, CONTEXT), {
    safeDetails: { reason: 'outbox_publisher_unavailable' },
  });
  const missingGuard = handlerHarness({ effectGuard: null });
  await assert.rejects(() => missingGuard.handlers['factory.langgraph.start.v1'](START, CONTEXT), {
    safeDetails: { reason: 'effect_guard_unavailable' },
  });
  const missingRecovery = handlerHarness({ factoryRecovery: null });
  await assert.rejects(() => missingRecovery.handlers['maintenance.factory.reconcile.v1'](
    { occurrenceId: 'factory:1000' }, CONTEXT,
  ), { safeDetails: { reason: 'factory_recovery_unavailable' } });
  const missingRetention = handlerHarness({ pruneRegistry: null });
  await assert.rejects(() => missingRetention.handlers['maintenance.job_runtime.prune.v1'](
    { occurrenceId: 'retention:1000' }, CONTEXT,
  ), { safeDetails: { reason: 'registry_retention_unavailable' } });
});

test('canonical producer authorization accepts only server-looked-up tenant records', async () => {
  assert.equal(await canonicalAuthorization(null)({ type: 'synthetic', id: 'x', workloadId: 'x' }), true);
  assert.equal(await canonicalAuthorization(null)({ type: 'factory_run', id: 'run', workloadId: 'run' }), false);
  const authorize = canonicalAuthorization(canonical());
  assert.equal(await authorize({ tenantId: 'tenant-one', type: 'factory_run', id: 'run-1' }), true);
  const forged = canonicalAuthorization(canonical({ lookup: async () => ({ tenantId: 'tenant-two' }) }));
  assert.equal(await forged({ tenantId: 'tenant-one', type: 'factory_run', id: 'run-1' }), false);
});

test('generic dependency errors classify as retryable runtime failures', async () => {
  const fixture = handlerHarness({ auditStore: {
    async processProjectionQueue() { throw new Error('postgres://secret'); },
    async processOutbox() {}, async processExpiredSreMonitoring() {},
  } });
  await assert.rejects(() => fixture.handlers['audit.projection.catch_up.v1'](BATCH, CONTEXT), {
    code: 'job_runtime_unavailable', retryable: true,
  });
  assert.equal(new JobRuntimeError('job_schedule_conflict').retryable, false);
});
