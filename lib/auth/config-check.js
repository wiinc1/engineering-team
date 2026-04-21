const REQUIRED_BROWSER_OIDC_VARS = [
  'VITE_OIDC_DISCOVERY_URL',
  'VITE_OIDC_CLIENT_ID',
];

const REQUIRED_PROVIDER_JWT_VARS = [
  'AUTH_JWT_ISSUER',
  'AUTH_JWT_AUDIENCE',
  'AUTH_JWT_JWKS_URL',
];

const INTERNAL_BOOTSTRAP_VARS = [
  'VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED',
  'AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP',
];

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function hasValue(env, name) {
  return String(env?.[name] || '').trim().length > 0;
}

function buildAuthDiagnostics(env = process.env) {
  const browserOidcConfigured = REQUIRED_BROWSER_OIDC_VARS.every((name) => hasValue(env, name));
  const providerJwtVerifierConfigured = REQUIRED_PROVIDER_JWT_VARS.every((name) => hasValue(env, name));
  const internalBootstrapEnabled = INTERNAL_BOOTSTRAP_VARS.some((name) => isTruthy(env?.[name]));

  return {
    generatedAt: new Date().toISOString(),
    browserOidcConfigured,
    providerJwtVerifierConfigured,
    internalBootstrapEnabled,
    requiredBrowserOidcVarsPresent: Object.fromEntries(REQUIRED_BROWSER_OIDC_VARS.map((name) => [name, hasValue(env, name)])),
    requiredProviderJwtVarsPresent: Object.fromEntries(REQUIRED_PROVIDER_JWT_VARS.map((name) => [name, hasValue(env, name)])),
    internalBootstrapVarsEnabled: Object.fromEntries(INTERNAL_BOOTSTRAP_VARS.map((name) => [name, isTruthy(env?.[name])])),
  };
}

function validateAuthConfig({ env = process.env, target = 'production', requireProviderJwt = true } = {}) {
  const diagnostics = buildAuthDiagnostics(env);
  const missing = [];
  const errors = [];
  const normalizedTarget = String(target || 'production').toLowerCase();
  const isProduction = normalizedTarget === 'production';

  if (isProduction) {
    for (const name of REQUIRED_BROWSER_OIDC_VARS) {
      if (!hasValue(env, name)) missing.push(name);
    }
    if (requireProviderJwt) {
      for (const name of REQUIRED_PROVIDER_JWT_VARS) {
        if (!hasValue(env, name)) missing.push(name);
      }
    }
    for (const name of INTERNAL_BOOTSTRAP_VARS) {
      if (isTruthy(env?.[name])) {
        errors.push(`${name} must be false or unset for production OIDC-only deployments`);
      }
    }
  }

  return {
    ok: missing.length === 0 && errors.length === 0,
    target: normalizedTarget,
    missing,
    errors,
    diagnostics,
  };
}

function extractVercelEnvNames(payload) {
  const parsed = typeof payload === 'string' ? JSON.parse(payload || '[]') : payload;
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.envs)
      ? parsed.envs
      : Array.isArray(parsed?.env)
        ? parsed.env
        : [];

  return new Set(items.map((item) => {
    if (typeof item === 'string') return item;
    return item?.key || item?.name || item?.target || '';
  }).filter(Boolean));
}

function validateVercelEnvNames(names) {
  const available = names instanceof Set ? names : new Set(names || []);
  const required = [...REQUIRED_BROWSER_OIDC_VARS, ...REQUIRED_PROVIDER_JWT_VARS];
  const missing = required.filter((name) => !available.has(name));
  const enabledInternalBootstrapVars = INTERNAL_BOOTSTRAP_VARS.filter((name) => available.has(name));

  return {
    ok: missing.length === 0,
    missing,
    present: Object.fromEntries(required.map((name) => [name, available.has(name)])),
    internalBootstrapVarsDeclared: Object.fromEntries(INTERNAL_BOOTSTRAP_VARS.map((name) => [name, available.has(name)])),
    warnings: enabledInternalBootstrapVars.map((name) => `${name} is declared in production; verify its value is false without exposing the value`),
  };
}

module.exports = {
  INTERNAL_BOOTSTRAP_VARS,
  REQUIRED_BROWSER_OIDC_VARS,
  REQUIRED_PROVIDER_JWT_VARS,
  buildAuthDiagnostics,
  extractVercelEnvNames,
  validateAuthConfig,
  validateVercelEnvNames,
};
