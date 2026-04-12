const STORAGE_KEY = 'engineering-team.task-browser-session';
const DEFAULT_POST_SIGN_IN_ROUTE = '/tasks';

function getSessionStorage(storage = globalThis.sessionStorage) {
  return storage;
}

function readBrowserSessionConfig(storage = getSessionStorage()) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { bearerToken: '', apiBaseUrl: '', expiresAt: '' };
    const parsed = JSON.parse(raw);
    return {
      bearerToken: typeof parsed?.bearerToken === 'string' ? parsed.bearerToken : '',
      apiBaseUrl: typeof parsed?.apiBaseUrl === 'string' ? parsed.apiBaseUrl : '',
      expiresAt: typeof parsed?.expiresAt === 'string' ? parsed.expiresAt : '',
    };
  } catch {
    return { bearerToken: '', apiBaseUrl: '', expiresAt: '' };
  }
}

function writeBrowserSessionConfig(config, storage = getSessionStorage()) {
  const next = {
    bearerToken: typeof config?.bearerToken === 'string' ? config.bearerToken.trim() : '',
    apiBaseUrl: typeof config?.apiBaseUrl === 'string' ? config.apiBaseUrl.trim().replace(/\/+$/, '') : '',
    expiresAt: typeof config?.expiresAt === 'string' ? config.expiresAt.trim() : '',
  };

  storage?.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function clearBrowserSessionConfig(storage = getSessionStorage()) {
  storage?.removeItem(STORAGE_KEY);
  return { bearerToken: '', apiBaseUrl: '', expiresAt: '' };
}

function buildAuthHeaders(config = {}) {
  const headers = {};
  const token = typeof config?.bearerToken === 'string' ? config.bearerToken.trim() : '';
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function resolveApiBaseUrl(config = {}, envBaseUrl = '') {
  return (typeof config?.apiBaseUrl === 'string' && config.apiBaseUrl.trim()) || envBaseUrl.trim() || '';
}

function decodeJwtPayload(token = '') {
  const [, payload] = token.split('.');
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    const json = globalThis.atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function readSessionClaims(config = {}) {
  return decodeJwtPayload(config?.bearerToken || '') || null;
}

function hasSessionExpired(config = {}, now = new Date()) {
  const explicitExpiry = typeof config?.expiresAt === 'string' ? config.expiresAt.trim() : '';
  if (explicitExpiry) {
    const expiresAt = Date.parse(explicitExpiry);
    if (Number.isFinite(expiresAt)) {
      return now.valueOf() >= expiresAt;
    }
  }

  const claims = readSessionClaims(config);
  if (!Number.isFinite(claims?.exp)) return false;
  return now.valueOf() >= claims.exp * 1000;
}

function isAuthenticatedSession(config = {}, now = new Date()) {
  const claims = readSessionClaims(config);
  if (!claims?.sub || !claims?.tenant_id) return false;
  if (!String(config?.bearerToken || '').trim()) return false;
  return !hasSessionExpired(config, now);
}

function sanitizeNextRoute(value) {
  if (!value || typeof value !== 'string') return DEFAULT_POST_SIGN_IN_ROUTE;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return DEFAULT_POST_SIGN_IN_ROUTE;

  const hashIndex = trimmed.indexOf('#');
  const withoutHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  if (!withoutHash || withoutHash.startsWith('/sign-in')) return DEFAULT_POST_SIGN_IN_ROUTE;
  return withoutHash || DEFAULT_POST_SIGN_IN_ROUTE;
}

function splitRouteTarget(value) {
  const sanitized = sanitizeNextRoute(value);
  const queryIndex = sanitized.indexOf('?');
  return queryIndex >= 0
    ? { pathname: sanitized.slice(0, queryIndex) || DEFAULT_POST_SIGN_IN_ROUTE, search: sanitized.slice(queryIndex) }
    : { pathname: sanitized, search: '' };
}

module.exports = {
  DEFAULT_POST_SIGN_IN_ROUTE,
  STORAGE_KEY,
  buildAuthHeaders,
  clearBrowserSessionConfig,
  decodeJwtPayload,
  hasSessionExpired,
  isAuthenticatedSession,
  readSessionClaims,
  readBrowserSessionConfig,
  resolveApiBaseUrl,
  sanitizeNextRoute,
  splitRouteTarget,
  writeBrowserSessionConfig,
};
