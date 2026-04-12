const test = require('node:test');
const assert = require('node:assert/strict');

const {
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
