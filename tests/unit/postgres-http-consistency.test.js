'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const {
  bindRequestContext,
  createProjectionConsistentStore,
  isQaResultsRequest,
  preparePostgresHttpConsistency,
} = require('../../lib/audit/postgres-http-consistency');

test('identifies only POST QA result commands as consistency-sensitive', () => {
  assert.equal(isQaResultsRequest({ method: 'POST', url: '/tasks/TSK-1/qa-results?trace=1' }), true);
  assert.equal(isQaResultsRequest({ method: 'GET', url: '/tasks/TSK-1/qa-results' }), false);
  assert.equal(isQaResultsRequest({ method: 'POST', url: '/tasks/TSK-1/state' }), false);
});

test('consistency-sensitive reads share one in-flight projection drain', async () => {
  const calls = [];
  const context = new AsyncLocalStorage();
  const store = createProjectionConsistentStore({
    async processProjectionQueue(limit) {
      calls.push(`drain:${limit}`);
      await new Promise((resolve) => setImmediate(resolve));
    },
    async getTaskCurrentState() { calls.push('state'); return { current_stage: 'QA_TESTING' }; },
    async getTaskHistory() { calls.push('history'); return []; },
  }, context);

  await context.run({ requiresProjectionConsistency: true }, () => Promise.all([
    store.getTaskCurrentState('TSK-1'),
    store.getTaskHistory('TSK-1'),
  ]));
  assert.deepEqual(calls, ['drain:25', 'state', 'history']);
});

test('QA stage append drains after persistence but ordinary activity stays asynchronous', async () => {
  const calls = [];
  const context = new AsyncLocalStorage();
  const store = createProjectionConsistentStore({
    async processProjectionQueue() { calls.push('drain'); },
    async appendEvent(input) { calls.push(`append:${input.eventType}`); return { duplicate: false }; },
    async getTaskCurrentState() { calls.push('state'); return null; },
    async getTaskHistory() { calls.push('history'); return []; },
  }, context);

  await store.getTaskCurrentState('TSK-1');
  await store.appendEvent({ eventType: 'task.stage_changed' });
  assert.deepEqual(calls, ['state', 'append:task.stage_changed']);

  calls.length = 0;
  await context.run({ requiresProjectionConsistency: true }, () => (
    store.appendEvent({ eventType: 'task.stage_changed' })
  ));
  assert.deepEqual(calls, ['append:task.stage_changed', 'drain']);
});

test('request listener binding establishes isolated QA consistency context', async () => {
  const context = new AsyncLocalStorage();
  const observed = [];
  const server = http.createServer((request, response) => {
    observed.push(context.getStore()?.requiresProjectionConsistency);
    response.end('ok');
  });
  bindRequestContext(server, context);
  const listener = server.listeners('request')[0];
  const response = { end() {} };
  await listener({ method: 'POST', url: '/tasks/TSK-1/qa-results' }, response);
  await listener({ method: 'GET', url: '/tasks/TSK-1/state' }, response);
  assert.deepEqual(observed, [true, false]);
});

test('consistency preparation leaves non-postgres stores unchanged', () => {
  const options = { store: { kind: 'memory' } };
  const prepared = preparePostgresHttpConsistency(options);
  const result = { server: http.createServer() };
  assert.equal(prepared.options, options);
  assert.equal(prepared.bind(result), result);
});

test('consistency preparation decorates postgres stores and binds the composed server', async () => {
  const calls = [];
  const sourceStore = {
    kind: 'postgres',
    async processProjectionQueue() { calls.push('drain'); },
    async getTaskCurrentState() { calls.push('state'); return null; },
    async getTaskHistory() { return []; },
    async appendEvent() { return { duplicate: false }; },
  };
  const prepared = preparePostgresHttpConsistency({ store: sourceStore, jwtSecret: 'test-only' });
  const server = http.createServer(async (request, response) => {
    await prepared.options.store.getTaskCurrentState('TSK-1');
    response.end('ok');
  });
  const result = { server };
  assert.notEqual(prepared.options.store, sourceStore);
  assert.equal(prepared.bind(result), result);
  const listener = server.listeners('request')[0];
  await listener({ method: 'POST', url: '/tasks/TSK-1/qa-results' }, { end() {} });
  assert.deepEqual(calls, ['drain', 'state']);
});
