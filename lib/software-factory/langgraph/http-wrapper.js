'use strict';

const { createLangGraphHttpHandler } = require('./http');
const { DEFINITIONS, LangGraphRuntimeError, errorEnvelope, normalizeRequestId } = require('./errors');
const { createLangGraphRuntime } = require('./runtime');
const { createLangGraphOperatorService } = require('./operator-service');

const MAX_BODY_BYTES = 16 * 1024;

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

function langGraphOperatorRoute(pathname) {
  const decision = pathname.match(/^\/v1\/langgraph\/runs\/([^/]+)\/interrupts\/([^/]+)\/decision$/);
  if (decision) return { kind: 'decision', threadId: decodeURIComponent(decision[1]), interruptId: decodeURIComponent(decision[2]) };
  const action = pathname.match(/^\/v1\/langgraph\/runs\/([^/]+)\/(retry|cancel)$/);
  if (action) return { kind: action[2], threadId: decodeURIComponent(action[1]) };
  const status = pathname.match(/^\/v1\/langgraph\/runs\/([^/]+)$/);
  if (status) return { kind: 'status', threadId: decodeURIComponent(status[1]) };
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
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization,content-type,idempotency-key,if-match,x-request-id,x-csrf-token');
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new LangGraphRuntimeError('langgraph_decision_invalid');
  }
  try { return raw.trim() ? JSON.parse(raw) : {}; }
  catch { throw new LangGraphRuntimeError('langgraph_decision_invalid'); }
}

function mutationEnabled(options) {
  const value = options.ffLangGraphControls ?? process.env.FF_LANGGRAPH_CONTROLS ?? 'false';
  return value === true || String(value).trim().toLowerCase() === 'true';
}

function operatorStatus(error) {
  return {
    langgraph_interrupt_not_found: 404,
    langgraph_tenant_mismatch: 403,
    langgraph_decision_forbidden: 403,
    langgraph_decision_invalid: 422,
    langgraph_decision_conflict: 409,
    langgraph_concurrency_conflict: 409,
    langgraph_mutations_disabled: 503,
    langgraph_checkpoint_unavailable: 503,
    langgraph_version_unsupported: 409,
  }[error?.code] || 500;
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

function methodNotAllowed(res, requestId) {
  return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.', request_id: requestId, requestId } }, requestId);
}

async function handleOperatorRoute(context, req, res, route, auth, runtime, requestId) {
  if (!authorized(auth, 'summary')) throw new LangGraphRuntimeError('langgraph_decision_forbidden');
  const service = context.options.langGraphOperatorService || createLangGraphOperatorService({
    runtime, registry: runtime.registry, logger: context.options.logger,
    metrics: runtime.metrics, mutationsEnabled: mutationEnabled(context.options),
  });
  if (route.kind === 'status' && req.method === 'GET') {
    const data = await service.status({ tenantId: auth.tenantId, threadId: route.threadId });
    return sendJson(res, 200, { success: true, data, requestId }, requestId);
  }
  if (req.method !== 'POST') return methodNotAllowed(res, requestId);
  if (context.authOptions.authService) await context.authOptions.authService.requireCsrf(req, auth);
  const body = await readJson(req);
  const common = {
    tenantId: auth.tenantId, actorId: auth.actorId, roles: auth.roles || [], requestId,
    threadId: route.threadId, idempotencyKey: req.headers?.['idempotency-key'] || body.idempotencyKey,
  };
  let data;
  if (route.kind === 'decision') {
    const rawVersion = req.headers?.['if-match'] ?? body.expectedVersion;
    data = await service.decide({
      ...common, interruptId: route.interruptId, checkpointId: body.checkpointId,
      expectedVersion: rawVersion === undefined ? Number.NaN : Number(String(rawVersion).replace(/^"|"$/g, '')),
      action: body.action, edits: body.edits,
    });
  } else if (route.kind === 'retry') data = await service.retry({ ...common, node: body.node, reason: body.reason });
  else data = await service.cancel({ ...common, reason: body.reason });
  return sendJson(res, 200, { success: true, data, requestId }, requestId);
}

async function handleReadRoute(req, res, route, url, auth, runtime, requestId) {
  if (req.method !== 'GET') return methodNotAllowed(res, requestId);
  const result = await createLangGraphHttpHandler(runtime)({
    method: req.method, path: `/api/v1/internal/langgraph/${route}`, context: auth,
    query: Object.fromEntries(url.searchParams), requestId,
  });
  return sendJson(res, result.status, result.body, requestId);
}

async function dispatchLangGraphRequest(context, req, res, route, operatorRoute, url, requestId) {
  const auth = await context.helpers.getRequestContext(req, context.authOptions);
  if (!auth?.tenantId || !auth?.actorId) {
    return sendJson(res, 401, { error: { code: 'missing_auth_context', message: 'Authenticated tenant and actor are required.', request_id: requestId, requestId } }, requestId);
  }
  const runtime = await context.getRuntime();
  return operatorRoute
    ? handleOperatorRoute(context, req, res, operatorRoute, auth, runtime, requestId)
    : handleReadRoute(req, res, route, url, auth, runtime, requestId);
}

function createRequestListener(context) {
  context.authOptions = { ...context.options, authService: context.bundle.authService || context.options.authService };
  return async (req, res) => {
    const requestId = normalizeRequestId(req.headers?.['x-request-id']);
    const url = new URL(req.url || '/', 'http://localhost');
    const path = normalizeRoutePath(url.pathname);
    const route = langGraphRoute(path);
    const operatorRoute = langGraphOperatorRoute(path);
    if (!route && !operatorRoute) return dispatchOriginal(context.server, context.listeners, req, res);
    if (req.method === 'OPTIONS') return sendJson(res, 204, {}, requestId);
    try { return await dispatchLangGraphRequest(context, req, res, route, operatorRoute, url, requestId); }
    catch (error) {
      return operatorRoute
        ? sendJson(res, operatorStatus(error), errorEnvelope(error, requestId), requestId)
        : sendJson(res, 503, unavailableResponse(error, requestId), requestId);
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

module.exports = { createLangGraphRouteWrapper, langGraphOperatorRoute, langGraphRoute, mutationEnabled, normalizeRoutePath, operatorStatus };
