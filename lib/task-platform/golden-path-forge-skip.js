'use strict';

/**
 * Local live/fixture factory proof may skip forgeadapter seed/start/review.
 * Hosted real-evidence paths keep forge on.
 */

function shouldSkipForgePhases(options = {}, phase2Result = null) {
  return options.skipForgeSeed === true
    || options.skipForgePhases === true
    || process.env.STAGING_SKIP_FORGE_SEED === 'true'
    || process.env.STAGING_SKIP_FORGE_PHASES === 'true'
    || phase2Result?.stack?.skipped === true
    || phase2Result?.api?.stackHealth?.skipped === true
    || phase2Result?.api?.seed?.skipped === true
    || (phase2Result != null && !phase2Result.forge);
}

function buildSkippedForgeSeedApi() {
  return {
    seed: { ok: true, skipped: true, reason: 'skip_forge_seed' },
    readiness: {
      ok: true,
      skipped: true,
      reason: 'skip_forge_seed',
      status: 200,
      body: { ready: true, skipped: true },
    },
    start: {
      ok: true,
      skipped: true,
      reason: 'skip_forge_seed',
      action: { jobId: null },
      job: { id: null, jobId: null, status: 'skipped' },
    },
    stack: {
      skipped: true,
      reason: 'skip_forge_seed',
      source: 'skip_forge_seed',
      baseUrl: null,
      faToken: null,
    },
    stackHealth: { ok: true, skipped: true, reason: 'skip_forge_seed' },
    runtimeAfterStart: { executionState: 'skipped_forge_seed' },
  };
}

function buildSkippedForgeJob(reason = 'skip_forge_seed') {
  return {
    ok: true,
    skipped: true,
    reason,
    action: { jobId: null },
    job: { id: null, jobId: null, status: 'skipped' },
  };
}

function buildSkippedForgeRuntime(reason = 'skipped_forge_seed') {
  return {
    response: { status: 200 },
    body: { executionState: reason, workflowState: reason },
  };
}

module.exports = {
  shouldSkipForgePhases,
  buildSkippedForgeSeedApi,
  buildSkippedForgeJob,
  buildSkippedForgeRuntime,
};
