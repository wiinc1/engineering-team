const fs = require('node:fs');
const path = require('node:path');
const {
  resolveStagingRuntime,
  assertStagingRuntimeReady,
  isLocalGoldenPathBaseUrl,
} = require('../task-platform/staging-runtime');
const { assertGoldenPathRealEvidencePreflight } = require('../task-platform/golden-path-real-evidence-preflight');
const {
  submitFactoryRequirementsForQueue,
  runFactoryOrchestratorTick,
} = require('../task-platform/factory-delivery');
const { factoryRealEvidenceRuntimeOptions } = require('./factory-real-evidence-runtime-options');

function realEvidenceFactoryOptions(runtime) {
  return factoryRealEvidenceRuntimeOptions(runtime);
}

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function wantsExplicitRealEvidenceCollection(runtime = {}, env = process.env) {
  // Note: resolveFactoryRealEvidenceConfig sets collect/require true whenever
  // agentDrivenPhases is true. That is not an operator "hosted proof" request.
  // Only honor explicit golden-path real-evidence env flags here.
  return parseBooleanEnv(env.FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE, false)
    || parseBooleanEnv(env.FF_GOLDEN_PATH_COLLECT_REAL_EVIDENCE, false)
    || parseBooleanEnv(env.STAGING_REQUIRE_REAL_EVIDENCE, false);
}

function factoryQueueOptions(runtime, queuePath, deliveryDir, extra = {}) {
  const localLiveProof = isLocalGoldenPathBaseUrl(runtime.baseUrl)
    && !wantsExplicitRealEvidenceCollection(runtime);
  return {
    baseUrl: runtime.baseUrl,
    tenantId: runtime.tenantId,
    jwtSecret: runtime.jwtSecret,
    fetchImpl: runtime.fetchImpl,
    queuePath,
    queueBackend: runtime.queueBackend,
    allowFileQueue: runtime.allowFileQueue,
    factoryQueueDatabaseUrl: runtime.factoryQueueDatabaseUrl,
    deliveryDir,
    requireDelegationSmoke: runtime.requireDelegationSmoke,
    skipValidation: runtime.skipValidation,
    skipForgePhases: runtime.skipForgePhases === true,
    skipForgeSeed: runtime.skipForgeSeed === true,
    agentDrivenPhase1: true,
    agentDrivenPhases: true,
    openclawUrl: runtime.openclawUrl || undefined,
    forgeAdapterUrl: runtime.forgeAdapterUrl,
    forgeServiceToken: runtime.forgeServiceToken || runtime.forgeAdapterToken,
    operatorUrl: runtime.operatorUrl,
    proofProfile: runtime.proofProfile || process.env.FACTORY_PROOF_PROFILE || null,
    ...realEvidenceFactoryOptions(runtime),
    // Local coordinated-stack live OpenClaw proof is agent-driven, not hosted release proof.
    ...(localLiveProof ? { collectRealEvidence: false, requireRealEvidence: false } : {}),
    ...extra,
  };
}

async function runFactoryTicks(runtime, queuePath, deliveryDir, maxAttempts = 6) {
  const ticks = [];
  let lastItem = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const tick = await runFactoryOrchestratorTick(factoryQueueOptions(runtime, queuePath, deliveryDir, { maxItems: 1 }));
    ticks.push(tick);
    lastItem = tick.results?.[0] || null;
    if (lastItem && ['phase6_complete', 'completed', 'failed'].includes(lastItem.stage)) break;
  }
  return { ticks, lastItem };
}

function resolveRuntime(options) {
  const runtime = assertStagingRuntimeReady(resolveStagingRuntime({
    ...options,
    outputDir: options.outputDir || 'observability/milestone-c-staging',
    requireDelegationSmoke: options.requireDelegationSmoke !== false,
    agentDrivenPhase1: true,
    agentDrivenPhases: true,
    // Preserve caller/env skip-forge flags for local live OpenClaw proof.
    skipForgePhases: options.skipForgePhases === true
      || process.env.STAGING_SKIP_FORGE_PHASES === 'true',
    skipForgeSeed: options.skipForgeSeed === true
      || process.env.STAGING_SKIP_FORGE_SEED === 'true'
      || options.skipForgePhases === true
      || process.env.STAGING_SKIP_FORGE_PHASES === 'true',
    skipValidation: options.skipValidation === true,
  }));
  runtime.fetchImpl = options.fetchImpl || fetch;
  runtime.agentDrivenPhase1 = true;
  runtime.agentDrivenPhases = true;
  runtime.skipForgePhases = options.skipForgePhases === true
    || process.env.STAGING_SKIP_FORGE_PHASES === 'true'
    || runtime.skipForgePhases === true;
  runtime.skipForgeSeed = options.skipForgeSeed === true
    || process.env.STAGING_SKIP_FORGE_SEED === 'true'
    || runtime.skipForgePhases === true
    || runtime.skipForgeSeed === true;
  runtime.proofProfile = options.proofProfile || process.env.FACTORY_PROOF_PROFILE || null;
  return runtime;
}

function assertMilestoneCRealEvidence(runtime) {
  // Local coordinated-stack live/fixture factory proof is gated by factory-proof-profile
  // (gateway probe + non-fixture runner). Hosted real-evidence preflight only applies when
  // explicitly collecting release/PR proof or when the base URL is non-local.
  if (isLocalGoldenPathBaseUrl(runtime.baseUrl) && !wantsExplicitRealEvidenceCollection(runtime)) {
    return;
  }
  assertGoldenPathRealEvidencePreflight({
    ...runtime,
    agentDrivenPhases: true,
    fromPhase: 2,
    toPhase: 6,
    skipValidation: runtime.skipValidation,
  }, { context: 'Milestone C agent verify' });
}

function createEvidence(runtime) {
  return {
    schemaVersion: '1.0',
    kind: 'milestone-c-agent-verify',
    generatedAt: new Date().toISOString(),
    profile: runtime.profile,
    baseUrl: runtime.baseUrl,
    outputDir: runtime.outputDir,
    summary: { passed: false, checks: [] },
    artifacts: {},
  };
}

function factoryPaths(outputDir) {
  const runId = Date.now().toString(36);
  return {
    queuePath: path.join(outputDir, `factory-milestone-c-queue-${runId}.json`),
    deliveryDir: path.join(outputDir, 'factory-delivery'),
    queueId: `factory-milestone-c-${runId}`,
  };
}

async function submitMilestoneCRequirement(runtime, paths, options) {
  return submitFactoryRequirementsForQueue([{
    id: paths.queueId,
    title: 'Milestone C agent autonomy verify',
    requirements: 'Prove GP-003/004/014/017/019/020-021/023 agent-driven factory delivery on coordinated stack.',
    templateTier: 'Simple',
    githubIssueUrl: options.githubIssueUrl || null,
  }], factoryQueueOptions(runtime, paths.queuePath, paths.deliveryDir));
}

function loadFactoryEvidence(deliveryDir, queueId) {
  const factoryEvidencePath = path.join(deliveryDir, `${queueId}.json`);
  const factoryEvidence = fs.existsSync(factoryEvidencePath)
    ? JSON.parse(fs.readFileSync(factoryEvidencePath, 'utf8'))
    : null;
  return { factoryEvidencePath, factoryEvidence };
}

function addMilestoneCChecks(evidence, context) {
  const phase2 = context.factoryEvidence?.phase2?.api || {};
  const phase3 = context.factoryEvidence?.phase3?.api || {};
  const phase4 = context.factoryEvidence?.phase4?.api || {};
  const phase6 = context.factoryEvidence?.phase6?.api || {};
  evidence.artifacts.factoryQueue = context.submit.queueTable || context.queuePath;
  evidence.artifacts.factoryQueueBackend = context.submit.queueBackend || context.runtime.queueBackend || 'file';
  evidence.artifacts.factoryEvidence = context.factoryEvidencePath;
  evidence.summary.checks.push({ name: 'factory_phase6_complete', ok: ['phase6_complete', 'completed'].includes(context.lastItem?.stage), stage: context.lastItem?.stage || null, error: context.lastItem?.error || null });
  evidence.summary.checks.push({ name: 'gp014_implementer_agent', ok: Boolean(phase2.implementerAgent?.sessionId || phase2.implementerAgent?.delegated) });
  evidence.summary.checks.push({ name: 'gp019_qa_agent', ok: Boolean(phase3.qaAgent?.sessionId || phase3.qaAgent?.delegated) });
  evidence.summary.checks.push({ name: 'gp017_fix_loop', ok: Boolean(phase4.engineerSubmission?.ok || phase4.readmeFix?.changed) });
  evidence.summary.checks.push({ name: 'gp023_ci_validation_evidence', ok: Boolean(phase6.ciValidation?.workflowFile || phase6.deploy?.ciValidation?.workflowFile) });
  // Accept any real specialist session captured during C (implementer, QA, smoke, phase1 PM/architect).
  evidence.summary.checks.push({
    name: 'agent_session_evidence',
    ok: Boolean(
      phase2.implementerAgent?.sessionId
      || phase2.delegationSmoke?.sessionId
      || phase3.qaAgent?.sessionId
      || phase4.fixAgent?.sessionId
      || context.factoryEvidence?.phase1?.api?.pmRefinementSessionId
      || context.factoryEvidence?.phase1?.api?.architectSessionId
    ),
  });
  evidence.factory = { ticks: context.ticks, queueId: context.queueId, factoryEvidencePath: context.factoryEvidencePath };
}

async function runMilestoneCAgentVerify(options = {}) {
  const runtime = resolveRuntime(options);
  assertMilestoneCRealEvidence(runtime);
  const outputDir = path.resolve(process.cwd(), runtime.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const evidence = createEvidence(runtime);
  const paths = factoryPaths(outputDir);
  const submit = await submitMilestoneCRequirement(runtime, paths, options);
  const { ticks, lastItem } = await runFactoryTicks(runtime, paths.queuePath, paths.deliveryDir);
  const loaded = loadFactoryEvidence(paths.deliveryDir, paths.queueId);
  addMilestoneCChecks(evidence, { ...paths, ...loaded, submit, ticks, lastItem, runtime });
  evidence.summary.passed = evidence.summary.checks.every((check) => check.ok);
  const outputPath = options.outputPath || path.join(outputDir, 'milestone-c-agent-verify.json');
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

module.exports = {
  realEvidenceFactoryOptions,
  runMilestoneCAgentVerify,
};
