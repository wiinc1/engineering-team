const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAuthHeaders,
  clearBrowserSessionConfig,
  decodeJwtPayload,
  readBrowserSessionConfig,
  resolveApiBaseUrl,
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
  const written = writeBrowserSessionConfig({ bearerToken: ' abc ', apiBaseUrl: 'http://api.local///' }, storage);

  assert.deepEqual(written, { bearerToken: 'abc', apiBaseUrl: 'http://api.local' });
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

test('clearBrowserSessionConfig removes persisted state', () => {
  const storage = createStorage();
  writeBrowserSessionConfig({ bearerToken: 'jwt', apiBaseUrl: 'http://api.local' }, storage);
  clearBrowserSessionConfig(storage);

  assert.deepEqual(readBrowserSessionConfig(storage), { bearerToken: '', apiBaseUrl: '' });
});
