'use strict';

const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');

const execFileAsync = promisify(execFile);

const PROVIDER_GROK = 'grok';
const PROVIDER_OPENCLAW = 'openclaw';
const DEFAULT_PROVIDER = PROVIDER_GROK;
const PROVIDER_UNKNOWN = 'SPECIALIST_RUNTIME_PROVIDER_UNKNOWN';
const DEFAULT_OPENCLAW_URL = 'http://127.0.0.1:18789';
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const DEFAULT_SPECIALIST_MAP = Object.freeze({
  pm: 'product-manager',
  architect: 'architect',
  engineer: 'sr-engineer',
  principal: 'principal',
  'jr-engineer': 'jr-engineer',
  'sr-engineer': 'sr-engineer',
  qa: 'qa-engineer',
  sre: 'sre',
  ux: 'ux-designer',
  'ux-designer': 'ux-designer',
  'engineer-jr': 'jr-engineer',
  'engineer-sr': 'sr-engineer',
  'engineer-principal': 'principal',
  'product-manager': 'product-manager',
});

function runnerCommand(scriptName) {
  return `node ${path.join(REPO_ROOT, 'scripts', scriptName)}`;
}

const GROK_SPECIALIST_RUNNER = runnerCommand('grok-specialist-runner.js');
const OPENCLAW_SPECIALIST_RUNNER = runnerCommand('openclaw-specialist-runner.js');
const FIXTURE_SPECIALIST_RUNNER = `node ${path.join(REPO_ROOT, 'tests', 'fixtures', 'specialist-runtime-runner.js')}`;

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function createProviderError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function isFixtureDelegationRunner(value) {
  return String(value || '').replace(/\\/g, '/').includes('tests/fixtures/specialist-runtime-runner.js');
}

function builtinProviders() {
  return {
    [PROVIDER_GROK]: {
      name: PROVIDER_GROK,
      runner: GROK_SPECIALIST_RUNNER,
      health: { kind: 'cli', binaryEnv: 'GROK_BIN', binary: 'grok' },
      mapEnv: 'GROK_SPECIALIST_MAP',
    },
    [PROVIDER_OPENCLAW]: {
      name: PROVIDER_OPENCLAW,
      runner: OPENCLAW_SPECIALIST_RUNNER,
      health: {
        kind: 'http',
        urlEnv: 'OPENCLAW_BASE_URL',
        defaultUrl: DEFAULT_OPENCLAW_URL,
      },
      mapEnv: 'OPENCLAW_SPECIALIST_MAP',
    },
  };
}

function extraProvidersFromEnv(env = process.env) {
  const raw = env.SPECIALIST_RUNTIME_PROVIDERS;
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw createProviderError(
      PROVIDER_UNKNOWN,
      'SPECIALIST_RUNTIME_PROVIDERS must be valid JSON',
      { cause: error.message },
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createProviderError(PROVIDER_UNKNOWN, 'SPECIALIST_RUNTIME_PROVIDERS must be a JSON object');
  }

  const extras = {};
  for (const [name, spec] of Object.entries(parsed)) {
    const providerName = String(name || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(providerName)) {
      throw createProviderError(PROVIDER_UNKNOWN, `Invalid extra specialist runtime provider name: ${name}`);
    }
    const runner = String(spec?.runner || spec?.command || '').trim();
    if (!runner) {
      throw createProviderError(PROVIDER_UNKNOWN, `Extra provider ${providerName} is missing a runner command`);
    }
    extras[providerName] = {
      name: providerName,
      runner,
      health: spec?.health && typeof spec.health === 'object'
        ? spec.health
        : { kind: spec?.healthKind || 'cli', binary: spec?.binary || providerName },
      mapEnv: spec?.mapEnv || 'SPECIALIST_RUNTIME_AGENT_MAP',
      extra: true,
    };
  }
  return extras;
}

function listProviders(env = process.env) {
  return { ...builtinProviders(), ...extraProvidersFromEnv(env) };
}

function normalizeProviderName(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveProviderName({ env = process.env, options = {} } = {}) {
  const fromOptions = normalizeProviderName(options.runtimeProvider || options.specialistRuntimeProvider);
  if (fromOptions) return fromOptions;
  const fromEnv = normalizeProviderName(env.SPECIALIST_RUNTIME_PROVIDER);
  if (fromEnv) return fromEnv;
  return DEFAULT_PROVIDER;
}

function resolveSpecialistRuntimeProvider({ env = process.env, options = {} } = {}) {
  const name = resolveProviderName({ env, options });
  const providers = listProviders(env);
  const provider = providers[name];
  if (!provider) {
    throw createProviderError(
      PROVIDER_UNKNOWN,
      `Unknown specialist runtime provider "${name}". Registered: ${Object.keys(providers).join(', ')}`,
      { provider: name, registered: Object.keys(providers) },
    );
  }
  return { ...provider };
}

function resolveSpecialistDelegationRunner({ env = process.env, options = {} } = {}) {
  const provider = resolveSpecialistRuntimeProvider({ env, options });
  const explicit = options.delegationRunner || env.SPECIALIST_DELEGATION_RUNNER;
  if (explicit) {
    return { ...provider, runner: String(explicit), override: true };
  }
  return { ...provider, override: false };
}

function resolveSpecialistMap(env = process.env, mapEnv = '') {
  const shared = env.SPECIALIST_RUNTIME_AGENT_MAP;
  const specific = mapEnv ? env[mapEnv] : '';
  const raw = specific || shared;
  if (!raw) return { ...DEFAULT_SPECIALIST_MAP };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SPECIALIST_MAP, ...parsed };
  } catch (error) {
    throw createProviderError(
      'SPECIALIST_RUNTIME_EXEC_FAILED',
      `${mapEnv || 'SPECIALIST_RUNTIME_AGENT_MAP'} must be valid JSON`,
      { cause: error.message },
    );
  }
}

function resolveRuntimeAgent(specialist, env = process.env, mapEnv = '') {
  const map = resolveSpecialistMap(env, mapEnv);
  const mapped = map[specialist];
  if (!mapped || typeof mapped !== 'string' || !mapped.trim()) {
    throw createProviderError(
      'SPECIALIST_RUNTIME_EXEC_FAILED',
      `No specialist agent mapping configured for ${specialist}`,
    );
  }
  return mapped.trim();
}

function resolveCliBinary(provider, env = process.env) {
  const health = provider.health || {};
  if (health.binaryEnv && env[health.binaryEnv]) return String(env[health.binaryEnv]);
  return String(health.binary || provider.name || 'grok');
}

function resolveHttpHealthUrl(provider, env = process.env) {
  const health = provider.health || {};
  if (health.urlEnv && env[health.urlEnv]) return String(env[health.urlEnv]).replace(/\/+$/, '');
  return String(health.defaultUrl || DEFAULT_OPENCLAW_URL).replace(/\/+$/, '');
}

async function probeCliProvider(provider, {
  env = process.env,
  execFileImpl = execFileAsync,
  timeoutMs = 2500,
} = {}) {
  const binary = resolveCliBinary(provider, env);
  try {
    await execFileImpl(binary, ['--help'], { timeout: timeoutMs });
    return {
      available: true,
      kind: 'cli',
      provider: provider.name,
      binary,
      latencyMs: null,
    };
  } catch (error) {
    return {
      available: false,
      kind: 'cli',
      provider: provider.name,
      binary,
      errorCode: 'SPECIALIST_RUNTIME_NOT_CONFIGURED',
      errorMessage: error.message || String(error),
    };
  }
}

async function defaultProbeHttp(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, error: error.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function probeSpecialistRuntimeProvider(provider, options = {}) {
  const health = provider.health || { kind: 'cli' };
  if (health.kind === 'http') {
    const baseUrl = resolveHttpHealthUrl(provider, options.env || process.env);
    const probeHttp = options.probeHttp || defaultProbeHttp;
    const result = await probeHttp(`${baseUrl}/health`);
    return {
      available: result?.ok === true,
      kind: 'http',
      provider: provider.name,
      baseUrl,
      status: result?.status,
      errorMessage: result?.error,
      errorCode: result?.ok ? null : 'FACTORY_PROOF_GATEWAY_UNAVAILABLE',
    };
  }
  return probeCliProvider(provider, options);
}

module.exports = {
  DEFAULT_PROVIDER,
  DEFAULT_SPECIALIST_MAP,
  DEFAULT_OPENCLAW_URL,
  FIXTURE_SPECIALIST_RUNNER,
  GROK_SPECIALIST_RUNNER,
  OPENCLAW_SPECIALIST_RUNNER,
  PROVIDER_GROK,
  PROVIDER_OPENCLAW,
  PROVIDER_UNKNOWN,
  extraProvidersFromEnv,
  isFixtureDelegationRunner,
  listProviders,
  probeCliProvider,
  probeSpecialistRuntimeProvider,
  resolveCliBinary,
  resolveHttpHealthUrl,
  resolveProviderName,
  resolveRuntimeAgent,
  resolveSpecialistDelegationRunner,
  resolveSpecialistMap,
  resolveSpecialistRuntimeProvider,
  runnerCommand,
};
