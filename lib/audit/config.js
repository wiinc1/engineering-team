function normalizeBackend(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'postgres' || normalized === 'file' ? normalized : normalized;
}

function resolveAuditBackend(options = {}) {
  const explicitBackend = normalizeBackend(options.backend || process.env.AUDIT_STORE_BACKEND);
  if (explicitBackend) return explicitBackend;
  if (options.pool || options.connectionString || process.env.DATABASE_URL) return 'postgres';
  return 'file';
}

function isLocalLikeEnvironment(options = {}) {
  const runtime = String(options.runtimeEnv || process.env.NODE_ENV || '').toLowerCase();
  if (!runtime) return true;
  return ['development', 'dev', 'test', 'local'].includes(runtime);
}

function assertAuditBackendConfiguration(options = {}) {
  const backend = resolveAuditBackend(options);
  const connectionString = options.connectionString || process.env.DATABASE_URL;
  const allowFileBackend = options.allowFileBackendInProduction === true || process.env.ALLOW_FILE_AUDIT_BACKEND_IN_PRODUCTION === 'true';

  if (backend === 'postgres' && !connectionString) {
    throw new Error('DATABASE_URL is required when AUDIT_STORE_BACKEND=postgres. Use the Supabase Postgres connection string in production.');
  }

  if (backend === 'file' && !isLocalLikeEnvironment(options) && !allowFileBackend) {
    throw new Error('File audit backend is restricted to local development/test. Production must use Supabase Postgres (set DATABASE_URL or AUDIT_STORE_BACKEND=postgres).');
  }

  return { backend, connectionString };
}

module.exports = {
  resolveAuditBackend,
  isLocalLikeEnvironment,
  assertAuditBackendConfiguration,
};
