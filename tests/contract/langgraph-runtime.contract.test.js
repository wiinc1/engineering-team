'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { test } = require('node:test');
const { BaseCheckpointSaver } = require('@langchain/langgraph');
const {
  DEFINITIONS,
  GuardedPostgresSaver,
  createLangGraphRouteWrapper,
  langGraphRoute,
  normalizeRoutePath,
} = require('../../lib/software-factory/langgraph');

function responseProbe() {
  return {
    headers: {}, writableEnded: false,
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; this.writableEnded = true; },
  };
}

test('LangGraph dependencies are exact production pins with MIT licenses', () => {
  const pkg = require('../../package.json');
  assert.equal(pkg.dependencies['@langchain/langgraph'], '1.4.8');
  assert.equal(pkg.dependencies['@langchain/langgraph-checkpoint-postgres'], '1.0.4');
  assert.equal(require('@langchain/langgraph/package.json').license, 'MIT');
  assert.equal(require('@langchain/langgraph-checkpoint-postgres/package.json').license, 'MIT');
});

test('guarded adapter implements the framework checkpointer contract', () => {
  assert.ok(GuardedPostgresSaver.prototype instanceof BaseCheckpointSaver);
  for (const method of ['setup', 'put', 'putWrites', 'getTuple', 'list', 'deleteThread']) {
    assert.equal(typeof GuardedPostgresSaver.prototype[method], 'function');
  }
});

test('stable error contract covers every issue-required class', () => {
  assert.deepEqual(Object.keys(DEFINITIONS).sort(), [
    'langgraph_checkpoint_unavailable',
    'langgraph_concurrency_conflict',
    'langgraph_configuration_invalid',
    'langgraph_decision_conflict',
    'langgraph_decision_forbidden',
    'langgraph_decision_invalid',
    'langgraph_interrupt_not_found',
    'langgraph_migration_mismatch',
    'langgraph_mutations_disabled',
    'langgraph_state_invalid',
    'langgraph_tenant_mismatch',
    'langgraph_version_unsupported',
  ]);
});

test('internal routes preserve API v1 and do not define a raw checkpoint endpoint', () => {
  assert.equal(normalizeRoutePath('/api/v1/internal/langgraph/health'), '/v1/internal/langgraph/health');
  assert.equal(langGraphRoute('/v1/internal/langgraph/health'), 'health');
  assert.equal(langGraphRoute('/v1/internal/langgraph/checkpoints'), 'checkpoints');
  assert.equal(langGraphRoute('/v1/internal/langgraph/checkpoints/raw'), null);
});

test('server wrapper authenticates and serves health without replacing unrelated routes', async () => {
  const server = new EventEmitter();
  let originalCalls = 0;
  server.on('request', (_req, res) => { originalCalls += 1; res.end('original'); });
  const runtime = {
    async health(input) { return { status: 'ok', deep: input.deep }; },
    async checkpointSummaries() { return []; },
  };
  const bundle = createLangGraphRouteWrapper({ server }, { langGraphRuntime: runtime }, {
    async getRequestContext() { return { actorId: 'actor-1', tenantId: 'tenant-1', roles: ['sre'] }; },
  });
  assert.equal(bundle.server, server);
  const listener = server.listeners('request')[0];
  const health = responseProbe();
  await listener({ headers: { 'x-request-id': 'req-lg' }, method: 'GET', url: '/api/v1/internal/langgraph/health?deep=true' }, health);
  assert.equal(health.statusCode, 200);
  assert.equal(JSON.parse(health.body).data.deep, true);
  assert.equal(health.headers['cache-control'], 'no-store');
  for (const invalidRequestId of [
    ['request-ok', '\r\nx-injected: true'].join(''),
    'x'.repeat(129),
    ['request-one', 'request-two'],
    '',
  ]) {
    const rejectedId = responseProbe();
    await listener({ headers: { 'x-request-id': invalidRequestId }, method: 'GET', url: '/api/v1/internal/langgraph/health' }, rejectedId);
    const response = JSON.parse(rejectedId.body);
    assert.match(rejectedId.headers['x-request-id'], /^[a-f0-9-]{36}$/);
    assert.equal(response.requestId, rejectedId.headers['x-request-id']);
    assert.doesNotMatch(JSON.stringify(response), /x-injected|request-one|request-two/);
  }
  const original = responseProbe();
  await listener({ headers: {}, method: 'GET', url: '/api/v1/tasks' }, original);
  assert.equal(original.body, 'original');
  assert.equal(originalCalls, 1);
});

test('server wrapper returns a generic error when an existing async route rejects', async () => {
  const server = new EventEmitter();
  server.on('request', async () => { throw new Error('database password must not escape'); });
  createLangGraphRouteWrapper({ server }, { langGraphRuntime: {} }, {
    async getRequestContext() { return {}; },
  });
  const response = responseProbe();
  await server.listeners('request')[0]({ headers: {}, method: 'GET', url: '/api/v1/tasks' }, response);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), {
    error: { code: 'internal_error', message: 'Internal server error.' },
  });
  assert.doesNotMatch(response.body, /password|database/);
});

test('server wrapper normalizes raw loader and authentication error codes without secrets', async () => {
  const server = new EventEmitter();
  const raw = Object.assign(new Error('password=do-not-leak'), { code: '28P01' });
  createLangGraphRouteWrapper({ server }, { langGraphRuntime: {} }, {
    async getRequestContext() { throw raw; },
  });
  const response = responseProbe();
  await server.listeners('request')[0]({
    headers: { 'x-request-id': 'safe-request' }, method: 'GET', url: '/api/v1/internal/langgraph/health',
  }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: {
    code: 'langgraph_checkpoint_unavailable', message: 'Checkpoint storage is unavailable.',
    request_id: 'safe-request', requestId: 'safe-request',
  } });
  assert.doesNotMatch(response.body, /28P01|password|do-not-leak/);
});

test('migration contract is dedicated, tenant-bound, indexed, expand-only, and guarded on rollback', () => {
  const up = fs.readFileSync('db/migrations/018_langgraph_runtime_persistence.sql', 'utf8');
  const down = fs.readFileSync('db/migrations/018_langgraph_runtime_persistence.down.sql', 'utf8');
  assert.match(up, /CREATE SCHEMA IF NOT EXISTS langgraph_checkpoint/);
  assert.match(up, /UNIQUE \(tenant_id, factory_run_id, graph_version\)/);
  assert.match(up, /active_idx/);
  assert.match(up, /stale_idx/);
  assert.match(up, /retention_idx/);
  assert.doesNotMatch(up, /DROP|TRUNCATE|audit_events|\btasks\b/);
  assert.match(down, /rollback refused/);
  assert.match(down, /registry_rows \+ checkpoint_rows \+ blob_rows \+ write_rows > 0/);
});
