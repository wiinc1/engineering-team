'use strict';

const http = require('node:http');
const https = require('node:https');

const DEFAULT_LIVE_OPENCLAW_URL = 'http://127.0.0.1:18789';
const DEFAULT_OPENCLAW_MOCK_PORT = 14001;
const DEFAULT_PROBE_TIMEOUT_MS = 3000;
const GATEWAY_UNAVAILABLE = 'FACTORY_PROOF_GATEWAY_UNAVAILABLE';

function readArg(argv = process.argv, name, fallback = '') {
  if (!Array.isArray(argv)) return fallback;
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
}

/**
 * GitLab #271: known OpenClaw mock topology (default :14001) is non-claim.
 * Live proof must not treat mock health as a live gateway.
 */
function isOpenClawMockBaseUrl(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw.includes('://') ? raw : `http://${raw}`);
    const port = parsed.port
      || (parsed.protocol === 'https:' ? '443' : '80');
    if (Number(port) === DEFAULT_OPENCLAW_MOCK_PORT) return true;
    const host = String(parsed.hostname || '').toLowerCase();
    if (host.includes('openclaw-mock') || host.startsWith('mock-')) return true;
    return false;
  } catch {
    return /:14001(?:\/|$)/.test(raw) || /openclaw-mock/i.test(raw);
  }
}

function resolveOpenClawBaseUrl({
  argv = process.argv,
  env = process.env,
  openclawUrl = '',
  preferDefaultLive = false,
} = {}) {
  const fromArg = openclawUrl || readArg(argv, '--openclaw-url', '');
  const fromEnv = env.OPENCLAW_BASE_URL || '';
  if (fromArg) return String(fromArg).trim();
  if (fromEnv) return String(fromEnv).trim();
  if (preferDefaultLive) return DEFAULT_LIVE_OPENCLAW_URL;
  return '';
}

function requestProbe(url, timeoutMs, fetchImpl) {
  if (typeof fetchImpl === 'function') {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    return fetchImpl(url, {
      method: 'GET',
      signal: controller?.signal,
      headers: { accept: 'application/json, text/plain, */*' },
    }).finally(() => {
      if (timer) clearTimeout(timer);
    }).then((response) => ({
      ok: Boolean(response?.ok || (response?.status >= 200 && response?.status < 500)),
      status: response?.status,
    }));
  }

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname || '/'}${parsed.search || ''}`,
      method: 'GET',
      timeout: timeoutMs,
      headers: { accept: 'application/json, text/plain, */*' },
    }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, status: res.statusCode });
    });
    req.on('timeout', () => {
      const error = new Error(`OpenClaw probe timed out after ${timeoutMs}ms`);
      error.code = GATEWAY_UNAVAILABLE;
      req.destroy(error);
    });
    req.on('error', reject);
    req.end();
  });
}

async function probeOpenClawGateway(options = {}) {
  const baseUrl = String(options.baseUrl || '').trim().replace(/\/$/, '');
  const timeoutMs = Number(options.timeoutMs || process.env.OPENCLAW_PROBE_TIMEOUT_MS || DEFAULT_PROBE_TIMEOUT_MS);
  const started = Date.now();
  if (!baseUrl) {
    return {
      available: false,
      baseUrl: '',
      latencyMs: 0,
      errorCode: GATEWAY_UNAVAILABLE,
      errorMessage: 'No OpenClaw base URL configured for probe',
    };
  }

  const candidates = [baseUrl, `${baseUrl}/health`, `${baseUrl}/v1/health`, `${baseUrl}/api/health`];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const result = await requestProbe(candidate, timeoutMs, options.fetchImpl);
      if (result.ok) {
        return {
          available: true,
          baseUrl,
          probedUrl: candidate,
          status: result.status,
          latencyMs: Date.now() - started,
        };
      }
      lastError = `HTTP ${result.status}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
  }

  return {
    available: false,
    baseUrl,
    latencyMs: Date.now() - started,
    errorCode: GATEWAY_UNAVAILABLE,
    errorMessage: lastError || 'OpenClaw gateway probe failed',
  };
}

module.exports = {
  DEFAULT_LIVE_OPENCLAW_URL,
  DEFAULT_OPENCLAW_MOCK_PORT,
  DEFAULT_PROBE_TIMEOUT_MS,
  GATEWAY_UNAVAILABLE,
  readArg,
  isOpenClawMockBaseUrl,
  resolveOpenClawBaseUrl,
  probeOpenClawGateway,
};
