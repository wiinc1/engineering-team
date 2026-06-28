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
    assert.equal(resolved.profile, 'hosted-staging');
    assert.equal(resolved.useVersionedTaskApi, true);
    assert.equal(resolved.skipForgePhases, true);
  } finally {
    if (original == null) delete process.env.STAGING_BASE_URL;
    else process.env.STAGING_BASE_URL = original;
  }
  assert.equal(runtime.profile, 'coordinated-stack');
});

test('resolveStagingRuntime defaults to golden-path local stack endpoints', () => {
  const keys = ['STAGING_BASE_URL', 'AUTH_JWT_SECRET', 'GOLDEN_PATH_JWT_SECRET'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    const runtime = resolveStagingRuntime({});
    assert.equal(runtime.baseUrl, 'http://127.0.0.1:13000');
    assert.equal(runtime.forgeAdapterUrl, 'http://127.0.0.1:14010');
    assert.equal(runtime.jwtSecret, 'golden-path-local-dev-secret');
    assert.equal(runtime.useVersionedTaskApi, false);
  } finally {
    for (const key of keys) {
      if (saved[key] == null) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test('resolveWorkflowRoute maps legacy task paths to /api/v1 on hosted URLs', () => {
  const { resolveWorkflowRoute } = require('../../lib/task-platform/golden-path-shared');
  assert.equal(
    resolveWorkflowRoute('/tasks/TSK-001/events', { useVersionedTaskApi: true }),
    '/api/v1/tasks/TSK-001/events',
  );
  assert.equal(
    resolveWorkflowRoute('/tasks/TSK-001/events', { useVersionedTaskApi: false }),
    '/tasks/TSK-001/events',
  );
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