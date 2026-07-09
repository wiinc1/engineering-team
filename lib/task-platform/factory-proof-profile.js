'use strict';

const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const DEFAULT_LIVE_OPENCLAW_URL = 'http://127.0.0.1:18789';
const DEFAULT_PROBE_TIMEOUT_MS = 3000;
const OPENCLAW_SPECIALIST_RUNNER = `node ${path.resolve(process.cwd(), 'scripts/openclaw-specialist-runner.js')}`;
const FIXTURE_SPECIALIST_RUNNER = `node ${path.resolve(process.cwd(), 'tests/fixtures/specialist-runtime-runner.js')}`;

const FACTORY_PROOF_ERROR_CODES = Object.freeze({
  FIXTURE_FORBIDDEN: 'FACTORY_PROOF_FIXTURE_FORBIDDEN',
  MISSING_SESSION: 'FACTORY_PROOF_MISSING_SESSION',
  FIXTURE_ATTRIBUTION: 'FACTORY_PROOF_FIXTURE_ATTRIBUTION',
  GATEWAY_UNAVAILABLE: 'FACTORY_PROOF_GATEWAY_UNAVAILABLE',
  SERVER_DELEGATION_MISCONFIGURED: 'FACTORY_PROOF_SERVER_DELEGATION_MISCONFIGURED',
});

const FIXTURE_WARNING =
  'FACTORY_PROOF_PROFILE=fixture: results are not valid for operator-trusted factory claims.';

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function hasFlag(argv = process.argv, name) {
  return Array.isArray(argv) && argv.includes(name);
}

function readArg(argv = process.argv, name, fallback = '') {
  if (!Array.isArray(argv)) return fallback;
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
}

function createFactoryProofError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function isFixtureDelegationRunner(value) {
  return String(value || '').replace(/\\/g, '/').includes('tests/fixtures/specialist-runtime-runner.js');
}

function isFixtureSessionId(sessionId) {
  const value = String(sessionId || '').trim();
  if (!value) return false;
  return (
    value.startsWith('runtime-session-')
    || value.startsWith('fixture-session-')
    || /^fixture[-_]/i.test(value)
  );
}

function isFixtureOwnership(ownership = {}) {
  const runtime = String(ownership.runtime || ownership.mode || '').toLowerCase();
  return runtime.includes('fixture');
}

function isProductionLikeProof(options = {}, env = process.env) {
  const profile = String(options.proofProfile || env.FACTORY_PROOF_PROFILE || '').trim().toLowerCase();
  if (profile === 'live' || profile === 'production-like' || profile === 'fail-closed') return true;
  return (
    options.requireRealEvidence === true
    || options.collectRealEvidence === true
    || options.agentDrivenPhases === true
    || parseBoolean(env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE, false)
    || parseBoolean(env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE, false)
    || parseBoolean(env.FF_REAL_SPECIALIST_DELEGATION, false)
    || String(env.FACTORY_PROOF_PROFILE || '').toLowerCase() === 'live'
  );
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
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
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
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname || '/'}${parsed.search || ''}`,
        method: 'GET',
        timeout: timeoutMs,
        headers: { accept: 'application/json, text/plain, */*' },
      },
      (res) => {
        res.resume();
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 500,
          status: res.statusCode,
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(createFactoryProofError(
        FACTORY_PROOF_ERROR_CODES.GATEWAY_UNAVAILABLE,
        `OpenClaw probe timed out after ${timeoutMs}ms`,
      ));
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
      errorCode: FACTORY_PROOF_ERROR_CODES.GATEWAY_UNAVAILABLE,
      errorMessage: 'No OpenClaw base URL configured for probe',
    };
  }

  const candidates = [
    baseUrl,
    `${baseUrl}/health`,
    `${baseUrl}/v1/health`,
    `${baseUrl}/api/health`,
  ];

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
    errorCode: FACTORY_PROOF_ERROR_CODES.GATEWAY_UNAVAILABLE,
    errorMessage: lastError || 'OpenClaw gateway probe failed',
  };
}

function resolveExplicitProfile({ argv = process.argv, env = process.env } = {}) {
  const envProfile = String(env.FACTORY_PROOF_PROFILE || '').trim().toLowerCase();
  if (envProfile === 'fixture' || envProfile === 'live' || envProfile === 'fail-closed') {
    return envProfile;
  }
  if (
    hasFlag(argv, '--allow-fixture-delegation')
    || hasFlag(argv, '--fixture-delegation')
    || parseBoolean(env.FACTORY_ALLOW_FIXTURE_DELEGATION, false)
  ) {
    return 'fixture';
  }
  if (hasFlag(argv, '--live-openclaw') || hasFlag(argv, '--require-live-openclaw')) {
    return 'live';
  }
  return null;
}

/**
 * Resolve the factory proof profile for claim / verify entrypoints.
 * Primary default: live when gateway available, otherwise fail closed.
 */
async function resolveFactoryProofProfile(options = {}) {
  const argv = options.argv || process.argv;
  const env = options.env || process.env;
  const explicit = resolveExplicitProfile({ argv, env });
  const preferDefaultLive = explicit === 'live' || explicit == null;
  const baseUrl = resolveOpenClawBaseUrl({
    argv,
    env,
    openclawUrl: options.openclawUrl || '',
    preferDefaultLive,
  });

  if (explicit === 'fixture') {
    return {
      profile: 'fixture',
      fixtureAllowed: true,
      fixtureDelegation: true,
      openclawBaseUrl: baseUrl || null,
      runner: FIXTURE_SPECIALIST_RUNNER,
      probe: options.probe || null,
      warning: FIXTURE_WARNING,
    };
  }

  const probe = options.probe || await probeOpenClawGateway({
    baseUrl,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });

  if (probe.available) {
    return {
      profile: 'live',
      fixtureAllowed: false,
      fixtureDelegation: false,
      openclawBaseUrl: probe.baseUrl || baseUrl,
      runner: OPENCLAW_SPECIALIST_RUNNER,
      probe,
      warning: null,
    };
  }

  // live or default claim path: fail closed when gateway is down
  const remediation = [
    'Start the OpenClaw gateway (local default http://127.0.0.1:18789).',
    'Pass --openclaw-url or set OPENCLAW_BASE_URL.',
    'Ensure the audit API process also has OPENCLAW_BASE_URL, FF_REAL_SPECIALIST_DELEGATION=true, and SPECIALIST_DELEGATION_RUNNER=node scripts/openclaw-specialist-runner.js.',
    'For non-claim local smoke only: --allow-fixture-delegation or FACTORY_PROOF_PROFILE=fixture.',
  ].join(' ');

  throw createFactoryProofError(
    FACTORY_PROOF_ERROR_CODES.GATEWAY_UNAVAILABLE,
    `Factory proof gateway unavailable at ${baseUrl || '(unset)'}: ${probe.errorMessage || 'probe failed'}. ${remediation}`,
    { probe, openclawBaseUrl: baseUrl || null, profile: explicit || 'live' },
  );
}

function applyFactoryProofProfileToEnv(proof, env = process.env) {
  const next = env;
  next.FACTORY_PROOF_PROFILE = proof.profile;
  next.FACTORY_USE_FIXTURE_DELEGATION = proof.fixtureDelegation ? 'true' : 'false';
  if (proof.profile === 'live') {
    next.FF_REAL_SPECIALIST_DELEGATION = 'true';
    next.SPECIALIST_DELEGATION_RUNNER = proof.runner || OPENCLAW_SPECIALIST_RUNNER;
    if (proof.openclawBaseUrl) {
      next.OPENCLAW_BASE_URL = proof.openclawBaseUrl;
    }
  } else if (proof.profile === 'fixture') {
    next.SPECIALIST_DELEGATION_RUNNER = proof.runner || FIXTURE_SPECIALIST_RUNNER;
  }
  return next;
}

async function applyPrimaryFactoryProofProfile(options = {}) {
  const proof = await resolveFactoryProofProfile(options);
  applyFactoryProofProfileToEnv(proof, options.env || process.env);
  if (proof.warning && options.emitWarning !== false) {
    process.stderr.write(`${proof.warning}\n`);
  }
  return proof;
}

function extractSessionCandidates(value, bucket = []) {
  if (!value || typeof value !== 'object') return bucket;
  if (Array.isArray(value)) {
    for (const item of value) extractSessionCandidates(item, bucket);
    return bucket;
  }
  const sessionId = value.sessionId || value.session_id || value.pmRefinementSessionId || value.architectSessionId;
  if (sessionId) {
    bucket.push({
      sessionId: String(sessionId),
      agentId: value.agentId || value.runtimeAgentId || value.specialistId || null,
      ownership: value.ownership || null,
      pathHint: value.role || value.phase || null,
    });
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') extractSessionCandidates(nested, bucket);
  }
  return bucket;
}

function collectAgentSessionEvidence(factoryEvidence = {}) {
  return extractSessionCandidates(factoryEvidence, []);
}

function validateLiveSessionEvidence({
  factoryEvidence = {},
  profile = 'live',
  runner = '',
  requireAtLeastOneSession = true,
} = {}) {
  if (profile === 'fixture') {
    return {
      ok: true,
      profile,
      fixtureDelegation: true,
      sessions: collectAgentSessionEvidence(factoryEvidence),
      errors: [],
    };
  }

  const errors = [];
  if (isFixtureDelegationRunner(runner)) {
    errors.push({
      code: FACTORY_PROOF_ERROR_CODES.FIXTURE_FORBIDDEN,
      message: 'Live factory proof cannot use the fixture specialist runner',
    });
  }

  const sessions = collectAgentSessionEvidence(factoryEvidence);
  const liveSessions = sessions.filter((entry) => entry.sessionId && !isFixtureSessionId(entry.sessionId) && !isFixtureOwnership(entry.ownership || {}));
  const fixtureSessions = sessions.filter((entry) => isFixtureSessionId(entry.sessionId) || isFixtureOwnership(entry.ownership || {}));

  if (fixtureSessions.length > 0) {
    errors.push({
      code: FACTORY_PROOF_ERROR_CODES.FIXTURE_ATTRIBUTION,
      message: 'Fixture session attribution is not valid under live factory proof',
      sessions: fixtureSessions.map((s) => s.sessionId),
    });
  }

  if (requireAtLeastOneSession && liveSessions.length === 0) {
    errors.push({
      code: FACTORY_PROOF_ERROR_CODES.MISSING_SESSION,
      message: 'Live factory proof requires at least one real agent sessionId',
    });
  }

  return {
    ok: errors.length === 0,
    profile,
    fixtureDelegation: false,
    sessions,
    liveSessions,
    fixtureSessions,
    errors,
  };
}

function assertLiveProofAllowsCompletion(proof, validation) {
  if (proof?.profile === 'live' && validation && !validation.ok) {
    const first = validation.errors[0] || {};
    throw createFactoryProofError(
      first.code || FACTORY_PROOF_ERROR_CODES.MISSING_SESSION,
      first.message || 'Live factory proof completion blocked',
      { validation },
    );
  }
}

function attachProofMetadata(target = {}, proof = {}, validation = null) {
  return {
    ...target,
    proofProfile: proof.profile || null,
    fixtureDelegation: Boolean(proof.fixtureDelegation),
    openclawBaseUrl: proof.openclawBaseUrl || null,
    proofProbe: proof.probe
      ? {
        available: proof.probe.available,
        baseUrl: proof.probe.baseUrl || null,
        latencyMs: proof.probe.latencyMs ?? null,
        errorCode: proof.probe.errorCode || null,
      }
      : null,
    sessionEvidence: validation
      ? {
        ok: validation.ok,
        liveSessionCount: validation.liveSessions?.length || 0,
        fixtureSessionCount: validation.fixtureSessions?.length || 0,
        sessions: (validation.liveSessions || validation.sessions || []).slice(0, 12).map((s) => ({
          sessionId: s.sessionId,
          agentId: s.agentId,
        })),
        errors: validation.errors || [],
      }
      : null,
  };
}

module.exports = {
  DEFAULT_LIVE_OPENCLAW_URL,
  DEFAULT_PROBE_TIMEOUT_MS,
  OPENCLAW_SPECIALIST_RUNNER,
  FIXTURE_SPECIALIST_RUNNER,
  FACTORY_PROOF_ERROR_CODES,
  FIXTURE_WARNING,
  parseBoolean,
  hasFlag,
  readArg,
  createFactoryProofError,
  isFixtureDelegationRunner,
  isFixtureSessionId,
  isFixtureOwnership,
  isProductionLikeProof,
  resolveOpenClawBaseUrl,
  probeOpenClawGateway,
  resolveFactoryProofProfile,
  applyFactoryProofProfileToEnv,
  applyPrimaryFactoryProofProfile,
  collectAgentSessionEvidence,
  validateLiveSessionEvidence,
  assertLiveProofAllowsCompletion,
  attachProofMetadata,
};
