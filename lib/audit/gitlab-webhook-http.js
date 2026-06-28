const crypto = require('node:crypto');
const { createTaskPlatformService } = require('../task-platform');
const { resolveAgentRegistry } = require('./agents');
const { handleGitLabWebhookRequest } = require('./gitlab-webhook-handler');

function normalizeRoutePath(pathname) {
  let path = pathname || '/';
  for (const prefix of ['/api', '/backend']) {
    if (path === prefix) return '/';
    if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length) || '/';
  }
  return path || '/';
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
      message: error.message || 'Internal server error',
      details: error.details || undefined,
      request_id: requestId,
      requestId,
    },
  };
}

function sendJson(res, statusCode, payload, requestId) {
  if (res.writableEnded) return;
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('x-request-id', requestId);
  res.end(JSON.stringify(payload, null, 2));
}

function dispatchOriginal(server, listeners, req, res) {
  for (const listener of listeners) {
    listener.call(server, req, res);
  }
}

function createGitLabWebhookRouteWrapper(bundle, options = {}, helpers = {}) {
  const server = bundle.server;
  const listeners = server.listeners('request');
  const effectiveOptions = {
    ...options,
    authService: bundle.authService || options.authService,
  };
  const taskPlatform = createTaskPlatformService({
    ...effectiveOptions,
    agentRegistry: resolveAgentRegistry(effectiveOptions),
  });
  const createIntakeDraft = helpers.createIntakeDraftFromWebhook || options.createIntakeDraftFromWebhook;

  server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    const url = new URL(req.url || '/', 'http://localhost');
    const routePath = normalizeRoutePath(url.pathname);

    if (!(routePath === '/gitlab/webhooks' && req.method === 'POST')) {
      return dispatchOriginal(server, listeners, req, res);
    }

    try {
      if (typeof createIntakeDraft !== 'function') {
        throw httpError(501, 'not_supported', 'GitLab intake draft creation is not wired for this server.');
      }

      const result = await handleGitLabWebhookRequest({
        req,
        store: bundle.store,
        taskPlatform,
        createIntakeDraft,
        options: effectiveOptions,
        logger: options.logger || null,
        requestId,
      });
      sendJson(res, result.status, result.body, requestId);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      sendJson(res, statusCode, errorPayload(error, requestId), requestId);
    }
  });

  return bundle;
}

module.exports = {
  createGitLabWebhookRouteWrapper,
};