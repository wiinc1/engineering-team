'use strict';

const { createLangGraphHttpHandler } = require('./http');
const { DEFINITIONS, normalizeRequestId } = require('./errors');
const { createLangGraphRuntime } = require('./runtime');

function normalizeRoutePath(pathname) {
  let output = pathname || '/';
  for (const prefix of ['/api', '/backend']) {
    if (output === prefix) return '/';
    if (output.startsWith(`${prefix}/`)) output = output.slice(prefix.length) || '/';
  }
  return output;
}

function langGraphRoute(pathname) {
  if (pathname === '/v1/internal/langgraph/health') return 'health';
  if (pathname === '/v1/internal/langgraph/checkpoints') return 'checkpoints';
  return null;
}

function dispatchOriginal(server, listeners, req, res) {
  for (const listener of listeners) {
    const result = listener.call(server, req, res);
    if (result && typeof result.catch === 'function') result.catch(() => {
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Internal server error.' } }));
      }
    });
  }
}

function sendJson(res, status, body, requestId) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-request-id', requestId);
  res.end(JSON.stringify(body));
}

function createRuntimeLoader(bundle, options) {
  let runtimePromise;
  return async () => {
    if (!runtimePromise) runtimePromise = (async () => {
      if (options.langGraphRuntime) return options.langGraphRuntime;
      if (!bundle.store?.pool) throw Object.assign(new Error('Postgres runtime is required.'), { code: 'langgraph_checkpoint_unavailable' });
      const runtime = createLangGraphRuntime({
        pool: bundle.store.pool,
        baseDir: options.baseDir,
        config: {
          enabled: options.ffLangGraphRuntime ?? process.env.FF_LANGGRAPH_RUNTIME,
          killSwitch: options.langGraphGlobalKillSwitch ?? process.env.LANGGRAPH_GLOBAL_KILL_SWITCH,
        },
        // LANGGRAPH-01 deploys dormant infrastructure; lifecycle nodes arrive in LANGGRAPH-02.
        nodes: [{ name: 'dormant_runtime', execute: () => ({}) }],
      });
      await runtime.setup();
      return runtime;
    })();
    return runtimePromise;
  };
}

function unavailableResponse(error, requestId) {
  const code = Object.hasOwn(DEFINITIONS, error?.code)
    ? error.code
    : 'langgraph_checkpoint_unavailable';
  return {
    error: {
      code,
      message: DEFINITIONS[code][0],
      request_id: requestId,
      requestId,
    },
  };
}

function createRequestListener(context) {
  return async (req, res) => {
    const requestId = normalizeRequestId(req.headers?.['x-request-id']);
    const url = new URL(req.url || '/', 'http://localhost');
    const route = langGraphRoute(normalizeRoutePath(url.pathname));
    if (!route) return dispatchOriginal(context.server, context.listeners, req, res);
    if (req.method === 'OPTIONS') return sendJson(res, 204, {}, requestId);
    if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.', request_id: requestId, requestId } }, requestId);
    try {
      const authOptions = { ...context.options, authService: context.bundle.authService || context.options.authService };
      const requestContext = await context.helpers.getRequestContext(req, authOptions);
      if (!requestContext?.tenantId || !requestContext?.actorId) {
        return sendJson(res, 401, { error: { code: 'missing_auth_context', message: 'Authenticated tenant and actor are required.', request_id: requestId, requestId } }, requestId);
      }
      const runtime = await context.getRuntime();
      const handler = createLangGraphHttpHandler(runtime);
      const result = await handler({
        method: req.method,
        path: `/api/v1/internal/langgraph/${route}`,
        context: requestContext,
        query: Object.fromEntries(url.searchParams),
        requestId,
      });
      return sendJson(res, result.status, result.body, requestId);
    } catch (error) {
      return sendJson(res, 503, unavailableResponse(error, requestId), requestId);
    }
  };
}

function createLangGraphRouteWrapper(bundle, options = {}, helpers = {}) {
  const server = bundle.server;
  const listeners = server.listeners('request');
  const getRuntime = createRuntimeLoader(bundle, options);
  server.removeAllListeners('request');
  server.on('request', createRequestListener({ bundle, getRuntime, helpers, listeners, options, server }));
  return bundle;
}

module.exports = { createLangGraphRouteWrapper, langGraphRoute, normalizeRoutePath };
