const { assertGoldenPathRealEvidencePreflight } = require('./golden-path-real-evidence-preflight');
const { hasFactoryItemRealDeliveryIntent } = require('./factory-delivery-shared');
const { buildPhaseRunnerOptions } = require('./factory-phase-runner-options');

function requiresFactoryRealEvidencePreflight(config = {}, item = {}) {
  return config.requireRealEvidence === true
    || config.collectRealEvidence === true
    || config.agentDrivenPhases === true
    || hasFactoryItemRealDeliveryIntent(item);
}

function phaseRangeForStage(stage, evidence = null) {
  if (stage === 'phase6_complete') return { fromPhase: 6, toPhase: 6, resumePhase6Only: true };
  if (stage !== 'phase1_complete') return { fromPhase: 2, toPhase: 6, resumePhase6Only: false };
  return String(evidence?.status || '') === 'phase5_complete'
    ? { fromPhase: 6, toPhase: 6, resumePhase6Only: true }
    : { fromPhase: 2, toPhase: 6, resumePhase6Only: false };
}

function assertFactoryItemRealEvidencePreflightForStage(config = {}, item = {}, stage = '', evidence = null) {
  if (!requiresFactoryRealEvidencePreflight(config, item)) return { required: false, failures: [] };
  return assertGoldenPathRealEvidencePreflight({
    ...buildPhaseRunnerOptions(config, item),
    ...phaseRangeForStage(stage, evidence),
  }, { context: 'Factory delivery item' });
}

module.exports = {
  assertFactoryItemRealEvidencePreflightForStage,
  phaseRangeForStage,
  requiresFactoryRealEvidencePreflight,
};
