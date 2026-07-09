const {
  resolveFactoryQueueConfig,
  resolveFactoryRealEvidenceConfig,
} = require('./factory-delivery-shared');

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function resolveOptionalBoolean(optionValue, envKey, envDefault) {
  if (typeof optionValue === 'boolean') return optionValue;
  return parseBooleanEnv(process.env[envKey], envDefault);
}

function resolveBaseUrl(options = {}) {
  return String(
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
}

function resolveOperatorUrl(options = {}, baseUrl) {
  return String(
    options.operatorUrl
    || process.env.STAGING_OPERATOR_URL
    || process.env.FACTORY_STAGING_OPERATOR_URL
    || process.env.FACTORY_OPERATOR_URL
    || baseUrl,
  ).trim();
}

function resolveStagingSecrets(options = {}) {
  return {
    jwtSecret: options.jwtSecret || process.env.STAGING_AUTH_JWT_SECRET || process.env.AUTH_JWT_SECRET || process.env.GOLDEN_PATH_JWT_SECRET || 'golden-path-local-dev-secret',
    githubWebhookSecret: options.githubWebhookSecret || process.env.STAGING_GITHUB_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET || 'golden-path-local-webhook-secret',
    gitlabWebhookSecret: options.gitlabWebhookSecret || process.env.STAGING_GITLAB_WEBHOOK_SECRET || process.env.GITLAB_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET || 'golden-path-local-webhook-secret',
  };
}

function resolveForgeIntakeRuntime(options = {}) {
  return {
    forgeIntakeProvider: options.forgeIntakeProvider || options.intakeProvider || process.env.FORGE_INTAKE_PROVIDER || process.env.STAGING_FORGE_INTAKE_PROVIDER || 'gitlab',
    gitlabBaseUrl: String(options.gitlabBaseUrl || process.env.GITLAB_BASE_URL || process.env.GITLAB_INTAKE_BASE_URL || 'http://192.168.1.116').trim(),
    gitlabProjectPath: String(options.gitlabProjectPath || process.env.GITLAB_INTAKE_PROJECT || process.env.GITLAB_PROJECT_PATH || 'wiinc1/engineering-team').trim(),
  };
}

function resolveForgeExecutionRuntime(options = {}) {
  return {
    forgeAdapterUrl: String(options.forgeAdapterUrl || process.env.STAGING_FORGEADAPTER_BASE_URL || process.env.FORGEADAPTER_BASE_URL || 'http://127.0.0.1:14010').trim(),
    forgeServiceToken: options.forgeServiceToken || process.env.STAGING_FORGE_SERVICE_TOKEN || process.env.FORGE_SERVICE_TOKEN || null,
    forgeAdapterToken: options.forgeAdapterToken || process.env.STAGING_FORGEADAPTER_SERVICE_TOKEN || process.env.FORGEADAPTER_SERVICE_TOKEN || null,
    openclawUrl: String(options.openclawUrl || process.env.STAGING_OPENCLAW_BASE_URL || process.env.OPENCLAW_BASE_URL || '').trim(),
  };
}

function resolveStagingSkipFlags(options = {}) {
  const skipForgePhases = resolveOptionalBoolean(options.skipForgePhases, 'STAGING_SKIP_FORGE_PHASES', true);
  return {
    requireDelegationSmoke: resolveOptionalBoolean(options.requireDelegationSmoke, 'STAGING_REQUIRE_DELEGATION_SMOKE', false),
    skipValidation: resolveOptionalBoolean(options.skipValidation, 'STAGING_SKIP_VALIDATION', false),
    skipForgePhases,
    skipForgeSeed: resolveOptionalBoolean(options.skipForgeSeed, 'STAGING_SKIP_FORGE_SEED', skipForgePhases),
    skipPilotAgentsSeed: resolveOptionalBoolean(options.skipPilotAgentsSeed, 'STAGING_SKIP_PILOT_AGENTS_SEED', false),
  };
}

function resolveStagingRuntime(options = {}) {
  const baseUrl = resolveBaseUrl(options);
  const operatorUrl = resolveOperatorUrl(options, baseUrl);
  const useVersionedTaskApi = typeof options.useVersionedTaskApi === 'boolean'
    ? options.useVersionedTaskApi
    : !isLocalGoldenPathBaseUrl(baseUrl);
  const queueConfig = resolveFactoryQueueConfig(options);
  const realEvidenceConfig = resolveFactoryRealEvidenceConfig(options);

  return {
    profile: options.profile
      || process.env.FACTORY_VERIFY_PROFILE
      || (useVersionedTaskApi ? 'hosted-staging' : 'coordinated-stack'),
    baseUrl,
    operatorUrl,
    useVersionedTaskApi,
    tenantId: String(options.tenantId || process.env.STAGING_TENANT_ID || process.env.TENANT_ID || 'engineering-team').trim(),
    ...resolveStagingSecrets(options),
    ...resolveForgeIntakeRuntime(options),
    ...resolveForgeExecutionRuntime(options),
    ...resolveStagingSkipFlags(options),
    ...queueConfig,
    ...realEvidenceConfig,
    releaseEnv: options.releaseEnv || process.env.RELEASE_ENV || null,
    changeKind: options.changeKind || process.env.CHANGE_KIND || null,
    changeReversibility: options.changeReversibility || process.env.CHANGE_REVERSIBILITY || null,
      changedFiles: options.changedFiles || null,
      checks: options.checks || null,
      requiredChecks: options.requiredChecks || null,
      branchProtection: options.branchProtection || null,
      mergeReadiness: options.mergeReadiness || null,
      githubEvidenceSource: options.githubEvidenceSource || options.evidenceSource || null,
      outputDir: String(options.outputDir || process.env.STAGING_EVIDENCE_DIR || 'observability/milestone-a-staging').trim(),
    };
}

function isLocalGoldenPathBaseUrl(baseUrl = '') {
  const normalized = String(baseUrl || '').trim().toLowerCase();
  return normalized.includes('127.0.0.1:13000') || normalized.includes('localhost:13000');
}

function applyLocalGoldenPathEnvIfNeeded(runtime = {}) {
  if (!isLocalGoldenPathBaseUrl(runtime.baseUrl)) return runtime;
  runtime.jwtSecret = process.env.GOLDEN_PATH_JWT_SECRET
    || process.env.STAGING_AUTH_JWT_SECRET
    || 'golden-path-local-dev-secret';
  process.env.AUTH_JWT_SECRET = runtime.jwtSecret;
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = process.env.GOLDEN_PATH_DATABASE_URL
      || 'postgres://audit:audit@127.0.0.1:15432/engineering_team';
  }
  if (!process.env.PGSSLMODE) process.env.PGSSLMODE = 'disable';
  if (!process.env.AUDIT_STORE_BACKEND) process.env.AUDIT_STORE_BACKEND = 'postgres';
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
