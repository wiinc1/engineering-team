'use strict';

/**
 * GitLab #273 — forge claim-path policy.
 *
 * Decision: Simple-class local claim path may skip forgeadapter lifecycle
 * (session-proof / live OpenClaw ET agents without forge). Non-Simple (or
 * explicit forge-required) paths fail closed when forge is skipped so claim
 * inventory cannot false-green forge GP steps.
 *
 * Spike (2026-07-11): live OpenClaw at :18789 reports health ok, but
 * POST /sessions/:id/children (and common variants) is not exposed — child
 * session forge lifecycle remains unavailable. Product path is Simple
 * forge-optional + honest skip labeling.
 */

const PHASE2_FORGE_GP_STEPS = Object.freeze([
  'GP-009',
  'GP-010',
  'GP-011',
  'GP-012',
  'GP-014',
]);

/** All forgeadapter-owned golden-path steps (seed/start/review/resume/complete). */
const FORGE_GP_STEPS = Object.freeze([
  ...PHASE2_FORGE_GP_STEPS,
  'GP-016',
  'GP-018',
  'GP-020',
]);

const POLICY_VERSION = 'simple-class-forge-optional.v1';
const POLICY_NAME = 'simple-class-forge-optional';

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function normalizeTier(value) {
  const tier = String(value || 'Simple').trim();
  if (!tier) return 'Simple';
  return tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase();
}

function envSkipRequested(env = process.env) {
  return parseBoolean(env.STAGING_SKIP_FORGE_SEED, false)
    || parseBoolean(env.STAGING_SKIP_FORGE_PHASES, false);
}

function optionsSkipRequested(options = {}) {
  return options.skipForgeSeed === true || options.skipForgePhases === true;
}

/**
 * Whether caller/env is asking to skip forge seed/phases.
 */
function isForgeSkipRequested(options = {}, env = process.env, phase2Result = null) {
  if (optionsSkipRequested(options) || envSkipRequested(env)) return true;
  if (phase2Result?.stack?.skipped === true) return true;
  if (phase2Result?.api?.stackHealth?.skipped === true) return true;
  if (phase2Result?.api?.seed?.skipped === true) return true;
  if (phase2Result?.forgePolicy?.skipped === true) return true;
  if (phase2Result != null && phase2Result.forge == null && phase2Result.stack?.skipped === true) return true;
  return false;
}

/**
 * Resolve forge claim policy for this run.
 * @returns {{
 *  policyName: string,
 *  policyVersion: string,
 *  templateTier: string,
 *  forgeRequired: boolean,
 *  skipRequested: boolean,
 *  canSkip: boolean,
 *  mode: 'live_forge'|'simple_optional_skip'|'skip_forbidden',
 *  rationale: string,
 *  forgeGpSteps: string[],
 * }}
 */
function resolveForgeClaimPolicy(options = {}, env = process.env, phase2Result = null) {
  const templateTier = normalizeTier(
    options.templateTier
      || options.tier
      || options.factoryTemplateTier
      || env.FACTORY_TEMPLATE_TIER
      || 'Simple',
  );
  const forceForgeRequired = options.forgeRequired === true
    || parseBoolean(env.FACTORY_FORGE_REQUIRED, false)
    || parseBoolean(env.FF_FACTORY_FORGE_REQUIRED, false);
  const forceAllowSkip = options.allowForgeSkip === true
    || parseBoolean(env.FACTORY_ALLOW_FORGE_SKIP, false);
  // Trusted real-evidence / real-delivery is not automatically forge-required
  // (PR path can proceed without forgeadapter), but higher tiers are.
  const forgeRequired = forceForgeRequired
    || (templateTier !== 'Simple' && !forceAllowSkip);

  const skipRequested = isForgeSkipRequested(options, env, phase2Result);
  const canSkip = !forgeRequired;
  let mode = 'live_forge';
  let rationale = 'Forgeadapter lifecycle is part of the claim path for this run.';
  if (skipRequested && canSkip) {
    mode = 'simple_optional_skip';
    rationale = 'Simple-class claim path treats forgeadapter seed/start/review as optional (GitLab #273). '
      + 'ET agent phases may run without forge; forge GP steps are labeled skipped with this policy — not real forge success. '
      + 'Live OpenClaw child-session protocol for forge is not available on this host.';
  } else if (skipRequested && !canSkip) {
    mode = 'skip_forbidden';
    rationale = `Forge is required for templateTier=${templateTier} (or FACTORY_FORGE_REQUIRED). `
      + 'Skipping forge seed/phases is not allowed; claim path would false-green forge GP steps.';
  } else if (!skipRequested && canSkip) {
    mode = 'live_forge';
    rationale = 'Simple-class run with forge enabled (no STAGING_SKIP_FORGE_* / skip flags).';
  }

  return {
    policyName: POLICY_NAME,
    policyVersion: POLICY_VERSION,
    templateTier,
    forgeRequired,
    skipRequested,
    canSkip,
    mode,
    rationale,
    forgeGpSteps: [...FORGE_GP_STEPS],
  };
}

/**
 * Fail closed when forge skip is requested but not allowed.
 */
function assertForgeSkipAllowed(options = {}, env = process.env, phase2Result = null) {
  const policy = resolveForgeClaimPolicy(options, env, phase2Result);
  if (policy.skipRequested && !policy.canSkip) {
    const error = new Error(
      `Forge skip forbidden for forge-required claim path (${policy.templateTier}): ${policy.rationale}`,
    );
    error.code = 'FORGE_SKIP_FORBIDDEN';
    error.forgePolicy = policy;
    throw error;
  }
  return policy;
}

/**
 * Whether forge phases should be skipped after policy gate.
 * Throws if skip is requested for a forge-required class.
 */
function resolveForgeSkipDecision(options = {}, env = process.env, phase2Result = null) {
  const policy = assertForgeSkipAllowed(options, env, phase2Result);
  const skip = policy.skipRequested && policy.canSkip;
  return {
    skip,
    policy,
    record: buildForgePolicyRecord(policy, { skipped: skip }),
  };
}

function buildForgePolicyRecord(policy, { skipped = false } = {}) {
  return {
    policyName: policy.policyName,
    policyVersion: policy.policyVersion,
    templateTier: policy.templateTier,
    forgeRequired: policy.forgeRequired,
    mode: skipped ? 'simple_optional_skip' : policy.mode,
    skipped: skipped === true,
    skipRequested: policy.skipRequested,
    rationale: policy.rationale,
    forgeGpSteps: policy.forgeGpSteps,
    skippedSteps: skipped ? [...policy.forgeGpSteps] : [],
    completedForgeSteps: skipped ? [] : [...policy.forgeGpSteps],
    openClawChildrenSpike: {
      status: 'blocked',
      probedAt: '2026-07-11',
      note: 'OpenClaw :18789 health live; POST /sessions/:id/children (and common variants) not exposed',
    },
  };
}

/**
 * Partition forge GP steps for inventory honesty.
 * @param {{ skipped?: boolean, includeGp013?: boolean, phase?: 'phase2'|'all' }} opts
 */
function partitionForgeSteps({ skipped = false, includeGp013 = false, phase = 'phase2' } = {}) {
  if (skipped) {
    return {
      completed: includeGp013 ? ['GP-013'] : [],
      // GP-013 is ET OpenClaw delegation, not forgeadapter
      skipped: [...FORGE_GP_STEPS],
    };
  }
  if (phase === 'all') {
    return {
      completed: includeGp013
        ? [...FORGE_GP_STEPS, 'GP-013']
        : [...FORGE_GP_STEPS],
      skipped: [],
    };
  }
  // phase2: only seed/start readiness steps; later forge steps complete in 3/4/5
  const completed = [...PHASE2_FORGE_GP_STEPS];
  if (includeGp013) completed.push('GP-013');
  return {
    completed,
    skipped: [],
  };
}

/**
 * Split a phase step list so forge-owned steps are skipped (not completed)
 * when Simple forge-optional skip is active.
 */
function partitionPhaseStepsWithForgePolicy({
  steps = [],
  forgeStepsInPhase = [],
  skipped = false,
} = {}) {
  const list = steps.map(String);
  if (!skipped) {
    return { steps: list, stepsSkipped: [] };
  }
  const forgeSet = new Set(forgeStepsInPhase.map(String));
  return {
    steps: list.filter((id) => !forgeSet.has(id)),
    stepsSkipped: list.filter((id) => forgeSet.has(id)),
  };
}

/**
 * Mark inventory/evidence so forge steps are not claimed automated when skipped.
 */
function applyForgeSkipToStepInventory(evidence = {}, policyRecord = {}) {
  const skippedSteps = new Set(policyRecord.skippedSteps || FORGE_GP_STEPS);
  const completed = (evidence.stepsCompleted || [])
    .map(String)
    .filter((step) => !skippedSteps.has(step));
  const existingSkipped = Array.isArray(evidence.stepsSkipped)
    ? evidence.stepsSkipped.map(String)
    : [];
  const mergedSkipped = [...new Set([...existingSkipped, ...skippedSteps])];
  return {
    ...evidence,
    stepsCompleted: completed,
    stepsSkipped: mergedSkipped,
    forgePolicy: policyRecord,
  };
}

function mergeStepsSkipped(existing = [], added = []) {
  return [...new Set([...existing, ...added].map(String))];
}

module.exports = {
  PHASE2_FORGE_GP_STEPS,
  FORGE_GP_STEPS,
  POLICY_VERSION,
  POLICY_NAME,
  normalizeTier,
  isForgeSkipRequested,
  resolveForgeClaimPolicy,
  assertForgeSkipAllowed,
  resolveForgeSkipDecision,
  buildForgePolicyRecord,
  partitionForgeSteps,
  partitionPhaseStepsWithForgePolicy,
  applyForgeSkipToStepInventory,
  mergeStepsSkipped,
};
