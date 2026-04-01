const STORAGE_KEY = 'engineering-team.task-browser-session';

function getSessionStorage(storage = globalThis.sessionStorage) {
  return storage;
}

function readBrowserSessionConfig(storage = getSessionStorage()) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { bearerToken: '', apiBaseUrl: '' };
    const parsed = JSON.parse(raw);
    return {
      bearerToken: typeof parsed?.bearerToken === 'string' ? parsed.bearerToken : '',
      apiBaseUrl: typeof parsed?.apiBaseUrl === 'string' ? parsed.apiBaseUrl : '',
    };
  } catch {
    return { bearerToken: '', apiBaseUrl: '' };
  }
}

function writeBrowserSessionConfig(config, storage = getSessionStorage()) {
  const next = {
    bearerToken: typeof config?.bearerToken === 'string' ? config.bearerToken.trim() : '',
    apiBaseUrl: typeof config?.apiBaseUrl === 'string' ? config.apiBaseUrl.trim().replace(/\/+$/, '') : '',
  };

  storage?.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function clearBrowserSessionConfig(storage = getSessionStorage()) {
  storage?.removeItem(STORAGE_KEY);
  return { bearerToken: '', apiBaseUrl: '' };
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

module.exports = {
  STORAGE_KEY,
  buildAuthHeaders,
  clearBrowserSessionConfig,
  decodeJwtPayload,
  readBrowserSessionConfig,
  resolveApiBaseUrl,
  writeBrowserSessionConfig,
};
