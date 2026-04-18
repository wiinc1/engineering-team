const test = require('node:test');
const assert = require('node:assert/strict');

const {
  beginOidcSignIn,
  buildOidcLogoutUrl,
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
} = require('../../src/app/session');

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test('browser session config round-trips through storage', () => {
  const storage = createStorage();
  const written = writeBrowserSessionConfig({
    bearerToken: ' abc ',
    apiBaseUrl: 'http://api.local///',
    expiresAt: '2026-04-10T01:00:00.000Z',
  }, storage);

  assert.deepEqual(written, {
    bearerToken: 'abc',
    apiBaseUrl: 'http://api.local',
    expiresAt: '2026-04-10T01:00:00.000Z',
  });
  assert.deepEqual(readBrowserSessionConfig(storage), written);
});

test('buildAuthHeaders only emits authorization when a token exists', () => {
  assert.deepEqual(buildAuthHeaders({ bearerToken: 'jwt-token' }), { authorization: 'Bearer jwt-token' });
  assert.deepEqual(buildAuthHeaders({ bearerToken: '   ' }), {});
});

test('resolveApiBaseUrl prefers stored value over env fallback', () => {
  assert.equal(resolveApiBaseUrl({ apiBaseUrl: 'http://stored.local' }, 'http://env.local'), 'http://stored.local');
  assert.equal(resolveApiBaseUrl({}, 'http://env.local'), 'http://env.local');
});

test('decodeJwtPayload decodes base64url claims for display', () => {
  globalThis.atob = (input) => Buffer.from(input, 'base64').toString('utf8');
  const payload = Buffer.from(JSON.stringify({ sub: 'pm-1', tenant_id: 'tenant-a', roles: ['reader'] })).toString('base64url');

  assert.deepEqual(decodeJwtPayload(`header.${payload}.sig`), {
    sub: 'pm-1',
    tenant_id: 'tenant-a',
    roles: ['reader'],
  });
});

test('readSessionClaims decodes actor, tenant, and role metadata from the stored token', () => {
  globalThis.atob = (input) => Buffer.from(input, 'base64').toString('utf8');
  const payload = Buffer.from(JSON.stringify({
    sub: 'pm-1',
    tenant_id: 'tenant-a',
    roles: ['pm', 'reader'],
    exp: Math.floor(Date.parse('2026-04-10T01:00:00.000Z') / 1000),
  })).toString('base64url');

  const claims = readSessionClaims({
    bearerToken: `header.${payload}.sig`,
  });

  assert.deepEqual(claims, {
    sub: 'pm-1',
    tenant_id: 'tenant-a',
    roles: ['pm', 'reader'],
    exp: Math.floor(Date.parse('2026-04-10T01:00:00.000Z') / 1000),
  });
});

test('isAuthenticatedSession requires a non-expired token with tenant and actor claims', () => {
  globalThis.atob = (input) => Buffer.from(input, 'base64').toString('utf8');
  const activePayload = Buffer.from(JSON.stringify({
    sub: 'pm-1',
    tenant_id: 'tenant-a',
    roles: ['pm', 'reader'],
    exp: Math.floor(Date.parse('2026-04-10T01:00:00.000Z') / 1000),
  })).toString('base64url');
  const expiredPayload = Buffer.from(JSON.stringify({
    sub: 'pm-1',
    tenant_id: 'tenant-a',
    roles: ['pm', 'reader'],
    exp: Math.floor(Date.parse('2026-04-08T01:00:00.000Z') / 1000),
  })).toString('base64url');

  assert.equal(isAuthenticatedSession({ bearerToken: `header.${activePayload}.sig` }, new Date('2026-04-09T12:00:00.000Z')), true);
  assert.equal(isAuthenticatedSession({ bearerToken: `header.${expiredPayload}.sig` }, new Date('2026-04-09T12:00:00.000Z')), false);
  assert.equal(isAuthenticatedSession({ bearerToken: '' }, new Date('2026-04-09T12:00:00.000Z')), false);
});

test('hasSessionExpired honors explicit expiry timestamps', () => {
  assert.equal(hasSessionExpired({ expiresAt: '2026-04-09T11:59:59.000Z' }, new Date('2026-04-09T12:00:00.000Z')), true);
  assert.equal(hasSessionExpired({ expiresAt: '2026-04-09T12:00:01.000Z' }, new Date('2026-04-09T12:00:00.000Z')), false);
});

test('sanitizeNextRoute preserves in-app query strings and blocks unsafe redirects', () => {
  assert.equal(sanitizeNextRoute('/tasks?view=board'), '/tasks?view=board');
  assert.equal(sanitizeNextRoute('/overview/pm?bucket=needs-attention#ignored'), '/overview/pm?bucket=needs-attention');
  assert.equal(sanitizeNextRoute('https://example.com'), '/tasks');
  assert.equal(sanitizeNextRoute('//example.com/tasks'), '/tasks');
  assert.equal(sanitizeNextRoute('/sign-in?next=/tasks'), '/tasks');
});

test('splitRouteTarget separates pathname and query string for post-sign-in restore', () => {
  assert.deepEqual(splitRouteTarget('/tasks?view=board'), {
    pathname: '/tasks',
    search: '?view=board',
  });
  assert.deepEqual(splitRouteTarget('/overview/pm'), {
    pathname: '/overview/pm',
    search: '',
  });
});

test('clearBrowserSessionConfig removes persisted state', () => {
  const storage = createStorage();
  writeBrowserSessionConfig({ bearerToken: 'jwt', apiBaseUrl: 'http://api.local' }, storage);
  clearBrowserSessionConfig(storage);

  assert.deepEqual(readBrowserSessionConfig(storage), { bearerToken: '', apiBaseUrl: '', expiresAt: '' });
});

test('readAuthRuntimeConfig prefers runtime overrides and enables internal fallback in test mode', () => {
  globalThis.__ENGINEERING_TEAM_RUNTIME_CONFIG__ = {
    oidcDiscoveryUrl: 'https://idp.example/.well-known/openid-configuration',
    oidcClientId: 'browser-client',
    oidcScope: 'openid profile email offline_access',
  };

  const config = readAuthRuntimeConfig({ MODE: 'test' }, globalThis.__ENGINEERING_TEAM_RUNTIME_CONFIG__, {
    origin: 'https://app.example',
  });

  assert.equal(config.oidcDiscoveryUrl, 'https://idp.example/.well-known/openid-configuration');
  assert.equal(config.oidcClientId, 'browser-client');
  assert.equal(config.oidcRedirectUri, 'https://app.example/auth/callback');
  assert.equal(config.oidcLogoutRedirectUri, 'https://app.example/sign-in?reason=signed_out');
  assert.equal(config.oidcScope, 'openid profile email offline_access');
  assert.equal(config.internalAuthBootstrapEnabled, true);
  assert.equal(config.isOidcConfigured, true);

  delete globalThis.__ENGINEERING_TEAM_RUNTIME_CONFIG__;
});

test('OIDC transaction storage round-trips through session storage', () => {
  const storage = createStorage();
  writeOidcTransaction({
    state: 'state-1',
    codeVerifier: 'verifier-1',
    nonce: 'nonce-1',
    next: '/tasks?view=board',
    apiBaseUrl: 'http://api.local///',
  }, storage);

  assert.deepEqual(readOidcTransaction(storage), {
    state: 'state-1',
    codeVerifier: 'verifier-1',
    nonce: 'nonce-1',
    next: '/tasks?view=board',
    apiBaseUrl: 'http://api.local',
  });

  clearOidcTransaction(storage);
  assert.equal(readOidcTransaction(storage), null);
});

test('beginOidcSignIn stores PKCE transaction state and builds the authorize redirect', async () => {
  globalThis.btoa = (input) => Buffer.from(input, 'binary').toString('base64');
  globalThis.crypto = require('node:crypto').webcrypto;
  const storage = createStorage();
  const redirects = [];

  await beginOidcSignIn({
    config: {
      oidcDiscoveryUrl: 'https://idp.example/.well-known/openid-configuration',
      oidcClientId: 'browser-client',
      oidcRedirectUri: 'https://app.example/auth/callback',
      oidcScope: 'openid profile email',
      isOidcConfigured: true,
    },
    next: '/tasks?view=board',
    apiBaseUrl: '/api',
    storage,
    redirect: (url) => redirects.push(url),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://idp.example/oauth2/authorize',
        token_endpoint: 'https://idp.example/oauth2/token',
      }),
    }),
  });

  assert.equal(redirects.length, 1);
  const redirectUrl = new URL(redirects[0]);
  assert.equal(redirectUrl.origin, 'https://idp.example');
  assert.equal(redirectUrl.searchParams.get('client_id'), 'browser-client');
  assert.equal(redirectUrl.searchParams.get('redirect_uri'), 'https://app.example/auth/callback');
  assert.equal(redirectUrl.searchParams.get('response_type'), 'code');
  assert.equal(redirectUrl.searchParams.get('scope'), 'openid profile email');
  assert.equal(redirectUrl.searchParams.get('code_challenge_method'), 'S256');

  const transaction = readOidcTransaction(storage);
  assert.equal(transaction.next, '/tasks?view=board');
  assert.equal(transaction.apiBaseUrl, '/api');
  assert.ok(transaction.state);
  assert.ok(transaction.codeVerifier);
  assert.ok(transaction.nonce);
});

test('completeOidcSignIn exchanges the code for an access token and restores the next route', async () => {
  globalThis.atob = (input) => Buffer.from(input, 'base64').toString('utf8');
  globalThis.btoa = (input) => Buffer.from(input, 'binary').toString('base64');
  globalThis.crypto = require('node:crypto').webcrypto;
  const storage = createStorage();
  writeOidcTransaction({
    state: 'callback-state',
    codeVerifier: 'callback-verifier',
    nonce: 'callback-nonce',
    next: '/overview/pm?bucket=needs-routing-attention',
    apiBaseUrl: '/api',
  }, storage);

  const accessTokenPayload = Buffer.from(JSON.stringify({
    sub: 'pm-1',
    tenant_id: 'tenant-a',
    roles: ['pm', 'reader'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');

  const result = await completeOidcSignIn({
    config: {
      oidcDiscoveryUrl: 'https://idp.example/.well-known/openid-configuration',
      oidcClientId: 'browser-client',
      oidcRedirectUri: 'https://app.example/auth/callback',
      isOidcConfigured: true,
    },
    search: '?code=oidc-code&state=callback-state',
    storage,
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) {
        return {
          ok: true,
          json: async () => ({
            authorization_endpoint: 'https://idp.example/oauth2/authorize',
            token_endpoint: 'https://idp.example/oauth2/token',
          }),
        };
      }
      assert.equal(url, 'https://idp.example/oauth2/token');
      assert.equal(init.method, 'POST');
      assert.match(String(init.body), /code=oidc-code/);
      assert.match(String(init.body), /code_verifier=callback-verifier/);
      return {
        ok: true,
        json: async () => ({
          access_token: `header.${accessTokenPayload}.signature`,
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      };
    },
  });

  assert.equal(result.next, '/overview/pm?bucket=needs-routing-attention');
  assert.equal(result.sessionConfig.apiBaseUrl, '/api');
  assert.equal(result.claims.sub, 'pm-1');
  assert.equal(readOidcTransaction(storage), null);
});

test('buildOidcLogoutUrl appends the logout redirect and client id', () => {
  const url = buildOidcLogoutUrl({
    oidcLogoutUrl: 'https://idp.example/logout',
    oidcLogoutRedirectUri: 'https://app.example/sign-in?reason=signed_out',
    oidcClientId: 'browser-client',
  });

  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://idp.example');
  assert.equal(parsed.searchParams.get('post_logout_redirect_uri'), 'https://app.example/sign-in?reason=signed_out');
  assert.equal(parsed.searchParams.get('client_id'), 'browser-client');
});
