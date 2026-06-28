const SUPPORTED_PROVIDERS = new Set(['gitlab', 'github']);

function normalizeProvider(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_PROVIDERS.has(normalized) ? normalized : null;
}

function resolveForgeIntakeProvider(options = {}) {
  const explicit = normalizeProvider(options.forgeIntakeProvider || options.intakeProvider);
  if (explicit) return explicit;

  const fromEnv = normalizeProvider(
    process.env.FORGE_INTAKE_PROVIDER
    || process.env.INTAKE_FORGE_PROVIDER,
  );
  if (fromEnv) return fromEnv;

  return 'gitlab';
}

function isGitHubIntakeProvider(options = {}) {
  return resolveForgeIntakeProvider(options) === 'github';
}

function isGitLabIntakeProvider(options = {}) {
  return resolveForgeIntakeProvider(options) === 'gitlab';
}

module.exports = {
  SUPPORTED_PROVIDERS,
  resolveForgeIntakeProvider,
  isGitHubIntakeProvider,
  isGitLabIntakeProvider,
};