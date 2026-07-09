function normalizeBackend(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'postgres' || normalized === 'file' ? normalized : normalized;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function resolveAuditBackend(options = {}) {
  const explicitBackend = normalizeBackend(options.backend || process.env.AUDIT_STORE_BACKEND);
  if (explicitBackend) return explicitBackend;
  if (options.pool || options.connectionString || process.env.DATABASE_URL) return 'postgres';
  return 'file';
}

function resolveRuntimeAuditBackend(options = {}) {
  const explicitBackend = normalizeBackend(options.backend || process.env.AUDIT_STORE_BACKEND);
  if (explicitBackend) return explicitBackend;
  if (options.pool || options.connectionString || process.env.DATABASE_URL) return 'postgres';
  return 'postgres';
}

function isLocalLikeEnvironment(options = {}) {
  const runtime = String(options.runtimeEnv || process.env.NODE_ENV || '').toLowerCase();
  if (!runtime) return true;
  return ['development', 'dev', 'test', 'local'].includes(runtime);
}

function isFileBackendExplicitlyAllowed(options = {}) {
  return options.allowFileBackend === true ||
    normalizeBoolean(options.allowFileBackend, false) ||
    normalizeBoolean(process.env.ALLOW_FILE_AUDIT_BACKEND, false) ||
    normalizeBoolean(process.env.TASK_PLATFORM_ALLOW_FILE_BACKEND, false);
}

function assertAuditBackendConfiguration(options = {}) {
  const backend = options.runtimeGuard === false
    ? resolveAuditBackend(options)
    : resolveRuntimeAuditBackend(options);
  const connectionString = options.connectionString || process.env.DATABASE_URL;

  if (backend === 'postgres' && !connectionString && !options.pool) {
    throw new Error('DATABASE_URL is required when AUDIT_STORE_BACKEND=postgres. Use the operator-hosted Postgres connection string for the coordinated factory stack.');
  }

  if (backend === 'file' && !isLocalLikeEnvironment(options)) {
    throw new Error('File audit backend is restricted to local development/test. Production must use operator-hosted Postgres (set DATABASE_URL or AUDIT_STORE_BACKEND=postgres). Cloud Supabase is not part of the factory stack.');
  }

  if (backend === 'file' && !isFileBackendExplicitlyAllowed(options)) {
    throw new Error('File audit backend requires an explicit local/test fallback opt-in. Set ALLOW_FILE_AUDIT_BACKEND=true only for isolated development or test harnesses.');
  }

  return {
    backend,
    connectionString,
    fallbackWarning: backend === 'file'
      ? {
          code: 'file_backend_fallback',
          message: 'File audit backend is enabled for an isolated local/test fallback. Production and staging must use Postgres.',
          remediation: 'Start Dockerized Postgres with npm run dev:postgres:up and set DATABASE_URL, or remove the fallback flag.',
        }
      : null,
  };
}

function backendSelectionLogEntry(config = {}, options = {}) {
  const backend = config.backend || 'unknown';
  return {
    feature: 'ff_canonical_task_runtime',
    action: 'backend_selection',
    outcome: backend === 'file' ? 'fallback_warning' : 'success',
    backend_mode: backend,
    environment: options.runtimeEnv || process.env.NODE_ENV || 'local',
    fallback_enabled: backend === 'file',
    warning_code: config.fallbackWarning?.code || null,
    remediation: config.fallbackWarning?.remediation || null,
  };
}

function logAuditBackendSelection(config = {}, logger = console, options = {}) {
  const entry = backendSelectionLogEntry(config, options);
  if (logger === console) {
    process.stderr.write(`${JSON.stringify(entry)}\n`);
    return entry;
  }
  if (entry.fallback_enabled && typeof logger.warn === 'function') {
    logger.warn(entry);
    return entry;
  }
  if (typeof logger.info === 'function') {
    logger.info(entry);
    return entry;
  }
  process.stderr.write(`${JSON.stringify(entry)}\n`);
  return entry;
}

module.exports = {
  resolveAuditBackend,
  resolveRuntimeAuditBackend,
  isLocalLikeEnvironment,
  isFileBackendExplicitlyAllowed,
  assertAuditBackendConfiguration,
  backendSelectionLogEntry,
  logAuditBackendSelection,
};
