'use strict';

const {
  DEFAULT_LIVE_OPENCLAW_URL,
  DEFAULT_PROBE_TIMEOUT_MS,
  resolveOpenClawBaseUrl,
  isOpenClawMockBaseUrl,
  probeOpenClawGateway,
  readArg: readProbeArg,
} = require('./factory-proof-probe');
const hermesProof = require('./factory-proof-hermes');
const {
  GROK_SPECIALIST_RUNNER,
  OPENCLAW_SPECIALIST_RUNNER,
  FIXTURE_SPECIALIST_RUNNER,
  PROVIDER_OPENCLAW,
  probeSpecialistRuntimeProvider,
  resolveProviderName,
  resolveSpecialistDelegationRunner,
} = require('../software-factory/specialist-runtime-provider');

const FACTORY_PROOF_ERROR_CODES = Object.freeze({
  FIXTURE_FORBIDDEN: 'FACTORY_PROOF_FIXTURE_FORBIDDEN',
  MISSING_SESSION: 'FACTORY_PROOF_MISSING_SESSION',
  FIXTURE_ATTRIBUTION: 'FACTORY_PROOF_FIXTURE_ATTRIBUTION',
  GATEWAY_UNAVAILABLE: 'FACTORY_PROOF_GATEWAY_UNAVAILABLE',
  MOCK_GATEWAY_FORBIDDEN: 'FACTORY_PROOF_MOCK_GATEWAY_FORBIDDEN',
  SERVER_DELEGATION_MISCONFIGURED: 'FACTORY_PROOF_SERVER_DELEGATION_MISCONFIGURED',
});

const FIXTURE_WARNING =
  'FACTORY_PROOF_PROFILE=fixture: results are not valid for operator-trusted factory claims.';

const GATEWAY_REMEDIATION = [
  'Set SPECIALIST_RUNTIME_PROVIDER=grok (default) or openclaw.',
  'For Grok: install the grok CLI and set GROK_BIN if it is not on PATH.',
  'For OpenClaw: start the gateway (local default http://127.0.0.1:18789) and pass --openclaw-url or OPENCLAW_BASE_URL.',
  'Ensure the audit API process has FF_REAL_SPECIALIST_DELEGATION=true and SPECIALIST_DELEGATION_RUNNER pointing at the selected provider runner.',
  'Do not point live proof at the OpenClaw mock (:14001); use --use-openclaw-mock / fixture profile only for non-claim smoke.',
  'For non-claim local smoke only: --allow-fixture-delegation or FACTORY_PROOF_PROFILE=fixture.',
].join(' ');

function hasFlag(argv = process.argv, name) {
  return Array.isArray(argv) && argv.includes(name);
}

function readArg(argv = process.argv, name, fallback = '') {
  return readProbeArg(argv, name, fallback);
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
  return value.startsWith('runtime-session-')
    || value.startsWith('fixture-session-')
    || /^fixture[-_]/i.test(value);
}

function isFixtureOwnership(ownership = {}) {
  return String(ownership.runtime || ownership.mode || '').toLowerCase().includes('fixture');
}

function isProductionLikeProof(options = {}, env = process.env) {
  const profile = String(options.proofProfile || env.FACTORY_PROOF_PROFILE || '').trim().toLowerCase();
  if (profile === 'live' || profile === 'production-like' || profile === 'fail-closed') return true;
  return options.requireRealEvidence === true
    || options.collectRealEvidence === true
    || options.agentDrivenPhases === true
    || hermesProof.parseBoolean(env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE, false)
    || hermesProof.parseBoolean(env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE, false)
    || hermesProof.parseBoolean(env.FF_REAL_SPECIALIST_DELEGATION, false)
    || String(env.FACTORY_PROOF_PROFILE || '').toLowerCase() === 'live';
}

function resolveExplicitProfile({ argv = process.argv, env = process.env } = {}) {
  const envProfile = String(env.FACTORY_PROOF_PROFILE || '').trim().toLowerCase();
  if (envProfile === 'fixture' || envProfile === 'live' || envProfile === 'fail-closed') return envProfile;
  if (
    hasFlag(argv, '--allow-fixture-delegation')
    || hasFlag(argv, '--fixture-delegation')
    || hermesProof.parseBoolean(env.FACTORY_ALLOW_FIXTURE_DELEGATION, false)
  ) {
    return 'fixture';
  }
  if (hasFlag(argv, '--live-openclaw') || hasFlag(argv, '--require-live-openclaw')) return 'live';
  return null;
}

function buildFixtureProof(baseUrl, probe = null, provider = null) {
  return {
    profile: 'fixture',
    fixtureAllowed: true,
    fixtureDelegation: true,
    runtimeProvider: provider?.name || resolveProviderName(),
    openclawBaseUrl: baseUrl || null,
    runner: FIXTURE_SPECIALIST_RUNNER,
    probe,
    warning: FIXTURE_WARNING,
  };
}

function buildLiveProof({ baseUrl, probe, provider }) {
  const openclaw = provider?.name === PROVIDER_OPENCLAW;
  return {
    profile: 'live',
    fixtureAllowed: false,
    fixtureDelegation: false,
    runtimeProvider: provider?.name || resolveProviderName(),
    openclawBaseUrl: openclaw ? (probe?.baseUrl || baseUrl || null) : null,
    runner: provider?.runner || GROK_SPECIALIST_RUNNER,
    probe,
    warning: null,
  };
}

function throwGatewayUnavailable(baseUrl, probe, explicit) {
  throw createFactoryProofError(
    FACTORY_PROOF_ERROR_CODES.GATEWAY_UNAVAILABLE,
    `Factory proof gateway unavailable at ${baseUrl || '(unset)'}: ${probe.errorMessage || 'probe failed'}. ${GATEWAY_REMEDIATION}`,
    { probe, openclawBaseUrl: baseUrl || null, profile: explicit || 'live' },
  );
}

function throwMockGatewayForbidden(baseUrl, explicit) {
  throw createFactoryProofError(
    FACTORY_PROOF_ERROR_CODES.MOCK_GATEWAY_FORBIDDEN,
    `Live factory proof cannot use the OpenClaw mock gateway at ${baseUrl || '(unset)'} (GitLab #271). `
    + `Point OPENCLAW_BASE_URL at the live gateway (${DEFAULT_LIVE_OPENCLAW_URL}) or use FACTORY_PROOF_PROFILE=fixture / --allow-fixture-delegation for non-claim smoke only. ${GATEWAY_REMEDIATION}`,
    { openclawBaseUrl: baseUrl || null, profile: explicit || 'live' },
  );
}

function assertLiveProofGatewayEligible(baseUrl, {
  argv = process.argv,
  env = process.env,
  explicit = null,
  provider = null,
} = {}) {
  const providerName = provider?.name || resolveProviderName({ env });
  if (providerName === PROVIDER_OPENCLAW && isOpenClawMockBaseUrl(baseUrl)) {
    throwMockGatewayForbidden(baseUrl, explicit);
  }
  const runner = env.SPECIALIST_DELEGATION_RUNNER || provider?.runner || '';
  if (isFixtureDelegationRunner(runner) && !hermesProof.parseBoolean(env.FACTORY_ALLOW_FIXTURE_DELEGATION, false)) {
    throw createFactoryProofError(
      FACTORY_PROOF_ERROR_CODES.FIXTURE_FORBIDDEN,
      'Live factory proof cannot use the fixture specialist runner. '
      + 'Set SPECIALIST_RUNTIME_PROVIDER=grok or SPECIALIST_DELEGATION_RUNNER to a live runner, '
      + 'or use FACTORY_PROOF_PROFILE=fixture for non-claim smoke.',
      { runner, openclawBaseUrl: baseUrl || null, profile: explicit || 'live', runtimeProvider: providerName },
    );
  }
  return true;
}

async function resolveFactoryProofProfile(options = {}) {
  const argv = options.argv || process.argv;
  const env = options.env || process.env;
  const explicit = resolveExplicitProfile({ argv, env });
  const provider = resolveSpecialistDelegationRunner({ env, options });
  const preferDefaultLive = explicit === 'live' || explicit == null;
  const baseUrl = resolveOpenClawBaseUrl({
    argv,
    env,
    openclawUrl: options.openclawUrl || '',
    preferDefaultLive: preferDefaultLive && provider.name === PROVIDER_OPENCLAW,
  });

  if (explicit === 'fixture') return buildFixtureProof(baseUrl, options.probe || null, provider);

  assertLiveProofGatewayEligible(baseUrl, { argv, env, explicit, provider });

  const hermesClaim = hermesProof.resolveHermesClaimForProof(options, env, explicit);

  let probe = options.probe;
  if (!probe) {
    if (provider.name === PROVIDER_OPENCLAW) {
      probe = await probeOpenClawGateway({
        baseUrl,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      });
    } else {
      probe = await probeSpecialistRuntimeProvider(provider, {
        env,
        execFileImpl: options.execFileImpl,
        probeHttp: options.probeHttp,
        timeoutMs: options.timeoutMs,
      });
    }
  }
  if (!probe.available) {
    if (provider.name === PROVIDER_OPENCLAW) throwGatewayUnavailable(baseUrl, probe, explicit);
    throw createFactoryProofError(
      probe.errorCode || FACTORY_PROOF_ERROR_CODES.GATEWAY_UNAVAILABLE,
      `Factory proof specialist runtime "${provider.name}" is unavailable: ${probe.errorMessage || 'probe failed'}. ${GATEWAY_REMEDIATION}`,
      { probe, runtimeProvider: provider.name, profile: explicit || 'live' },
    );
  }
  return hermesProof.attachHermesClaimToProof(buildLiveProof({ baseUrl, probe, provider }), hermesClaim);
}

function applyFactoryProofProfileToEnv(proof, env = process.env) {
  env.FACTORY_PROOF_PROFILE = proof.profile;
  env.FACTORY_USE_FIXTURE_DELEGATION = proof.fixtureDelegation ? 'true' : 'false';
  if (proof.runtimeProvider) env.SPECIALIST_RUNTIME_PROVIDER = proof.runtimeProvider;
  if (proof.profile === 'live') {
    env.FF_REAL_SPECIALIST_DELEGATION = 'true';
    env.SPECIALIST_DELEGATION_RUNNER = proof.runner || GROK_SPECIALIST_RUNNER;
    if (proof.openclawBaseUrl) env.OPENCLAW_BASE_URL = proof.openclawBaseUrl;
  } else if (proof.profile === 'fixture') {
    env.SPECIALIST_DELEGATION_RUNNER = proof.runner || FIXTURE_SPECIALIST_RUNNER;
  }
  return env;
}

async function applyPrimaryFactoryProofProfile(options = {}) {
  const proof = await resolveFactoryProofProfile(options);
  applyFactoryProofProfileToEnv(proof, options.env || process.env);
  if (proof.warning && options.emitWarning !== false) process.stderr.write(`${proof.warning}\n`);
  return proof;
}

module.exports = {
  DEFAULT_LIVE_OPENCLAW_URL,
  DEFAULT_PROBE_TIMEOUT_MS,
  GROK_SPECIALIST_RUNNER,
  OPENCLAW_SPECIALIST_RUNNER,
  FIXTURE_SPECIALIST_RUNNER,
  FACTORY_PROOF_ERROR_CODES,
  FIXTURE_WARNING,
  hasFlag,
  readArg,
  createFactoryProofError,
  isFixtureDelegationRunner,
  isFixtureSessionId,
  isFixtureOwnership,
  isOpenClawMockBaseUrl,
  isProductionLikeProof,
  resolveOpenClawBaseUrl,
  probeOpenClawGateway,
  assertLiveProofGatewayEligible,
  resolveFactoryProofProfile,
  applyFactoryProofProfileToEnv,
  applyPrimaryFactoryProofProfile,
  ...hermesProof,
};
