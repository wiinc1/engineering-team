const fs = require('node:fs');
const path = require('node:path');
const { resolveStagingRuntime, assertStagingRuntimeReady } = require('../task-platform/staging-runtime');
const { assertGoldenPathRealEvidencePreflight } = require('../task-platform/golden-path-real-evidence-preflight');
const {
  submitFactoryRequirementsForQueue,
  runFactoryOrchestratorTick,
} = require('../task-platform/factory-delivery');
const { factoryRealEvidenceRuntimeOptions } = require('./factory-real-evidence-runtime-options');

function realEvidenceFactoryOptions(runtime) {
  return factoryRealEvidenceRuntimeOptions(runtime);
}

function factoryQueueOptions(runtime, queuePath, deliveryDir, extra = {}) {
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
    agentDrivenPhase1: true,
    agentDrivenPhases: true,
    openclawUrl: runtime.openclawUrl || undefined,
    forgeAdapterUrl: runtime.forgeAdapterUrl,
    operatorUrl: runtime.operatorUrl,
    ...realEvidenceFactoryOptions(runtime),
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
    skipForgePhases: false,
    skipValidation: options.skipValidation === true,
  }));
  runtime.fetchImpl = options.fetchImpl || fetch;
  runtime.agentDrivenPhase1 = true;
  runtime.agentDrivenPhases = true;
  return runtime;
}

function assertMilestoneCRealEvidence(runtime) {
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
  evidence.summary.checks.push({ name: 'agent_session_evidence', ok: Boolean(phase2.implementerAgent?.sessionId || context.factoryEvidence?.phase1?.api?.pmRefinementSessionId || context.factoryEvidence?.phase1?.api?.architectSessionId) });
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
