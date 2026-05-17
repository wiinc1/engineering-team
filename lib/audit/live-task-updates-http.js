const crypto = require('crypto');
const { authorize } = require('./authz');
const { createTaskPlatformService } = require('../task-platform');
const {
  LIVE_TASK_UPDATES_FEATURE,
  assertLiveTaskUpdatesEnabled,
  buildLiveTaskUpdateResponse,
  createLiveTaskUpdateError,
  sanitizeCursor,
} = require('./live-task-updates');

function normalizeRoutePath(pathname) {
  let path = pathname || '/';
  for (const prefix of ['/api', '/backend']) {
    if (path === prefix) return '/';
    if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length) || '/';
  }
  return path || '/';
}

function liveTaskUpdatesRoute(path) {
  return path === '/v1/tasks/updates';
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

function normalizeError(error) {
  if (error?.statusCode) return error;
  return createLiveTaskUpdateError(
    500,
    error?.code || 'internal_error',
    error?.message || 'Internal server error',
    error?.details,
  );
}

function setHeaders(res, requestId) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('x-request-id', requestId);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization,content-type,x-actor-id,x-roles,x-tenant-id,x-csrf-token,x-request-id');
}

function sendJson(res, statusCode, payload, requestId) {
  if (res.writableEnded) return;
  res.statusCode = statusCode;
  setHeaders(res, requestId);
  res.end(JSON.stringify(payload));
}

async function requireTenantAccess(req, options, getRequestContext) {
  const principal = await getRequestContext(req, options);
  if (!principal?.tenantId || !principal?.actorId) {
    throw createLiveTaskUpdateError(401, 'missing_auth_context', 'Bearer token with tenant and actor claims is required.');
  }
  if (options.authService) await options.authService.requireCsrf(req, principal);
  return principal;
}

function requirePermission(principal, permission) {
  if (!authorize(principal, permission)) {
    throw createLiveTaskUpdateError(403, 'forbidden', `missing permission: ${permission}`, { permission });
  }
}

async function recordLiveMetric(store, metric = {}) {
  if (!store || typeof store.updateMetrics !== 'function') return;
  await store.updateMetrics((metrics) => {
    metrics.feature_live_task_updates_events_total = Number(metrics.feature_live_task_updates_events_total || 0) + Number(metric.events || 0);
    metrics.feature_live_task_updates_poll_errors_total = Number(metrics.feature_live_task_updates_poll_errors_total || 0) + Number(metric.errors || 0);
    metrics.feature_live_task_updates_stale_views_total = Number(metrics.feature_live_task_updates_stale_views_total || 0) + Number(metric.staleViews || 0);
    if (metric.latencySeconds != null) {
      metrics.feature_live_task_updates_latency_seconds = Number(metric.latencySeconds);
    }
  });
}

function countStaleViews(updates = []) {
  return updates.filter((update) => update.payload?.task?.freshness?.status === 'stale').length;
}

async function handleLiveTaskUpdatesRequest(req, res, context) {
  const { requestId, options, taskPlatform, store, getRequestContext, url, logger } = context;
  assertLiveTaskUpdatesEnabled(options);
  if (req.method === 'OPTIONS') return sendJson(res, 204, {}, requestId);
  if (req.method !== 'GET') {
    throw createLiveTaskUpdateError(405, 'method_not_allowed', 'Method not allowed', { method: req.method, path: url.pathname });
  }
  const principal = await requireTenantAccess(req, options, getRequestContext);
  requirePermission(principal, 'state:read');
  const startedAt = Date.now();
  const cursor = url.searchParams.get('cursor') || '';
  const response = await buildLiveTaskUpdateResponse({
    store,
    taskPlatform,
    tenantId: principal.tenantId,
    cursor,
  });
  const latencySeconds = (Date.now() - startedAt) / 1000;
  await recordLiveMetric(store, {
    events: response.data.updates.length,
    latencySeconds,
    staleViews: countStaleViews(response.data.updates),
  });
  logger.info?.({
    feature: LIVE_TASK_UPDATES_FEATURE,
    action: 'poll',
    outcome: 'success',
    request_id: requestId,
    tenant_id: principal.tenantId,
    actor_id: principal.actorId,
    cursor: sanitizeCursor(cursor),
    update_count: response.data.updates.length,
    duration_ms: Date.now() - startedAt,
  });
  return sendJson(res, 200, response, requestId);
}

function dispatchOriginal(server, listeners, req, res) {
  for (const listener of listeners) {
    const result = listener.call(server, req, res);
    if (result && typeof result.catch === 'function') {
      result.catch((error) => {
        if (!res.writableEnded) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: { code: 'internal_error', message: error.message } }));
        }
      });
    }
  }
}

function createLiveTaskUpdatesRouteWrapper(bundle, options = {}, helpers = {}) {
  const server = bundle.server;
  const listeners = server.listeners('request');
  const effectiveOptions = { ...options, authService: bundle.authService || options.authService };
  const taskPlatform = createTaskPlatformService(effectiveOptions);
  const logger = effectiveOptions.logger || { info() {}, error() {} };
  server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    const url = new URL(req.url || '/', 'http://localhost');
    if (!liveTaskUpdatesRoute(normalizeRoutePath(url.pathname))) {
      return dispatchOriginal(server, listeners, req, res);
    }
    try {
      await handleLiveTaskUpdatesRequest(req, res, {
        requestId,
        options: effectiveOptions,
        taskPlatform,
        store: bundle.store,
        getRequestContext: helpers.getRequestContext,
        url,
        logger,
      });
    } catch (error) {
      const normalized = normalizeError(error);
      await recordLiveMetric(bundle.store, { errors: normalized.statusCode >= 400 ? 1 : 0 });
      logger.error?.({
        feature: LIVE_TASK_UPDATES_FEATURE,
        action: 'poll',
        outcome: 'error',
        request_id: requestId,
        method: req.method,
        path: url.pathname,
        status_code: normalized.statusCode,
        error_code: normalized.code,
        cursor: sanitizeCursor(url.searchParams.get('cursor') || ''),
      });
      sendJson(res, normalized.statusCode, errorPayload(normalized, requestId), requestId);
    }
  });
  return bundle;
}

module.exports = {
  createLiveTaskUpdatesRouteWrapper,
  liveTaskUpdatesRoute,
  normalizeRoutePath,
};
