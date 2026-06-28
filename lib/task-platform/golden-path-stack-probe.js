const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STATE_FILE = path.join(
  process.cwd(),
  'observability',
  'golden-path-local-dev',
  'stack.json',
);

function readGoldenPathStackState(stateFile = DEFAULT_STATE_FILE) {
  const resolved = path.resolve(stateFile);
  if (!fs.existsSync(resolved)) return null;
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    return null;
  }
}

function resolveGoldenPathForgeAdapterUrl(options = {}) {
  if (options.forgeAdapterBaseUrl) {
    return String(options.forgeAdapterBaseUrl).replace(/\/+$/, '');
  }
  const fromEnv = String(process.env.FORGEADAPTER_BASE_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const state = readGoldenPathStackState(options.stackStateFile);
  const url = state?.services?.forgeadapter?.url;
  return url ? String(url).replace(/\/+$/, '') : '';
}

function resolveGoldenPathForgeAdapterToken(options = {}) {
  if (options.forgeAdapterToken) return options.forgeAdapterToken;
  const fromEnv = process.env.FORGEADAPTER_SERVICE_TOKEN || process.env.FORGEADAPTER_TOKEN;
  if (fromEnv) return fromEnv;
  const state = readGoldenPathStackState(options.stackStateFile);
  return state?.services?.forgeadapter?.token || null;
}

async function probeForgeAdapterHealth(baseUrl, fetchImpl = fetch, timeoutMs = 5000) {
  if (!baseUrl) {
    return { ok: false, skipped: true, reason: 'no_forgeadapter_url' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/ready`, { signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status,
      url: baseUrl,
      source: 'health_probe',
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url: baseUrl,
      error: error?.message || String(error),
      source: 'health_probe',
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_STATE_FILE,
  readGoldenPathStackState,
  resolveGoldenPathForgeAdapterUrl,
  resolveGoldenPathForgeAdapterToken,
  probeForgeAdapterHealth,
};