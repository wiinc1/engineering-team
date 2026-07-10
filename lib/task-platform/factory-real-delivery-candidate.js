const path = require('node:path');
const { REAL_DELIVERY_CANDIDATE_SCHEMA_VERSION } = require('./real-delivery-candidate');
const {
  verifyRealDeliveryCandidateReleaseProof,
  writeRealDeliveryCandidateProof,
} = require('./real-delivery-candidate-proof');
const {
  hasFactoryItemRealDeliveryIntent,
  itemRealDelivery,
} = require('./factory-delivery-shared');
const { collectGitHubPullRequestEvidence } = require('./golden-path-real-evidence-collector');
const { runSourceIntegrity } = require('../../scripts/check-source-integrity');

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
  const base = String(config.baseUrl || config.operatorUrl || '').toLowerCase();
  return base.includes('127.0.0.1:13000') || base.includes('localhost:13000');
}

function requiresFactoryCandidateProof(config = {}, item = {}, env = process.env) {
  if (hasFactoryItemRealDeliveryIntent(item)) return true;
  if (wantsExplicitHostedRealEvidence(env)) return true;
  // Local live OpenClaw agent proof sets agentDrivenPhases without hosted candidate proof.
  if (isLocalCoordinatedStackConfig(config) && !wantsExplicitHostedRealEvidence(env)) {
    return false;
  }
  return config.requireRealEvidence === true
    || config.collectRealEvidence === true
    || config.agentDrivenPhases === true;
}

function factoryCandidateProofPath(config = {}, item = {}) {
  const realDelivery = itemRealDelivery(item);
  if (item.realDeliveryCandidateProofPath) return item.realDeliveryCandidateProofPath;
  if (realDelivery.candidateProofPath) return realDelivery.candidateProofPath;
  if (realDelivery.realDeliveryCandidateProofPath) return realDelivery.realDeliveryCandidateProofPath;
  if (config.realDeliveryCandidateProofPath) return config.realDeliveryCandidateProofPath;
  const deliveryDir = config.deliveryDir || 'observability/factory-delivery';
  return path.join(deliveryDir, `${item.id || 'factory'}-real-delivery-candidate-proof.json`);
}

function factoryCandidateChangedFiles(config = {}, item = {}) {
  return item.changedFiles || config.changedFiles || [];
}

function factoryCandidateTestCommands(config = {}, item = {}) {
  return item.testCommands || itemRealDelivery(item).testCommands || config.realDeliveryTestCommands || [];
}

function factoryCandidateGithubProof(config = {}, item = {}) {
  const realDelivery = itemRealDelivery(item);
  return {
    checks: item.checks || realDelivery.checks || config.checks,
    requiredChecks: item.requiredChecks || realDelivery.requiredChecks || config.requiredChecks,
    branchProtection: item.branchProtection || realDelivery.branchProtection || config.branchProtection,
    mergeReadiness: item.mergeReadiness || realDelivery.mergeReadiness || config.mergeReadiness,
    evidenceSource: item.githubEvidenceSource
      || realDelivery.githubEvidenceSource
      || realDelivery.evidenceSource
      || config.githubEvidenceSource
      || config.evidenceSource,
  };
}

function factoryCandidateGithubTarget(config = {}, item = {}) {
  const realDelivery = itemRealDelivery(item);
  return {
    ciRepository: realDelivery.ciRepository || realDelivery.repository || config.ciRepository,
    repository: realDelivery.ciRepository || realDelivery.repository || config.repository,
    branchName: realDelivery.branchName || realDelivery.branch || config.branchName,
    commitSha: realDelivery.implementationCommitSha
      || realDelivery.commitSha
      || config.implementationCommitSha
      || config.commitSha,
    implementationCommitSha: realDelivery.implementationCommitSha
      || realDelivery.commitSha
      || config.implementationCommitSha
      || config.commitSha,
    prUrl: realDelivery.prUrl || realDelivery.pullRequestUrl || config.prUrl,
    prNumber: realDelivery.prNumber || realDelivery.pullRequestNumber || config.prNumber,
  };
}

function collectedGithubProofFields(githubProof = {}) {
  if (!githubProof?.commitSha) return {};
  return Object.fromEntries(Object.entries({
    repository: githubProof.repository,
    branchName: githubProof.branchName,
    commitSha: githubProof.commitSha,
    prUrl: githubProof.prUrl,
    prNumber: githubProof.prNumber,
    checks: githubProof.checks,
    requiredChecks: githubProof.requiredChecks,
    branchProtection: githubProof.branchProtection,
    mergeReadiness: githubProof.mergeReadiness,
    evidenceSource: githubProof.evidenceSource,
  }).filter(([, value]) => value !== undefined));
}

function factoryCandidateRollbackVerified(config = {}, item = {}) {
  return config.rollbackVerified === true || itemRealDelivery(item).rollbackVerified === true;
}

function factoryCandidateRollbackEvidence(config = {}, item = {}) {
  const realDelivery = itemRealDelivery(item);
  return realDelivery.rollbackEvidence
    || realDelivery.rollbackEvidencePath
    || config.realDeliveryRollbackEvidence
    || config.rollbackEvidence
    || null;
}

function factoryCandidateProductionSafetyEvidence(config = {}, item = {}) {
  const realDelivery = itemRealDelivery(item);
  return realDelivery.productionSafetyEvidence
    || realDelivery.productionSafetyEvidencePath
    || config.realDeliveryProductionSafetyEvidence
    || config.productionSafetyEvidence
    || null;
}

function buildFactoryCandidateManifest(config = {}, item = {}, options = {}) {
  const realDelivery = itemRealDelivery(item);
  const githubProof = collectedGithubProofFields(options.githubProof);
  const manualGithubProof = options.includeManualGithubProof === false ? {} : factoryCandidateGithubProof(config, item);
  const githubChangedFiles = Array.isArray(options.githubProof?.changedFiles) && options.githubProof.changedFiles.length
    ? options.githubProof.changedFiles
    : null;
  return {
    schemaVersion: REAL_DELIVERY_CANDIDATE_SCHEMA_VERSION,
    source: {
      ...factoryCandidateGithubTarget(config, item),
      ...manualGithubProof,
      ...githubProof,
    },
    release: {
      environment: realDelivery.releaseEnv || config.releaseEnv,
      deploymentUrl: realDelivery.deploymentUrl || config.deploymentUrl || config.productionUrl,
      healthCheckPath: realDelivery.healthCheckPath || config.realDeliveryHealthCheckPath,
      requireHealthCommit: realDelivery.requireHealthCommit === true || config.requireHealthCommit === true,
      productionSafe: realDelivery.productionSafe === true || config.realDeliveryProductionSafe === true,
      productionSafetyEvidence: factoryCandidateProductionSafetyEvidence(config, item),
    },
    rollback: {
      target: realDelivery.rollbackTarget || config.rollbackTarget,
      plan: realDelivery.rollbackPlan || config.rollbackPlan,
      verified: realDelivery.rollbackVerified === true || config.rollbackVerified === true,
      evidence: factoryCandidateRollbackEvidence(config, item),
    },
    risk: {
      level: realDelivery.riskLevel || config.realDeliveryRiskLevel,
      productionSafe: realDelivery.productionSafe === true || config.realDeliveryProductionSafe === true,
    },
    scope: {
      maxChangedFiles: config.realDeliveryMaxChangedFiles,
      changedFiles: githubChangedFiles || factoryCandidateChangedFiles(config, item),
    },
    tests: {
      commands: factoryCandidateTestCommands(config, item),
    },
  };
}

async function collectFactoryCandidateGithubProof(config = {}, item = {}) {
  const target = factoryCandidateGithubTarget(config, item);
  if (!target.prUrl && !(target.ciRepository || target.repository) && !target.prNumber) {
    throw new Error('factory real-delivery candidate requires a GitHub PR target');
  }
  return collectGitHubPullRequestEvidence({
    ...target,
    collectRealEvidence: true,
    requireRealEvidence: true,
    githubToken: config.githubToken,
    githubApiBaseUrl: config.githubApiBaseUrl,
    allowMockGitHubEvidence: config.allowMockGitHubEvidence === true,
    allowTestGitHubEvidenceInjection: config.allowTestGitHubEvidenceInjection === true,
    env: config.env,
    fetchImpl: config.realDeliveryGithubFetchImpl || config.githubFetchImpl,
  }, {});
}

function appendFailures(result, failures = []) {
  for (const failure of failures.filter(Boolean)) {
    if (!result.failures.includes(failure)) result.failures.push(failure);
  }
  if (failures.length) result.ok = false;
  return result;
}

function factorySourceIntegrity(config = {}) {
  if (typeof config.realDeliverySourceIntegrity === 'function') {
    return config.realDeliverySourceIntegrity;
  }
  return (root) => runSourceIntegrity({ root });
}

async function verifyFactoryRealDeliveryCandidate(config = {}, item = {}) {
  if (!requiresFactoryCandidateProof(config, item)) {
    return { ok: true, skipped: true, proofPath: null, result: null };
  }
  const root = config.repoRoot || process.cwd();
  const proofPath = factoryCandidateProofPath(config, item);
  const collectionFailures = [];
  let githubProof = null;
  try {
    githubProof = await collectFactoryCandidateGithubProof(config, item);
  } catch (error) {
    collectionFailures.push(`GitHub candidate proof collection failed: ${error.message}`);
  }
  const result = await verifyRealDeliveryCandidateReleaseProof({
    root,
    manifestData: buildFactoryCandidateManifest(config, item, {
      githubProof,
      includeManualGithubProof: false,
    }),
    gitState: config.realDeliveryCandidateGitState,
    runTestCommands: true,
    requireFinalReleaseProof: true,
    verifyDeploymentHealth: true,
    rollbackVerified: factoryCandidateRollbackVerified(config, item),
    rollbackEvidence: factoryCandidateRollbackEvidence(config, item),
    productionSafetyEvidence: factoryCandidateProductionSafetyEvidence(config, item),
    sourceIntegrity: factorySourceIntegrity(config),
    fetchImpl: config.realDeliveryFetchImpl || config.fetchImpl,
  });
  appendFailures(result, collectionFailures);
  writeRealDeliveryCandidateProof(root, proofPath, result);
  if (!result.ok) {
    throw new Error(`Factory real-delivery candidate proof failed (${proofPath}): ${result.failures.join('; ')}`);
  }
  return { ok: true, skipped: false, proofPath, result };
}

module.exports = {
  buildFactoryCandidateManifest,
  collectFactoryCandidateGithubProof,
  factoryCandidateProductionSafetyEvidence,
  factoryCandidateRollbackEvidence,
  factorySourceIntegrity,
  factoryCandidateProofPath,
  hasFactoryItemRealDeliveryIntent,
  itemRealDelivery,
  requiresFactoryCandidateProof,
  verifyFactoryRealDeliveryCandidate,
};
