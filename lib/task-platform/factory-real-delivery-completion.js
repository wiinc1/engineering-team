const path = require('node:path');
const { verifyRealAutonomousDeliveryEvidence } = require('./real-autonomous-delivery-evidence');
const {
  buildRealAutonomousDeliveryEvidence,
  writeRealAutonomousDeliveryEvidence,
} = require('./real-autonomous-delivery-builder');
const { factoryCandidateProofPath } = require('./factory-real-delivery-candidate');
const {
  DEFAULT_DELIVERY_DIR,
  hasFactoryItemRealDeliveryIntent,
  itemRealDelivery,
} = require('./factory-delivery-shared');

function requiresFactoryFinalProof(config = {}, item = {}) {
  return config.requireRealEvidence === true
    || config.collectRealEvidence === true
    || config.agentDrivenPhases === true
    || hasFactoryItemRealDeliveryIntent(item);
}

function isTestFinalProofInjection() {
  return process.env.NODE_ENV === 'test';
}

function assertNoProductionFinalProofInjection(config = {}, item = {}, keys = []) {
  if (!requiresFactoryFinalProof(config, item) || isTestFinalProofInjection(config)) return;
  const injected = keys.filter((key) => typeof config[key] === 'function');
  if (injected.length) {
    throw new Error(`${injected.join(', ')} custom factory final proof hooks are only allowed in test mode`);
  }
}

function factoryEvidencePath(item = {}) {
  const realDelivery = itemRealDelivery(item);
  return item.realAutonomousDeliveryEvidencePath
    || item.realDeliveryFinalEvidencePath
    || realDelivery.finalEvidencePath
    || realDelivery.realAutonomousDeliveryEvidencePath
    || realDelivery.realDeliveryFinalEvidencePath
    || item.evidencePath
    || null;
}

function factoryCompletionCandidateProofPath(config = {}, item = {}) {
  const realDelivery = itemRealDelivery(item);
  return item.realDeliveryCandidateProofPath
    || realDelivery.candidateProofPath
    || realDelivery.realDeliveryCandidateProofPath
    || config.realDeliveryCandidateProofPath
    || factoryCandidateProofPath(config, item);
}

function factoryCompletionReleaseEnv(config = {}, item = {}) {
  return itemRealDelivery(item).releaseEnv || config.releaseEnv || '';
}

function factoryCompletionFinalEvidencePath(config = {}, item = {}) {
  const realDelivery = itemRealDelivery(item);
  return item.realAutonomousDeliveryEvidencePath
    || item.realDeliveryFinalEvidencePath
    || realDelivery.finalEvidencePath
    || realDelivery.realAutonomousDeliveryEvidencePath
    || realDelivery.realDeliveryFinalEvidencePath
    || config.realAutonomousDeliveryEvidencePath
    || config.realDeliveryFinalEvidencePath
    || path.join(config.deliveryDir || DEFAULT_DELIVERY_DIR, `${item.id || 'factory'}-real-autonomous-delivery-evidence.json`);
}

function factoryCompletionSourceEvidencePath(config = {}, item = {}) {
  const realDelivery = itemRealDelivery(item);
  return item.sourceEvidencePath
    || item.goldenPathEvidencePath
    || realDelivery.sourceEvidencePath
    || realDelivery.goldenPathEvidencePath
    || config.realDeliverySourceEvidencePath
    || config.sourceEvidencePath
    || item.evidencePath
    || null;
}

function itemWithFinalProofMetadata(item, completion) {
  if (!completion?.evidencePath || completion.skipped === true) return item;
  const current = item.metadata?.realDelivery || item.realDelivery || {};
  return {
    ...item,
    metadata: {
      ...(item.metadata || {}),
      realDelivery: {
        ...current,
        finalEvidencePath: completion.evidencePath,
        candidateProofPath: completion.build?.verification?.candidateProofPath || current.candidateProofPath,
      },
    },
  };
}

function finalEvidenceBuilderOptions(config = {}, item = {}) {
  const realDelivery = itemRealDelivery(item);
  return {
    cwd: config.repoRoot || process.cwd(),
    baseUrl: config.baseUrl,
    operatorUrl: config.operatorUrl,
    deploymentUrl: realDelivery.deploymentUrl || config.deploymentUrl || config.productionUrl,
    productionUrl: realDelivery.productionUrl || config.productionUrl,
    ciRepository: realDelivery.ciRepository || realDelivery.repository || config.ciRepository,
    branchName: realDelivery.branchName || realDelivery.branch || config.branchName,
    implementationCommitSha: realDelivery.implementationCommitSha
      || realDelivery.commitSha
      || config.implementationCommitSha
      || config.commitSha,
    prUrl: realDelivery.prUrl || realDelivery.pullRequestUrl || config.prUrl,
    prNumber: realDelivery.prNumber || realDelivery.pullRequestNumber || config.prNumber,
    githubToken: config.githubToken,
    githubApiBaseUrl: config.githubApiBaseUrl,
    releaseEnv: factoryCompletionReleaseEnv(config, item),
    changeKind: item.changeKind || config.changeKind,
    templateTier: item.templateTier || config.templateTier,
    changeReversibility: config.changeReversibility,
    rollbackTarget: realDelivery.rollbackTarget || config.rollbackTarget,
    rollbackEvidence: realDelivery.rollbackEvidence || realDelivery.rollbackEvidencePath || config.realDeliveryRollbackEvidence || config.rollbackEvidence,
    rollbackVerified: realDelivery.rollbackVerified === true || config.rollbackVerified === true,
    candidateProofPath: factoryCompletionCandidateProofPath(config, item),
    releaseArtifactDir: realDelivery.releaseArtifactDir || config.releaseArtifactDir,
    useExistingReleaseArtifacts: realDelivery.useExistingReleaseArtifacts === true || config.useExistingReleaseArtifacts === true,
    releaseArtifactCommands: realDelivery.releaseArtifactCommands || config.releaseArtifactCommands,
    releaseArtifactCommandTimeoutMs: config.releaseArtifactCommandTimeoutMs,
    releaseEvidenceBuilder: config.releaseEvidenceBuilder,
    healthCheckPath: realDelivery.healthCheckPath || config.realDeliveryHealthCheckPath || config.healthCheckPath,
    requireHealthCommit: realDelivery.requireHealthCommit === true || config.requireHealthCommit === true,
    allowMockGitHubEvidence: config.allowMockGitHubEvidence === true,
    allowTestGitHubEvidenceInjection: config.allowTestGitHubEvidenceInjection === true,
    env: config.env,
    fetchImpl: config.realDeliveryFetchImpl || config.fetchImpl,
    sourceEvidencePath: factoryCompletionSourceEvidencePath(config, item),
  };
}

async function buildFactoryRealDeliveryCompletionEvidence(config = {}, item = {}) {
  if (!requiresFactoryFinalProof(config, item)) {
    return { ok: true, skipped: true, evidencePath: factoryEvidencePath(item), build: null };
  }
  assertNoProductionFinalProofInjection(config, item, [
    'realAutonomousDeliveryBuilder',
    'realAutonomousDeliveryEvidenceWriter',
  ]);
  const evidencePath = factoryCompletionFinalEvidencePath(config, item);
  const builder = config.realAutonomousDeliveryBuilder || buildRealAutonomousDeliveryEvidence;
  const build = await builder(finalEvidenceBuilderOptions(config, item));
  const writer = config.realAutonomousDeliveryEvidenceWriter || writeRealAutonomousDeliveryEvidence;
  writer(config.repoRoot || process.cwd(), evidencePath, build.evidence);
  return { ok: true, skipped: false, evidencePath, build };
}

function verifyFactoryRealDeliveryCompletion(config = {}, item = {}) {
  if (!requiresFactoryFinalProof(config, item)) {
    return { ok: true, skipped: true, result: null };
  }
  const evidencePath = factoryEvidencePath(item);
  if (!evidencePath) {
    throw new Error('Factory real-delivery completion proof requires an evidencePath');
  }
  assertNoProductionFinalProofInjection(config, item, ['realAutonomousDeliveryVerifier']);
  const verifier = config.realAutonomousDeliveryVerifier || verifyRealAutonomousDeliveryEvidence;
  const result = verifier({
    evidencePath,
    candidateProofPath: factoryCompletionCandidateProofPath(config, item),
    requireCandidateProof: true,
    repoRoot: config.repoRoot || process.cwd(),
    releaseEnv: factoryCompletionReleaseEnv(config, item),
  });
  if (!result.ok) {
    throw new Error(`Factory real-delivery completion proof failed (${evidencePath}): ${result.failures.join('; ')}`);
  }
  return { ok: true, skipped: false, result };
}

async function completeFactoryRealDeliveryProof(config = {}, item = {}) {
  const built = await buildFactoryRealDeliveryCompletionEvidence(config, item);
  if (built.skipped) return { ok: true, skipped: true, evidencePath: built.evidencePath, result: null };
  const verified = verifyFactoryRealDeliveryCompletion(config, {
    ...item,
    realAutonomousDeliveryEvidencePath: built.evidencePath,
  });
  return { ...verified, evidencePath: built.evidencePath, build: built.build };
}

module.exports = {
  buildFactoryRealDeliveryCompletionEvidence,
  completeFactoryRealDeliveryProof,
  factoryCompletionCandidateProofPath,
  factoryCompletionFinalEvidencePath,
  factoryCompletionReleaseEnv,
  factoryCompletionSourceEvidencePath,
  factoryEvidencePath,
  finalEvidenceBuilderOptions,
  assertNoProductionFinalProofInjection,
  itemWithFinalProofMetadata,
  requiresFactoryFinalProof,
  verifyFactoryRealDeliveryCompletion,
};
