const STORAGE_KEY = 'engineering-team.task-browser-session';
const DEFAULT_POST_SIGN_IN_ROUTE = '/tasks';
const OIDC_TRANSACTION_STORAGE_KEY = 'engineering-team.oidc-transaction';

function defaultStorage(storage = globalThis.sessionStorage) {
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

function base64Url(bytes) {
  let raw = '';
  bytes.forEach((byte) => {
    raw += String.fromCharCode(byte);
  });
  return globalThis.btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function runtimeConfig() {
  return globalThis.__ENGINEERING_TEAM_RUNTIME_CONFIG__ || {};
}

function firstValue(source = {}, ...keys) {
  for (const key of keys) {
    const value = source?.[key];
    const normalized = String(value ?? '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function readBrowserSessionConfig(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { bearerToken: '', apiBaseUrl: '', expiresAt: '' };
    const parsed = JSON.parse(raw);
    const config = {
      bearerToken: typeof parsed?.bearerToken === 'string' ? parsed.bearerToken : '',
      apiBaseUrl: typeof parsed?.apiBaseUrl === 'string' ? parsed.apiBaseUrl : '',
      expiresAt: typeof parsed?.expiresAt === 'string' ? parsed.expiresAt : '',
    };
    if (typeof parsed?.actorId === 'string') config.actorId = parsed.actorId;
    if (typeof parsed?.tenantId === 'string') config.tenantId = parsed.tenantId;
    if (Array.isArray(parsed?.roles)) config.roles = parsed.roles;
    if (typeof parsed?.authType === 'string') config.authType = parsed.authType;
    return config;
  } catch {
    return { bearerToken: '', apiBaseUrl: '', expiresAt: '' };
  }
}

function writeBrowserSessionConfig(config, storage = defaultStorage()) {
  const next = {
    bearerToken: typeof config?.bearerToken === 'string' ? config.bearerToken.trim() : '',
    apiBaseUrl: typeof config?.apiBaseUrl === 'string' ? config.apiBaseUrl.trim().replace(/\/+$/, '') : '',
    expiresAt: typeof config?.expiresAt === 'string' ? config.expiresAt.trim() : '',
  };
  if (typeof config?.actorId === 'string') next.actorId = config.actorId.trim();
  if (typeof config?.tenantId === 'string') next.tenantId = config.tenantId.trim();
  if (Array.isArray(config?.roles)) next.roles = config.roles.map((role) => String(role || '').trim()).filter(Boolean);
  if (typeof config?.authType === 'string') next.authType = config.authType.trim();
  storage?.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function clearBrowserSessionConfig(storage = defaultStorage()) {
  storage?.removeItem(STORAGE_KEY);
  return { bearerToken: '', apiBaseUrl: '', expiresAt: '' };
}

function readCookie(name, cookieHeader = globalThis.document?.cookie || '') {
  const prefix = `${name}=`;
  return String(cookieHeader || '')
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length) || '';
}

function readOidcTransaction(storage = defaultStorage()) {
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

function writeOidcTransaction(transaction, storage = defaultStorage()) {
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

function clearOidcTransaction(storage = defaultStorage()) {
  storage?.removeItem(OIDC_TRANSACTION_STORAGE_KEY);
}

function buildAuthHeaders(sessionConfig = {}) {
  const headers = {};
  const bearerToken = typeof sessionConfig?.bearerToken === 'string' ? sessionConfig.bearerToken.trim() : '';
  if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
  if (!bearerToken) {
    const csrf = decodeURIComponent(readCookie('engineering_team_csrf') || '');
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  return headers;
}

function resolveApiBaseUrl(sessionConfig = {}, envBaseUrl = '') {
  return typeof sessionConfig?.apiBaseUrl === 'string' && sessionConfig.apiBaseUrl.trim()
    ? sessionConfig.apiBaseUrl.trim()
    : envBaseUrl.trim() || '';
}

function readAuthRuntimeConfig(env = {}, config = runtimeConfig(), location = globalThis.location) {
  const callback = location?.origin ? `${location.origin}/auth/callback` : '/auth/callback';
  const signedOut = location?.origin ? `${location.origin}/sign-in?reason=signed_out` : '/sign-in?reason=signed_out';
  const localDefault = !!(env?.DEV || env?.MODE === 'test');
  const oidcDiscoveryUrl = String(firstValue(config, 'oidcDiscoveryUrl', 'VITE_OIDC_DISCOVERY_URL') || env?.VITE_OIDC_DISCOVERY_URL || '').trim();
  const oidcClientId = String(firstValue(config, 'oidcClientId', 'VITE_OIDC_CLIENT_ID') || env?.VITE_OIDC_CLIENT_ID || '').trim();
  const oidcRedirectUri = String(firstValue(config, 'oidcRedirectUri', 'VITE_OIDC_REDIRECT_URI') || env?.VITE_OIDC_REDIRECT_URI || callback).trim();
  const oidcScope = String(firstValue(config, 'oidcScope', 'VITE_OIDC_SCOPE') || env?.VITE_OIDC_SCOPE || 'openid profile email').trim();
  const oidcLogoutUrl = String(firstValue(config, 'oidcLogoutUrl', 'VITE_OIDC_LOGOUT_URL') || env?.VITE_OIDC_LOGOUT_URL || '').trim();
  const oidcLogoutRedirectUri = String(firstValue(config, 'oidcLogoutRedirectUri', 'VITE_OIDC_LOGOUT_REDIRECT_URI') || env?.VITE_OIDC_LOGOUT_REDIRECT_URI || signedOut).trim();
  const internalAuthBootstrapEnabled = parseBoolean(
    firstValue(config, 'internalAuthBootstrapEnabled', 'VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED') ||
      env?.VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED,
    localDefault
  );
  const configuredStrategy = String(
    firstValue(config, 'productionAuthStrategy', 'VITE_AUTH_PRODUCTION_AUTH_STRATEGY', 'AUTH_PRODUCTION_AUTH_STRATEGY') ||
      env?.VITE_AUTH_PRODUCTION_AUTH_STRATEGY ||
      env?.AUTH_PRODUCTION_AUTH_STRATEGY ||
      ''
  ).trim().toLowerCase();
  const vercelEnv = String(firstValue(config, 'vercelEnv', 'VITE_VERCEL_ENV') || env?.VITE_VERCEL_ENV || '').trim().toLowerCase();
  const productionAuthStrategy =
    configuredStrategy === 'magic-link'
      ? 'registration'
      : configuredStrategy || (env?.PROD || env?.MODE === 'production' || vercelEnv === 'production' || vercelEnv === 'preview' ? 'registration' : oidcDiscoveryUrl && oidcClientId ? 'oidc' : internalAuthBootstrapEnabled ? 'internal-bootstrap' : '');

  return {
    productionAuthStrategy,
    oidcDiscoveryUrl,
    oidcClientId,
    oidcRedirectUri,
    oidcScope,
    oidcLogoutUrl,
    oidcLogoutRedirectUri,
    internalAuthBootstrapEnabled,
    isOidcConfigured: !!(oidcDiscoveryUrl && oidcClientId),
    isRegistrationConfigured: productionAuthStrategy === 'registration',
    isMagicLinkConfigured: false,
  };
}

function decodeJwtPayload(token = '') {
  const [, payload] = token.split('.');
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    return JSON.parse(globalThis.atob(padded));
  } catch {
    return null;
  }
}

function readSessionClaims(config = {}) {
  if (config?.actorId && config?.tenantId) {
    return {
      sub: config.actorId,
      tenant_id: config.tenantId,
      roles: config.roles || [],
      exp: Number.isFinite(Date.parse(config.expiresAt)) ? Math.floor(Date.parse(config.expiresAt) / 1000) : undefined,
    };
  }
  return decodeJwtPayload(config?.bearerToken || '') || null;
}

function hasSessionExpired(config = {}, now = new Date()) {
  const expiresAt = typeof config?.expiresAt === 'string' ? config.expiresAt.trim() : '';
  if (expiresAt) {
    const time = Date.parse(expiresAt);
    if (Number.isFinite(time)) return now.valueOf() >= time;
  }
  const claims = readSessionClaims(config);
  return Number.isFinite(claims?.exp) ? now.valueOf() >= claims.exp * 1000 : false;
}

function isAuthenticatedSession(config = {}, now = new Date()) {
  const claims = readSessionClaims(config);
  const hasCredential = String(config?.bearerToken || '').trim() || config.authType === 'cookie-session';
  return !!(claims?.sub && claims?.tenant_id && hasCredential && !hasSessionExpired(config, now));
}

function sanitizeNextRoute(value) {
  if (!value || typeof value !== 'string') return DEFAULT_POST_SIGN_IN_ROUTE;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return DEFAULT_POST_SIGN_IN_ROUTE;
  const hashIndex = trimmed.indexOf('#');
  const route = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  if (
    !route ||
    route.startsWith('/sign-in') ||
    route.startsWith('/auth/register') ||
    route.startsWith('/auth/login') ||
    route.startsWith('/auth/email/verify') ||
    route.startsWith('/auth/password-reset') ||
    route.startsWith('/auth/magic-link')
  ) {
    return DEFAULT_POST_SIGN_IN_ROUTE;
  }
  return route || DEFAULT_POST_SIGN_IN_ROUTE;
}

function splitRouteTarget(value) {
  const route = sanitizeNextRoute(value);
  const index = route.indexOf('?');
  return index >= 0
    ? { pathname: route.slice(0, index) || DEFAULT_POST_SIGN_IN_ROUTE, search: route.slice(index) }
    : { pathname: route, search: '' };
}

async function loadOidcMetadata(config, fetchImpl) {
  if (!config?.oidcDiscoveryUrl) throw new Error('Enterprise sign-in is not configured for this environment.');
  const response = await fetchImpl(config.oidcDiscoveryUrl, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('Failed to load enterprise sign-in configuration.');
  const metadata = await response.json();
  if (!metadata?.authorization_endpoint || !metadata?.token_endpoint) {
    throw new Error('Enterprise sign-in metadata is incomplete.');
  }
  return metadata;
}

async function sha256Base64Url(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function randomBase64Url(bytes = 32) {
  const values = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(values);
  return base64Url(values);
}

function tokenExpiresAt(token, expiresIn) {
  const seconds = Number(expiresIn);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(Date.now() + seconds * 1000).toISOString();
  const claims = decodeJwtPayload(token);
  return Number.isFinite(claims?.exp) ? new Date(claims.exp * 1000).toISOString() : '';
}

async function beginOidcSignIn({
  config,
  next = DEFAULT_POST_SIGN_IN_ROUTE,
  apiBaseUrl = '',
  fetchImpl = globalThis.fetch.bind(globalThis),
  storage = defaultStorage(),
  redirect = (url) => globalThis.location.assign(url),
} = {}) {
  if (!config?.isOidcConfigured) throw new Error('Enterprise sign-in is not configured for this environment.');
  const metadata = await loadOidcMetadata(config, fetchImpl);
  const codeVerifier = randomBase64Url(32);
  const state = randomBase64Url(24);
  const nonce = randomBase64Url(24);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  writeOidcTransaction({ state, codeVerifier, nonce, next, apiBaseUrl }, storage);
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set('client_id', config.oidcClientId);
  url.searchParams.set('redirect_uri', config.oidcRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.oidcScope);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  redirect(url.toString());
  return { state, nonce };
}

async function completeOidcSignIn({
  config,
  search = globalThis.location?.search || '',
  fetchImpl = globalThis.fetch.bind(globalThis),
  storage = defaultStorage(),
} = {}) {
  if (!config?.isOidcConfigured) throw new Error('Enterprise sign-in is not configured for this environment.');
  const params = new URLSearchParams(search);
  const error = String(params.get('error') || '').trim();
  const description = String(params.get('error_description') || '').trim();
  if (error) {
    clearOidcTransaction(storage);
    throw new Error(description || 'Enterprise sign-in failed.');
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
  const metadata = await loadOidcMetadata(config, fetchImpl);
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', config.oidcClientId);
  body.set('code', code);
  body.set('redirect_uri', config.oidcRedirectUri);
  body.set('code_verifier', transaction.codeVerifier);
  const response = await fetchImpl(metadata.token_endpoint, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
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
  const sessionConfig = writeBrowserSessionConfig(
    { bearerToken: accessToken, apiBaseUrl: transaction.apiBaseUrl, expiresAt: tokenExpiresAt(accessToken, payload?.expires_in) },
    storage
  );
  clearOidcTransaction(storage);
  return { sessionConfig, next: transaction.next || DEFAULT_POST_SIGN_IN_ROUTE, claims: decodeJwtPayload(accessToken) };
}

async function requestJson(url, body, fetchImpl) {
  const response = await fetchImpl(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || 'Request failed.');
  return payload;
}

async function loginWithPassword({
  apiBaseUrl = '',
  email,
  password,
  next = DEFAULT_POST_SIGN_IN_ROUTE,
  fetchImpl = globalThis.fetch.bind(globalThis),
  storage = defaultStorage(),
} = {}) {
  const payload = await requestJson(`${apiBaseUrl}/auth/login`, { email, password, next: sanitizeNextRoute(next) }, fetchImpl);
  const data = payload?.data || {};
  return writeBrowserSessionConfig(
    {
      apiBaseUrl,
      actorId: data.actorId,
      tenantId: data.tenantId,
      roles: data.roles || [],
      authType: data.authType || 'cookie-session',
      expiresAt: data.expiresAt || '',
    },
    storage
  );
}

async function registerAccount({ apiBaseUrl = '', email, password, displayName = '', inviteCode = '', fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  return requestJson(`${apiBaseUrl}/auth/register`, { email, password, displayName, inviteCode }, fetchImpl);
}

async function requestEmailVerification({ apiBaseUrl = '', email, fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  return requestJson(`${apiBaseUrl}/auth/email/verify/request`, { email }, fetchImpl);
}

async function confirmEmailVerification({ apiBaseUrl = '', token, fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  return requestJson(`${apiBaseUrl}/auth/email/verify/confirm`, { token }, fetchImpl);
}

async function requestPasswordReset({ apiBaseUrl = '', email, fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  return requestJson(`${apiBaseUrl}/auth/password-reset/request`, { email }, fetchImpl);
}

async function confirmPasswordReset({ apiBaseUrl = '', token, password, fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  return requestJson(`${apiBaseUrl}/auth/password-reset/confirm`, { token, password }, fetchImpl);
}

async function fetchCurrentSession({ apiBaseUrl = '', fetchImpl = globalThis.fetch.bind(globalThis), storage = defaultStorage() } = {}) {
  const response = await fetchImpl(`${apiBaseUrl}/auth/me`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return null;
  const data = (await response.json())?.data;
  if (!data?.actorId || !data?.tenantId) return null;
  return writeBrowserSessionConfig(
    {
      apiBaseUrl,
      actorId: data.actorId,
      tenantId: data.tenantId,
      roles: data.roles || [],
      authType: data.authType || 'cookie-session',
      expiresAt: data.expiresAt || '',
    },
    storage
  );
}

async function logoutSession({ apiBaseUrl = '', fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  const response = await fetchImpl(`${apiBaseUrl}/auth/logout`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: buildAuthHeaders({ authType: 'cookie-session' }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message || 'Sign-out failed.');
  }
  return true;
}

function buildOidcLogoutUrl(config) {
  const logoutUrl = String(config?.oidcLogoutUrl || '').trim();
  if (!logoutUrl) return '';
  const url = new URL(logoutUrl);
  if (config?.oidcLogoutRedirectUri) url.searchParams.set('post_logout_redirect_uri', config.oidcLogoutRedirectUri);
  if (config?.oidcClientId) url.searchParams.set('client_id', config.oidcClientId);
  return url.toString();
}

export {
  DEFAULT_POST_SIGN_IN_ROUTE,
  OIDC_TRANSACTION_STORAGE_KEY,
  beginOidcSignIn,
  buildOidcLogoutUrl,
  STORAGE_KEY,
  buildAuthHeaders,
  clearBrowserSessionConfig,
  clearOidcTransaction,
  completeOidcSignIn,
  confirmEmailVerification,
  confirmPasswordReset,
  decodeJwtPayload,
  fetchCurrentSession,
  hasSessionExpired,
  isAuthenticatedSession,
  loginWithPassword,
  logoutSession,
  readAuthRuntimeConfig,
  readBrowserSessionConfig,
  readOidcTransaction,
  readSessionClaims,
  registerAccount,
  requestEmailVerification,
  requestPasswordReset,
  resolveApiBaseUrl,
  sanitizeNextRoute,
  splitRouteTarget,
  writeBrowserSessionConfig,
  writeOidcTransaction,
};
