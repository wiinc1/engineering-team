const crypto = require('crypto');
const { authorize } = require('./authz');
const { createTaskPlatformService } = require('../task-platform');

function normalizeRoutePath(pathname) {
  let path = pathname || '/';
  for (const prefix of ['/api', '/backend']) {
    if (path === prefix) return '/';
    if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length) || '/';
  }
  return path || '/';
}

function projectRoute(path) {
  if (path === '/v1/projects') return { kind: 'projects' };
  const project = path.match(/^\/v1\/projects\/([^/]+)$/);
  if (project) return { kind: 'project', projectId: decodeURIComponent(project[1]) };
  const task = path.match(/^\/v1\/tasks\/([^/]+)\/project$/);
  if (task) return { kind: 'taskProject', taskId: decodeURIComponent(task[1]) };
  return null;
}

function isDisabled(value) {
  return ['0', 'false', 'off', 'disabled'].includes(String(value || '').trim().toLowerCase());
}

function assertProjectsEnabled(options = {}) {
  const configured = options.ffProjects ?? options.ff_projects ?? process.env.FF_PROJECTS ?? '1';
  if (isDisabled(configured)) {
    throw httpError(503, 'feature_disabled', 'Projects are disabled by FF_PROJECTS.', { feature: 'ff_projects' });
  }
}

function httpError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
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
  return httpError(500, error?.code || 'internal_error', error?.message || 'Internal server error', error?.details);
}

function setProjectHeaders(res, requestId) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('x-request-id', requestId);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization,content-type,x-actor-id,x-roles,x-tenant-id,x-csrf-token');
}

function sendJson(res, statusCode, payload, requestId) {
  if (res.writableEnded) return;
  res.statusCode = statusCode;
  setProjectHeaders(res, requestId);
  res.end(JSON.stringify(payload));
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

function listOptions(searchParams) {
  return {
    status: searchParams.get('status') || undefined,
    includeArchived: ['1', 'true', 'yes'].includes(String(searchParams.get('includeArchived') || '').toLowerCase()),
  };
}

async function appendProjectAuditEvent(store, principal, taskId, result, body, requestId) {
  if (!store || typeof store.appendEvent !== 'function') return;
  try {
    await store.appendEvent({
      taskId,
      tenantId: principal.tenantId,
      eventType: result.projectId ? 'task.project_attached' : 'task.project_detached',
      actorId: principal.actorId,
      actorType: body.actorType || 'user',
      idempotencyKey: body.idempotencyKey || body.idempotency_key || `project:${taskId}:${result.version}`,
      payload: { project_id: result.projectId || null, project: result.project || null, version: result.version },
      source: 'http',
    });
  } catch (error) {
    await recordProjectMetric(store, { auditErrors: 1 });
  }
}

async function recordProjectMetric(store, metric = {}) {
  if (!store || typeof store.updateMetrics !== 'function') return;
  await store.updateMetrics(metrics => {
    metrics.feature_projects_requests_total = Number(metrics.feature_projects_requests_total || 0) + Number(metric.requests || 0);
    metrics.feature_projects_errors_total = Number(metrics.feature_projects_errors_total || 0) + Number(metric.errors || 0);
    metrics.feature_projects_audit_errors_total = Number(metrics.feature_projects_audit_errors_total || 0) + Number(metric.auditErrors || 0);
  });
}

async function handleProjectsRequest(req, res, context) {
  const { route, requestId, options, taskPlatform, store, getRequestContext, url } = context;
  assertProjectsEnabled(options);
  if (req.method === 'OPTIONS') return sendJson(res, 204, {}, requestId);
  const principal = await requireTenantAccess(req, options, getRequestContext);
  if (route.kind === 'projects' && req.method === 'GET') {
    requirePermission(principal, 'state:read');
    const data = await taskPlatform.listProjects({ tenantId: principal.tenantId, ...listOptions(url.searchParams) });
    return sendJson(res, 200, { data }, requestId);
  }
  if (route.kind === 'projects' && req.method === 'POST') {
    requirePermission(principal, 'projects:write');
    const body = await parseJson(req);
    const data = await taskPlatform.createProject({ ...body, tenantId: principal.tenantId, actorId: principal.actorId, requestId });
    return sendJson(res, 201, { data }, requestId);
  }
  if (route.kind === 'project' && req.method === 'GET') {
    requirePermission(principal, 'state:read');
    const data = await taskPlatform.getProject({ tenantId: principal.tenantId, projectId: route.projectId, includeTasks: true });
    if (!data) throw httpError(404, 'project_not_found', 'Project not found', { projectId: route.projectId });
    return sendJson(res, 200, { data }, requestId);
  }
  if (route.kind === 'project' && req.method === 'PATCH') {
    requirePermission(principal, 'projects:write');
    const body = await parseJson(req);
    const data = await taskPlatform.updateProject({ ...body, tenantId: principal.tenantId, actorId: principal.actorId, projectId: route.projectId, requestId });
    return sendJson(res, 200, { data }, requestId);
  }
  if (route.kind === 'taskProject' && req.method === 'PATCH') {
    requirePermission(principal, 'projects:write');
    const body = await parseJson(req);
    const data = await taskPlatform.updateTaskProject({ ...body, tenantId: principal.tenantId, actorId: principal.actorId, taskId: route.taskId, requestId });
    await appendProjectAuditEvent(store, principal, route.taskId, data, body, requestId);
    return sendJson(res, 200, { data }, requestId);
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

function createProjectRouteWrapper(bundle, options = {}, helpers = {}) {
  const server = bundle.server;
  const listeners = server.listeners('request');
  const effectiveOptions = { ...options, authService: bundle.authService || options.authService };
  const taskPlatform = createTaskPlatformService(effectiveOptions);
  server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    const url = new URL(req.url || '/', 'http://localhost');
    const route = projectRoute(normalizeRoutePath(url.pathname));
    if (!route) return dispatchOriginal(server, listeners, req, res);
    try {
      await recordProjectMetric(bundle.store, { requests: 1 });
      await handleProjectsRequest(req, res, { route, requestId, options: effectiveOptions, taskPlatform, store: bundle.store, getRequestContext: helpers.getRequestContext, url });
    } catch (error) {
      const normalized = normalizeError(error);
      await recordProjectMetric(bundle.store, { errors: normalized.statusCode >= 400 ? 1 : 0 });
      sendJson(res, normalized.statusCode, errorPayload(normalized, requestId), requestId);
    }
  });
  return bundle;
}

module.exports = {
  createProjectRouteWrapper,
};
