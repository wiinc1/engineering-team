const fs = require('node:fs');
const path = require('node:path');
const { resolveStagingRuntime, assertStagingRuntimeReady } = require('../task-platform/staging-runtime');
const { runMilestoneAStagingVerify } = require('./milestone-a-staging-verify');
const {
  submitFactoryRequirementsForQueue,
  runFactoryOrchestratorTick,
} = require('../task-platform/factory-delivery');
const { factoryRealEvidenceRuntimeOptions } = require('./factory-real-evidence-runtime-options');

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
    agentDrivenPhase1: runtime.agentDrivenPhase1,
    openclawUrl: runtime.openclawUrl || undefined,
    forgeAdapterUrl: runtime.forgeAdapterUrl,
    operatorUrl: runtime.operatorUrl,
    ...factoryRealEvidenceRuntimeOptions(runtime),
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
    outputDir: options.outputDir || 'observability/milestone-b-staging',
    requireDelegationSmoke: options.requireDelegationSmoke !== false,
    skipForgePhases: false,
    skipValidation: options.skipValidation === true,
  }));
  runtime.fetchImpl = options.fetchImpl || fetch;
  runtime.agentDrivenPhase1 = options.agentDrivenPhase1 !== false;
  return runtime;
}

function createEvidence(runtime) {
  return {
    schemaVersion: '1.0',
    kind: 'milestone-b-orchestration-verify',
    generatedAt: new Date().toISOString(),
    profile: runtime.profile,
    baseUrl: runtime.baseUrl,
    outputDir: runtime.outputDir,
    summary: { passed: false, checks: [] },
    artifacts: {},
  };
}

async function addMilestoneABaseline(evidence, runtime, outputDir) {
  const milestoneA = await runMilestoneAStagingVerify({
    ...runtime,
    outputPath: path.join(outputDir, 'milestone-a-staging-verify.json'),
    outputDir: path.join(outputDir, 'milestone-a-staging'),
  });
  evidence.artifacts.milestoneA = path.join(runtime.outputDir, 'milestone-a-staging-verify.json');
  evidence.summary.checks.push({ name: 'milestone_a_baseline', ok: milestoneA.summary.passed });
}

function factoryPaths(outputDir, prefix) {
  const runId = Date.now().toString(36);
  return {
    queuePath: path.join(outputDir, `${prefix}-queue-${runId}.json`),
    deliveryDir: path.join(outputDir, 'factory-delivery'),
    queueId: `${prefix}-${runId}`,
  };
}

async function submitMilestoneBRequirement(runtime, paths, options) {
  return submitFactoryRequirementsForQueue([{
    id: paths.queueId,
    title: 'Milestone B orchestration verify',
    requirements: 'Prove GP-009/012/013 and agent-driven phase1 contract generation on coordinated stack.',
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

function addMilestoneBChecks(evidence, context) {
  const phase1 = context.factoryEvidence?.phase1 || {};
  const projectionModes = (phase1.projectionRuns || []).map((run) => run.mode);
  const workerModes = projectionModes.filter((mode) => mode === 'always_on_worker').length;
  const manualModes = projectionModes.filter((mode) => mode === 'manual_script').length;
  evidence.artifacts.factoryQueue = context.submit.queueTable || context.queuePath;
  evidence.artifacts.factoryQueueBackend = context.submit.queueBackend || context.runtime.queueBackend || 'file';
  evidence.artifacts.factoryEvidence = context.factoryEvidencePath;
  evidence.summary.checks.push({ name: 'factory_phase6_complete', ok: ['phase6_complete', 'completed'].includes(context.lastItem?.stage), stage: context.lastItem?.stage || null, error: context.lastItem?.error || null });
  evidence.summary.checks.push({ name: 'gp012_intake_agents_seeded', ok: (context.factoryEvidence?.stepsCompleted || []).includes('GP-012') });
  evidence.summary.checks.push({ name: 'gp009_forge_seed_on_phase1', ok: Boolean(context.factoryEvidence?.forgeadapter?.taskId) });
  evidence.summary.checks.push({ name: 'gp013_delegation_smoke', ok: (context.factoryEvidence?.stepsCompleted || []).includes('GP-013') || phase1.api?.architectDelegated === true || phase1.api?.pmRefinementDelegated === true });
  evidence.summary.checks.push({ name: 'agent_driven_phase1_contract', ok: phase1.api?.pmRefinementDelegated === true || phase1.contract?.factoryTemplateTier != null });
  evidence.summary.checks.push({ name: 'projection_worker_preference', ok: workerModes >= manualModes, workerModes, manualModes });
  evidence.factory = { ticks: context.ticks, queueId: context.queueId, factoryEvidencePath: context.factoryEvidencePath, phase1Api: phase1.api || null };
}

async function runMilestoneBOrchestrationVerify(options = {}) {
  const runtime = resolveRuntime(options);
  const outputDir = path.resolve(process.cwd(), runtime.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const evidence = createEvidence(runtime);
  await addMilestoneABaseline(evidence, runtime, outputDir);
  const paths = factoryPaths(outputDir, 'factory-milestone-b');
  const submit = await submitMilestoneBRequirement(runtime, paths, options);
  const { ticks, lastItem } = await runFactoryTicks(runtime, paths.queuePath, paths.deliveryDir);
  const loaded = loadFactoryEvidence(paths.deliveryDir, paths.queueId);
  addMilestoneBChecks(evidence, { ...paths, ...loaded, submit, ticks, lastItem, runtime });
  evidence.summary.passed = evidence.summary.checks.every((check) => check.ok);
  const outputPath = options.outputPath || path.join(outputDir, 'milestone-b-orchestration-verify.json');
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

module.exports = {
  runMilestoneBOrchestrationVerify,
};
