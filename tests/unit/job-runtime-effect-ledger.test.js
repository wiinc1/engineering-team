'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createEffectGuard,
  createEffectLedger,
  EFFECT_CATEGORIES,
  effectKey,
  normalizeEffect,
  safeResultCode,
} = require('../../lib/job-runtime/effect-ledger');
const { JobRuntimeError } = require('../../lib/job-runtime/errors');
const { captureLogger, metricRecorder } = require('../fixtures/job-runtime/v1');

const INPUT = Object.freeze({
  tenantId: 'tenant-one',
  taskIdentifier: 'factory.langgraph.start.v1',
  effectCategory: 'langgraph_checkpoint',
  resourceType: 'factory_run',
  resourceId: 'run-1',
  effectVersion: 1,
});

function row(overrides = {}) {
  return {
    tenant_id: INPUT.tenantId,
    effect_key: effectKey(INPUT),
    task_identifier: INPUT.taskIdentifier,
    effect_category: INPUT.effectCategory,
    canonical_resource_type: INPUT.resourceType,
    canonical_resource_id: INPUT.resourceId,
    effect_version: INPUT.effectVersion,
    status: 'started',
    owner_token: '00000000-0000-4000-8000-000000000001',
    result_code: null,
    lease_expires_at: '2026-07-15T12:30:00.000Z',
    ...overrides,
  };
}

function queuedPool(responses) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      const response = responses.shift();
      return response || { rows: [] };
    },
  };
}

test('effect identity is deterministic tenant-bound and version-bound', () => {
  const key = effectKey(INPUT);
  assert.match(key, /^effect:v1:[a-f0-9]{64}$/);
  assert.equal(effectKey({ ...INPUT }), key);
  assert.notEqual(effectKey({ ...INPUT, tenantId: 'tenant-two' }), key);
  assert.notEqual(effectKey({ ...INPUT, effectVersion: 2 }), key);
  assert.throws(() => effectKey({ ...INPUT, resourceId: '' }), { code: 'job_payload_invalid' });
  assert.throws(() => effectKey({ ...INPUT, tenantId: null }), { code: 'job_payload_invalid' });
  assert.throws(() => effectKey({ ...INPUT, effectCategory: 'arbitrary_code' }), {
    code: 'job_payload_invalid', safeDetails: { reason: 'effect_category' },
  });
  assert.equal(safeResultCode('published'), 'published');
  assert.equal(safeResultCode('raw dependency: secret'), 'completed');
  assert.equal(safeResultCode(null, 'safe_fallback'), 'safe_fallback');
  assert.deepEqual(EFFECT_CATEGORIES, [
    'gitlab', 'github', 'deployment', 'notification', 'canonical_task', 'audit_record',
    'langgraph_checkpoint', 'evidence', 'closeout', 'factory_queue_recovery',
    'operational_retention', 'audit_projection',
  ]);
});

test('effect ledger persists ownership completion terminal state and reconciliation reads', async () => {
  const owned = row();
  const completed = row({ status: 'completed', result_code: 'started', lease_expires_at: null, completed_at: new Date() });
  const terminal = row({ status: 'terminal', result_code: 'rejected', lease_expires_at: null, completed_at: new Date() });
  const pool = queuedPool([
    { rows: [owned] },
    { rows: [] }, { rows: [owned] },
    { rows: [completed] },
    { rows: [terminal] },
    { rows: [completed] },
  ]);
  const ledger = createEffectLedger(pool);
  const begin = await ledger.begin({ ...INPUT, effectKey: owned.effect_key, ownerToken: owned.owner_token, leaseSeconds: 60 });
  assert.equal(begin.owner, true);
  const conflict = await ledger.begin({ ...INPUT, effectKey: owned.effect_key, ownerToken: 'other-owner', leaseSeconds: 60 });
  assert.equal(conflict.owner, false);
  assert.equal((await ledger.complete({ tenantId: INPUT.tenantId, effectKey: owned.effect_key, resultCode: 'started' })).status, 'completed');
  assert.equal((await ledger.terminal({ tenantId: INPUT.tenantId, effectKey: owned.effect_key, ownerToken: owned.owner_token, resultCode: 'rejected' })).status, 'terminal');
  assert.equal((await ledger.find(INPUT.tenantId, owned.effect_key)).status, 'completed');
  assert.equal(pool.queries[0].params.at(-1), 60);
  assert.match(pool.queries[0].sql, /INSERT INTO job_runtime\.job_effect_ledger/);
  assert.match(pool.queries[0].sql, /lease_expires_at <= NOW\(\)/);
  assert.deepEqual(pool.queries[0].params, [
    INPUT.tenantId, owned.effect_key, INPUT.taskIdentifier, INPUT.effectCategory,
    INPUT.resourceType, INPUT.resourceId, INPUT.effectVersion, owned.owner_token, 60,
  ]);
  assert.match(pool.queries[2].sql, /WHERE tenant_id = \$1 AND effect_key = \$2/);
  assert.deepEqual(pool.queries[2].params, [INPUT.tenantId, owned.effect_key]);
  assert.match(pool.queries[3].sql, /SET status = 'completed'/);
  assert.deepEqual(pool.queries[3].params, [INPUT.tenantId, owned.effect_key, 'started']);
  assert.match(pool.queries[4].sql, /owner_token = \$3 AND status = 'started'/);
  assert.deepEqual(pool.queries[4].params, [INPUT.tenantId, owned.effect_key, owned.owner_token, 'rejected']);
  assert.equal(normalizeEffect(null), null);
  await assert.rejects(
    () => createEffectLedger(queuedPool([{ rows: [] }])).complete({ tenantId: INPUT.tenantId, effectKey: owned.effect_key }),
    { code: 'job_schedule_conflict' },
  );
});

function memoryLedger(initial) {
  let record = initial || null;
  const calls = { begin: 0, complete: 0, terminal: 0 };
  return {
    calls,
    get record() { return record; },
    async begin(input) {
      calls.begin += 1;
      if (!record) record = { ...input, status: 'started' };
      return { owner: record.ownerToken === input.ownerToken, record };
    },
    async complete(input) { calls.complete += 1; record = { ...record, status: 'completed', resultCode: input.resultCode }; },
    async terminal(input) { calls.terminal += 1; record = { ...record, status: 'terminal', resultCode: input.resultCode }; },
  };
}

function guardHarness(ledger, overrides = {}) {
  return createEffectGuard({
    ledger,
    logger: captureLogger(),
    metrics: metricRecorder(),
    idGenerator: () => '00000000-0000-4000-8000-000000000001',
    leaseSeconds: 60,
    ...overrides,
  });
}

test('effect guard performs once and suppresses completed replay', async () => {
  const ledger = memoryLedger();
  let effects = 0;
  const guard = guardHarness(ledger);
  const first = await guard.execute({ ...INPUT, async perform(key) { effects += 1; return { code: 'started', key }; } });
  assert.equal(first.completed, true);
  assert.equal(first.suppressed, false);
  const second = await guard.execute({ ...INPUT, async perform() { effects += 1; } });
  assert.equal(second.suppressed, true);
  assert.equal(effects, 1);
  assert.equal(ledger.calls.complete, 1);
});

test('effect guard supplies exact lease identity and emits sanitized suppression telemetry', async () => {
  let beginInput;
  const ledger = {
    async begin(input) {
      beginInput = input;
      return { owner: false, record: { ...input, status: 'completed' } };
    },
  };
  const logger = captureLogger();
  const metrics = metricRecorder();
  const guard = createEffectGuard({
    ledger, logger, metrics,
    idGenerator: () => '00000000-0000-4000-8000-000000000009', leaseSeconds: 77,
  });
  const context = {
    deliveryId: '00000000-0000-4000-8000-000000000287', workloadId: 'run-1', attempt: 2,
    correlation: { correlationId: 'corr-287', requestId: 'request-287', traceId: '0123456789abcdef' },
  };
  const result = await guard.execute({ ...INPUT, context, async perform() { throw new Error('must not perform'); } });
  assert.deepEqual(beginInput, {
    ...INPUT,
    context,
    perform: beginInput.perform,
    effectKey: effectKey(INPUT),
    ownerToken: '00000000-0000-4000-8000-000000000009',
    leaseSeconds: 77,
  });
  assert.deepEqual(result, {
    completed: true, suppressed: true, effectKey: effectKey(INPUT), reason: 'ledger_completed',
  });
  assert.deepEqual(metrics.increments, [{
    name: 'job_runtime_effect_suppressed_total',
    labels: { task: INPUT.taskIdentifier, reason: 'ledger_completed' }, value: undefined,
  }]);
  assert.deepEqual(logger.entries[0], {
    level: 'info', event: 'job_effect_suppressed', fields: {
      tenant_id: INPUT.tenantId, task_identifier: INPUT.taskIdentifier,
      effect_category: INPUT.effectCategory, effect_key: effectKey(INPUT), reason: 'ledger_completed',
      canonical_resource_type: INPUT.resourceType, canonical_resource_id: INPUT.resourceId,
      delivery_id: context.deliveryId, workload_id: context.workloadId, attempt: context.attempt,
      correlation_id: context.correlation.correlationId, request_id: context.correlation.requestId,
      trace_id: context.correlation.traceId,
    },
  });
});

test('effect guard checks canonical completion before reclaiming and sanitizes result codes', async () => {
  const ledger = memoryLedger();
  const guard = guardHarness(ledger);
  let performed = 0;
  const result = await guard.execute({
    ...INPUT,
    async lookup() { return { completed: true, code: 'already_applied' }; },
    async perform() { performed += 1; },
  });
  assert.equal(result.reason, 'canonical_effect_completed');
  assert.equal(performed, 0);
  assert.equal(ledger.calls.complete, 1);
  assert.equal(ledger.record.resultCode, 'already_applied');
});

test('crash-after-effect replay reconciles canonical completion without a duplicate effect', async () => {
  const ledger = memoryLedger();
  let performed = 0;
  const crashing = guardHarness(ledger, { faults: { async afterEffect() { throw new Error('process killed'); } } });
  await assert.rejects(() => crashing.execute({ ...INPUT, async perform() { performed += 1; } }), /process killed/);
  const retry = guardHarness(ledger, { idGenerator: () => '00000000-0000-4000-8000-000000000002' });
  const result = await retry.execute({
    ...INPUT,
    async lookup() { return { completed: true, code: 'checkpoint_exists' }; },
    async perform() { performed += 1; },
  });
  assert.equal(result.reason, 'canonical_effect_completed');
  assert.equal(performed, 1);
  assert.equal(ledger.record.status, 'completed');
});

test('concurrent redelivery waits while effect is unconfirmed and terminal outcomes stay terminal', async () => {
  const started = memoryLedger({ ...INPUT, ownerToken: 'another', status: 'started' });
  const guard = guardHarness(started);
  await assert.rejects(() => guard.execute({ ...INPUT, async lookup() { return { completed: false }; }, async perform() {} }), {
    code: 'job_runtime_unavailable', retryable: true, safeDetails: { reason: 'effect_in_progress' },
  });
  const terminal = memoryLedger({ ...INPUT, ownerToken: 'another', status: 'terminal' });
  await assert.rejects(() => guardHarness(terminal).execute({ ...INPUT, async perform() {} }), {
    code: 'job_schedule_conflict', safeDetails: { reason: 'terminal_effect' },
  });
  const own = memoryLedger();
  await assert.rejects(() => guardHarness(own).execute({
    ...INPUT,
    async perform() { throw new JobRuntimeError('job_schedule_conflict'); },
  }), { code: 'job_schedule_conflict' });
  assert.equal(own.calls.terminal, 1);
});

test('crash-before-effect never invokes the business adapter', async () => {
  let performed = 0;
  const guard = guardHarness(memoryLedger(), { faults: { async beforeEffect() { throw new Error('crash before'); } } });
  await assert.rejects(() => guard.execute({ ...INPUT, async perform() { performed += 1; } }), /crash before/);
  assert.equal(performed, 0);
});

test('every external business-effect category reconciles crash-before and crash-after without replay', async () => {
  const external = ['gitlab', 'github', 'deployment', 'notification', 'canonical_task', 'audit_record',
    'langgraph_checkpoint', 'evidence', 'closeout'];
  assert.ok(external.every((category) => EFFECT_CATEGORIES.includes(category)));
  for (const effectCategory of external) {
    const input = { ...INPUT, effectCategory };
    let performed = 0;
    const beforeLedger = memoryLedger();
    await assert.rejects(() => guardHarness(beforeLedger, {
      faults: { async beforeEffect() { throw new Error('crash before'); } },
    }).execute({ ...input, async lookup() { return { completed: false }; }, async perform() { performed += 1; } }));
    assert.equal(performed, 0, effectCategory);

    const afterLedger = memoryLedger();
    await assert.rejects(() => guardHarness(afterLedger, {
      faults: { async afterEffect() { throw new Error('crash after'); } },
    }).execute({ ...input, async lookup() { return { completed: false }; }, async perform() { performed += 1; } }));
    const replay = guardHarness(afterLedger, {
      idGenerator: () => '00000000-0000-4000-8000-000000000002',
    });
    const result = await replay.execute({
      ...input, async lookup() { return { completed: true, code: 'already_applied' }; },
      async perform() { performed += 1; },
    });
    assert.equal(result.suppressed, true, effectCategory);
    assert.equal(performed, 1, effectCategory);
  }
});
