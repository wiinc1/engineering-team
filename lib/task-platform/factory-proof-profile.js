'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_LIVE_OPENCLAW_URL,
  DEFAULT_PROBE_TIMEOUT_MS,
  resolveOpenClawBaseUrl,
  isOpenClawMockBaseUrl,
  probeOpenClawGateway,
  readArg: readProbeArg,
} = require('./factory-proof-probe');

const OPENCLAW_SPECIALIST_RUNNER = `node ${path.resolve(process.cwd(), 'scripts/openclaw-specialist-runner.js')}`;
const FIXTURE_SPECIALIST_RUNNER = `node ${path.resolve(process.cwd(), 'tests/fixtures/specialist-runtime-runner.js')}`;

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
  'Start the OpenClaw gateway (local default http://127.0.0.1:18789).',
  'Pass --openclaw-url or set OPENCLAW_BASE_URL.',
  'Ensure the audit API process also has OPENCLAW_BASE_URL, FF_REAL_SPECIALIST_DELEGATION=true, and SPECIALIST_DELEGATION_RUNNER=node scripts/openclaw-specialist-runner.js.',
  'Do not point live proof at the OpenClaw mock (:14001); use --use-openclaw-mock / fixture profile only for non-claim smoke.',
  'For non-claim local smoke only: --allow-fixture-delegation or FACTORY_PROOF_PROFILE=fixture.',
].join(' ');

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

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
    || parseBoolean(env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE, false)
    || parseBoolean(env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE, false)
    || parseBoolean(env.FF_REAL_SPECIALIST_DELEGATION, false)
    || String(env.FACTORY_PROOF_PROFILE || '').toLowerCase() === 'live';
}

function resolveExplicitProfile({ argv = process.argv, env = process.env } = {}) {
  const envProfile = String(env.FACTORY_PROOF_PROFILE || '').trim().toLowerCase();
  if (envProfile === 'fixture' || envProfile === 'live' || envProfile === 'fail-closed') return envProfile;
  if (
    hasFlag(argv, '--allow-fixture-delegation')
    || hasFlag(argv, '--fixture-delegation')
    || parseBoolean(env.FACTORY_ALLOW_FIXTURE_DELEGATION, false)
  ) {
    return 'fixture';
  }
  if (hasFlag(argv, '--live-openclaw') || hasFlag(argv, '--require-live-openclaw')) return 'live';
  return null;
}

function buildFixtureProof(baseUrl, probe = null) {
  return {
    profile: 'fixture',
    fixtureAllowed: true,
    fixtureDelegation: true,
    openclawBaseUrl: baseUrl || null,
    runner: FIXTURE_SPECIALIST_RUNNER,
    probe,
    warning: FIXTURE_WARNING,
  };
}

function buildLiveProof(baseUrl, probe) {
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

function assertLiveProofGatewayEligible(baseUrl, { argv = process.argv, env = process.env, explicit = null } = {}) {
  // Never allow known mock topology to satisfy live / fail-closed claim paths.
  if (isOpenClawMockBaseUrl(baseUrl)) {
    throwMockGatewayForbidden(baseUrl, explicit);
  }
  const runner = env.SPECIALIST_DELEGATION_RUNNER || '';
  if (isFixtureDelegationRunner(runner) && !parseBoolean(env.FACTORY_ALLOW_FIXTURE_DELEGATION, false)) {
    throw createFactoryProofError(
      FACTORY_PROOF_ERROR_CODES.FIXTURE_FORBIDDEN,
      'Live factory proof cannot use the fixture specialist runner. '
      + 'Set SPECIALIST_DELEGATION_RUNNER=node scripts/openclaw-specialist-runner.js or use FACTORY_PROOF_PROFILE=fixture for non-claim smoke.',
      { runner, openclawBaseUrl: baseUrl || null, profile: explicit || 'live' },
    );
  }
  return true;
}

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

  if (explicit === 'fixture') return buildFixtureProof(baseUrl, options.probe || null);

  // Live claim path (default when no explicit fixture): fail closed on mock topology / fixture runner.
  assertLiveProofGatewayEligible(baseUrl, { argv, env, explicit });

  const probe = options.probe || await probeOpenClawGateway({
    baseUrl,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  if (probe.available) return buildLiveProof(baseUrl, probe);
  throwGatewayUnavailable(baseUrl, probe, explicit);
}

function applyFactoryProofProfileToEnv(proof, env = process.env) {
  env.FACTORY_PROOF_PROFILE = proof.profile;
  env.FACTORY_USE_FIXTURE_DELEGATION = proof.fixtureDelegation ? 'true' : 'false';
  if (proof.profile === 'live') {
    env.FF_REAL_SPECIALIST_DELEGATION = 'true';
    env.SPECIALIST_DELEGATION_RUNNER = proof.runner || OPENCLAW_SPECIALIST_RUNNER;
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

function partitionSessions(sessions) {
  const liveSessions = sessions.filter((entry) => (
    entry.sessionId
    && !isFixtureSessionId(entry.sessionId)
    && !isFixtureOwnership(entry.ownership || {})
  ));
  const fixtureSessions = sessions.filter((entry) => (
    isFixtureSessionId(entry.sessionId) || isFixtureOwnership(entry.ownership || {})
  ));
  return { liveSessions, fixtureSessions };
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
  const { liveSessions, fixtureSessions } = partitionSessions(sessions);
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

function loadFactoryEvidenceFromResult(evidence = {}) {
  let factoryEvidence = evidence.factoryEvidence || evidence.factory?.factoryEvidence || {};
  const factoryEvidencePath = evidence.artifacts?.factoryEvidence;
  if ((!factoryEvidence || !Object.keys(factoryEvidence).length) && factoryEvidencePath && fs.existsSync(factoryEvidencePath)) {
    factoryEvidence = JSON.parse(fs.readFileSync(factoryEvidencePath, 'utf8'));
  }
  return factoryEvidence;
}

function finalizeLiveProofEvidence(evidence, proof, env = process.env) {
  const factoryEvidence = loadFactoryEvidenceFromResult(evidence);
  const validation = validateLiveSessionEvidence({
    factoryEvidence,
    profile: proof.profile,
    runner: env.SPECIALIST_DELEGATION_RUNNER,
    requireAtLeastOneSession: proof.profile === 'live',
  });
  Object.assign(evidence, attachProofMetadata(evidence, proof, validation));
  if (proof.profile === 'live') {
    evidence.summary = evidence.summary || { passed: false, checks: [] };
    evidence.summary.checks = evidence.summary.checks || [];
    evidence.summary.checks.push({
      name: 'live_session_evidence',
      ok: validation.ok,
      liveSessionCount: validation.liveSessions?.length || 0,
      errors: validation.errors,
    });
    evidence.summary.passed = evidence.summary.checks.every((check) => check.ok);
    if (!validation.ok) assertLiveProofAllowsCompletion(proof, validation);
  }
  return { evidence, validation };
}

function writeMilestoneVerifyReport({
  evidence,
  proof,
  milestone,
  title,
  outputDir,
}) {
  process.stdout.write(`${JSON.stringify({
    ok: evidence.summary.passed,
    milestone,
    title,
    outputDir,
    proofProfile: proof.profile,
    fixtureDelegation: proof.fixtureDelegation,
    openclawBaseUrl: proof.openclawBaseUrl,
    summary: evidence.summary,
    artifacts: evidence.artifacts,
    milestoneDComplete: evidence.artifacts?.milestoneDComplete || undefined,
  }, null, 2)}\n`);
  if (!evidence.summary.passed) process.exitCode = 1;
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
  isOpenClawMockBaseUrl,
  isProductionLikeProof,
  resolveOpenClawBaseUrl,
  probeOpenClawGateway,
  assertLiveProofGatewayEligible,
  resolveFactoryProofProfile,
  applyFactoryProofProfileToEnv,
  applyPrimaryFactoryProofProfile,
  collectAgentSessionEvidence,
  validateLiveSessionEvidence,
  assertLiveProofAllowsCompletion,
  attachProofMetadata,
  loadFactoryEvidenceFromResult,
  finalizeLiveProofEvidence,
  writeMilestoneVerifyReport,
};
