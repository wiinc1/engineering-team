const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const {
  buildAuthDiagnostics,
  extractVercelEnvNames,
  validateAuthConfig,
  validateVercelEnvNames,
} = require('../../lib/auth/config-check');

test('production auth config check fails without OIDC and provider JWT verifier variables', () => {
  const result = validateAuthConfig({ env: {}, target: 'production' });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [
    'VITE_OIDC_DISCOVERY_URL',
    'VITE_OIDC_CLIENT_ID',
    'AUTH_JWT_ISSUER',
    'AUTH_JWT_AUDIENCE',
    'AUTH_JWT_JWKS_URL',
  ]);
});

test('production auth config check rejects internal bootstrap fallback', () => {
  const env = {
    VITE_OIDC_DISCOVERY_URL: 'https://idp.example/.well-known/openid-configuration',
    VITE_OIDC_CLIENT_ID: 'browser-client',
    AUTH_JWT_ISSUER: 'https://idp.example',
    AUTH_JWT_AUDIENCE: 'engineering-team',
    AUTH_JWT_JWKS_URL: 'https://idp.example/.well-known/jwks.json',
    VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED: 'true',
  };

  const result = validateAuthConfig({ env, target: 'production' });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED must be false/);
});

test('production auth config check allows explicit internal bootstrap strategy without an external IdP', () => {
  const env = {
    AUTH_PRODUCTION_AUTH_STRATEGY: 'internal-bootstrap',
    AUTH_JWT_SECRET: 'signed-production-bootstrap-secret',
    VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED: 'true',
    AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP: 'true',
  };

  const result = validateAuthConfig({ env, target: 'production' });

  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.productionAuthStrategy, 'internal-bootstrap');
  assert.equal(result.diagnostics.internalBootstrapConfigured, true);
  assert.equal(JSON.stringify(result.diagnostics).includes('signed-production-bootstrap-secret'), false);
});

test('production internal bootstrap strategy requires both browser and server flags plus signing secret', () => {
  const result = validateAuthConfig({
    env: { AUTH_PRODUCTION_AUTH_STRATEGY: 'internal-bootstrap' },
    target: 'production',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [
    'AUTH_JWT_SECRET',
    'VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED',
    'AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP',
  ]);
});

test('development auth config passes with explicitly enabled internal fallback', () => {
  const result = validateAuthConfig({
    env: { VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED: 'true' },
    target: 'development',
  });

  assert.equal(result.ok, true);
});

test('diagnostics artifact model contains booleans and missing names only', () => {
  const diagnostics = buildAuthDiagnostics({
    VITE_OIDC_DISCOVERY_URL: 'https://idp.example/.well-known/openid-configuration',
    VITE_OIDC_CLIENT_ID: 'browser-client',
    AUTH_JWT_ISSUER: '',
  });
  const serialized = JSON.stringify(diagnostics);

  assert.equal(diagnostics.browserOidcConfigured, true);
  assert.equal(diagnostics.providerJwtVerifierConfigured, false);
  assert.equal(diagnostics.productionAuthStrategy, 'oidc');
  assert.equal(serialized.includes('https://idp.example'), false);
  assert.equal(serialized.includes('browser-client'), false);
});

test('Vercel env-name validation parses name-only CLI JSON without requiring values', () => {
  const names = extractVercelEnvNames(JSON.stringify([
    { key: 'VITE_OIDC_DISCOVERY_URL' },
    { key: 'VITE_OIDC_CLIENT_ID' },
    { key: 'AUTH_JWT_ISSUER' },
    { key: 'AUTH_JWT_AUDIENCE' },
    { key: 'AUTH_JWT_JWKS_URL' },
  ]));

  const result = validateVercelEnvNames(names);

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test('Vercel env-name validation reports missing names only', () => {
  const result = validateVercelEnvNames(new Set(['VITE_OIDC_DISCOVERY_URL']));

  assert.equal(result.ok, false);
  assert.deepEqual(result.oidcMissing, [
    'VITE_OIDC_CLIENT_ID',
    'AUTH_JWT_ISSUER',
    'AUTH_JWT_AUDIENCE',
    'AUTH_JWT_JWKS_URL',
  ]);
  assert.deepEqual(result.internalBootstrapMissing, [
    'AUTH_PRODUCTION_AUTH_STRATEGY',
    'AUTH_JWT_SECRET',
    'VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED',
    'AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP',
  ]);
});

test('Vercel env-name validation accepts the explicit internal bootstrap production strategy names', () => {
  const result = validateVercelEnvNames(new Set([
    'AUTH_PRODUCTION_AUTH_STRATEGY',
    'AUTH_JWT_SECRET',
    'VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED',
    'AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP',
  ]));

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.internalBootstrapPresent.AUTH_JWT_SECRET, true);
});

test('auth availability alert thresholds are documented without secret-bearing fields', () => {
  const rules = fs.readFileSync('monitoring/alerts/auth-availability.yml', 'utf8');

  assert.match(rules, /auth-no-login-path-after-deploy/);
  assert.match(rules, /immediate_after_deploy/);
  assert.match(rules, /auth_callback_failures_10m >= 5/);
  assert.match(rules, /auth_callback_failure_rate_10m > 0\.25 AND auth_callback_attempts_10m >= 10/);
  assert.doesNotMatch(rules, /token|authorization_code|client_secret/i);
});
