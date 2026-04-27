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

test('production auth config check allows complete magic-link strategy', () => {
  const env = {
    DATABASE_URL: 'postgres://example',
    AUTH_PRODUCTION_AUTH_STRATEGY: 'magic-link',
    VITE_AUTH_PRODUCTION_AUTH_STRATEGY: 'magic-link',
    AUTH_SESSION_SECRET: 'session-secret',
    AUTH_EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 'resend-secret',
    AUTH_EMAIL_FROM: 'Workflow <noreply@example.com>',
    AUTH_PUBLIC_APP_URL: 'https://app.example',
    AUTH_MAGIC_LINK_TTL_MINUTES: '15',
    AUTH_SESSION_TTL_HOURS: '8',
    AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP: 'false',
    VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED: 'false',
  };

  const result = validateAuthConfig({ env, target: 'production' });

  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.productionAuthStrategy, 'magic-link');
  assert.equal(result.diagnostics.browserMagicLinkStrategyConfigured, true);
  assert.equal(result.diagnostics.magicLinkConfigured, true);
  assert.equal(JSON.stringify(result.diagnostics).includes('resend-secret'), false);
});

test('production auth config check accepts documented runtime magic-link strategy evidence', () => {
  const env = {
    DATABASE_URL: 'postgres://example',
    AUTH_PRODUCTION_AUTH_STRATEGY: 'magic-link',
    AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY: 'magic-link',
    AUTH_SESSION_SECRET: 'session-secret',
    AUTH_EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 'resend-secret',
    AUTH_EMAIL_FROM: 'Workflow <noreply@example.com>',
    AUTH_PUBLIC_APP_URL: 'https://app.example',
    AUTH_MAGIC_LINK_TTL_MINUTES: '15',
    AUTH_SESSION_TTL_HOURS: '8',
  };

  const result = validateAuthConfig({ env, target: 'production' });

  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.browserMagicLinkStrategyConfigured, true);
  assert.equal(result.diagnostics.magicLinkProductionRulesSatisfied.browserStrategy, true);
});

test('production magic-link strategy requires browser-visible strategy selection', () => {
  const env = {
    DATABASE_URL: 'postgres://example',
    AUTH_PRODUCTION_AUTH_STRATEGY: 'magic-link',
    AUTH_SESSION_SECRET: 'session-secret',
    AUTH_EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 'resend-secret',
    AUTH_EMAIL_FROM: 'Workflow <noreply@example.com>',
    AUTH_PUBLIC_APP_URL: 'https://app.example',
    AUTH_MAGIC_LINK_TTL_MINUTES: '15',
    AUTH_SESSION_TTL_HOURS: '8',
  };

  const result = validateAuthConfig({ env, target: 'production' });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['VITE_AUTH_PRODUCTION_AUTH_STRATEGY or AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY']);
  assert.equal(result.diagnostics.magicLinkConfigured, false);
});

test('production magic-link strategy enforces https public URL and exact TTLs', () => {
  const env = {
    DATABASE_URL: 'postgres://example',
    AUTH_PRODUCTION_AUTH_STRATEGY: 'magic-link',
    VITE_AUTH_PRODUCTION_AUTH_STRATEGY: 'magic-link',
    AUTH_SESSION_SECRET: 'session-secret',
    AUTH_EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 'resend-secret',
    AUTH_EMAIL_FROM: 'Workflow <noreply@example.com>',
    AUTH_PUBLIC_APP_URL: 'http://app.example',
    AUTH_MAGIC_LINK_TTL_MINUTES: '30',
    AUTH_SESSION_TTL_HOURS: '24',
  };

  const result = validateAuthConfig({ env, target: 'production' });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /AUTH_PUBLIC_APP_URL must be an https URL/);
  assert.match(result.errors.join('\n'), /AUTH_MAGIC_LINK_TTL_MINUTES must be exactly 15/);
  assert.match(result.errors.join('\n'), /AUTH_SESSION_TTL_HOURS must be exactly 8/);
  assert.equal(result.diagnostics.magicLinkProductionRulesSatisfied.publicAppUrlHttps, false);
  assert.equal(result.diagnostics.magicLinkProductionRulesSatisfied.magicLinkTtlMinutes15, false);
  assert.equal(result.diagnostics.magicLinkProductionRulesSatisfied.sessionTtlHours8, false);
});

test('production magic-link strategy rejects internal bootstrap flags', () => {
  const env = {
    DATABASE_URL: 'postgres://example',
    AUTH_PRODUCTION_AUTH_STRATEGY: 'magic-link',
    VITE_AUTH_PRODUCTION_AUTH_STRATEGY: 'magic-link',
    AUTH_SESSION_SECRET: 'session-secret',
    AUTH_EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 'resend-secret',
    AUTH_EMAIL_FROM: 'Workflow <noreply@example.com>',
    AUTH_PUBLIC_APP_URL: 'https://app.example',
    AUTH_MAGIC_LINK_TTL_MINUTES: '15',
    AUTH_SESSION_TTL_HOURS: '8',
    AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP: 'true',
  };

  const result = validateAuthConfig({ env, target: 'production' });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP must be false/);
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

test('Vercel env-name validation accepts magic-link production strategy names', () => {
  const result = validateVercelEnvNames(new Set([
    'DATABASE_URL',
    'AUTH_PRODUCTION_AUTH_STRATEGY',
    'VITE_AUTH_PRODUCTION_AUTH_STRATEGY',
    'AUTH_SESSION_SECRET',
    'AUTH_EMAIL_PROVIDER',
    'RESEND_API_KEY',
    'AUTH_EMAIL_FROM',
    'AUTH_PUBLIC_APP_URL',
    'AUTH_MAGIC_LINK_TTL_MINUTES',
    'AUTH_SESSION_TTL_HOURS',
  ]));

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.magicLinkPresent.RESEND_API_KEY, true);
  assert.equal(result.browserMagicLinkStrategyPresent.VITE_AUTH_PRODUCTION_AUTH_STRATEGY, true);
});

test('Vercel env-name validation accepts runtime-config evidence for magic-link browser strategy', () => {
  const result = validateVercelEnvNames(new Set([
    'DATABASE_URL',
    'AUTH_PRODUCTION_AUTH_STRATEGY',
    'AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY',
    'AUTH_SESSION_SECRET',
    'AUTH_EMAIL_PROVIDER',
    'RESEND_API_KEY',
    'AUTH_EMAIL_FROM',
    'AUTH_PUBLIC_APP_URL',
    'AUTH_MAGIC_LINK_TTL_MINUTES',
    'AUTH_SESSION_TTL_HOURS',
  ]));

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.browserMagicLinkStrategyPresent.AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY, true);
});

test('Vercel env-name validation reports missing magic-link browser strategy evidence', () => {
  const result = validateVercelEnvNames(new Set([
    'DATABASE_URL',
    'AUTH_PRODUCTION_AUTH_STRATEGY',
    'AUTH_SESSION_SECRET',
    'AUTH_EMAIL_PROVIDER',
    'RESEND_API_KEY',
    'AUTH_EMAIL_FROM',
    'AUTH_PUBLIC_APP_URL',
    'AUTH_MAGIC_LINK_TTL_MINUTES',
    'AUTH_SESSION_TTL_HOURS',
  ]));

  assert.equal(result.ok, false);
  assert.match(result.magicLinkMissing.join('\n'), /VITE_AUTH_PRODUCTION_AUTH_STRATEGY or AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY/);
});

test('auth availability alert thresholds are documented without secret-bearing fields', () => {
  const rules = fs.readFileSync('monitoring/alerts/auth-availability.yml', 'utf8');

  assert.match(rules, /auth-no-login-path-after-deploy/);
  assert.match(rules, /immediate_after_deploy/);
  assert.match(rules, /auth_callback_failures_10m >= 5/);
  assert.match(rules, /auth_callback_failure_rate_10m > 0\.25 AND auth_callback_attempts_10m >= 10/);
  assert.doesNotMatch(rules, /token|authorization_code|client_secret/i);
});
