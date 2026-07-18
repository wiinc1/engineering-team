'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { MemorySaver } = require('@langchain/langgraph');
const {
  LIFECYCLE_NODE_NAMES,
  compileFactoryGraph,
  createLifecycleDefinition,
  deriveThreadId,
  executeChildPlan,
  validateChildDefinitions,
  validateFactoryState,
} = require('../../lib/software-factory/langgraph');
const { state } = require('../fixtures/langgraph/v1');

function runnableState(overrides = {}) {
  const tenantId = overrides.tenantId || 'tenant_alpha';
  const factoryRunId = overrides.factoryRunId || 'factory:RUN-281';
  return state({
    tenantId,
    factoryRunId,
    threadId: deriveThreadId({ tenantId, factoryRunId }),
    ...overrides,
  });
}

function definition(overrides = {}) {
  return createLifecycleDefinition({
    maxNodeAttempts: 2,
    maxQaAttempts: 2,
    ports: {
      invoke: async () => ({ outcome: 'success' }),
      planChildren: async () => [],
      executeChild: async () => ({ outcome: 'success' }),
      recordEvent: async () => {},
      ...overrides,
    },
  });
}

async function runLifecycle(lifecycle, input = runnableState()) {
  const graph = compileFactoryGraph({
    ...lifecycle,
    checkpointer: new MemorySaver(),
    clock: { now: () => Date.parse('2026-07-16T12:00:00.000Z') },
    maxStateBytes: 256 * 1024,
  });
  return graph.invoke(input, {
    configurable: { thread_id: input.threadId, checkpoint_ns: '' },
  });
}

test('complete lifecycle graph executes every required production node in order', async () => {
  const calls = [];
  const lifecycle = definition({
    invoke: async (name) => { calls.push(name); return { outcome: 'success' }; },
  });
  const result = validateFactoryState(await runLifecycle(lifecycle));
  assert.deepEqual(calls, LIFECYCLE_NODE_NAMES.filter((name) => !['child_execution', 'fix', 'terminal'].includes(name)));
  assert.equal(result.lifecycleStatus, 'succeeded');
  assert.equal(result.terminalReason, null);
  assert.ok(result.completedNodes.includes('closeout'));
  assert.ok(!result.completedNodes.includes('terminal'));
});

test('QA failure routes through bounded fix and returns to QA', async () => {
  let qaCalls = 0;
  let fixCalls = 0;
  const lifecycle = definition({
    qa: async () => ({ outcome: 'success', qaOutcome: ++qaCalls === 1 ? 'fail' : 'pass' }),
    fix: async () => { fixCalls += 1; return { outcome: 'success' }; },
  });
  const result = validateFactoryState(await runLifecycle(lifecycle));
  assert.equal(qaCalls, 2);
  assert.equal(fixCalls, 1);
  assert.equal(result.qaAttempts, 2);
  assert.equal(result.lifecycleStatus, 'succeeded');
});

test('QA exhaustion terminates as dead letter without running review or deployment', async () => {
  const calls = [];
  const lifecycle = definition({
    invoke: async (name) => { calls.push(name); return { outcome: 'success' }; },
    qa: async () => ({ outcome: 'success', qaOutcome: 'fail' }),
    fix: async () => ({ outcome: 'success' }),
  });
  const result = validateFactoryState(await runLifecycle(lifecycle));
  assert.equal(result.lifecycleStatus, 'dead_letter');
  assert.equal(result.terminalReason, 'qa_retry_exhausted');
  assert.ok(result.completedNodes.includes('terminal'));
  assert.ok(!calls.includes('review'));
});

test('retryable node failure is bounded and persists attempts before continuing', async () => {
  let attempts = 0;
  const lifecycle = definition({
    implementation: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('temporary'), { code: 'adapter_timeout', retryable: true });
      return { outcome: 'success' };
    },
  });
  const result = validateFactoryState(await runLifecycle(lifecycle));
  assert.equal(attempts, 2);
  assert.equal(result.nodeAttempts.implementation, 2);
  assert.equal(result.lifecycleStatus, 'succeeded');
});

test('nonrecoverable and cancellation outcomes route directly to terminal evidence', async () => {
  for (const [outcome, expected] of [['failed', 'failed'], ['cancelled', 'cancelled']]) {
    const lifecycle = definition({
      deployment: async () => ({ outcome, terminalReason: `${outcome}_deployment` }),
    });
    const result = validateFactoryState(await runLifecycle(lifecycle, runnableState({ factoryRunId: `factory:${outcome}` })));
    assert.equal(result.lifecycleStatus, expected);
    assert.equal(result.terminalReason, `${outcome}_deployment`);
    assert.ok(result.completedNodes.includes('terminal'));
    assert.ok(!result.completedNodes.includes('sre'));
  }
});

test('independent child work runs concurrently while dependencies wait', async () => {
  const started = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const execution = executeChildPlan([
    { id: 'api', dependencies: [] },
    { id: 'ui', dependencies: [] },
    { id: 'integration', dependencies: ['api', 'ui'] },
  ], async (child, context) => {
    started.push({ id: child.id, namespace: context.namespace });
    if (child.id !== 'integration') await gate;
    return { outcome: 'success' };
  }, { idempotencyKey: 'thread:child_execution:1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.map((entry) => entry.id).sort(), ['api', 'ui']);
  release();
  const runs = await execution;
  assert.deepEqual(started.map((entry) => entry.id), ['api', 'ui', 'integration']);
  assert.ok(started.every((entry) => entry.namespace === `child:${entry.id}`));
  assert.ok(runs.every((run) => run.status === 'succeeded'));
});

test('child plans reject missing dependencies, self-dependencies, cycles, and duplicates', async () => {
  assert.throws(() => validateChildDefinitions([{ id: 'api', dependencies: ['missing'] }]), {
    code: 'langgraph_state_invalid',
  });
  assert.throws(() => validateChildDefinitions([{ id: 'api', dependencies: ['api'] }]), {
    code: 'langgraph_state_invalid',
  });
  assert.throws(() => validateChildDefinitions([{ id: 'api' }, { id: 'api' }]), {
    code: 'langgraph_state_invalid',
  });
  await assert.rejects(() => executeChildPlan([
    { id: 'api', dependencies: ['ui'] },
    { id: 'ui', dependencies: ['api'] },
  ], async () => ({ outcome: 'success' }), { idempotencyKey: 'cycle' }), {
    code: 'langgraph_state_invalid',
  });
});

test('lifecycle state rejects unsafe operational fields and child-run corruption', () => {
  assert.throws(() => validateFactoryState(runnableState({ lifecycleStatus: 'unknown' })), {
    code: 'langgraph_state_invalid',
  });
  assert.throws(() => validateFactoryState(runnableState({ nodeAttempts: { qa: -1 } })), {
    code: 'langgraph_state_invalid',
  });
  assert.throws(() => validateFactoryState(runnableState({
    childRuns: [{ id: 'api', status: 'succeeded', dependencies: ['missing'], attempt: 1, namespace: 'child:api' }],
  })), { code: 'langgraph_state_invalid' });
});

test('every lifecycle node emits canonical start and outcome evidence without raw state', async () => {
  const events = [];
  const lifecycle = definition({
    recordEvent: async (event) => { events.push(event); },
    implementation: async () => ({
      outcome: 'success',
      delegation: { delegated: true, handledBy: 'jr_engineer' },
    }),
  });
  await runLifecycle(lifecycle);
  const started = events.filter((event) => event.type === 'node_started');
  const finished = events.filter((event) => event.type === 'node_finished');
  assert.equal(started.length, finished.length);
  assert.ok(started.length >= 12);
  assert.deepEqual(finished.find((event) => event.node === 'implementation').delegation, {
    delegated: true, handledBy: 'jr_engineer',
  });
  assert.equal(JSON.stringify(events).includes('artifacts'), false);
});

test('delegation attribution fails closed when ownership evidence is malformed or false', async () => {
  const invalid = [
    { delegated: true, handledBy: 'factory_orchestrator' },
    { delegated: 'yes', handledBy: 'qa' },
    { delegated: true },
  ];
  for (const [index, delegation] of invalid.entries()) {
    const lifecycle = definition({ implementation: async () => ({ outcome: 'success', delegation }) });
    const result = validateFactoryState(await runLifecycle(
      lifecycle,
      runnableState({ factoryRunId: `factory:delegation_${index}` }),
    ));
    assert.equal(result.lifecycleStatus, 'failed');
    assert.equal(result.terminalReason, 'langgraph_state_invalid');
  }
});
