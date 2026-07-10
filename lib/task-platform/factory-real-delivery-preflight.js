const { assertGoldenPathRealEvidencePreflight } = require('./golden-path-real-evidence-preflight');
const { hasFactoryItemRealDeliveryIntent } = require('./factory-delivery-shared');
const { buildPhaseRunnerOptions } = require('./factory-phase-runner-options');
const { isLocalGoldenPathBaseUrl } = require('./staging-runtime');

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function wantsExplicitHostedRealEvidence(env = process.env) {
  return parseBooleanEnv(env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE, false)
    || parseBooleanEnv(env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE, false)
    || parseBooleanEnv(env.STAGING_REQUIRE_REAL_EVIDENCE, false);
}

function isLocalCoordinatedStackConfig(config = {}) {
  return isLocalGoldenPathBaseUrl(config.baseUrl)
    || isLocalGoldenPathBaseUrl(config.operatorUrl);
}

/**
 * Hosted real-delivery preflight is required for items with real-delivery intent or
 * explicit golden-path real-evidence flags. Local coordinated-stack live OpenClaw
 * proof sets agentDrivenPhases without implying hosted release/PR evidence.
 */
function requiresFactoryRealEvidencePreflight(config = {}, item = {}, env = process.env) {
  if (hasFactoryItemRealDeliveryIntent(item)) return true;
  if (wantsExplicitHostedRealEvidence(env)) return true;
  if (isLocalCoordinatedStackConfig(config) && !wantsExplicitHostedRealEvidence(env)) {
    return false;
  }
  return config.requireRealEvidence === true
    || config.collectRealEvidence === true
    || config.agentDrivenPhases === true;
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
