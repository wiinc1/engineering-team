'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const { createJobRuntimeRouteWrapper } = require('../../lib/audit/job-runtime-http');
const { JobRuntimeError } = require('../../lib/job-runtime/errors');

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
  let originalCalls = 0;
  server.on('request', (_req, res) => { originalCalls += 1; res.end('original'); });
  const calls = [];
  const service = options.service || {
    async get(...args) { calls.push(['get', ...args]); return { job: { deliveryId: args[1] }, history: [] }; },
    async act(input) { calls.push(['act', input]); return { action: input.action, expectedVersion: input.expectedVersion }; },
    async drain(input) { calls.push(['drain', input]); return { state: 'draining' }; },
  };
  const principal = options.principal === undefined
    ? { tenantId: 'tenant-one', actorId: 'sre-1', roles: ['sre'] }
    : options.principal;
  const csrfCalls = [];
  createJobRuntimeRouteWrapper({ server, authService: options.csrf === false ? null : {
    async requireCsrf(...args) { csrfCalls.push(args); },
  } }, { jobOperatorService: options.noService ? null : service }, {
    async getRequestContext() {
      if (options.authError) throw options.authError;
      return principal;
    },
  });
  return { calls, csrfCalls, originalCalls: () => originalCalls, listener: server.listeners('request')[0] };
}

async function invoke(fx, method, url, body, headers = {}) {
  const res = responseProbe();
  await fx.listener(request(method, url, body, headers), res);
  let json = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch {}
  return { ...res, json };
}

test('job runtime HTTP wrapper preserves unrelated routes and handles preflight', async () => {
  const fx = fixture();
  let response = await invoke(fx, 'GET', '/api/v1/tasks');
  assert.equal(response.body, 'original');
  assert.equal(fx.originalCalls(), 1);
  response = await invoke(fx, 'OPTIONS', '/backend/v1/job-runtime/jobs/job%201');
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-methods'], 'GET,POST,OPTIONS');
});

test('job detail is tenant scoped and requires read permission', async () => {
  const fx = fixture();
  const response = await invoke(fx, 'GET', '/api/v1/job-runtime/jobs/job%201', undefined, { 'x-request-id': 'job-request-1' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.success, true);
  assert.equal(response.json.data.job.deliveryId, 'job 1');
  assert.deepEqual(fx.calls[0], ['get', 'tenant-one', 'job 1']);
  assert.equal(response.headers['x-request-id'], 'job-request-1');
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');

  const denied = await invoke(fixture({ principal: { tenantId: 'tenant-one', actorId: 'user-1', roles: ['stakeholder'] } }), 'GET', '/v1/job-runtime/jobs/job-1');
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json.error.code, 'job_action_forbidden');
});

test('job actions enforce CSRF and propagate bounded concurrency inputs', async () => {
  const fx = fixture();
  const response = await invoke(fx, 'POST', '/v1/job-runtime/jobs/job-1/retry', JSON.stringify({ reason: 'recover' }), {
    'content-type': 'application/json', 'if-match': '"7"', 'idempotency-key': 'retry-7',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.success, true);
  assert.equal(response.json.data.expectedVersion, 7);
  assert.deepEqual(fx.calls[0][1], {
    tenantId: 'tenant-one', actorId: 'sre-1', requestId: response.headers['x-request-id'],
    deliveryId: 'job-1', action: 'retry', reason: 'recover', expectedVersion: 7,
    idempotencyKey: 'retry-7',
  });
  assert.equal(fx.csrfCalls.length, 1);

  const bodyFallback = await invoke(fx, 'POST', '/v1/job-runtime/jobs/job-1/requeue', JSON.stringify({
    reason: 'requeue', expectedVersion: 8, idempotencyKey: 'requeue-8',
  }));
  assert.equal(bodyFallback.json.data.expectedVersion, 8);
});

test('drain is explicit, audited, and method constrained', async () => {
  const fx = fixture();
  let response = await invoke(fx, 'POST', '/v1/job-runtime/drain', JSON.stringify({ reason: 'maintenance' }));
  assert.equal(response.statusCode, 202);
  assert.equal(response.json.success, true);
  assert.equal(response.json.data.state, 'draining');
  assert.equal(fx.calls[0][1].reason, 'maintenance');
  response = await invoke(fx, 'DELETE', '/v1/job-runtime/jobs/job-1');
  assert.equal(response.statusCode, 405);
  assert.equal(response.json.error.code, 'method_not_allowed');
  assert.equal(response.json.error.message, 'Method not allowed.');
  assert.equal(response.json.error.retryable, false);
});

test('authentication, input, availability, and service failures use stable envelopes', async () => {
  let response = await invoke(fixture({ principal: null }), 'GET', '/v1/job-runtime/jobs/job-1');
  assert.equal(response.statusCode, 401);
  assert.equal(response.json.error.code, 'missing_auth_context');
  assert.equal(response.json.error.message, 'Bearer token with tenant and actor claims is required.');

  response = await invoke(fixture(), 'POST', '/v1/job-runtime/jobs/job-1/cancel', '{bad json');
  assert.equal(response.statusCode, 400);
  assert.equal(response.json.error.code, 'job_action_conflict');
  assert.equal(response.json.error.message, 'Job action request must be valid JSON.');
  response = await invoke(fixture(), 'POST', '/v1/job-runtime/jobs/job-1/cancel', JSON.stringify({ reason: 'x' }), {});
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.data.expectedVersion, null);
  response = await invoke(fixture(), 'POST', '/v1/job-runtime/jobs/job-1/cancel', 'x'.repeat(17 * 1024));
  assert.equal(response.statusCode, 413);
  assert.equal(response.json.error.message, 'Job action request is too large.');

  const unavailable = fixture({ service: {
    async get() { throw new JobRuntimeError('job_not_found'); },
  } });
  response = await invoke(unavailable, 'GET', '/v1/job-runtime/jobs/missing');
  assert.equal(response.statusCode, 404);
  assert.equal(response.json.error.code, 'job_not_found');
  assert.equal(JSON.stringify(response.json).includes('password'), false);
});

test('async failures from preserved routes are contained', async () => {
  const server = new EventEmitter();
  server.on('request', async () => { throw new Error('password=secret'); });
  createJobRuntimeRouteWrapper({ server }, { jobOperatorService: {} }, { async getRequestContext() { return {}; } });
  const res = responseProbe();
  await server.listeners('request')[0](request('GET', '/unrelated'), res);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.parse(res.body).error.code, 'internal_error');
  assert.doesNotMatch(res.body, /password|secret/);
});

test('wrapper composes the operator service from runtime infrastructure', async () => {
  const server = new EventEmitter();
  const registry = {
    async findForTenant(tenantId, deliveryId) { return { tenantId, deliveryId }; },
    async listOperatorHistory() { return []; },
  };
  createJobRuntimeRouteWrapper({ server }, {
    jobRuntimeInfrastructure: { registry, adapter: {}, runtime: {} },
  }, { async getRequestContext() { return { tenantId: 'tenant-one', actorId: 'sre-1', roles: ['sre'] }; } });
  const res = responseProbe();
  await server.listeners('request')[0](request('GET', '/v1/job-runtime/jobs/job-1'), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).data.job, { tenantId: 'tenant-one', deliveryId: 'job-1' });
});
