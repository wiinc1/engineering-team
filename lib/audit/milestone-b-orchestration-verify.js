const fs = require('node:fs');
const path = require('node:path');
const { resolveStagingRuntime, assertStagingRuntimeReady } = require('../task-platform/staging-runtime');
const { runMilestoneAStagingVerify } = require('./milestone-a-staging-verify');
const {
  submitFactoryRequirements,
  runFactoryOrchestratorTick,
} = require('../task-platform/factory-delivery');

async function runMilestoneBOrchestrationVerify(options = {}) {
  const runtime = assertStagingRuntimeReady(resolveStagingRuntime({
    ...options,
    outputDir: options.outputDir || 'observability/milestone-b-staging',
    requireDelegationSmoke: options.requireDelegationSmoke !== false,
    skipForgePhases: false,
    skipValidation: options.skipValidation === true,
  }));
  runtime.fetchImpl = options.fetchImpl || fetch;
  runtime.agentDrivenPhase1 = options.agentDrivenPhase1 !== false;
  const outputDir = path.resolve(process.cwd(), runtime.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const evidence = {
    schemaVersion: '1.0',
    kind: 'milestone-b-orchestration-verify',
    generatedAt: new Date().toISOString(),
    profile: runtime.profile,
    baseUrl: runtime.baseUrl,
    outputDir: runtime.outputDir,
    summary: { passed: false, checks: [] },
    artifacts: {},
  };

  const milestoneA = await runMilestoneAStagingVerify({
    ...runtime,
    outputPath: path.join(outputDir, 'milestone-a-staging-verify.json'),
    outputDir: path.join(outputDir, 'milestone-a-staging'),
  });
  evidence.artifacts.milestoneA = path.join(runtime.outputDir, 'milestone-a-staging-verify.json');
  evidence.summary.checks.push({ name: 'milestone_a_baseline', ok: milestoneA.summary.passed });

  const runId = Date.now().toString(36);
  const queuePath = path.join(outputDir, `factory-milestone-b-queue-${runId}.json`);
  const deliveryDir = path.join(outputDir, 'factory-delivery');
  const queueId = `factory-milestone-b-${runId}`;
  submitFactoryRequirements([{
    id: queueId,
    title: 'Milestone B orchestration verify',
    requirements: 'Prove GP-009/012/013 and agent-driven phase1 contract generation on coordinated stack.',
    templateTier: 'Simple',
    githubIssueUrl: options.githubIssueUrl
      || 'https://github.com/wiinc1/engineering-team/issues/271',
  }], {
    baseUrl: runtime.baseUrl,
    tenantId: runtime.tenantId,
    jwtSecret: runtime.jwtSecret,
    fetchImpl: runtime.fetchImpl,
    queuePath,
    deliveryDir,
    requireDelegationSmoke: runtime.requireDelegationSmoke,
    skipValidation: runtime.skipValidation,
    agentDrivenPhase1: runtime.agentDrivenPhase1,
    openclawUrl: runtime.openclawUrl || undefined,
    forgeAdapterUrl: runtime.forgeAdapterUrl,
    operatorUrl: runtime.operatorUrl,
  });

  const ticks = [];
  let lastItem = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const tick = await runFactoryOrchestratorTick({
      baseUrl: runtime.baseUrl,
      tenantId: runtime.tenantId,
      jwtSecret: runtime.jwtSecret,
      queuePath,
      deliveryDir,
      requireDelegationSmoke: runtime.requireDelegationSmoke,
      skipValidation: runtime.skipValidation,
      agentDrivenPhase1: runtime.agentDrivenPhase1,
      openclawUrl: runtime.openclawUrl || undefined,
      forgeAdapterUrl: runtime.forgeAdapterUrl,
      operatorUrl: runtime.operatorUrl,
      maxItems: 1,
      fetchImpl: runtime.fetchImpl,
    });
    ticks.push(tick);
    lastItem = tick.results?.[0] || null;
    if (lastItem && ['phase6_complete', 'completed', 'failed'].includes(lastItem.stage)) {
      break;
    }
  }

  const factoryEvidencePath = path.join(deliveryDir, `${queueId}.json`);
  const factoryEvidence = fs.existsSync(factoryEvidencePath)
    ? JSON.parse(fs.readFileSync(factoryEvidencePath, 'utf8'))
    : null;
  const phase1 = factoryEvidence?.phase1 || {};
  const projectionModes = (phase1.projectionRuns || []).map((run) => run.mode);
  const workerModes = projectionModes.filter((mode) => mode === 'always_on_worker').length;
  const manualModes = projectionModes.filter((mode) => mode === 'manual_script').length;

  evidence.artifacts.factoryQueue = queuePath;
  evidence.artifacts.factoryEvidence = factoryEvidencePath;
  evidence.summary.checks.push({
    name: 'factory_phase6_complete',
    ok: lastItem?.stage === 'phase6_complete' || lastItem?.stage === 'completed',
    stage: lastItem?.stage || null,
    error: lastItem?.error || null,
  });
  evidence.summary.checks.push({
    name: 'gp012_intake_agents_seeded',
    ok: (factoryEvidence?.stepsCompleted || []).includes('GP-012'),
  });
  evidence.summary.checks.push({
    name: 'gp009_forge_seed_on_phase1',
    ok: Boolean(factoryEvidence?.forgeadapter?.taskId),
  });
  evidence.summary.checks.push({
    name: 'gp013_delegation_smoke',
    ok: (factoryEvidence?.stepsCompleted || []).includes('GP-013')
      || phase1.api?.architectDelegated === true
      || phase1.api?.pmRefinementDelegated === true,
  });
  evidence.summary.checks.push({
    name: 'agent_driven_phase1_contract',
    ok: phase1.api?.pmRefinementDelegated === true
      || phase1.contract?.factoryTemplateTier != null,
  });
  evidence.summary.checks.push({
    name: 'projection_worker_preference',
    ok: workerModes >= manualModes,
    workerModes,
    manualModes,
  });

  evidence.factory = { ticks, queueId, factoryEvidencePath, phase1Api: phase1.api || null };
  evidence.summary.passed = evidence.summary.checks.every((check) => check.ok);
  const outputPath = options.outputPath || path.join(outputDir, 'milestone-b-orchestration-verify.json');
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

module.exports = {
  runMilestoneBOrchestrationVerify,
};