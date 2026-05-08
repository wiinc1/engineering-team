const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

function hashEvidence(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized ? crypto.createHash('sha256').update(normalized).digest('hex') : null;
}

function normalizeBaseUrl(value, { strategy = 'production auth' } = {}) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('AUTH_PROD_BASE_URL or --base-url is required');
  const url = new URL(normalized);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error(`Production ${strategy} smoke requires an HTTPS base URL`);
  }
  return url.toString().replace(/\/+$/, '');
}

function parseProtectedRoutes(value) {
  const routes = String(value || '')
    .split(',')
    .map((route) => route.trim())
    .filter(Boolean);
  return routes.length ? routes : ['/tasks', '/tasks?view=board', '/overview/pm'];
}

function buildDeploymentEvidence(options = {}) {
  return {
    selectedAuthStrategy: options.selectedAuthStrategy || 'registration',
    id: options.deploymentId || null,
    url: options.deploymentUrl || options.baseUrl || null,
    status: options.deploymentStatus || null,
    commitSha: options.commitSha || null,
    buildTimestamp: options.buildTimestamp || null,
    rollbackTarget: options.rollbackTarget || null,
  };
}

function writeEvidence(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

module.exports = {
  buildDeploymentEvidence,
  hashEvidence,
  normalizeBaseUrl,
  parseProtectedRoutes,
  writeEvidence,
};
