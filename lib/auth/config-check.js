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

const REQUIRED_INTERNAL_BOOTSTRAP_VARS = [
  'AUTH_PRODUCTION_AUTH_STRATEGY',
  'AUTH_JWT_SECRET',
  'VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED',
  'AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP',
];

const REQUIRED_MAGIC_LINK_VARS = [
  'DATABASE_URL',
  'AUTH_PRODUCTION_AUTH_STRATEGY',
  'AUTH_SESSION_SECRET',
  'AUTH_EMAIL_PROVIDER',
  'RESEND_API_KEY',
  'AUTH_EMAIL_FROM',
  'AUTH_PUBLIC_APP_URL',
  'AUTH_MAGIC_LINK_TTL_MINUTES',
  'AUTH_SESSION_TTL_HOURS',
];

const BROWSER_MAGIC_LINK_STRATEGY_VARS = [
  'VITE_AUTH_PRODUCTION_AUTH_STRATEGY',
  'AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY',
];

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function hasValue(env, name) {
  return String(env?.[name] || '').trim().length > 0;
}

function normalizedValue(env, name) {
  return String(env?.[name] || '').trim().toLowerCase();
}

function isExactNumericValue(env, name, expected) {
  const value = String(env?.[name] || '').trim();
  return /^(0|[1-9]\d*)$/.test(value) && Number(value) === expected;
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value || '').trim()).protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

function hasBrowserMagicLinkStrategy(env) {
  return BROWSER_MAGIC_LINK_STRATEGY_VARS.some((name) => normalizedValue(env, name) === 'magic-link');
}

function buildAuthDiagnostics(env = process.env) {
  const browserOidcConfigured = REQUIRED_BROWSER_OIDC_VARS.every((name) => hasValue(env, name));
  const providerJwtVerifierConfigured = REQUIRED_PROVIDER_JWT_VARS.every((name) => hasValue(env, name));
  const internalBootstrapEnabled = INTERNAL_BOOTSTRAP_VARS.some((name) => isTruthy(env?.[name]));
  const productionAuthStrategy = normalizedValue(env, 'AUTH_PRODUCTION_AUTH_STRATEGY') || 'oidc';
  const browserMagicLinkStrategyConfigured = hasBrowserMagicLinkStrategy(env);
  const internalBootstrapConfigured = REQUIRED_INTERNAL_BOOTSTRAP_VARS.every((name) => (
    name === 'AUTH_PRODUCTION_AUTH_STRATEGY'
      ? productionAuthStrategy === 'internal-bootstrap'
      : name === 'AUTH_JWT_SECRET'
        ? hasValue(env, name)
        : isTruthy(env?.[name])
  ));
  const magicLinkConfigured = REQUIRED_MAGIC_LINK_VARS.every((name) => (
    name === 'AUTH_PRODUCTION_AUTH_STRATEGY'
      ? productionAuthStrategy === 'magic-link'
      : hasValue(env, name)
  )) && browserMagicLinkStrategyConfigured
    && isHttpsUrl(env?.AUTH_PUBLIC_APP_URL)
    && isExactNumericValue(env, 'AUTH_MAGIC_LINK_TTL_MINUTES', 15)
    && isExactNumericValue(env, 'AUTH_SESSION_TTL_HOURS', 8);

  return {
    generatedAt: new Date().toISOString(),
    productionAuthStrategy,
    browserMagicLinkStrategyConfigured,
    browserOidcConfigured,
    providerJwtVerifierConfigured,
    internalBootstrapEnabled,
    internalBootstrapConfigured,
    magicLinkConfigured,
    requiredBrowserOidcVarsPresent: Object.fromEntries(REQUIRED_BROWSER_OIDC_VARS.map((name) => [name, hasValue(env, name)])),
    requiredProviderJwtVarsPresent: Object.fromEntries(REQUIRED_PROVIDER_JWT_VARS.map((name) => [name, hasValue(env, name)])),
    internalBootstrapVarsEnabled: Object.fromEntries(INTERNAL_BOOTSTRAP_VARS.map((name) => [name, isTruthy(env?.[name])])),
    requiredInternalBootstrapVarsPresent: Object.fromEntries(REQUIRED_INTERNAL_BOOTSTRAP_VARS.map((name) => [name, (
      name === 'AUTH_PRODUCTION_AUTH_STRATEGY'
        ? productionAuthStrategy === 'internal-bootstrap'
        : hasValue(env, name)
    )])),
    requiredMagicLinkVarsPresent: Object.fromEntries(REQUIRED_MAGIC_LINK_VARS.map((name) => [name, (
      name === 'AUTH_PRODUCTION_AUTH_STRATEGY'
        ? productionAuthStrategy === 'magic-link'
        : hasValue(env, name)
    )])),
    browserMagicLinkStrategyVarsPresent: Object.fromEntries(BROWSER_MAGIC_LINK_STRATEGY_VARS.map((name) => [name, hasValue(env, name)])),
    magicLinkProductionRulesSatisfied: {
      browserStrategy: browserMagicLinkStrategyConfigured,
      publicAppUrlHttps: isHttpsUrl(env?.AUTH_PUBLIC_APP_URL),
      magicLinkTtlMinutes15: isExactNumericValue(env, 'AUTH_MAGIC_LINK_TTL_MINUTES', 15),
      sessionTtlHours8: isExactNumericValue(env, 'AUTH_SESSION_TTL_HOURS', 8),
    },
  };
}

function validateAuthConfig({ env = process.env, target = 'production', requireProviderJwt = true } = {}) {
  const diagnostics = buildAuthDiagnostics(env);
  const missing = [];
  const errors = [];
  const normalizedTarget = String(target || 'production').toLowerCase();
  const isProduction = normalizedTarget === 'production';
  const strategy = diagnostics.productionAuthStrategy;

  if (isProduction) {
    if (strategy === 'internal-bootstrap') {
      for (const name of REQUIRED_INTERNAL_BOOTSTRAP_VARS) {
        if (name === 'AUTH_PRODUCTION_AUTH_STRATEGY') continue;
        if (name === 'AUTH_JWT_SECRET' && !hasValue(env, name)) missing.push(name);
        if (INTERNAL_BOOTSTRAP_VARS.includes(name) && !isTruthy(env?.[name])) missing.push(name);
      }
    } else if (strategy === 'magic-link') {
      for (const name of REQUIRED_MAGIC_LINK_VARS) {
        if (name === 'AUTH_PRODUCTION_AUTH_STRATEGY') continue;
        if (!hasValue(env, name)) missing.push(name);
      }
      if (!diagnostics.browserMagicLinkStrategyConfigured) {
        missing.push('VITE_AUTH_PRODUCTION_AUTH_STRATEGY or AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY');
      }
      if (normalizedValue(env, 'AUTH_EMAIL_PROVIDER') !== 'resend') {
        errors.push('AUTH_EMAIL_PROVIDER must be "resend" for production magic-link deployments');
      }
      if (hasValue(env, 'AUTH_PUBLIC_APP_URL') && !isHttpsUrl(env.AUTH_PUBLIC_APP_URL)) {
        errors.push('AUTH_PUBLIC_APP_URL must be an https URL for production magic-link deployments');
      }
      if (hasValue(env, 'AUTH_MAGIC_LINK_TTL_MINUTES') && !isExactNumericValue(env, 'AUTH_MAGIC_LINK_TTL_MINUTES', 15)) {
        errors.push('AUTH_MAGIC_LINK_TTL_MINUTES must be exactly 15 for production magic-link deployments');
      }
      if (hasValue(env, 'AUTH_SESSION_TTL_HOURS') && !isExactNumericValue(env, 'AUTH_SESSION_TTL_HOURS', 8)) {
        errors.push('AUTH_SESSION_TTL_HOURS must be exactly 8 for production magic-link deployments');
      }
      for (const name of INTERNAL_BOOTSTRAP_VARS) {
        if (isTruthy(env?.[name])) {
          errors.push(`${name} must be false or unset for production magic-link deployments`);
        }
      }
    } else if (strategy === 'oidc') {
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
          errors.push(`${name} must be false or unset for production OIDC deployments`);
        }
      }
    } else {
      errors.push(`AUTH_PRODUCTION_AUTH_STRATEGY must be "oidc", "internal-bootstrap", or "magic-link" for production`);
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
  const oidcRequired = [...REQUIRED_BROWSER_OIDC_VARS, ...REQUIRED_PROVIDER_JWT_VARS];
  const internalRequired = REQUIRED_INTERNAL_BOOTSTRAP_VARS;
  const magicLinkRequired = REQUIRED_MAGIC_LINK_VARS;
  const magicLinkBrowserStrategyDeclared = BROWSER_MAGIC_LINK_STRATEGY_VARS.some((name) => available.has(name));
  const oidcMissing = oidcRequired.filter((name) => !available.has(name));
  const internalMissing = internalRequired.filter((name) => !available.has(name));
  const magicLinkMissing = [
    ...magicLinkRequired.filter((name) => !available.has(name)),
    ...(magicLinkBrowserStrategyDeclared ? [] : ['VITE_AUTH_PRODUCTION_AUTH_STRATEGY or AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY']),
  ];
  const ok = oidcMissing.length === 0 || internalMissing.length === 0 || magicLinkMissing.length === 0;
  const enabledInternalBootstrapVars = INTERNAL_BOOTSTRAP_VARS.filter((name) => available.has(name));

  return {
    ok,
    missing: ok ? [] : oidcMissing,
    oidcMissing,
    internalBootstrapMissing: internalMissing,
    magicLinkMissing,
    present: Object.fromEntries(oidcRequired.map((name) => [name, available.has(name)])),
    internalBootstrapPresent: Object.fromEntries(internalRequired.map((name) => [name, available.has(name)])),
    magicLinkPresent: Object.fromEntries(magicLinkRequired.map((name) => [name, available.has(name)])),
    browserMagicLinkStrategyPresent: Object.fromEntries(BROWSER_MAGIC_LINK_STRATEGY_VARS.map((name) => [name, available.has(name)])),
    internalBootstrapVarsDeclared: Object.fromEntries(INTERNAL_BOOTSTRAP_VARS.map((name) => [name, available.has(name)])),
    warnings: enabledInternalBootstrapVars.map((name) => `${name} is declared in production; verify it is intentionally set for the selected production auth strategy without exposing the value`),
  };
}

module.exports = {
  BROWSER_MAGIC_LINK_STRATEGY_VARS,
  INTERNAL_BOOTSTRAP_VARS,
  REQUIRED_BROWSER_OIDC_VARS,
  REQUIRED_INTERNAL_BOOTSTRAP_VARS,
  REQUIRED_MAGIC_LINK_VARS,
  REQUIRED_PROVIDER_JWT_VARS,
  buildAuthDiagnostics,
  extractVercelEnvNames,
  validateAuthConfig,
  validateVercelEnvNames,
};
