function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function resolveOptionalBoolean(optionValue, envKey, envDefault) {
  if (typeof optionValue === 'boolean') return optionValue;
  return parseBooleanEnv(process.env[envKey], envDefault);
}

function resolveStagingRuntime(options = {}) {
  const baseUrl = String(
    options.baseUrl
    || process.env.STAGING_BASE_URL
    || process.env.FACTORY_STACK_BASE_URL
    || process.env.GOLDEN_PATH_BASE_URL
    || process.env.AUDIT_WORKERS_SMOKE_BASE_URL
    || process.env.FACTORY_STAGING_BASE_URL
    || process.env.FACTORY_BASE_URL
    || process.env.ENGINEERING_TEAM_BASE_URL
    || 'http://127.0.0.1:13000',
  ).trim();

  const operatorUrl = String(
    options.operatorUrl
    || process.env.STAGING_OPERATOR_URL
    || process.env.FACTORY_STAGING_OPERATOR_URL
    || process.env.FACTORY_OPERATOR_URL
    || baseUrl,
  ).trim();

  return {
    profile: options.profile || process.env.FACTORY_VERIFY_PROFILE || 'coordinated-stack',
    baseUrl,
    operatorUrl,
    tenantId: String(options.tenantId || process.env.STAGING_TENANT_ID || process.env.TENANT_ID || 'engineering-team').trim(),
    jwtSecret: options.jwtSecret
      || process.env.STAGING_AUTH_JWT_SECRET
      || process.env.AUTH_JWT_SECRET
      || process.env.GOLDEN_PATH_JWT_SECRET
      || 'golden-path-local-dev-secret',
    githubWebhookSecret: options.githubWebhookSecret
      || process.env.STAGING_GITHUB_WEBHOOK_SECRET
      || process.env.GITHUB_WEBHOOK_SECRET
      || 'golden-path-local-webhook-secret',
    forgeAdapterUrl: String(
      options.forgeAdapterUrl
      || process.env.STAGING_FORGEADAPTER_BASE_URL
      || process.env.FORGEADAPTER_BASE_URL
      || 'http://127.0.0.1:14010',
    ).trim(),
    forgeServiceToken: options.forgeServiceToken || process.env.STAGING_FORGE_SERVICE_TOKEN || process.env.FORGE_SERVICE_TOKEN || null,
    forgeAdapterToken: options.forgeAdapterToken || process.env.STAGING_FORGEADAPTER_SERVICE_TOKEN || process.env.FORGEADAPTER_SERVICE_TOKEN || null,
    openclawUrl: String(options.openclawUrl || process.env.STAGING_OPENCLAW_BASE_URL || process.env.OPENCLAW_BASE_URL || '').trim(),
    requireDelegationSmoke: resolveOptionalBoolean(
      options.requireDelegationSmoke,
      'STAGING_REQUIRE_DELEGATION_SMOKE',
      false,
    ),
    skipValidation: resolveOptionalBoolean(
      options.skipValidation,
      'STAGING_SKIP_VALIDATION',
      true,
    ),
    skipForgePhases: resolveOptionalBoolean(
      options.skipForgePhases,
      'STAGING_SKIP_FORGE_PHASES',
      true,
    ),
    skipForgeSeed: resolveOptionalBoolean(
      options.skipForgeSeed,
      'STAGING_SKIP_FORGE_SEED',
      resolveOptionalBoolean(options.skipForgePhases, 'STAGING_SKIP_FORGE_PHASES', true),
    ),
    skipPilotAgentsSeed: resolveOptionalBoolean(
      options.skipPilotAgentsSeed,
      'STAGING_SKIP_PILOT_AGENTS_SEED',
      false,
    ),
    outputDir: String(options.outputDir || process.env.STAGING_EVIDENCE_DIR || 'observability/milestone-a-staging').trim(),
  };
}

function isLocalGoldenPathBaseUrl(baseUrl = '') {
  const normalized = String(baseUrl || '').trim().toLowerCase();
  return normalized.includes('127.0.0.1:13000') || normalized.includes('localhost:13000');
}

function applyLocalGoldenPathEnvIfNeeded(runtime = {}) {
  if (!isLocalGoldenPathBaseUrl(runtime.baseUrl)) return runtime;
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = process.env.GOLDEN_PATH_DATABASE_URL
      || 'postgres://audit:audit@127.0.0.1:15432/engineering_team';
  }
  if (!process.env.PGSSLMODE) process.env.PGSSLMODE = 'disable';
  if (!process.env.AUDIT_STORE_BACKEND) process.env.AUDIT_STORE_BACKEND = 'postgres';
  if (!process.env.AUTH_JWT_SECRET && runtime.jwtSecret) {
    process.env.AUTH_JWT_SECRET = runtime.jwtSecret;
  }
  if (!process.env.FORGE_SERVICE_TOKEN) {
    process.env.FORGE_SERVICE_TOKEN = 'local-golden-path-forge-token';
  }
  if (!process.env.FORGEADAPTER_BASE_URL) {
    process.env.FORGEADAPTER_BASE_URL = 'http://127.0.0.1:14010';
  }
  if (!process.env.OPENCLAW_BASE_URL && !runtime.openclawUrl) {
    process.env.OPENCLAW_BASE_URL = 'http://127.0.0.1:14001';
    runtime.openclawUrl = process.env.OPENCLAW_BASE_URL;
  }
  return runtime;
}

function assertStagingRuntimeReady(runtime, { requireJwt = true, requireBaseUrl = true } = {}) {
  const missing = [];
  if (requireBaseUrl && !String(runtime.baseUrl || '').trim()) {
    missing.push('FACTORY_STACK_BASE_URL or GOLDEN_PATH_BASE_URL');
  }
  if (requireJwt && !runtime.jwtSecret) missing.push('AUTH_JWT_SECRET or GOLDEN_PATH_JWT_SECRET');
  if (missing.length) {
    throw new Error(`Staging runtime missing required env: ${missing.join(', ')}`);
  }
  return runtime;
}

module.exports = {
  parseBooleanEnv,
  isLocalGoldenPathBaseUrl,
  applyLocalGoldenPathEnvIfNeeded,
  resolveStagingRuntime,
  assertStagingRuntimeReady,
};