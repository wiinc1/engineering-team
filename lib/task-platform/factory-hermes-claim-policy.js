'use strict';

/**
 * Hermes claim-path policy (GitLab #272).
 *
 * Default decision: Hermes is non-critical / out of scope for Simple factory
 * claim topology. hermes-mock (:14002) may run for opt-in non-claim smoke only.
 *
 * When operators force Hermes required (FACTORY_HERMES_CLAIM_ROLE=required or
 * HERMES_REQUIRED_FOR_FACTORY_CLAIM=true), live / production-like proof fails
 * closed if Hermes is unset or points at the mock.
 */

const DEFAULT_HERMES_MOCK_PORT = 14002;

const HERMES_CLAIM_DECISION = Object.freeze({
  issue: 272,
  role: 'non-critical',
  /** Profiles covered by the default de-scope. */
  claimProfiles: Object.freeze(['live', 'production-like', 'fail-closed', 'simple-factory']),
  summary:
    'Hermes is non-critical for Simple factory claims and live factory-of-record proof. '
    + 'Claim success must not depend on hermes-mock. Real Hermes integration is deferred '
    + 'until a productized runtime exists; until then hermes-mock is opt-in non-claim smoke only.',
  recordedIn: 'docs/reports/FACTORY_AUTONOMY_DECISIONS.md',
});

const HERMES_CLAIM_ERROR_CODES = Object.freeze({
  REQUIRED_UNAVAILABLE: 'FACTORY_PROOF_HERMES_REQUIRED_UNAVAILABLE',
  MOCK_FORBIDDEN: 'FACTORY_PROOF_HERMES_MOCK_FORBIDDEN',
});

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function isHermesMockBaseUrl(url) {
  const value = String(url || '').trim().toLowerCase();
  if (!value) return false;
  if (value.includes('hermes-mock')) return true;
  // Canonical local mock port used by golden-path stack defaults.
  if (new RegExp(`:${DEFAULT_HERMES_MOCK_PORT}(?:/|$)`).test(value)) return true;
  return false;
}

function classifyHermesEndpoint(url) {
  const value = String(url || '').trim();
  if (!value) return 'unset';
  if (isHermesMockBaseUrl(value)) return 'mock';
  return 'real';
}

/**
 * Resolve claim role for Hermes.
 * @returns {'non-critical'|'optional'|'required'}
 */
function resolveHermesClaimRole(env = process.env) {
  const explicit = String(env.FACTORY_HERMES_CLAIM_ROLE || '').trim().toLowerCase();
  if (explicit === 'required' || explicit === 'optional' || explicit === 'non-critical') {
    return explicit;
  }
  if (parseBoolean(env.HERMES_REQUIRED_FOR_FACTORY_CLAIM, false)) {
    return 'required';
  }
  // Default product decision (GitLab #272): de-scoped / non-critical.
  return HERMES_CLAIM_DECISION.role;
}

function isHermesRequiredForClaim(env = process.env) {
  return resolveHermesClaimRole(env) === 'required';
}

function isLiveLikeProofProfile(options = {}, env = process.env) {
  const profile = String(
    options.proofProfile
    || options.profile
    || env.FACTORY_PROOF_PROFILE
    || '',
  ).trim().toLowerCase();
  if (profile === 'fixture') return false;
  if (profile === 'live' || profile === 'production-like' || profile === 'fail-closed') return true;
  // Unset profile under factory claim tooling still defaults live-like for Hermes checks
  // when required mode is forced; de-scoped mode never fails closed.
  return options.requireLiveHermes === true
    || options.agentDrivenPhases === true
    || parseBoolean(env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE, false);
}

/**
 * Pure claim-topology evaluation for Hermes.
 * Does not perform network I/O.
 */
function evaluateHermesClaimTopology(options = {}) {
  const env = options.env || process.env;
  const role = resolveHermesClaimRole(env);
  const hermesUrl = String(
    options.hermesUrl != null ? options.hermesUrl : (env.HERMES_BASE_URL || ''),
  ).trim();
  const classification = classifyHermesEndpoint(hermesUrl);
  const liveLike = isLiveLikeProofProfile(options, env);
  const decision = { ...HERMES_CLAIM_DECISION, role };

  if (role === 'required') {
    if (classification === 'unset') {
      return {
        ok: false,
        required: true,
        role,
        classification,
        hermesUrl: hermesUrl || null,
        claimTopology: true,
        code: HERMES_CLAIM_ERROR_CODES.REQUIRED_UNAVAILABLE,
        decision,
        note:
          'Hermes is required for this claim profile but HERMES_BASE_URL is unset. '
          + 'Point at a real Hermes runtime or set FACTORY_HERMES_CLAIM_ROLE=non-critical.',
      };
    }
    if (classification === 'mock' && liveLike) {
      return {
        ok: false,
        required: true,
        role,
        classification,
        hermesUrl,
        claimTopology: true,
        code: HERMES_CLAIM_ERROR_CODES.MOCK_FORBIDDEN,
        decision,
        note:
          `Live factory claim cannot use hermes-mock at ${hermesUrl} (GitLab #272). `
          + 'Use a real HERMES_BASE_URL or de-scope with FACTORY_HERMES_CLAIM_ROLE=non-critical.',
      };
    }
    if (classification === 'mock') {
      return {
        ok: false,
        required: true,
        role,
        classification,
        hermesUrl,
        claimTopology: true,
        code: HERMES_CLAIM_ERROR_CODES.MOCK_FORBIDDEN,
        decision,
        note: `Hermes mock at ${hermesUrl} cannot satisfy required Hermes claim topology.`,
      };
    }
    return {
      ok: true,
      required: true,
      role,
      classification,
      hermesUrl,
      claimTopology: true,
      code: null,
      decision,
      note: 'Real Hermes endpoint configured for required claim topology.',
    };
  }

  // non-critical / optional (de-scoped): claim path never depends on mock or presence.
  const mockSmoke = classification === 'mock';
  return {
    ok: true,
    required: false,
    role,
    classification,
    hermesUrl: hermesUrl || null,
    claimTopology: false,
    code: null,
    decision,
    note: mockSmoke
      ? 'hermes-mock is optional non-claim smoke only; not part of factory-of-record claim topology (GitLab #272).'
      : classification === 'unset'
        ? 'Hermes unset is allowed: non-critical for Simple factory claims (GitLab #272).'
        : 'Hermes URL present but not required for factory claim topology (GitLab #272).',
  };
}

function createHermesClaimError(evaluation) {
  const error = new Error(evaluation.note || 'Hermes claim topology check failed');
  error.code = evaluation.code || HERMES_CLAIM_ERROR_CODES.REQUIRED_UNAVAILABLE;
  error.details = {
    role: evaluation.role,
    classification: evaluation.classification,
    hermesUrl: evaluation.hermesUrl,
    required: evaluation.required,
    issue: 272,
  };
  return error;
}

/**
 * Fail closed when Hermes is required and endpoint is missing/mock.
 * No-op under default de-scope.
 */
function assertHermesEligibleForClaim(options = {}) {
  const evaluation = evaluateHermesClaimTopology(options);
  if (!evaluation.ok) {
    throw createHermesClaimError(evaluation);
  }
  return evaluation;
}

/**
 * Health/status helper: classify optional Hermes mock probe for stack reports.
 */
function describeHermesForStackHealth(options = {}) {
  const evaluation = evaluateHermesClaimTopology(options);
  return {
    ...evaluation,
    optional: evaluation.required !== true,
    liveClaimRequired: evaluation.required === true,
    mockAllowedForClaims: false,
  };
}

module.exports = {
  DEFAULT_HERMES_MOCK_PORT,
  HERMES_CLAIM_DECISION,
  HERMES_CLAIM_ERROR_CODES,
  isHermesMockBaseUrl,
  classifyHermesEndpoint,
  resolveHermesClaimRole,
  isHermesRequiredForClaim,
  isLiveLikeProofProfile,
  evaluateHermesClaimTopology,
  assertHermesEligibleForClaim,
  createHermesClaimError,
  describeHermesForStackHealth,
};
