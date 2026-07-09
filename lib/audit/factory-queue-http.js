const crypto = require('crypto');
const { authorize } = require('./authz');
const { readPostgresFactoryQueueStatus } = require('../task-platform/factory-delivery-queue-status');
const { requeuePostgresFactoryQueueItem } = require('../task-platform/factory-delivery-queue-requeue');

const MAX_JSON_BODY_BYTES = 64 * 1024;

function normalizeRoutePath(pathname) {
  let path = pathname || '/';
  for (const prefix of ['/api', '/backend']) {
    if (path === prefix) return '/';
    if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length) || '/';
  }
  return path || '/';
}

function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function factoryQueueRoute(path) {
  if (path === '/v1/factory/queue') return { kind: 'factoryQueue' };
  const requeueMatch = path.match(/^\/v1\/factory\/queue\/([^/]+)\/requeue$/);
  if (requeueMatch) return { kind: 'factoryQueueRequeue', queueId: decodePathSegment(requeueMatch[1]) };
  return null;
}

function httpError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeError(error) {
  if (error?.statusCode) return error;
  return httpError(500, error?.code || 'internal_error', error?.message || 'Internal server error', error?.details);
}

function errorPayload(error, requestId) {
  return {
    error: {
      code: error.code || 'internal_error',
      error_id: error.errorId || undefined,
      message: error.message || 'Internal server error',
      details: error.details || undefined,
      request_id: requestId,
      requestId,
    },
  };
}

function setJsonHeaders(res, requestId) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('x-request-id', requestId);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization,content-type,x-actor-id,x-roles,x-tenant-id,x-csrf-token');
}

function sendJson(res, statusCode, payload, requestId) {
  if (res.writableEnded) return;
  res.statusCode = statusCode;
  setJsonHeaders(res, requestId);
  res.end(JSON.stringify(payload));
}

async function requireTenantAccess(req, options, getRequestContext) {
  const principal = await getRequestContext(req, options);
  if (!principal?.tenantId || !principal?.actorId) {
    throw httpError(401, 'missing_auth_context', 'Bearer token with tenant and actor claims is required.');
  }
  if (options.authService) await options.authService.requireCsrf(req, principal);
  return principal;
}

function requirePermission(principal, permission) {
  if (!authorize(principal, permission)) {
    throw httpError(403, 'forbidden', `missing permission: ${permission}`, { permission });
  }
}

async function recordFactoryQueueHttpMetrics(store, fields = {}) {
  if (!store || typeof store.updateMetrics !== 'function') return;
  await store.updateMetrics(metrics => {
    metrics.feature_factory_queue_status_requests_total =
      Number(metrics.feature_factory_queue_status_requests_total || 0) + (fields.request ? 1 : 0);
    metrics.feature_factory_queue_status_errors_total =
      Number(metrics.feature_factory_queue_status_errors_total || 0) + (fields.error ? 1 : 0);
  });
}

async function readJsonBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_JSON_BODY_BYTES) {
      throw httpError(413, 'request_body_too_large', 'Factory queue request body is too large.');
    }
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, 'invalid_json_body', 'Factory queue request body must be valid JSON.');
  }
}

function queueOptionsFromRequest(principal, options, url) {
  return {
    ...options,
    pool: options.factoryQueuePool,
    tenantId: principal.tenantId,
    stage: url.searchParams.get('stage') || undefined,
    limit: url.searchParams.get('limit') || undefined,
  };
}

function normalizeRequeueReason(value) {
  return String(value || '').trim().slice(0, 500);
}

function requeueOptionsFromRequest(principal, options, route, body = {}) {
  const reason = normalizeRequeueReason(body.reason || body.recoveryReason);
  if (!reason) {
    throw httpError(400, 'missing_requeue_reason', 'Factory queue requeue requires a recovery reason.');
  }
  return {
    ...options,
    pool: options.factoryQueuePool,
    tenantId: principal.tenantId,
    actorId: principal.actorId,
    queueId: route.queueId,
    reason,
  };
}

async function handleFactoryQueueRequest(req, res, context) {
  const { route, requestId, options, store, getRequestContext, url } = context;
  if (req.method === 'OPTIONS') return sendJson(res, 204, {}, requestId);
  const principal = await requireTenantAccess(req, options, getRequestContext);
  if (route.kind === 'factoryQueue' && req.method === 'GET') {
    requirePermission(principal, 'metrics:read');
    const reader = options.factoryQueueStatusReader || readPostgresFactoryQueueStatus;
    const data = await reader(queueOptionsFromRequest(principal, options, url));
    return sendJson(res, 200, { success: true, data }, requestId);
  }
  if (route.kind === 'factoryQueueRequeue' && req.method === 'POST') {
    requirePermission(principal, 'factory-queue:write');
    const body = await readJsonBody(req);
    const requeue = options.factoryQueueRequeue || requeuePostgresFactoryQueueItem;
    const data = await requeue(requeueOptionsFromRequest(principal, options, route, body));
    return sendJson(res, 200, { success: true, data }, requestId);
  }
  throw httpError(405, 'method_not_allowed', 'Method not allowed', { method: req.method, path: url.pathname });
}

function dispatchOriginal(server, listeners, req, res) {
  for (const listener of listeners) {
    const result = listener.call(server, req, res);
    if (result && typeof result.catch === 'function') {
      result.catch(error => {
        if (!res.writableEnded) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: { code: 'internal_error', message: error.message } }));
        }
      });
    }
  }
}

function createFactoryQueueRouteWrapper(bundle, options = {}, helpers = {}) {
  const server = bundle.server;
  const listeners = server.listeners('request');
  const effectiveOptions = { ...options, authService: bundle.authService || options.authService };
  server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    const url = new URL(req.url || '/', 'http://localhost');
    const route = factoryQueueRoute(normalizeRoutePath(url.pathname));
    if (!route) return dispatchOriginal(server, listeners, req, res);
    await recordFactoryQueueHttpMetrics(bundle.store, { request: true });
    try {
      await handleFactoryQueueRequest(req, res, {
        route,
        requestId,
        options: effectiveOptions,
        store: bundle.store,
        getRequestContext: helpers.getRequestContext,
        url,
      });
    } catch (error) {
      const normalized = normalizeError(error);
      await recordFactoryQueueHttpMetrics(bundle.store, { error: normalized.statusCode >= 400 });
      sendJson(res, normalized.statusCode, errorPayload(normalized, requestId), requestId);
    }
  });
  return bundle;
}

module.exports = {
  createFactoryQueueRouteWrapper,
  factoryQueueRoute,
};
