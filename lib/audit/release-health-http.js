const crypto = require('crypto');
const { spawnSync } = require('child_process');

const RELEASE_HEALTH_SCHEMA_VERSION = 'engineering-team-release-health.v1';
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

function normalizeRoutePath(pathname) {
  let path = pathname || '/';
  for (const prefix of ['/api', '/backend']) {
    if (path === prefix) return '/';
    if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length) || '/';
  }
  return path || '/';
}

function isReleaseHealthRoute(path) {
  return path === '/version' || path === '/health';
}

function normalizeCommitSha(value) {
  const text = String(value || '').trim();
  return COMMIT_SHA_PATTERN.test(text) ? text : '';
}

function commitShaFromEnv(env = process.env) {
  const keys = [
    'ENGINEERING_TEAM_RELEASE_COMMIT_SHA',
    'ENGINEERING_TEAM_COMMIT_SHA',
    'RELEASE_COMMIT_SHA',
    'COMMIT_SHA',
    'GITHUB_SHA',
  ];
  for (const key of keys) {
    const commitSha = normalizeCommitSha(env[key]);
    if (commitSha) return { commitSha, source: `env:${key}` };
  }
  return { commitSha: '', source: null };
}

function commitShaFromGit(cwd = process.cwd()) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    timeout: 3000,
  });
  const commitSha = normalizeCommitSha(result.stdout);
  return commitSha ? { commitSha, source: 'git:rev-parse HEAD' } : { commitSha: '', source: null };
}

function resolveReleaseCommitSha(options = {}, env = process.env) {
  const explicit = normalizeCommitSha(options.releaseCommitSha || options.commitSha);
  if (explicit) return { commitSha: explicit, source: 'options' };
  const fromEnv = commitShaFromEnv(env);
  if (fromEnv.commitSha) return fromEnv;
  return commitShaFromGit(options.repoRoot || options.baseDir || process.cwd());
}

function buildReleaseHealthPayload(options = {}, env = process.env) {
  const resolved = resolveReleaseCommitSha(options, env);
  return {
    schemaVersion: RELEASE_HEALTH_SCHEMA_VERSION,
    status: resolved.commitSha ? 'ok' : 'degraded',
    service: 'engineering-team-audit-api',
    commitSha: resolved.commitSha || null,
    commit_sha: resolved.commitSha || null,
    source: resolved.source,
  };
}

function sendJson(res, statusCode, payload, requestId, method = 'GET') {
  if (res.writableEnded) return;
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-request-id', requestId);
  if (method === 'HEAD') return res.end();
  return res.end(JSON.stringify(payload, null, 2));
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

function createReleaseHealthRouteWrapper(bundle, options = {}) {
  const server = bundle.server;
  const listeners = server.listeners('request');
  const releaseHealthPayload = buildReleaseHealthPayload(options);
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    const url = new URL(req.url || '/', 'http://localhost');
    if (!isReleaseHealthRoute(normalizeRoutePath(url.pathname))) {
      return dispatchOriginal(server, listeners, req, res);
    }
    if (req.method === 'OPTIONS') return sendJson(res, 204, {}, requestId);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, {
        error: {
          code: 'method_not_allowed',
          message: 'Method not allowed',
          request_id: requestId,
          requestId,
        },
      }, requestId, req.method);
    }
    return sendJson(res, 200, releaseHealthPayload, requestId, req.method);
  });
  return bundle;
}

module.exports = {
  RELEASE_HEALTH_SCHEMA_VERSION,
  buildReleaseHealthPayload,
  createReleaseHealthRouteWrapper,
  normalizeRoutePath,
  resolveReleaseCommitSha,
};
