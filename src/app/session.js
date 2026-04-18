const STORAGE_KEY = 'engineering-team.task-browser-session';
const DEFAULT_POST_SIGN_IN_ROUTE = '/tasks';
const OIDC_TRANSACTION_STORAGE_KEY = 'engineering-team.oidc-transaction';

function getSessionStorage(storage = globalThis.sessionStorage) {
  return storage;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toBase64UrlFromBytes(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return globalThis.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function readRuntimeAuthConfig() {
  return globalThis.__ENGINEERING_TEAM_RUNTIME_CONFIG__ || {};
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

function readOidcTransaction(storage = getSessionStorage()) {
  try {
    const raw = storage?.getItem(OIDC_TRANSACTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      state: typeof parsed?.state === 'string' ? parsed.state : '',
      codeVerifier: typeof parsed?.codeVerifier === 'string' ? parsed.codeVerifier : '',
      nonce: typeof parsed?.nonce === 'string' ? parsed.nonce : '',
      next: sanitizeNextRoute(parsed?.next),
      apiBaseUrl: typeof parsed?.apiBaseUrl === 'string' ? parsed.apiBaseUrl.trim().replace(/\/+$/, '') : '',
    };
  } catch {
    return null;
  }
}

function writeOidcTransaction(transaction, storage = getSessionStorage()) {
  const next = {
    state: typeof transaction?.state === 'string' ? transaction.state.trim() : '',
    codeVerifier: typeof transaction?.codeVerifier === 'string' ? transaction.codeVerifier.trim() : '',
    nonce: typeof transaction?.nonce === 'string' ? transaction.nonce.trim() : '',
    next: sanitizeNextRoute(transaction?.next),
    apiBaseUrl: typeof transaction?.apiBaseUrl === 'string' ? transaction.apiBaseUrl.trim().replace(/\/+$/, '') : '',
  };
  storage?.setItem(OIDC_TRANSACTION_STORAGE_KEY, JSON.stringify(next));
  return next;
}

function clearOidcTransaction(storage = getSessionStorage()) {
  storage?.removeItem(OIDC_TRANSACTION_STORAGE_KEY);
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

function readAuthRuntimeConfig(env = {}, runtimeConfig = readRuntimeAuthConfig(), location = globalThis.location) {
  const redirectUriDefault = location?.origin ? `${location.origin}/auth/callback` : '/auth/callback';
  const logoutRedirectDefault = location?.origin ? `${location.origin}/sign-in?reason=signed_out` : '/sign-in?reason=signed_out';
  const internalFallbackDefault = Boolean(env?.DEV || env?.MODE === 'test');

  const oidcDiscoveryUrl = String(runtimeConfig.oidcDiscoveryUrl || env?.VITE_OIDC_DISCOVERY_URL || '').trim();
  const oidcClientId = String(runtimeConfig.oidcClientId || env?.VITE_OIDC_CLIENT_ID || '').trim();
  const oidcRedirectUri = String(runtimeConfig.oidcRedirectUri || env?.VITE_OIDC_REDIRECT_URI || redirectUriDefault).trim();
  const oidcScope = String(runtimeConfig.oidcScope || env?.VITE_OIDC_SCOPE || 'openid profile email').trim();
  const oidcLogoutUrl = String(runtimeConfig.oidcLogoutUrl || env?.VITE_OIDC_LOGOUT_URL || '').trim();
  const oidcLogoutRedirectUri = String(runtimeConfig.oidcLogoutRedirectUri || env?.VITE_OIDC_LOGOUT_REDIRECT_URI || logoutRedirectDefault).trim();
  const internalAuthBootstrapEnabled = parseBoolean(
    runtimeConfig.internalAuthBootstrapEnabled ?? env?.VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED,
    internalFallbackDefault,
  );

  return {
    oidcDiscoveryUrl,
    oidcClientId,
    oidcRedirectUri,
    oidcScope,
    oidcLogoutUrl,
    oidcLogoutRedirectUri,
    internalAuthBootstrapEnabled,
    isOidcConfigured: Boolean(oidcDiscoveryUrl && oidcClientId),
  };
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

async function fetchOidcMetadata(config, fetchImpl) {
  if (!config?.oidcDiscoveryUrl) {
    throw new Error('Enterprise sign-in is not configured for this environment.');
  }

  const response = await fetchImpl(config.oidcDiscoveryUrl, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error('Failed to load enterprise sign-in configuration.');
  }
  const metadata = await response.json();
  if (!metadata?.authorization_endpoint || !metadata?.token_endpoint) {
    throw new Error('Enterprise sign-in metadata is incomplete.');
  }
  return metadata;
}

async function createPkceChallenge(verifier) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return toBase64UrlFromBytes(new Uint8Array(digest));
}

function createRandomString(length = 32) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64UrlFromBytes(bytes);
}

function buildExpiresAt(accessToken, expiresInSeconds) {
  const expiresIn = Number(expiresInSeconds);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000).toISOString();
  }

  const claims = decodeJwtPayload(accessToken);
  if (Number.isFinite(claims?.exp)) {
    return new Date(claims.exp * 1000).toISOString();
  }

  return '';
}

async function beginOidcSignIn({
  config,
  next = DEFAULT_POST_SIGN_IN_ROUTE,
  apiBaseUrl = '',
  fetchImpl = globalThis.fetch.bind(globalThis),
  storage = getSessionStorage(),
  redirect = (url) => globalThis.location.assign(url),
} = {}) {
  if (!config?.isOidcConfigured) {
    throw new Error('Enterprise sign-in is not configured for this environment.');
  }

  const metadata = await fetchOidcMetadata(config, fetchImpl);
  const codeVerifier = createRandomString(32);
  const state = createRandomString(24);
  const nonce = createRandomString(24);
  const codeChallenge = await createPkceChallenge(codeVerifier);
  writeOidcTransaction({
    state,
    codeVerifier,
    nonce,
    next,
    apiBaseUrl,
  }, storage);

  const authorizeUrl = new URL(metadata.authorization_endpoint);
  authorizeUrl.searchParams.set('client_id', config.oidcClientId);
  authorizeUrl.searchParams.set('redirect_uri', config.oidcRedirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', config.oidcScope);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('nonce', nonce);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  redirect(authorizeUrl.toString());
  return { state, nonce };
}

async function completeOidcSignIn({
  config,
  search = globalThis.location?.search || '',
  fetchImpl = globalThis.fetch.bind(globalThis),
  storage = getSessionStorage(),
} = {}) {
  if (!config?.isOidcConfigured) {
    throw new Error('Enterprise sign-in is not configured for this environment.');
  }

  const params = new URLSearchParams(search);
  const callbackError = String(params.get('error') || '').trim();
  const callbackErrorDescription = String(params.get('error_description') || '').trim();
  if (callbackError) {
    clearOidcTransaction(storage);
    throw new Error(callbackErrorDescription || 'Enterprise sign-in failed.');
  }

  const code = String(params.get('code') || '').trim();
  const state = String(params.get('state') || '').trim();
  const transaction = readOidcTransaction(storage);
  if (!code || !state || !transaction?.state || !transaction.codeVerifier) {
    clearOidcTransaction(storage);
    throw new Error('The enterprise sign-in callback is missing required state.');
  }
  if (transaction.state !== state) {
    clearOidcTransaction(storage);
    throw new Error('The enterprise sign-in callback could not be validated.');
  }

  const metadata = await fetchOidcMetadata(config, fetchImpl);
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', config.oidcClientId);
  body.set('code', code);
  body.set('redirect_uri', config.oidcRedirectUri);
  body.set('code_verifier', transaction.codeVerifier);

  const response = await fetchImpl(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    clearOidcTransaction(storage);
    throw new Error(payload?.error_description || payload?.error || 'Enterprise sign-in token exchange failed.');
  }

  const accessToken = String(payload?.access_token || '').trim();
  if (!accessToken) {
    clearOidcTransaction(storage);
    throw new Error('Enterprise sign-in did not return an access token.');
  }

  const sessionConfig = writeBrowserSessionConfig({
    bearerToken: accessToken,
    apiBaseUrl: transaction.apiBaseUrl,
    expiresAt: buildExpiresAt(accessToken, payload?.expires_in),
  }, storage);
  clearOidcTransaction(storage);
  return {
    sessionConfig,
    next: transaction.next || DEFAULT_POST_SIGN_IN_ROUTE,
    claims: decodeJwtPayload(accessToken),
  };
}

function buildOidcLogoutUrl(config) {
  const logoutUrl = String(config?.oidcLogoutUrl || '').trim();
  if (!logoutUrl) return '';

  const nextUrl = new URL(logoutUrl);
  if (config?.oidcLogoutRedirectUri) {
    nextUrl.searchParams.set('post_logout_redirect_uri', config.oidcLogoutRedirectUri);
  }
  if (config?.oidcClientId) {
    nextUrl.searchParams.set('client_id', config.oidcClientId);
  }
  return nextUrl.toString();
}

module.exports = {
  DEFAULT_POST_SIGN_IN_ROUTE,
  OIDC_TRANSACTION_STORAGE_KEY,
  beginOidcSignIn,
  buildOidcLogoutUrl,
  STORAGE_KEY,
  buildAuthHeaders,
  clearBrowserSessionConfig,
  clearOidcTransaction,
  completeOidcSignIn,
  decodeJwtPayload,
  hasSessionExpired,
  isAuthenticatedSession,
  readAuthRuntimeConfig,
  readOidcTransaction,
  readSessionClaims,
  readBrowserSessionConfig,
  resolveApiBaseUrl,
  sanitizeNextRoute,
  splitRouteTarget,
  writeOidcTransaction,
  writeBrowserSessionConfig,
};
