const fs = require('node:fs');
const path = require('node:path');
const { loadPilotEvidence } = require('../task-platform/golden-path-phase1');
const { runGoldenPathPhases } = require('../task-platform/golden-path-phases');
const { isLocalGoldenPathBaseUrl } = require('../task-platform/staging-runtime');

async function runMilestoneHostedPhase6Verify(options = {}) {
  const outputDir = options.outputDir || 'observability/milestone-hosted-staging';
  const evidencePath = options.evidencePath
    ? path.resolve(process.cwd(), options.evidencePath)
    : null;
  const evidence = options.pilot
    || (evidencePath && fs.existsSync(evidencePath) ? loadPilotEvidence(evidencePath) : null);

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

  const resolvedEvidencePath = evidencePath
    || path.resolve(process.cwd(), outputDir, 'factory-delivery', `${evidence.factoryQueueId || 'hosted'}.json`);

  await runGoldenPathPhases({
    fromPhase: 6,
    toPhase: 6,
    resumePhase6Only: true,
    baseUrl: options.baseUrl,
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
    agentDrivenPhases: options.agentDrivenPhases !== false,
    autoMerge: options.autoMerge,
    deploymentEnvironment: options.deploymentEnvironment || 'production',
    fetchImpl: options.fetchImpl || fetch,
  });

  const refreshed = loadPilotEvidence(resolvedEvidencePath);
  const result = {
    schemaVersion: '1.0',
    kind: 'milestone-hosted-phase6-verify',
    generatedAt: new Date().toISOString(),
    profile: options.profile || 'hosted-staging',
    baseUrl: options.baseUrl,
    operatorUrl: options.operatorUrl || options.baseUrl,
    outputDir,
    summary: {
      passed: refreshed?.status === 'phase6_complete',
      phase6Complete: refreshed?.status === 'phase6_complete',
      gp026SreAgent: Boolean(
        refreshed?.phase5?.api?.sreMonitoring?.agentSessionId
        || refreshed?.phase6?.api?.sreMonitoring?.agentSessionId,
      ),
      gp022AutoMerge: Boolean(refreshed?.phase6?.api?.autoMerge?.ok),
      validationOk: refreshed?.phase6?.api?.validation?.ok === true,
    },
    artifacts: {
      factoryEvidence: resolvedEvidencePath,
    },
    factory: {
      taskId: refreshed?.engineeringTeam?.taskId || null,
      stage: refreshed?.status || null,
    },
  };

  const outputPath = options.outputPath || path.join(outputDir, 'milestone-hosted-phase6-verify.json');
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

module.exports = {
  runMilestoneHostedPhase6Verify,
};