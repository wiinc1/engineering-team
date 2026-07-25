'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createLangGraphWorkloadAdapter,
  createLifecycleRuntime,
  deriveThreadId,
} = require('../../lib/software-factory/langgraph');

function workload(overrides = {}) {
  const tenantId = overrides.tenantId || 'tenant_alpha';
  const runId = overrides.runId || 'factory:RUN-281';
  return {
    tenantId,
    runId,
    taskId: 'TSK-281',
    threadId: deriveThreadId({ tenantId, factoryRunId: runId }),
    workflowVersion: 1,
    ...overrides,
  };
}

test('workload adapter composes start resume and canonical effect lookup with runtime', async () => {
  const calls = [];
  const runtime = {
    registry: {
      async get(tenantId, threadId) { calls.push(['get', tenantId, threadId]); return { status: 'completed' }; },
    },
    async invoke(input) {
      calls.push(['invoke', input]);
      return { lifecycleStatus: 'succeeded', lifecycleNode: 'closeout' };
    },
    async resume(input) {
      calls.push(['resume', input]);
      return { lifecycleStatus: 'running', lifecycleNode: 'qa' };
    },
  };
  const adapter = createLangGraphWorkloadAdapter({ runtime });
  const input = workload();
  assert.deepEqual(await adapter.start(input), {
    code: 'lifecycle_completed', threadId: input.threadId, lifecycleStatus: 'succeeded', lifecycleNode: 'closeout',
  });
  assert.deepEqual(await adapter.resume({ ...input, checkpointVersion: 2 }), {
    code: 'lifecycle_resumed', threadId: input.threadId, lifecycleStatus: 'running', lifecycleNode: 'qa',
  });
  assert.deepEqual(await adapter.lookupEffect({ ...input, effectKey: 'opaque' }), {
    completed: true, code: 'lifecycle_completed',
  });
  assert.deepEqual(calls, [
    ['invoke', { tenantId: input.tenantId, factoryRunId: input.runId }],
    ['resume', { tenantId: input.tenantId, factoryRunId: input.runId, threadId: input.threadId }],
    ['get', input.tenantId, input.threadId],
  ]);
});

test('workload adapter fails closed on forged thread identity and unsupported workflow version', async () => {
  const adapter = createLangGraphWorkloadAdapter({
    runtime: { registry: { async get() {} }, async invoke() {}, async resume() {} },
  });
  await assert.rejects(() => adapter.start(workload({ threadId: 'lg_000000000000000000000000000000000000000000000000' })), {
    code: 'langgraph_tenant_mismatch',
  });
  await assert.rejects(() => adapter.start(workload({ workflowVersion: 2 })), {
    code: 'langgraph_version_unsupported', safeDetails: { kind: 'workflow' },
  });
});

test('workload adapter covers pending failed and active effect states and validates construction', async () => {
  assert.throws(() => createLangGraphWorkloadAdapter({}), /runtime with invoke and resume/);
  assert.throws(() => createLangGraphWorkloadAdapter({ runtime: { invoke() {} } }), /runtime with invoke and resume/);
  const records = [null, { status: 'failed' }, { status: 'paused' }];
  const runtime = {
    registry: { async get() { return records.shift(); } },
    async invoke() { return { lifecycleStatus: 'running', lifecycleNode: 'intake' }; },
    async resume() { return { lifecycleStatus: 'succeeded', lifecycleNode: 'closeout' }; },
  };
  const adapter = createLangGraphWorkloadAdapter({ runtime });
  const input = workload();
  assert.equal((await adapter.start(input)).code, 'lifecycle_started');
  assert.equal((await adapter.resume(input)).code, 'lifecycle_completed');
  assert.deepEqual(await adapter.lookupEffect(input), { completed: false });
  assert.deepEqual(await adapter.lookupEffect(input), { completed: true, code: 'lifecycle_failed' });
  assert.deepEqual(await adapter.lookupEffect(input), { completed: false, code: 'lifecycle_paused' });
  await assert.rejects(() => createLangGraphWorkloadAdapter({ runtime }).start(null), { code: 'langgraph_state_invalid' });
  await assert.rejects(() => createLangGraphWorkloadAdapter({ runtime }).start('invalid'), { code: 'langgraph_state_invalid' });
});

test('lifecycle runtime composes the complete graph definition into the durable runtime', () => {
  const pool = { options: { max: 2 }, query: async () => ({ rows: [] }), end: async () => {} };
  const runtime = createLifecycleRuntime({
    pool,
    runtimePool: pool,
    checkpointer: { setup: async () => {} },
    registry: {},
    graph: { invoke: async () => {} },
    config: { enabled: true, production: false },
    ports: {
      invoke: async () => ({ outcome: 'success' }),
      planChildren: async () => [],
      executeChild: async () => ({ outcome: 'success' }),
      recordEvent: async () => {},
    },
  });
  assert.equal(typeof runtime.invoke, 'function');
});
