const crypto = require('crypto');
const { authorize } = require('./authz');
const {
  buildRetrospectiveSignal,
  normalizeFilters,
  readAutonomousDeliveryMetrics,
  rebuildAutonomousDeliveryMetrics,
} = require('./autonomous-delivery-metrics');

function normalizeRoutePath(pathname) {
  let path = pathname || '/';
  for (const prefix of ['/api', '/backend']) {
    if (path === prefix) return '/';
    if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length) || '/';
  }
  return path || '/';
}

function autonomousDeliveryRoute(path) {
  if (path === '/v1/metrics/autonomous-delivery') return { kind: 'metrics' };
  if (path === '/v1/metrics/autonomous-delivery/rebuild') return { kind: 'rebuild' };
  const taskSignal = path.match(/^\/v1\/tasks\/([^/]+)\/retrospective-signal$/);
  if (taskSignal) return { kind: 'taskSignal', taskId: decodeURIComponent(taskSignal[1]) };
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

async function recordAutonomousDeliveryHttpMetrics(store, fields = {}) {
  if (!store || typeof store.updateMetrics !== 'function') return;
  await store.updateMetrics(metrics => {
    metrics.feature_autonomous_delivery_metrics_requests_total =
      Number(metrics.feature_autonomous_delivery_metrics_requests_total || 0) + (fields.request ? 1 : 0);
    metrics.feature_autonomous_delivery_metrics_errors_total =
      Number(metrics.feature_autonomous_delivery_metrics_errors_total || 0) + (fields.error ? 1 : 0);
    metrics.feature_retrospective_signal_errors_total =
      Number(metrics.feature_retrospective_signal_errors_total || 0) + (fields.retrospectiveSignalError ? 1 : 0);
  });
}

async function parseJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
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

function isDisabled(value) {
  return ['0', 'false', 'off', 'disabled', 'no'].includes(String(value || '').trim().toLowerCase());
}

function isAutonomousDeliveryMetricsMvpEnabled(options = {}) {
  if (typeof options.autonomousDeliveryMetricsMvpEnabled === 'boolean') return options.autonomousDeliveryMetricsMvpEnabled;
  const configured = options.ffAutonomousDeliveryMetricsMvp ??
    options.ff_autonomous_delivery_metrics_mvp ??
    process.env.FF_AUTONOMOUS_DELIVERY_METRICS_MVP;
  return configured == null || configured === '' ? true : !isDisabled(configured);
}

function assertAutonomousDeliveryMetricsEnabled(options = {}) {
  if (!isAutonomousDeliveryMetricsMvpEnabled(options)) {
    throw httpError(503, 'feature_disabled', 'Autonomous delivery metrics are disabled by ff_autonomous_delivery_metrics_mvp.', {
      feature: 'ff_autonomous_delivery_metrics_mvp',
    });
  }
}

function filtersFromSearch(searchParams, body = {}) {
  return normalizeFilters({
    ...body.filters,
    tenantId: body.tenantId || body.tenant_id || searchParams.get('tenantId') || searchParams.get('tenant_id') || undefined,
    dateFrom: body.dateFrom || body.date_from || searchParams.get('dateFrom') || searchParams.get('date_from') || undefined,
    dateTo: body.dateTo || body.date_to || searchParams.get('dateTo') || searchParams.get('date_to') || undefined,
    taskClass: body.taskClass || body.task_class || searchParams.get('taskClass') || searchParams.get('task_class') || undefined,
    tier: body.tier || body.templateTier || body.template_tier || searchParams.get('tier') || searchParams.get('templateTier') || undefined,
    agent: body.agent || body.implementationAgent || body.implementation_agent || searchParams.get('agent') || searchParams.get('implementationAgent') || undefined,
    includeUnknown: body.includeUnknown ?? body.include_unknown ?? searchParams.get('includeUnknown') ?? searchParams.get('include_unknown') ?? undefined,
  });
}

async function handleAutonomousDeliveryRequest(req, res, context) {
  const { route, requestId, options, store, getRequestContext, url } = context;
  assertAutonomousDeliveryMetricsEnabled(options);
  if (req.method === 'OPTIONS') return sendJson(res, 204, {}, requestId);

  const principal = await requireTenantAccess(req, options, getRequestContext);

  if (route.kind === 'metrics' && req.method === 'GET') {
    requirePermission(principal, 'metrics:read');
    const filters = filtersFromSearch(url.searchParams, { tenantId: principal.tenantId });
    const data = await readAutonomousDeliveryMetrics({ store, tenantId: principal.tenantId, filters });
    return sendJson(res, 200, { success: true, data }, requestId);
  }

  if (route.kind === 'rebuild' && req.method === 'POST') {
    requirePermission(principal, 'projections:rebuild');
    const body = await parseJson(req);
    const filters = filtersFromSearch(url.searchParams, { ...body, tenantId: principal.tenantId });
    const { projection, persistence } = await rebuildAutonomousDeliveryMetrics({
      store,
      tenantId: principal.tenantId,
      filters,
      includeOpen: body.includeOpen === true || body.include_open === true,
      persist: body.persist !== false,
    });
    return sendJson(res, 202, { success: true, data: { ...projection, persistence } }, requestId);
  }

  if (route.kind === 'taskSignal' && req.method === 'GET') {
    requirePermission(principal, 'metrics:read');
    if (!store || typeof store.getTaskHistory !== 'function' || typeof store.getTaskCurrentState !== 'function') {
      throw httpError(501, 'not_supported', 'Retrospective signals are not supported by this store.');
    }
    const [state, history] = await Promise.all([
      Promise.resolve(store.getTaskCurrentState(route.taskId, { tenantId: principal.tenantId })),
      Promise.resolve(store.getTaskHistory(route.taskId, { tenantId: principal.tenantId, limit: 1000 })),
    ]);
    if (!state && !history.length) throw httpError(404, 'task_not_found', 'Task not found', { task_id: route.taskId });
    const data = buildRetrospectiveSignal({
      taskId: route.taskId,
      tenantId: principal.tenantId,
      state: state || { task_id: route.taskId, tenant_id: principal.tenantId },
      history,
    });
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

function createAutonomousDeliveryMetricsRouteWrapper(bundle, options = {}, helpers = {}) {
  const server = bundle.server;
  const listeners = server.listeners('request');
  const effectiveOptions = { ...options, authService: bundle.authService || options.authService };
  server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    const url = new URL(req.url || '/', 'http://localhost');
    const route = autonomousDeliveryRoute(normalizeRoutePath(url.pathname));
    if (!route) return dispatchOriginal(server, listeners, req, res);
    await recordAutonomousDeliveryHttpMetrics(bundle.store, { request: true });
    try {
      await handleAutonomousDeliveryRequest(req, res, {
        route,
        requestId,
        options: effectiveOptions,
        store: bundle.store,
        getRequestContext: helpers.getRequestContext,
        url,
      });
    } catch (error) {
      const normalized = normalizeError(error);
      await recordAutonomousDeliveryHttpMetrics(bundle.store, {
        error: normalized.statusCode >= 400,
        retrospectiveSignalError: route.kind === 'taskSignal' && normalized.statusCode >= 500,
      });
      sendJson(res, normalized.statusCode, errorPayload(normalized, requestId), requestId);
    }
  });
  return bundle;
}

module.exports = {
  createAutonomousDeliveryMetricsRouteWrapper,
};
