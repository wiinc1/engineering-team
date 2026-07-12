'use strict';

/**
 * Local live/fixture factory proof may skip forgeadapter seed/start/review
 * only when Simple-class forge-optional policy allows it (GitLab #273).
 * Hosted/real-forge and non-Simple claim paths fail closed on skip.
 */

const {
  resolveForgeSkipDecision,
  assertForgeSkipAllowed,
  resolveForgeClaimPolicy,
  POLICY_VERSION,
  FORGE_GP_STEPS,
} = require('./forge-claim-policy');

function shouldSkipForgePhases(options = {}, phase2Result = null, env = process.env) {
  // Policy gate first — throws FORGE_SKIP_FORBIDDEN for forge-required classes.
  const decision = resolveForgeSkipDecision(options, env, phase2Result);
  if (decision.skip) return true;
  // Legacy detection when skip not requested via flags but phase2 already skipped.
  if (phase2Result?.stack?.skipped === true) return true;
  if (phase2Result?.api?.stackHealth?.skipped === true) return true;
  if (phase2Result?.api?.seed?.skipped === true) return true;
  if (phase2Result != null && !phase2Result.forge && phase2Result.api?.seed?.skipped === true) return true;
  return false;
}

function buildSkippedForgeSeedApi(policyRecord = null) {
  const reason = policyRecord?.policyVersion
    ? `skip_forge_seed:${policyRecord.policyVersion}`
    : 'skip_forge_seed';
  const policy = policyRecord || {
    policyVersion: POLICY_VERSION,
    mode: 'simple_optional_skip',
    skipped: true,
    rationale: 'Simple-class forge-optional skip (GitLab #273).',
    skippedSteps: [...FORGE_GP_STEPS],
  };
  return {
    seed: { ok: true, skipped: true, reason, forgePolicy: policy },
    readiness: {
      ok: true,
      skipped: true,
      reason,
      status: 200,
      body: { ready: true, skipped: true, forgePolicy: policy },
    },
    start: {
      ok: true,
      skipped: true,
      reason,
      action: { jobId: null },
      job: { id: null, jobId: null, status: 'skipped' },
    },
    stack: {
      skipped: true,
      reason,
      source: 'skip_forge_seed',
      baseUrl: null,
      faToken: null,
      forgePolicy: policy,
    },
    stackHealth: { ok: true, skipped: true, reason, forgePolicy: policy },
    runtimeAfterStart: { executionState: 'skipped_forge_seed', forgePolicy: policy },
    forgePolicy: policy,
  };
}

function buildSkippedForgeJob(reason = 'skip_forge_seed', policyRecord = null) {
  return {
    ok: true,
    skipped: true,
    reason,
    forgePolicy: policyRecord || null,
    action: { jobId: null },
    job: { id: null, jobId: null, status: 'skipped' },
  };
}

function buildSkippedForgeRuntime(reason = 'skipped_forge_seed', policyRecord = null) {
  return {
    response: { status: 200 },
    body: {
      executionState: reason,
      workflowState: reason,
      skipped: true,
      forgePolicy: policyRecord || null,
    },
  };
}

module.exports = {
  shouldSkipForgePhases,
  buildSkippedForgeSeedApi,
  buildSkippedForgeJob,
  buildSkippedForgeRuntime,
  // re-export policy helpers used by phases / auditor
  resolveForgeSkipDecision,
  assertForgeSkipAllowed,
  resolveForgeClaimPolicy,
  POLICY_VERSION,
  FORGE_GP_STEPS,
};
