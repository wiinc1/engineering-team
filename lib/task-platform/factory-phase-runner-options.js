const path = require('node:path');
const {
  DEFAULT_DELIVERY_DIR,
  evidencePathForItem,
  persistDirForItem,
  makeForgeTaskId,
  hasFactoryItemRealDeliveryIntent,
  itemRealDelivery,
} = require('./factory-delivery-shared');

function firstConfiguredValue(...values) {
  return values.find((value) => value != null && value !== '');
}

function firstNonEmptyArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length) || [];
}

function requiresDefaultCandidateProofPath(config = {}, item = {}) {
  if (hasFactoryItemRealDeliveryIntent(item)) return true;
  const profile = String(config.proofProfile || process.env.FACTORY_PROOF_PROFILE || '').trim().toLowerCase();
  if (profile === 'live' || profile === 'fixture') {
    return config.requireRealEvidence === true || config.collectRealEvidence === true;
  }
  return config.requireRealEvidence === true
    || config.collectRealEvidence === true
    || config.agentDrivenPhases === true;
}

function defaultFactoryCandidateProofPath(config = {}, item = {}) {
  return path.join(
    config.deliveryDir || DEFAULT_DELIVERY_DIR,
    `${item.id || 'factory'}-real-delivery-candidate-proof.json`,
  );
}

function itemCandidateProofPath(config = {}, item = {}, realDelivery = itemRealDelivery(item)) {
  return firstConfiguredValue(
    item.realDeliveryCandidateProofPath,
    realDelivery.candidateProofPath,
    realDelivery.realDeliveryCandidateProofPath,
    config.realDeliveryCandidateProofPath,
  ) || (
    requiresDefaultCandidateProofPath(config, item)
      ? defaultFactoryCandidateProofPath(config, item)
      : null
  );
}

function resolveItemReleaseOptions(config = {}, item = {}) {
  const realDelivery = itemRealDelivery(item);
  const healthCheckPath = firstConfiguredValue(realDelivery.healthCheckPath, config.realDeliveryHealthCheckPath);
  const candidateProofPath = itemCandidateProofPath(config, item, realDelivery);
  const riskLevel = firstConfiguredValue(realDelivery.riskLevel, config.realDeliveryRiskLevel, config.riskLevel);
  const productionSafe = realDelivery.productionSafe === true
    || config.realDeliveryProductionSafe === true
    || config.productionSafe === true;
  const candidateTestCommands = firstNonEmptyArray(
    item.testCommands,
    realDelivery.testCommands,
    config.realDeliveryTestCommands,
    config.candidateTestCommands,
    config.testCommands,
  );
  return {
    releaseEnv: firstConfiguredValue(realDelivery.releaseEnv, config.releaseEnv),
    deploymentUrl: firstConfiguredValue(realDelivery.deploymentUrl, config.deploymentUrl, config.operatorUrl),
    productionUrl: firstConfiguredValue(realDelivery.productionUrl, config.productionUrl),
    rollbackTarget: firstConfiguredValue(realDelivery.rollbackTarget, config.rollbackTarget),
    rollbackPlan: firstConfiguredValue(realDelivery.rollbackPlan, config.rollbackPlan),
    productionSafetyEvidence: firstConfiguredValue(
      realDelivery.productionSafetyEvidence,
      realDelivery.productionSafetyEvidencePath,
      config.realDeliveryProductionSafetyEvidence,
      config.productionSafetyEvidence,
    ),
    rollbackEvidence: firstConfiguredValue(
      realDelivery.rollbackEvidence,
      realDelivery.rollbackEvidencePath,
      config.realDeliveryRollbackEvidence,
      config.rollbackEvidence,
    ),
    rollbackVerified: realDelivery.rollbackVerified === true || config.rollbackVerified === true,
    riskLevel,
    realDeliveryRiskLevel: riskLevel,
    productionSafe,
    realDeliveryProductionSafe: productionSafe,
    candidateTestCommands,
    realDeliveryTestCommands: candidateTestCommands,
    realDeliveryHealthCheckPath: healthCheckPath,
    healthCheckPath,
    candidateProofPath,
    realDeliveryCandidateProofPath: candidateProofPath,
    maxChangedFiles: firstConfiguredValue(realDelivery.maxChangedFiles, config.realDeliveryMaxChangedFiles, config.maxChangedFiles),
  };
}

function basePhaseRunnerOptions(config, item, evidencePath, stackPersistDir) {
  return {
    baseUrl: config.baseUrl,
    jwtSecret: config.jwtSecret,
    tenantId: config.tenantId,
    actorId: config.actorId,
    fetchImpl: config.fetchImpl,
    outputPath: evidencePath,
    persistDir: null,
    stackPersistDir,
    skipValidation: config.skipValidation === true,
    changeKind: item.changeKind || config.changeKind,
    changeReversibility: config.changeReversibility,
    templateTier: item.templateTier || config.templateTier,
    changedFiles: item.changedFiles || config.changedFiles,
    factoryRequirements: item.requirements || config.factoryRequirements || null,
    requirements: item.requirements || null,
  };
}

function githubPhaseRunnerOptions(config, item = {}) {
  const realDelivery = itemRealDelivery(item);
  return {
    checks: item.checks || realDelivery.checks || config.checks,
    requiredChecks: item.requiredChecks || realDelivery.requiredChecks || config.requiredChecks,
    branchProtection: item.branchProtection || realDelivery.branchProtection || config.branchProtection,
    mergeReadiness: item.mergeReadiness || realDelivery.mergeReadiness || config.mergeReadiness,
    ciRepository: realDelivery.ciRepository || realDelivery.repository || config.ciRepository,
    branchName: realDelivery.branchName || realDelivery.branch || config.branchName,
    implementationCommitSha: realDelivery.implementationCommitSha
      || realDelivery.commitSha
      || config.implementationCommitSha,
    commitSha: realDelivery.commitSha || config.commitSha,
    prUrl: realDelivery.prUrl || realDelivery.pullRequestUrl || config.prUrl,
    prNumber: realDelivery.prNumber || realDelivery.pullRequestNumber || config.prNumber,
    fixBranchName: config.fixBranchName,
    fixCommitSha: config.fixCommitSha,
    fixPrUrl: config.fixPrUrl,
    mergeCommitSha: config.mergeCommitSha,
    autoMerge: realDelivery.autoMerge === true || config.autoMerge === true,
  };
}

function evidenceModeOptions(config, item = {}) {
  const itemRequiresRealEvidence = hasFactoryItemRealDeliveryIntent(item);
  const realDelivery = itemRealDelivery(item);
  const profile = String(config.proofProfile || process.env.FACTORY_PROOF_PROFILE || '').trim().toLowerCase();
  const factoryProofActive = profile === 'live' || profile === 'fixture';
  const tier = String(item.templateTier || config.templateTier || 'Simple').trim().toLowerCase();
  const trustedSimple = config.trustedDelivery === true
    || config.requireTrustedSimpleClose === true
    || config.trustedSimpleClose === true
    || ['1', 'true', 'yes', 'on'].includes(String(process.env.FACTORY_TRUSTED_DELIVERY || '').trim().toLowerCase())
    || ['1', 'true', 'yes', 'on'].includes(String(process.env.FF_FACTORY_TRUSTED_SIMPLE_CLOSE || '').trim().toLowerCase());
  // GitLab #274: trusted Simple close always requires real PR/merge evidence (not session-proof synthetic JSON).
  const requireTrustedSimpleClose = trustedSimple && (tier === 'simple' || !item.templateTier);
  const requireRealEvidence = config.requireRealEvidence === true
    || itemRequiresRealEvidence
    || requireTrustedSimpleClose;
  const collectRealEvidence = config.collectRealEvidence === true
    || itemRequiresRealEvidence
    || requireTrustedSimpleClose;
  const factoryGeneratesCandidateProof = config.generateCandidateProof === true
    || requireRealEvidence
    || collectRealEvidence
    || (!factoryProofActive && config.agentDrivenPhases === true);
  return {
    collectRealEvidence,
    requireRealEvidence,
    trustedDelivery: requireTrustedSimpleClose || config.trustedDelivery === true,
    trustedSimpleClose: requireTrustedSimpleClose,
    proofProfile: config.proofProfile || process.env.FACTORY_PROOF_PROFILE || null,
    generateCandidateProof: factoryGeneratesCandidateProof,
    githubToken: config.githubToken,
    githubApiBaseUrl: config.githubApiBaseUrl,
    releaseArtifactDir: realDelivery.releaseArtifactDir || config.releaseArtifactDir,
    releaseArtifactCommands: realDelivery.releaseArtifactCommands || config.releaseArtifactCommands,
    releaseArtifactCommandTimeoutMs: config.releaseArtifactCommandTimeoutMs,
    useExistingReleaseArtifacts: realDelivery.useExistingReleaseArtifacts === true || config.useExistingReleaseArtifacts === true,
    requireHealthyDeployment: config.requireHealthyDeployment !== false,
    requireHealthCommit: realDelivery.requireHealthCommit === true || config.requireHealthCommit === true,
  };
}

function runtimePhaseRunnerOptions(config, item) {
  return {
    skipForgeSeed: config.skipForgeSeed === true,
    skipForgePhases: config.skipForgePhases === true,
    forgeAdapterBaseUrl: config.forgeAdapterUrl,
    forgeServiceToken: config.forgeServiceToken,
    forgeAdapterToken: config.forgeAdapterToken,
    operatorUrl: config.operatorUrl,
    openclawUrl: config.openclawUrl || undefined,
    hermesUrl: config.hermesUrl || undefined,
    skipDelegationSmoke: config.requireDelegationSmoke !== true,
    agentDrivenPhase1: config.agentDrivenPhase1 === true,
    agentDrivenPhases: config.agentDrivenPhases === true,
    useVersionedTaskApi: config.useVersionedTaskApi === true,
  };
}

function buildPhaseRunnerOptions(config, item) {
  const evidencePath = item.evidencePath || evidencePathForItem(item, config.deliveryDir);
  const stackPersistDir = item.persistDir || persistDirForItem(item, config.deliveryDir);
  return {
    ...basePhaseRunnerOptions(config, item, evidencePath, stackPersistDir),
    ...githubPhaseRunnerOptions(config, item),
    ...evidenceModeOptions(config, item),
    ...resolveItemReleaseOptions(config, item),
    taskId: item.taskId,
    projectId: item.projectId,
    forgeTaskId: item.forgeTaskId || makeForgeTaskId(item.id),
    ...runtimePhaseRunnerOptions(config, item),
  };
}

module.exports = {
  buildPhaseRunnerOptions,
  defaultFactoryCandidateProofPath,
  evidenceModeOptions,
  firstConfiguredValue,
  firstNonEmptyArray,
  itemCandidateProofPath,
  requiresDefaultCandidateProofPath,
  resolveItemReleaseOptions,
};
