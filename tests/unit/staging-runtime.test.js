const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveStagingRuntime,
  assertStagingRuntimeReady,
} = require('../../lib/task-platform/staging-runtime');

test('resolveStagingRuntime prefers STAGING_BASE_URL over local factory default', () => {
  const runtime = resolveStagingRuntime({
    env: undefined,
  });
  const original = process.env.STAGING_BASE_URL;
  process.env.STAGING_BASE_URL = 'https://staging.example';
  try {
    const resolved = resolveStagingRuntime();
    assert.equal(resolved.baseUrl, 'https://staging.example');
    assert.equal(resolved.profile, 'coordinated-stack');
    assert.equal(resolved.skipForgePhases, true);
  } finally {
    if (original == null) delete process.env.STAGING_BASE_URL;
    else process.env.STAGING_BASE_URL = original;
  }
  assert.equal(runtime.profile, 'coordinated-stack');
});

test('resolveStagingRuntime defaults to golden-path local stack endpoints', () => {
  const runtime = resolveStagingRuntime({});
  assert.equal(runtime.baseUrl, 'http://127.0.0.1:13000');
  assert.equal(runtime.forgeAdapterUrl, 'http://127.0.0.1:14010');
  assert.equal(runtime.jwtSecret, 'golden-path-local-dev-secret');
});

test('resolveStagingRuntime honors explicit skipValidation false', () => {
  const runtime = resolveStagingRuntime({ skipValidation: false });
  assert.equal(runtime.skipValidation, false);
});

test('assertStagingRuntimeReady fails closed when base URL explicitly cleared', () => {
  assert.throws(
    () => assertStagingRuntimeReady(resolveStagingRuntime({ baseUrl: ' ', jwtSecret: 'secret' })),
    /FACTORY_STACK_BASE_URL/,
  );
});