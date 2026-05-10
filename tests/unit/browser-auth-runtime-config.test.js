const assert = require('node:assert/strict');
const test = require('node:test');
const { readAuthRuntimeConfig } = require('../../src/app/session');

test('browser auth runtime defaults Vercel preview bundles to registration', () => {
  const config = readAuthRuntimeConfig(
    {
      MODE: 'production',
      PROD: true,
      VITE_VERCEL_ENV: 'preview',
      VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED: 'true',
    },
    {},
    { origin: 'https://app.example' }
  );

  assert.equal(config.productionAuthStrategy, 'registration');
  assert.equal(config.isRegistrationConfigured, true);
  assert.equal(config.internalAuthBootstrapEnabled, true);
});

test('browser auth runtime keeps internal bootstrap only when explicitly selected', () => {
  const config = readAuthRuntimeConfig(
    {
      MODE: 'production',
      PROD: true,
      VITE_VERCEL_ENV: 'preview',
      VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED: 'true',
      VITE_AUTH_PRODUCTION_AUTH_STRATEGY: 'internal-bootstrap',
    },
    {},
    { origin: 'https://app.example' }
  );

  assert.equal(config.productionAuthStrategy, 'internal-bootstrap');
  assert.equal(config.internalAuthBootstrapEnabled, true);
});
