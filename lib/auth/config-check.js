const REQUIRED_BROWSER_OIDC_VARS = ['VITE_OIDC_DISCOVERY_URL', 'VITE_OIDC_CLIENT_ID'];
const REQUIRED_PROVIDER_JWT_VARS = ['AUTH_JWT_ISSUER', 'AUTH_JWT_AUDIENCE', 'AUTH_JWT_JWKS_URL'];
const INTERNAL_BOOTSTRAP_VARS = ['VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED', 'AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP'];
const REQUIRED_INTERNAL_BOOTSTRAP_VARS = [
  'AUTH_PRODUCTION_AUTH_STRATEGY',
  'AUTH_JWT_SECRET',
  'VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED',
  'AUTH_ENABLE_INTERNAL_BROWSER_BOOTSTRAP',
];
const REQUIRED_REGISTRATION_VARS = [
  'DATABASE_URL',
  'AUTH_PRODUCTION_AUTH_STRATEGY',
  'AUTH_SESSION_SECRET',
  'AUTH_EMAIL_PROVIDER',
  'RESEND_API_KEY',
  'AUTH_EMAIL_FROM',
  'AUTH_PUBLIC_APP_URL',
  'AUTH_REGISTRATION_MODE',
  'AUTH_REGISTRATION_DEFAULT_TENANT',
  'AUTH_SESSION_TTL_HOURS',
  'AUTH_EMAIL_VERIFICATION_TTL_HOURS',
  'AUTH_PASSWORD_RESET_TTL_MINUTES',
];
const BROWSER_REGISTRATION_STRATEGY_VARS = [
  'VITE_AUTH_PRODUCTION_AUTH_STRATEGY',
  'AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY',
];
const REMOVED_MAGIC_LINK_VARS = [
  'AUTH_MAGIC_LINK_TTL_MINUTES',
  'AUTH_PROD_MAGIC_LINK_URL',
  'VITE_AUTH_PRODUCTION_AUTH_STRATEGY',
  'AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY',
];
const REGISTRATION_MODES = ['open', 'invite-only', 'admin-approved'];

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
  } catch {
    return false;
  }
}

function browserStrategyConfigured(env, strategy) {
  return BROWSER_REGISTRATION_STRATEGY_VARS.some((name) => normalizedValue(env, name) === strategy);
}

function registrationModeValid(env) {
  return REGISTRATION_MODES.includes(normalizedValue(env, 'AUTH_REGISTRATION_MODE'));
}

function registrationModeAdminApproved(env) {
  return normalizedValue(env, 'AUTH_REGISTRATION_MODE') === 'admin-approved';
}

function requiredRegistrationVarPresent(env, productionAuthStrategy, name) {
  return name === 'AUTH_PRODUCTION_AUTH_STRATEGY'
    ? productionAuthStrategy === 'registration'
    : hasValue(env, name);
}

function requiredInternalBootstrapVarPresent(env, productionAuthStrategy, name) {
  if (name === 'AUTH_PRODUCTION_AUTH_STRATEGY') return productionAuthStrategy === 'internal-bootstrap';
  if (name === 'AUTH_JWT_SECRET') return hasValue(env, name);
  return isTruthy(env?.[name]);
}

function buildRequiredVarPresence(env, names, predicate) {
  return Object.fromEntries(names.map((name) => [name, predicate(name)]));
}

function isRegistrationConfigured(env, productionAuthStrategy, browserRegistrationStrategyConfigured) {
  return (
    REQUIRED_REGISTRATION_VARS.every((name) =>
      requiredRegistrationVarPresent(env, productionAuthStrategy, name)
    ) &&
    browserRegistrationStrategyConfigured &&
    normalizedValue(env, 'AUTH_EMAIL_PROVIDER') === 'resend' &&
    isHttpsUrl(env?.AUTH_PUBLIC_APP_URL) &&
    registrationModeAdminApproved(env) &&
    isExactNumericValue(env, 'AUTH_SESSION_TTL_HOURS', 8) &&
    isExactNumericValue(env, 'AUTH_EMAIL_VERIFICATION_TTL_HOURS', 24) &&
    isExactNumericValue(env, 'AUTH_PASSWORD_RESET_TTL_MINUTES', 30)
  );
}

function buildRegistrationProductionRules(env, browserRegistrationStrategyConfigured) {
  return {
    browserStrategy: browserRegistrationStrategyConfigured,
    publicAppUrlHttps: isHttpsUrl(env?.AUTH_PUBLIC_APP_URL),
    registrationModeValid: registrationModeValid(env),
    registrationModeAdminApproved: registrationModeAdminApproved(env),
    emailProviderResend: normalizedValue(env, 'AUTH_EMAIL_PROVIDER') === 'resend',
    sessionTtlHours8: isExactNumericValue(env, 'AUTH_SESSION_TTL_HOURS', 8),
    emailVerificationTtlHours24: isExactNumericValue(env, 'AUTH_EMAIL_VERIFICATION_TTL_HOURS', 24),
    passwordResetTtlMinutes30: isExactNumericValue(env, 'AUTH_PASSWORD_RESET_TTL_MINUTES', 30),
  };
}

function buildAuthDiagnostics(env = process.env) {
  const browserOidcConfigured = REQUIRED_BROWSER_OIDC_VARS.every((name) => hasValue(env, name));
  const providerJwtVerifierConfigured = REQUIRED_PROVIDER_JWT_VARS.every((name) => hasValue(env, name));
  const internalBootstrapEnabled = INTERNAL_BOOTSTRAP_VARS.some((name) => isTruthy(env?.[name]));
  const productionAuthStrategy = normalizedValue(env, 'AUTH_PRODUCTION_AUTH_STRATEGY') || 'registration';
  const browserRegistrationStrategyConfigured = browserStrategyConfigured(env, 'registration');
  const internalBootstrapConfigured = REQUIRED_INTERNAL_BOOTSTRAP_VARS.every((name) =>
    requiredInternalBootstrapVarPresent(env, productionAuthStrategy, name)
  );
  const registrationConfigured = isRegistrationConfigured(
    env,
    productionAuthStrategy,
    browserRegistrationStrategyConfigured
  );

  return {
    generatedAt: new Date().toISOString(),
    productionAuthStrategy,
    browserOidcConfigured,
    providerJwtVerifierConfigured,
    internalBootstrapEnabled,
    internalBootstrapConfigured,
    browserRegistrationStrategyConfigured,
    registrationConfigured,
    magicLinkRemoved: productionAuthStrategy !== 'magic-link',
    requiredBrowserOidcVarsPresent: buildRequiredVarPresence(env, REQUIRED_BROWSER_OIDC_VARS, (name) =>
      hasValue(env, name)
    ),
    requiredProviderJwtVarsPresent: buildRequiredVarPresence(env, REQUIRED_PROVIDER_JWT_VARS, (name) =>
      hasValue(env, name)
    ),
    internalBootstrapVarsEnabled: buildRequiredVarPresence(env, INTERNAL_BOOTSTRAP_VARS, (name) =>
      isTruthy(env?.[name])
    ),
    requiredInternalBootstrapVarsPresent: buildRequiredVarPresence(env, REQUIRED_INTERNAL_BOOTSTRAP_VARS, (name) =>
      requiredInternalBootstrapVarPresent(env, productionAuthStrategy, name)
    ),
    requiredRegistrationVarsPresent: buildRequiredVarPresence(env, REQUIRED_REGISTRATION_VARS, (name) =>
      requiredRegistrationVarPresent(env, productionAuthStrategy, name)
    ),
    browserRegistrationStrategyVarsPresent: buildRequiredVarPresence(env, BROWSER_REGISTRATION_STRATEGY_VARS, (name) =>
      hasValue(env, name)
    ),
    registrationProductionRulesSatisfied: buildRegistrationProductionRules(
      env,
      browserRegistrationStrategyConfigured
    ),
  };
}

function validateRegistrationProduction(env, missing, errors) {
  for (const name of REQUIRED_REGISTRATION_VARS) {
    if (name === 'AUTH_PRODUCTION_AUTH_STRATEGY') {
      if (normalizedValue(env, name) !== 'registration') missing.push(name);
    } else if (!hasValue(env, name)) {
      missing.push(name);
    }
  }
  if (!browserStrategyConfigured(env, 'registration')) {
    missing.push('VITE_AUTH_PRODUCTION_AUTH_STRATEGY or AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY');
  }
  if (hasValue(env, 'AUTH_EMAIL_PROVIDER') && normalizedValue(env, 'AUTH_EMAIL_PROVIDER') !== 'resend') {
    errors.push('AUTH_EMAIL_PROVIDER must be "resend" for production registration deployments');
  }
  if (hasValue(env, 'AUTH_PUBLIC_APP_URL') && !isHttpsUrl(env.AUTH_PUBLIC_APP_URL)) {
    errors.push('AUTH_PUBLIC_APP_URL must be an https URL for production registration deployments');
  }
  if (hasValue(env, 'AUTH_REGISTRATION_MODE') && !registrationModeValid(env)) {
    errors.push('AUTH_REGISTRATION_MODE must be "open", "invite-only", or "admin-approved"');
  } else if (hasValue(env, 'AUTH_REGISTRATION_MODE') && !registrationModeAdminApproved(env)) {
    errors.push('AUTH_REGISTRATION_MODE must be "admin-approved" for production registration deployments');
  }
  if (hasValue(env, 'AUTH_SESSION_TTL_HOURS') && !isExactNumericValue(env, 'AUTH_SESSION_TTL_HOURS', 8)) {
    errors.push('AUTH_SESSION_TTL_HOURS must be exactly 8 for production registration deployments');
  }
  if (
    hasValue(env, 'AUTH_EMAIL_VERIFICATION_TTL_HOURS') &&
    !isExactNumericValue(env, 'AUTH_EMAIL_VERIFICATION_TTL_HOURS', 24)
  ) {
    errors.push('AUTH_EMAIL_VERIFICATION_TTL_HOURS must be exactly 24 for production registration deployments');
  }
  if (hasValue(env, 'AUTH_PASSWORD_RESET_TTL_MINUTES') && !isExactNumericValue(env, 'AUTH_PASSWORD_RESET_TTL_MINUTES', 30)) {
    errors.push('AUTH_PASSWORD_RESET_TTL_MINUTES must be exactly 30 for production registration deployments');
  }
  for (const name of INTERNAL_BOOTSTRAP_VARS) {
    if (isTruthy(env?.[name])) errors.push(`${name} must be false or unset for production registration deployments`);
  }
  if (normalizedValue(env, 'AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY') === 'magic-link') {
    errors.push('Browser runtime auth strategy must not be "magic-link"; registration is the cutover strategy');
  }
}

function validateAuthConfig({ env = process.env, target = 'production', requireProviderJwt = true } = {}) {
  const diagnostics = buildAuthDiagnostics(env);
  const missing = [];
  const errors = [];
  const normalizedTarget = String(target || 'production').toLowerCase();
  const production = normalizedTarget === 'production';
  const strategy = diagnostics.productionAuthStrategy;

  if (production) {
    if (strategy === 'registration') {
      validateRegistrationProduction(env, missing, errors);
    } else if (strategy === 'internal-bootstrap') {
      for (const name of REQUIRED_INTERNAL_BOOTSTRAP_VARS) {
        if (name !== 'AUTH_PRODUCTION_AUTH_STRATEGY' && name === 'AUTH_JWT_SECRET' && !hasValue(env, name)) missing.push(name);
        if (INTERNAL_BOOTSTRAP_VARS.includes(name) && !isTruthy(env?.[name])) missing.push(name);
      }
    } else if (strategy === 'oidc') {
      for (const name of REQUIRED_BROWSER_OIDC_VARS) if (!hasValue(env, name)) missing.push(name);
      if (requireProviderJwt) {
        for (const name of REQUIRED_PROVIDER_JWT_VARS) if (!hasValue(env, name)) missing.push(name);
      }
      for (const name of INTERNAL_BOOTSTRAP_VARS) {
        if (isTruthy(env?.[name])) errors.push(`${name} must be false or unset for production OIDC deployments`);
      }
    } else if (strategy === 'magic-link') {
      errors.push('AUTH_PRODUCTION_AUTH_STRATEGY="magic-link" has been removed; use "registration" for production');
    } else {
      errors.push('AUTH_PRODUCTION_AUTH_STRATEGY must be "registration", "oidc", or "internal-bootstrap" for production');
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

function extractVercelEnvNames(input) {
  const parsed = typeof input === 'string' ? JSON.parse(input || '[]') : input;
  const envs = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.envs)
      ? parsed.envs
      : Array.isArray(parsed?.env)
        ? parsed.env
        : [];
  return new Set(envs.map((item) => (typeof item === 'string' ? item : item?.key || item?.name || item?.target || '')).filter(Boolean));
}

function validateVercelEnvNames(input) {
  const names = input instanceof Set ? input : new Set(input || []);
  const oidcNames = [...REQUIRED_BROWSER_OIDC_VARS, ...REQUIRED_PROVIDER_JWT_VARS];
  const registrationMissing = REQUIRED_REGISTRATION_VARS.filter((name) => !names.has(name));
  const runtimeRegistrationPresent = BROWSER_REGISTRATION_STRATEGY_VARS.some((name) => names.has(name));
  const oidcMissing = oidcNames.filter((name) => !names.has(name));
  const internalBootstrapMissing = REQUIRED_INTERNAL_BOOTSTRAP_VARS.filter((name) => !names.has(name));
  const registrationNameMissing = [
    ...registrationMissing,
    ...(runtimeRegistrationPresent ? [] : ['VITE_AUTH_PRODUCTION_AUTH_STRATEGY or AUTH_BROWSER_RUNTIME_PRODUCTION_AUTH_STRATEGY']),
  ];
  const ok = oidcMissing.length === 0 || internalBootstrapMissing.length === 0 || registrationNameMissing.length === 0;
  const bootstrapDeclarations = INTERNAL_BOOTSTRAP_VARS.filter((name) => names.has(name));

  return {
    ok,
    missing: ok ? [] : oidcMissing,
    oidcMissing,
    internalBootstrapMissing,
    registrationMissing: registrationNameMissing,
    present: Object.fromEntries(oidcNames.map((name) => [name, names.has(name)])),
    internalBootstrapPresent: Object.fromEntries(REQUIRED_INTERNAL_BOOTSTRAP_VARS.map((name) => [name, names.has(name)])),
    registrationPresent: Object.fromEntries(REQUIRED_REGISTRATION_VARS.map((name) => [name, names.has(name)])),
    browserRegistrationStrategyPresent: Object.fromEntries(BROWSER_REGISTRATION_STRATEGY_VARS.map((name) => [name, names.has(name)])),
    internalBootstrapVarsDeclared: Object.fromEntries(INTERNAL_BOOTSTRAP_VARS.map((name) => [name, names.has(name)])),
    warnings: bootstrapDeclarations.map(
      (name) => `${name} is declared in production; verify it is intentionally set for the selected production auth strategy without exposing the value`
    ),
  };
}

module.exports = {
  BROWSER_REGISTRATION_STRATEGY_VARS,
  INTERNAL_BOOTSTRAP_VARS,
  REGISTRATION_MODES,
  REMOVED_MAGIC_LINK_VARS,
  REQUIRED_BROWSER_OIDC_VARS,
  REQUIRED_INTERNAL_BOOTSTRAP_VARS,
  REQUIRED_PROVIDER_JWT_VARS,
  REQUIRED_REGISTRATION_VARS,
  buildAuthDiagnostics,
  extractVercelEnvNames,
  validateAuthConfig,
  validateVercelEnvNames,
};
