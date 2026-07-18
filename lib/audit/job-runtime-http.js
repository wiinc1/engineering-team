'use strict';

const crypto = require('node:crypto');
const { authorize } = require('./authz');
const { sanitizedError, JobRuntimeError } = require('../job-runtime/errors');
const { createJobOperatorService } = require('../job-runtime/operator-service');

const MAX_BODY_BYTES = 16 * 1024;

function normalizeRoutePath(pathname) {
  let value = pathname || '/';
  for (const prefix of ['/api', '/backend']) if (value.startsWith(`${prefix}/`)) value = value.slice(prefix.length);
  return value || '/';
}
function jobRuntimeRoute(path) {
  if (path === '/v1/job-runtime/drain') return { kind: 'drain' };
  const match = path.match(/^\/v1\/job-runtime\/jobs\/([^/]+)(?:\/(retry|requeue|cancel))?$/);
  if (!match) return null;
  try { return { kind: match[2] ? 'action' : 'detail', deliveryId: decodeURIComponent(match[1]), action: match[2] || null }; }
  catch { return { kind: match[2] ? 'action' : 'detail', deliveryId: match[1], action: match[2] || null }; }
}
function httpError(statusCode, code, message, details) { return Object.assign(new Error(message), { statusCode, code, details }); }
async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw httpError(413, 'job_action_conflict', 'Job action request is too large.');
  }
  try { return raw.trim() ? JSON.parse(raw) : {}; }
  catch { throw httpError(400, 'job_action_conflict', 'Job action request must be valid JSON.'); }
}
function sendJson(res, statusCode, body, requestId) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('x-request-id', requestId);
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization,content-type,idempotency-key,if-match,x-request-id,x-csrf-token');
  res.end(JSON.stringify(body));
}
function requirePermission(principal, permission) {
  if (!authorize(principal, permission)) throw new JobRuntimeError('job_action_forbidden');
}
function statusFor(error) {
  if (error.statusCode) return error.statusCode;
  return { job_not_found: 404, job_action_forbidden: 403, job_action_conflict: 409, job_runtime_unavailable: 503 }[error.code] || 500;
}
function dispatchOriginal(server, listeners, req, res) {
  for (const listener of listeners) {
    const result = listener.call(server, req, res);
    if (result?.catch) result.catch(() => sendJson(res, 500, { error: { code: 'internal_error', message: 'Internal server error.' } }, crypto.randomUUID()));
  }
}
function operatorService(options) {
  if (options.jobOperatorService) return options.jobOperatorService;
  const value = options.jobRuntimeInfrastructure;
  return value ? createJobOperatorService({
    registry: value.registry, adapter: value.adapter, runtime: value.runtime,
    logger: options.logger, metrics: value.metrics,
  }) : null;
}
async function actionRequest(context, req, route, principal, requestId) {
  requirePermission(principal, 'factory-queue:write');
  const body = await readJson(req);
  const rawVersion = req.headers['if-match'] ?? body.expectedVersion;
  const expectedVersion = rawVersion === undefined || String(rawVersion).trim() === '' ? Number.NaN : Number(String(rawVersion).replace(/^"|"$/g, ''));
  return context.service.act({
    tenantId: principal.tenantId, actorId: principal.actorId, requestId,
    deliveryId: route.deliveryId, action: route.action, reason: body.reason, expectedVersion,
    idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey,
  });
}
async function handleRoute(context, req, res, route, requestId) {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {}, requestId);
  const principal = await context.helpers.getRequestContext(req, context.effective);
  if (!principal?.tenantId || !principal?.actorId) throw httpError(401, 'missing_auth_context', 'Bearer token with tenant and actor claims is required.');
  if (context.effective.authService) await context.effective.authService.requireCsrf(req, principal);
  if (!context.service) throw new JobRuntimeError('job_runtime_unavailable');
  if (route.kind === 'detail' && req.method === 'GET') {
    requirePermission(principal, 'metrics:read');
    return sendJson(res, 200, { success: true, data: await context.service.get(principal.tenantId, route.deliveryId) }, requestId);
  }
  if (route.kind === 'action' && req.method === 'POST') {
    return sendJson(res, 200, { success: true, data: await actionRequest(context, req, route, principal, requestId) }, requestId);
  }
  if (route.kind === 'drain' && req.method === 'POST') {
    requirePermission(principal, 'factory-queue:write');
    const body = await readJson(req);
    const data = await context.service.drain({ tenantId: principal.tenantId, actorId: principal.actorId, requestId, reason: body.reason });
    return sendJson(res, 202, { success: true, data }, requestId);
  }
  throw httpError(405, 'method_not_allowed', 'Method not allowed.');
}
function createJobRuntimeRouteWrapper(bundle, options = {}, helpers = {}) {
  const server = bundle.server;
  const listeners = server.listeners('request');
  const effective = { ...options, authService: bundle.authService || options.authService };
  const context = { effective, helpers, service: operatorService(options) };
  server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    const route = jobRuntimeRoute(normalizeRoutePath(new URL(req.url || '/', 'http://localhost').pathname));
    if (!route) return dispatchOriginal(server, listeners, req, res);
    try { return await handleRoute(context, req, res, route, requestId); }
    catch (error) {
      const safe = sanitizedError(error);
      return sendJson(res, statusFor(error), { error: { ...safe, requestId, request_id: requestId } }, requestId);
    }
  });
  return bundle;
}

module.exports = { createJobRuntimeRouteWrapper, jobRuntimeRoute, normalizeRoutePath };
