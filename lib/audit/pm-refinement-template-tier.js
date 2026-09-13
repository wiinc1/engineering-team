'use strict';

function resolvePmRefinementTemplateTier(body = {}, options = {}, env = process.env) {
  return body.templateTier
    || body.template_tier
    || options.templateTier
    || options.template_tier
    || env.FACTORY_TEMPLATE_TIER
    || 'Standard';
}

function buildPmRefinementContractHttpBody({
  pmDraft,
  uiUxIntake,
  idempotencyKey,
  contractIsValid,
  waitingState,
  defaultOperatorVerificationPath,
}) {
  return {
    templateTier: pmDraft.templateTier,
    sections: pmDraft.sections,
    ...(pmDraft.riskFlags.length ? { riskFlags: pmDraft.riskFlags } : {}),
    ...(uiUxIntake ? {
      dispatchSignals: { workCategory: 'ui_ux' },
      operatorVerificationPath: defaultOperatorVerificationPath(),
      runnableSurface: {
        branch: 'main',
        serveUrl: 'http://127.0.0.1:15173',
        mergePolicy: 'required_before_submission_final',
      },
    } : {}),
    idempotencyKey: `${idempotencyKey}:execution-contract`,
    actorType: 'agent',
    ...(contractIsValid ? { waitingState } : {}),
  };
}

async function maybeStartPmRefinementReviewerRouting({
  contractIsValid,
  startReviewerRouting,
  store,
  context,
  taskId,
  contract,
  summary,
  idempotencyKey,
  options,
  recordSectionReview,
  loadExecutionContractContext,
  source,
  logger,
}) {
  if (!contractIsValid) return null;
  return startReviewerRouting({
    store,
    context,
    taskId,
    contract,
    summary,
    idempotencyKey,
    options,
    recordSectionReview,
    loadLatestContract: async () => {
      const { projection } = await loadExecutionContractContext(store, taskId, context.tenantId);
      return projection.latest || null;
    },
    source,
    logger,
  });
}

module.exports = {
  resolvePmRefinementTemplateTier,
  buildPmRefinementContractHttpBody,
  maybeStartPmRefinementReviewerRouting,
};
