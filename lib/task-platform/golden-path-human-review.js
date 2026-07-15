'use strict';

function requiresHumanReview(ctx, options, contractBody) {
  return ctx.agentDrivenPhase1
    || options.agentDrivenPhases === true
    || contractBody.require_human_pm_architect_review === true;
}

async function recordGoldenPathHumanReview({
  ctx, options, contractBody, taskId, api, apiSend, runProjectionCatchUp,
}) {
  api.projectionPostContract = await runProjectionCatchUp(ctx, 'execution-contract-recorded');
  if (!requiresHumanReview(ctx, options, contractBody)) return;
  api.humanPmArchitectReview = await apiSend(
    ctx,
    `/api/v1/tasks/${encodeURIComponent(taskId)}/execution-contract/human-pm-architect-review`,
    'POST',
    ['pm', 'operator', 'admin', 'reader'],
    {
      role: 'both',
      reason: 'Supervised human acceptance of agent-authored PM/Architect proposals (Q6 / factory proof).',
      actorType: 'human',
      actorId: ctx.actorId || 'factory-operator',
    },
  );
  if (!api.humanPmArchitectReview.ok) {
    throw new Error(
      `Human PM/Architect review failed (${api.humanPmArchitectReview.status}): `
      + `${JSON.stringify(api.humanPmArchitectReview.body)}`,
    );
  }
  api.projectionPostHumanReview = await runProjectionCatchUp(ctx, 'pm-architect-human-review-recorded');
}

module.exports = { recordGoldenPathHumanReview, requiresHumanReview };
