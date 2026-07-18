'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const { createLangGraphRouteWrapper } = require('../../lib/software-factory/langgraph/http-wrapper');
const { LangGraphRuntimeError } = require('../../lib/software-factory/langgraph/errors');

function responseProbe() {
  return {
    headers: {}, writableEnded: false,
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; this.writableEnded = true; },
  };
}

function request(method, url, body, headers = {}) {
  return Object.assign(Readable.from(body === undefined ? [] : [body]), { method, url, headers });
}

function fixture(options = {}) {
  const server = new EventEmitter();
  const calls = [];
  const runtime = options.runtime || {
    registry: {},
    async health(input) { calls.push(['health', input]); return { status: 'ok', deep: input.deep }; },
    async checkpointSummaries() { return []; },
  };
  const service = options.service || {
    async status(input) { calls.push(['status', input]); return { status: 'paused' }; },
    async decide(input) { calls.push(['decide', input]); return { outcome: 'succeeded' }; },
    async retry(input) { calls.push(['retry', input]); return { outcome: 'succeeded' }; },
    async cancel(input) { calls.push(['cancel', input]); return { outcome: 'succeeded' }; },
  };
  const csrfCalls = [];
  const principal = options.principal === undefined
    ? { tenantId: 'tenant-one', actorId: 'sre-1', roles: ['sre'] }
    : options.principal;
  createLangGraphRouteWrapper({ server, store: options.store, authService: {
    async requireCsrf(...args) { csrfCalls.push(args); },
  } }, {
    langGraphRuntime: options.noRuntime ? undefined : runtime,
    langGraphOperatorService: service,
    ffLangGraphControls: true,
  }, {
    async getRequestContext() {
      if (options.authError) throw options.authError;
      return principal;
    },
  });
  return { calls, csrfCalls, listener: server.listeners('request')[0] };
}

async function invoke(fx, method, url, body, headers = {}) {
  const res = responseProbe();
  await fx.listener(request(method, url, body, headers), res);
  return { ...res, json: res.body ? JSON.parse(res.body) : null };
}

test('LangGraph operator status is authorized and tenant scoped', async () => {
  const fx = fixture();
  const response = await invoke(fx, 'GET', '/api/v1/langgraph/runs/thread%201', undefined, { 'x-request-id': 'lg-request-1' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.data.status, 'paused');
  assert.deepEqual(fx.calls[0], ['status', { tenantId: 'tenant-one', threadId: 'thread 1' }]);

  const denied = await invoke(fixture({ principal: { tenantId: 'tenant-one', actorId: 'user-1', roles: [] } }), 'GET', '/v1/langgraph/runs/thread-1');
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json.error.code, 'langgraph_decision_forbidden');
});

test('decision route propagates checkpoint concurrency and idempotency fields', async () => {
  const fx = fixture();
  const response = await invoke(fx, 'POST', '/v1/langgraph/runs/thread-1/interrupts/int-1/decision', JSON.stringify({
    checkpointId: 'cp-7', action: 'edit', edits: { summary: 'bounded' },
  }), { 'if-match': '"2"', 'idempotency-key': 'decision-2' });
  assert.equal(response.statusCode, 200);
  assert.equal(fx.csrfCalls.length, 1);
  assert.deepEqual(fx.calls[0][1], {
    tenantId: 'tenant-one', actorId: 'sre-1', roles: ['sre'], requestId: response.headers['x-request-id'],
    threadId: 'thread-1', idempotencyKey: 'decision-2', interruptId: 'int-1', checkpointId: 'cp-7',
    expectedVersion: 2, action: 'edit', edits: { summary: 'bounded' },
  });
});

test('retry and cancel routes use body fallbacks and reject unsupported methods', async () => {
  const fx = fixture();
  let response = await invoke(fx, 'POST', '/backend/v1/langgraph/runs/thread-1/retry', JSON.stringify({
    node: 'qa', reason: 'recover', idempotencyKey: 'retry-1',
  }));
  assert.equal(response.statusCode, 200);
  assert.equal(fx.calls[0][0], 'retry');
  response = await invoke(fx, 'POST', '/v1/langgraph/runs/thread-1/cancel', JSON.stringify({
    reason: 'stop', idempotencyKey: 'cancel-1',
  }));
  assert.equal(fx.calls[1][0], 'cancel');
  response = await invoke(fx, 'PATCH', '/v1/langgraph/runs/thread-1');
  assert.equal(response.statusCode, 405);
  assert.equal(response.json.error.code, 'method_not_allowed');
});

test('operator wrapper handles preflight, auth, invalid bodies, and stable errors', async () => {
  let response = await invoke(fixture(), 'OPTIONS', '/v1/langgraph/runs/thread-1');
  assert.equal(response.statusCode, 204);
  response = await invoke(fixture({ principal: null }), 'GET', '/v1/langgraph/runs/thread-1');
  assert.equal(response.statusCode, 401);
  assert.equal(response.json.error.code, 'missing_auth_context');
  response = await invoke(fixture(), 'POST', '/v1/langgraph/runs/thread-1/cancel', '{bad');
  assert.equal(response.statusCode, 422);
  response = await invoke(fixture(), 'POST', '/v1/langgraph/runs/thread-1/cancel', 'x'.repeat(17 * 1024));
  assert.equal(response.statusCode, 422);

  const conflict = fixture({ service: {
    async status() { throw new LangGraphRuntimeError('langgraph_concurrency_conflict'); },
  } });
  response = await invoke(conflict, 'GET', '/v1/langgraph/runs/thread-1');
  assert.equal(response.statusCode, 409);
  assert.equal(response.json.error.code, 'langgraph_concurrency_conflict');
});

test('internal read routes retain their role checks and sanitized loader failures', async () => {
  let response = await invoke(fixture(), 'GET', '/v1/internal/langgraph/health?deep=true');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.data.deep, true);
  response = await invoke(fixture({ principal: { tenantId: 'tenant-one', actorId: 'user-1', roles: [] } }), 'GET', '/v1/internal/langgraph/checkpoints');
  assert.equal(response.statusCode, 403);

  const unavailable = fixture({ noRuntime: true });
  response = await invoke(unavailable, 'GET', '/v1/internal/langgraph/health');
  assert.equal(response.statusCode, 503);
  assert.equal(response.json.error.code, 'langgraph_checkpoint_unavailable');
});

test('enabled HTTP runtime fails closed instead of installing a placeholder lifecycle graph', async () => {
  const server = new EventEmitter();
  assert.throws(() => createLangGraphRouteWrapper({
    server, store: { pool: { options: { max: 2 }, async query() { return { rows: [] }; } } },
  }, { ffLangGraphRuntime: true }), {
    code: 'langgraph_configuration_invalid', safeDetails: { reason: 'lifecycle_ports_missing' },
  });
});

test('operator wrapper can compose its service from the supplied runtime', async () => {
  const server = new EventEmitter();
  const calls = [];
  const runtime = {
    metrics: { increment() {} },
    registry: { async interruptHistory() { return []; } },
    async runStatus(input) { calls.push(input); return { status: 'paused' }; },
  };
  createLangGraphRouteWrapper({ server }, { langGraphRuntime: runtime, ffLangGraphControls: true }, {
    async getRequestContext() { return { tenantId: 'tenant-one', actorId: 'pm-1', roles: ['pm'] }; },
  });
  const res = responseProbe();
  await server.listeners('request')[0](request('GET', '/v1/langgraph/runs/thread-1'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].tenantId, 'tenant-one');
});
