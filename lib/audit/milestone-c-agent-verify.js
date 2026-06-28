const fs = require('node:fs');
const path = require('node:path');
const { resolveStagingRuntime, assertStagingRuntimeReady } = require('../task-platform/staging-runtime');
const {
  submitFactoryRequirements,
  runFactoryOrchestratorTick,
} = require('../task-platform/factory-delivery');

async function runMilestoneCAgentVerify(options = {}) {
  const runtime = assertStagingRuntimeReady(resolveStagingRuntime({
    ...options,
    outputDir: options.outputDir || 'observability/milestone-c-staging',
    requireDelegationSmoke: options.requireDelegationSmoke !== false,
    skipForgePhases: false,
    skipValidation: options.skipValidation === true,
  }));
  runtime.fetchImpl = options.fetchImpl || fetch;
  runtime.agentDrivenPhase1 = true;
  runtime.agentDrivenPhases = true;
  const outputDir = path.resolve(process.cwd(), runtime.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const evidence = {
    schemaVersion: '1.0',
    kind: 'milestone-c-agent-verify',
    generatedAt: new Date().toISOString(),
    profile: runtime.profile,
    baseUrl: runtime.baseUrl,
    outputDir: runtime.outputDir,
    summary: { passed: false, checks: [] },
    artifacts: {},
  };

  const runId = Date.now().toString(36);
  const queuePath = path.join(outputDir, `factory-milestone-c-queue-${runId}.json`);
  const deliveryDir = path.join(outputDir, 'factory-delivery');
  const queueId = `factory-milestone-c-${runId}`;
  submitFactoryRequirements([{
    id: queueId,
    title: 'Milestone C agent autonomy verify',
    requirements: 'Prove GP-003/004/014/017/019/020-021/023 agent-driven factory delivery on coordinated stack.',
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
    agentDrivenPhase1: true,
    agentDrivenPhases: true,
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
      agentDrivenPhase1: true,
      agentDrivenPhases: true,
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
  const phase2 = factoryEvidence?.phase2?.api || {};
  const phase3 = factoryEvidence?.phase3?.api || {};
  const phase4 = factoryEvidence?.phase4?.api || {};
  const phase6 = factoryEvidence?.phase6?.api || {};

  evidence.artifacts.factoryQueue = queuePath;
  evidence.artifacts.factoryEvidence = factoryEvidencePath;
  evidence.summary.checks.push({
    name: 'factory_phase6_complete',
    ok: lastItem?.stage === 'phase6_complete' || lastItem?.stage === 'completed',
    stage: lastItem?.stage || null,
    error: lastItem?.error || null,
  });
  evidence.summary.checks.push({
    name: 'gp014_implementer_agent',
    ok: Boolean(phase2.implementerAgent?.sessionId || phase2.implementerAgent?.delegated),
  });
  evidence.summary.checks.push({
    name: 'gp019_qa_agent',
    ok: Boolean(phase3.qaAgent?.sessionId || phase3.qaAgent?.delegated),
  });
  evidence.summary.checks.push({
    name: 'gp017_fix_loop',
    ok: Boolean(phase4.engineerSubmission?.ok || phase4.readmeFix?.changed),
  });
  evidence.summary.checks.push({
    name: 'gp023_ci_validation_evidence',
    ok: Boolean(phase6.ciValidation?.workflowFile || phase6.deploy?.ciValidation?.workflowFile),
  });
  evidence.summary.checks.push({
    name: 'agent_session_evidence',
    ok: Boolean(
      phase2.implementerAgent?.sessionId
      || factoryEvidence?.phase1?.api?.pmRefinementSessionId
      || factoryEvidence?.phase1?.api?.architectSessionId,
    ),
  });

  evidence.factory = { ticks, queueId, factoryEvidencePath };
  evidence.summary.passed = evidence.summary.checks.every((check) => check.ok);
  const outputPath = options.outputPath || path.join(outputDir, 'milestone-c-agent-verify.json');
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

module.exports = {
  runMilestoneCAgentVerify,
};