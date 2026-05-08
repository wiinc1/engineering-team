const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildAuthDiagnostics,
  extractVercelEnvNames,
  validateAuthConfig,
  validateVercelEnvNames,
} = require('../../lib/auth/config-check');

function completeRegistrationEnv(overrides = {}) {
  return {
    DATABASE_URL: 'postgres://example',
    AUTH_PRODUCTION_AUTH_STRATEGY: 'registration',
    VITE_AUTH_PRODUCTION_AUTH_STRATEGY: 'registration',
    AUTH_SESSION_SECRET: 'session-secret',
    AUTH_EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 'resend-secret',
    AUTH_EMAIL_FROM: 'Workflow <noreply@example.com>',
    AUTH_PUBLIC_APP_URL: 'https://app.example',
    AUTH_REGISTRATION_MODE: 'admin-approved',
    AUTH_REGISTRATION_DEFAULT_TENANT: 'tenant-int',
    AUTH_SESSION_TTL_HOURS: '8',
    AUTH_EMAIL_VERIFICATION_TTL_HOURS: '24',
    AUTH_PASSWORD_RESET_TTL_MINUTES: '30',
    AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP: 'false',
    VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED: 'false',
    ...overrides,
  };
}

test('production auth config defaults to registration and fails closed without required variables', () => {
  const result = validateAuthConfig({ env: {}, target: 'production' });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.productionAuthStrategy, 'registration');
  assert.ok(result.missing.includes('DATABASE_URL'));
  assert.ok(result.missing.includes('AUTH_SESSION_SECRET'));
  assert.ok(result.missing.includes('AUTH_REGISTRATION_MODE'));
});

test('production auth config allows complete registration strategy', () => {
  const result = validateAuthConfig({ env: completeRegistrationEnv(), target: 'production' });

  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.diagnostics.productionAuthStrategy, 'registration');
  assert.equal(result.diagnostics.registrationConfigured, true);
  assert.equal(result.diagnostics.registrationProductionRulesSatisfied.passwordResetTtlMinutes30, true);
  assert.equal(JSON.stringify(result.diagnostics).includes('resend-secret'), false);
  assert.equal(JSON.stringify(result.diagnostics).includes('session-secret'), false);
});

test('production registration strategy accepts documented runtime strategy evidence', () => {
  const env = completeRegistrationEnv({
    VITE_AUTH_PRODUCTION_AUTH_STRATEGY: '',
    AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY: 'registration',
  });

  const result = validateAuthConfig({ env, target: 'production' });

  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.diagnostics.browserRegistrationStrategyConfigured, true);
});

test('production registration strategy enforces https, mode, exact TTLs, and internal flag removal', () => {
  const result = validateAuthConfig({
    env: completeRegistrationEnv({
      AUTH_PUBLIC_APP_URL: 'http://app.example',
      AUTH_REGISTRATION_MODE: 'open',
      AUTH_SESSION_TTL_HOURS: '24',
      AUTH_EMAIL_VERIFICATION_TTL_HOURS: '1',
      AUTH_PASSWORD_RESET_TTL_MINUTES: '60',
      AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP: 'true',
    }),
    target: 'production',
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /AUTH_PUBLIC_APP_URL must be an https URL/);
  assert.match(result.errors.join('\n'), /AUTH_REGISTRATION_MODE must be "admin-approved"/);
  assert.match(result.errors.join('\n'), /AUTH_SESSION_TTL_HOURS must be exactly 8/);
  assert.match(result.errors.join('\n'), /AUTH_EMAIL_VERIFICATION_TTL_HOURS must be exactly 24/);
  assert.match(result.errors.join('\n'), /AUTH_PASSWORD_RESET_TTL_MINUTES must be exactly 30/);
  assert.match(result.errors.join('\n'), /AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP must be false/);
});

test('production auth config rejects removed magic-link strategy', () => {
  const result = validateAuthConfig({
    env: {
      AUTH_PRODUCTION_AUTH_STRATEGY: 'magic-link',
      VITE_AUTH_PRODUCTION_AUTH_STRATEGY: 'magic-link',
    },
    target: 'production',
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /magic-link.*removed/);
  assert.equal(result.diagnostics.magicLinkRemoved, false);
});

test('production auth config keeps explicit internal bootstrap strategy for emergency rollback only', () => {
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

test('production OIDC config remains valid when selected explicitly', () => {
  const env = {
    AUTH_PRODUCTION_AUTH_STRATEGY: 'oidc',
    VITE_OIDC_DISCOVERY_URL: 'https://idp.example/.well-known/openid-configuration',
    VITE_OIDC_CLIENT_ID: 'browser-client',
    AUTH_JWT_ISSUER: 'https://idp.example',
    AUTH_JWT_AUDIENCE: 'engineering-team',
    AUTH_JWT_JWKS_URL: 'https://idp.example/.well-known/jwks.json',
  };

  const result = validateAuthConfig({ env, target: 'production' });

  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('development auth config passes with explicitly enabled internal fallback', () => {
  const result = validateAuthConfig({
    env: { VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED: 'true' },
    target: 'development',
  });

  assert.equal(result.ok, true);
});

test('diagnostics artifact model contains booleans and missing names only', () => {
  const diagnostics = buildAuthDiagnostics(completeRegistrationEnv());
  const serialized = JSON.stringify(diagnostics);

  assert.equal(diagnostics.registrationConfigured, true);
  assert.equal(diagnostics.productionAuthStrategy, 'registration');
  assert.equal(serialized.includes('https://app.example'), false);
  assert.equal(serialized.includes('resend-secret'), false);
});

test('Vercel env-name validation parses name-only CLI JSON and accepts registration names', () => {
  const names = extractVercelEnvNames(
    JSON.stringify(Object.keys(completeRegistrationEnv()).map((key) => ({ key })))
  );

  const result = validateVercelEnvNames(names);

  assert.equal(result.ok, true);
  assert.deepEqual(result.registrationMissing, []);
  assert.equal(result.registrationPresent.AUTH_SESSION_SECRET, true);
});

test('Vercel env-name validation reports missing names without values', () => {
  const result = validateVercelEnvNames(new Set(['DATABASE_URL']));

  assert.equal(result.ok, false);
  assert.ok(result.registrationMissing.includes('AUTH_SESSION_SECRET'));
  assert.ok(result.oidcMissing.includes('VITE_OIDC_CLIENT_ID'));
  assert.ok(result.internalBootstrapMissing.includes('AUTH_JWT_SECRET'));
});
