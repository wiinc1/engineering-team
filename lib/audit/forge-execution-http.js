const crypto = require('crypto');
const { authorize } = require('./authz');
const { getBearerToken } = require('../auth/jwt');
const { evaluateForgeExecutionReadiness } = require('../task-platform/forge-canonical-task');

function normalizeRoutePath(pathname) {
  let path = pathname || '/';
  for (const prefix of ['/api', '/backend']) {
    if (path === prefix) return '/';
    if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length) || '/';
  }
  return path || '/';
}

function forgeExecutionRoute(path) {
  const match = path.match(/^\/tasks\/([^/]+)\/forge-execution-readiness$/);
  if (!match) return null;
  return { kind: 'forgeExecutionReadiness', taskId: decodeURIComponent(match[1]) };
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
  res.setHeader('access-control-allow-methods', 'GET,OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization,content-type,x-actor-id,x-roles,x-tenant-id,x-csrf-token');
}

function sendJson(res, statusCode, payload, requestId) {
  if (res.writableEnded) return;
  res.statusCode = statusCode;
  setJsonHeaders(res, requestId);
  res.end(JSON.stringify(payload));
}

function resolveForgeServiceToken(options = {}) {
  return options.forgeServiceToken
    || process.env.FORGE_SERVICE_TOKEN
    || null;
}

function isServiceTokenAuthorized(req, options = {}) {
  const configured = resolveForgeServiceToken(options);
  if (!configured) return false;
  const bearer = getBearerToken(req);
  if (!bearer) return false;
  const expected = Buffer.from(configured);
  const provided = Buffer.from(bearer);
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

async function loadTaskForForgeRead(store, taskId, tenantId = null) {
  if (tenantId) {
    return {
      state: await Promise.resolve(store.getTaskCurrentState(taskId, { tenantId })),
      history: await Promise.resolve(store.getTaskHistory(taskId, { tenantId, limit: 1000 })),
    };
  }

  const directState = await Promise.resolve(store.getTaskCurrentState(taskId, {}));
  const directHistory = await Promise.resolve(store.getTaskHistory(taskId, { limit: 1000 }));
  if (directState || directHistory.length) {
    return { state: directState, history: directHistory };
  }

  const tenantCandidates = [
    process.env.DEFAULT_TENANT_ID,
    process.env.ENGINEERING_TEAM_TENANT_ID,
    'engineering-team',
    'tenant-a',
  ].filter(Boolean);

  for (const candidate of [...new Set(tenantCandidates)]) {
    const state = await Promise.resolve(store.getTaskCurrentState(taskId, { tenantId: candidate }));
    const history = await Promise.resolve(store.getTaskHistory(taskId, { tenantId: candidate, limit: 1000 }));
    if (state || history.length) {
      return { state, history };
    }
  }

  return { state: null, history: [] };
}

async function requireForgeReadAccess(req, options, getRequestContext) {
  if (isServiceTokenAuthorized(req, options)) {
    return { authType: 'service-token', roles: ['forge-service'] };
  }

  const principal = await getRequestContext(req, options);
  if (!principal?.tenantId || !principal?.actorId) {
    throw httpError(401, 'missing_auth_context', 'Bearer token with tenant and actor claims is required.');
  }
  if (!authorize(principal, 'forge:read')) {
    throw httpError(403, 'forbidden', 'missing permission: forge:read', { permission: 'forge:read' });
  }
  return principal;
}

async function handleForgeExecutionRequest(req, res, context) {
  const { route, requestId, options, store, getRequestContext } = context;
  if (req.method === 'OPTIONS') return sendJson(res, 204, {}, requestId);
  if (req.method !== 'GET') {
    throw httpError(405, 'method_not_allowed', 'Method not allowed', { method: req.method });
  }

  const principal = await requireForgeReadAccess(req, options, getRequestContext);

  if (!store || typeof store.getTaskHistory !== 'function' || typeof store.getTaskCurrentState !== 'function') {
    throw httpError(501, 'not_supported', 'Forge execution readiness is not supported by this store.');
  }

  const { state, history } = await loadTaskForForgeRead(store, route.taskId, principal.tenantId || null);

  const result = evaluateForgeExecutionReadiness({
    taskId: route.taskId,
    state,
    history,
  });

  if (!result.ready) {
    throw httpError(result.statusCode, result.code, result.message, result.details);
  }

  return sendJson(res, 200, result.task, requestId);
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

function createForgeExecutionReadinessRouteWrapper(bundle, options = {}, helpers = {}) {
  const server = bundle.server;
  const listeners = server.listeners('request');
  const effectiveOptions = { ...options, authService: bundle.authService || options.authService };
  server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    const url = new URL(req.url || '/', 'http://localhost');
    const route = forgeExecutionRoute(normalizeRoutePath(url.pathname));
    if (!route) return dispatchOriginal(server, listeners, req, res);
    try {
      await handleForgeExecutionRequest(req, res, {
        route,
        requestId,
        options: effectiveOptions,
        store: bundle.store,
        getRequestContext: helpers.getRequestContext,
        url,
      });
    } catch (error) {
      const normalized = normalizeError(error);
      sendJson(res, normalized.statusCode, errorPayload(normalized, requestId), requestId);
    }
  });
  return bundle;
}

module.exports = {
  createForgeExecutionReadinessRouteWrapper,
  forgeExecutionRoute,
  isServiceTokenAuthorized,
};