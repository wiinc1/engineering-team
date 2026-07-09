const fs = require('node:fs');
const path = require('node:path');
const { loadPilotEvidence } = require('../task-platform/golden-path-phase1');
const { runGoldenPathPhases } = require('../task-platform/golden-path-phases');
const { assertGoldenPathRealEvidencePreflight } = require('../task-platform/golden-path-real-evidence-preflight');
const { verifyRealAutonomousDeliveryEvidence } = require('../task-platform/real-autonomous-delivery-evidence');
const { isLocalGoldenPathBaseUrl } = require('../task-platform/staging-runtime');

function resolveHostedPhase6Evidence(options, outputDir) {
  const evidencePath = options.evidencePath
    ? path.resolve(process.cwd(), options.evidencePath)
    : null;
  const evidence = options.pilot
    || (evidencePath && fs.existsSync(evidencePath) ? loadPilotEvidence(evidencePath) : null);
  return {
    evidence,
    evidencePath,
    resolvedEvidencePath: evidencePath
      || path.resolve(process.cwd(), outputDir, 'factory-delivery', `${evidence?.factoryQueueId || 'hosted'}.json`),
  };
}

function assertHostedPhase6Inputs(options, evidence) {
  if (!evidence) {
    throw new Error('Hosted phase 6 verify requires factory evidence via --evidence-path or pilot option');
  }
  if (!options.baseUrl) {
    throw new Error('Hosted phase 6 verify requires --base-url');
  }
  if (!options.jwtSecret) {
    throw new Error('Hosted phase 6 verify requires AUTH_JWT_SECRET');
  }
  if (isLocalGoldenPathBaseUrl(options.baseUrl) && !options.allowLocalHosted) {
    throw new Error('Hosted phase 6 verify expects a non-local base URL (pass --allow-local-hosted to override)');
  }
}

function assertHostedPhase6Preflight(options, agentDrivenPhases) {
  assertGoldenPathRealEvidencePreflight({
    ...options,
    requireReadableCandidateProof: true,
    agentDrivenPhases,
    fromPhase: 6,
    toPhase: 6,
    allowSreWaiver: false,
    skipValidation: options.skipValidation === true,
  }, { context: 'Hosted phase 6 replay' });
  if (!hostedCandidateProofPath(options) && !options.candidateProof) {
    throw new Error('Hosted phase 6 replay preflight failed: real-delivery candidate proof is required (--candidate-proof)');
  }
}

function hostedCandidateProofPath(options = {}) {
  return options.candidateProofPath || options.realDeliveryCandidateProofPath || '';
}

function hostedReleaseProofOptions(options = {}) {
  return {
    rollbackTarget: options.rollbackTarget,
    rollbackEvidence: options.rollbackEvidence,
    rollbackVerified: options.rollbackVerified === true,
    releaseArtifactCommands: options.releaseArtifactCommands,
    releaseArtifactCommandTimeoutMs: options.releaseArtifactCommandTimeoutMs,
    releaseArtifactDir: options.releaseArtifactDir,
    useExistingReleaseArtifacts: options.useExistingReleaseArtifacts === true,
    healthCheckPath: options.healthCheckPath,
    requireHealthCommit: options.requireHealthCommit === true,
  };
}

function buildHostedPhase6Options(options, evidence, resolvedEvidencePath, agentDrivenPhases) {
  return {
    fromPhase: 6,
    toPhase: 6,
    resumePhase6Only: true,
    baseUrl: options.baseUrl,
    useVersionedTaskApi: options.useVersionedTaskApi !== false,
    jwtSecret: options.jwtSecret,
    tenantId: options.tenantId || 'engineering-team',
    actorId: options.actorId || 'hosted-phase6-verify',
    outputPath: resolvedEvidencePath,
    pilot: evidence,
    taskId: evidence.engineeringTeam?.taskId,
    forgeTaskId: evidence.forgeadapter?.taskId,
    operatorUrl: options.operatorUrl || options.baseUrl,
    forgeAdapterBaseUrl: options.forgeAdapterUrl,
    openclawUrl: options.openclawUrl,
    skipValidation: options.skipValidation === true,
    allowSreWaiver: false,
    agentDrivenPhases,
    collectRealEvidence: true,
    requireRealEvidence: true,
    ciRepository: options.ciRepository || options.repository,
    branchName: options.branchName || options.branch,
    implementationCommitSha: options.implementationCommitSha || options.commitSha,
    commitSha: options.commitSha,
    prUrl: options.prUrl,
    prNumber: options.prNumber,
    githubToken: options.githubToken,
    githubApiBaseUrl: options.githubApiBaseUrl,
    deploymentUrl: options.deploymentUrl,
    productionUrl: options.productionUrl,
    productionSafetyEvidence: options.productionSafetyEvidence,
    candidateProofPath: hostedCandidateProofPath(options),
    ...hostedReleaseProofOptions(options),
    releaseEnv: options.releaseEnv,
    changeKind: options.changeKind,
    templateTier: options.templateTier,
    changeReversibility: options.changeReversibility,
    changedFiles: options.changedFiles,
    autoMerge: options.autoMerge,
    deploymentEnvironment: options.deploymentEnvironment || 'production',
    fetchImpl: options.fetchImpl || fetch,
  };
}

function buildHostedPhase6Result(options, outputDir, resolvedEvidencePath, refreshed, realDeliveryAudit) {
  const phase6Complete = refreshed?.status === 'phase6_complete';
  const validationOk = refreshed?.phase6?.api?.validation?.ok === true;
  const realDeliveryAuditOk = realDeliveryAudit?.ok === true;
  return {
    schemaVersion: '1.0',
    kind: 'milestone-hosted-phase6-verify',
    generatedAt: new Date().toISOString(),
    profile: options.profile || 'hosted-staging',
    baseUrl: options.baseUrl,
    operatorUrl: options.operatorUrl || options.baseUrl,
    outputDir,
    summary: {
      passed: phase6Complete && validationOk && realDeliveryAuditOk,
      phase6Complete,
      gp026SreAgent: Boolean(
        refreshed?.phase5?.api?.sreMonitoring?.agentSessionId
        || refreshed?.phase6?.api?.sreMonitoring?.agentSessionId,
      ),
      gp022AutoMerge: Boolean(refreshed?.phase6?.api?.autoMerge?.ok),
      validationOk,
      realDeliveryAuditOk,
    },
    artifacts: {
      factoryEvidence: resolvedEvidencePath,
      candidateProof: hostedCandidateProofPath(options) || null,
    },
    realDeliveryAudit: realDeliveryAudit ? {
      ok: realDeliveryAudit.ok,
      releaseEnv: realDeliveryAudit.releaseEnv,
      failures: realDeliveryAudit.failures,
    } : null,
    factory: {
      taskId: refreshed?.engineeringTeam?.taskId || null,
      stage: refreshed?.status || null,
    },
  };
}

function writeHostedPhase6Result(result, options, outputDir) {
  const outputPath = options.outputPath || path.join(outputDir, 'milestone-hosted-phase6-verify.json');
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`);
}

async function runMilestoneHostedPhase6Verify(options = {}) {
  const outputDir = options.outputDir || 'observability/milestone-hosted-staging';
  const { evidence, resolvedEvidencePath } = resolveHostedPhase6Evidence(options, outputDir);
  assertHostedPhase6Inputs(options, evidence);
  const agentDrivenPhases = options.agentDrivenPhases !== false;
  assertHostedPhase6Preflight(options, agentDrivenPhases);

  const runPhases = options.runPhasesFn || runGoldenPathPhases;
  await runPhases(buildHostedPhase6Options(options, evidence, resolvedEvidencePath, agentDrivenPhases));
  const refreshed = loadPilotEvidence(resolvedEvidencePath);
  const realDeliveryAudit = verifyRealAutonomousDeliveryEvidence({
    evidence: refreshed,
    evidencePath: resolvedEvidencePath,
    candidateProof: options.candidateProof,
    candidateProofPath: hostedCandidateProofPath(options),
    repoRoot: options.repoRoot || process.cwd(),
    releaseEnv: options.releaseEnv,
  });
  const result = buildHostedPhase6Result(options, outputDir, resolvedEvidencePath, refreshed, realDeliveryAudit);
  writeHostedPhase6Result(result, options, outputDir);
  return result;
}

module.exports = {
  buildHostedPhase6Options,
  runMilestoneHostedPhase6Verify,
};
