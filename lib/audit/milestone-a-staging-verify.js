const fs = require('node:fs');
const path = require('node:path');
const { resolveStagingRuntime, assertStagingRuntimeReady } = require('../task-platform/staging-runtime');
const { runAuditWorkersProductionSmoke } = require('./audit-workers-production-smoke');
const { runEtForgeBridgeSmoke } = require('./et-forge-bridge-smoke');
const {
  submitFactoryRequirementsForQueue,
  runFactoryOrchestratorTick,
} = require('../task-platform/factory-delivery');
const { factoryRealEvidenceRuntimeOptions } = require('./factory-real-evidence-runtime-options');

async function runGithubIntakeSmoke(runtime, outputPath) {
  const { writeEvidence } = require('../../scripts/golden-path-smoke-lib');
  const { postIssueWebhook, resolveForgeIntakeProvider } = require('./forge-intake-verify');
  const issueNumber = 900_000 + Math.floor(Math.random() * 99_000);
  const intakeProvider = resolveForgeIntakeProvider(runtime);
  const created = await postIssueWebhook(runtime, {
    issueNumber,
    deliveryId: `milestone-a-gp-002-${issueNumber}`,
    secret: runtime.gitlabWebhookSecret || runtime.githubWebhookSecret || 'golden-path-local-webhook-secret',
    options: runtime,
  });
  const responseBody = created.body || {};
  const passed = created.ok && Boolean(
    responseBody.taskId || responseBody.task_id || responseBody.reason === 'existing_intake_task',
  );
  return writeEvidence(outputPath, {
    schemaVersion: '1.0',
    kind: 'gp-002-staging-smoke',
    generatedAt: new Date().toISOString(),
    baseUrl: runtime.baseUrl,
    intakeProvider,
    issueNumber,
    status: created.status,
    ok: created.ok,
    body: responseBody,
    summary: { passed, taskId: responseBody.taskId || responseBody.task_id || null },
  });
}

function buildFactorySmokeRequirement(runtime, queueId) {
  return {
    id: queueId,
    title: `Milestone A staging factory smoke ${new Date().toISOString()}`,
    requirements: 'Docs-only Simple tier staging smoke for factory orchestrator intake + phase1.',
    templateTier: 'Simple',
    githubIssueUrl: runtime.githubIssueUrl || null,
  };
}

function buildFactorySmokeOptions(runtime, queuePath, deliveryDir) {
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
    skipForgeSeed: runtime.skipForgeSeed === true,
    skipPilotAgentsSeed: runtime.skipPilotAgentsSeed === true,
    openclawUrl: runtime.openclawUrl || undefined,
    forgeAdapterUrl: runtime.forgeAdapterUrl || 'http://127.0.0.1:14010',
    operatorUrl: runtime.operatorUrl,
    releaseEnv: runtime.releaseEnv,
    changeKind: runtime.changeKind,
    changeReversibility: runtime.changeReversibility,
    changedFiles: runtime.changedFiles,
    ...factoryRealEvidenceRuntimeOptions(runtime),
  };
}

async function runFactorySmokeTicks(runtime, queuePath, deliveryDir, targetStages, maxTicks) {
  const ticks = [];
  let processed = null;
  for (let attempt = 0; attempt < maxTicks; attempt += 1) {
    const tick = await runFactoryOrchestratorTick({ ...buildFactorySmokeOptions(runtime, queuePath, deliveryDir), maxItems: 1 });
    ticks.push(tick);
    processed = tick.results?.[0] || null;
    if (processed && (targetStages.includes(processed.stage) || processed.stage === 'failed')) break;
  }
  return { ticks, processed };
}

async function runFactoryStagingSmoke(runtime, outputPath) {
  const runId = Date.now().toString(36);
  const queuePath = path.join(runtime.outputDir, `factory-staging-queue-${runId}.json`);
  const deliveryDir = path.join(runtime.outputDir, `factory-delivery-${runId}`);
  const queueId = `factory-staging-${runId}`;
  const requirement = buildFactorySmokeRequirement(runtime, queueId);

  const submit = await submitFactoryRequirementsForQueue([requirement], buildFactorySmokeOptions(runtime, queuePath, deliveryDir));
  const targetStages = runtime.skipForgePhases
    ? ['phase1_complete', 'phase6_complete', 'completed']
    : ['phase6_complete', 'completed'];
  const maxTicks = runtime.skipForgePhases ? 2 : 4;
  const { ticks, processed } = await runFactorySmokeTicks(runtime, queuePath, deliveryDir, targetStages, maxTicks);

  const passed = Boolean(processed && targetStages.includes(processed.stage));
  const evidence = {
    schemaVersion: '1.0',
    kind: 'factory-staging-smoke',
    generatedAt: new Date().toISOString(),
    baseUrl: runtime.baseUrl,
    queuePath,
    queueBackend: submit.queueBackend || runtime.queueBackend || 'file',
    queueTable: submit.queueTable || null,
    deliveryDir,
    requirement,
    ticks,
    summary: {
      passed,
      stage: processed?.stage || null,
      taskId: processed?.taskId || null,
      projectId: processed?.projectId || null,
      note: runtime.skipForgePhases
        ? 'Staging smoke stops after phase1 when STAGING_SKIP_FORGE_PHASES=true (default).'
        : null,
    },
  };
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function createMilestoneAEvidence(runtime) {
  return {
    schemaVersion: '1.0',
    kind: 'milestone-a-staging-verify',
    generatedAt: new Date().toISOString(),
    profile: runtime.profile,
    baseUrl: runtime.baseUrl,
    outputDir: runtime.outputDir,
    summary: { passed: false, checks: [] },
    artifacts: {},
  };
}

async function recordWorkerSmoke(evidence, runtime, outputDir) {
  const artifact = 'audit-workers-production-smoke.json';
  const workers = await runAuditWorkersProductionSmoke({
    fetchImpl: runtime.fetchImpl,
    baseUrl: runtime.baseUrl,
    tenantId: runtime.tenantId,
    jwtSecret: runtime.jwtSecret,
    outputPath: path.join(outputDir, artifact),
  });
  evidence.artifacts.workers = path.join(runtime.outputDir, artifact);
  evidence.summary.checks.push({
    name: 'gp_007_workers',
    ok: workers.summary.passed,
    lagSeconds: workers.metrics.projectionLagSecondsAfter,
  });
}

async function recordBridgeSmoke(evidence, runtime, outputDir) {
  const artifact = 'et-forge-bridge-smoke.json';
  const bridge = await runEtForgeBridgeSmoke({
    fetchImpl: runtime.fetchImpl,
    enabled: process.env.ET_FORGE_DISPATCH_ENABLED || 'true',
    engineeringTeamBaseUrl: runtime.baseUrl,
    forgeAdapterBaseUrl: runtime.forgeAdapterUrl || 'http://forge.staging.local',
    outputPath: path.join(outputDir, artifact),
    probeLiveForge: Boolean(runtime.forgeAdapterUrl),
  });
  evidence.artifacts.bridge = path.join(runtime.outputDir, artifact);
  evidence.summary.checks.push({ name: 'et_forge_bridge', ok: bridge.summary.passed });
}

async function recordIntakeSmoke(evidence, runtime, outputDir) {
  const artifact = 'gp-002-github-intake-smoke.json';
  const intake = await runGithubIntakeSmoke(runtime, path.join(outputDir, artifact));
  evidence.artifacts.intake = path.join(runtime.outputDir, artifact);
  evidence.summary.checks.push({ name: 'gp_002_intake', ok: intake.summary.passed });
}

async function recordFactorySmoke(evidence, runtime, outputDir) {
  const artifact = 'factory-staging-smoke.json';
  const factory = await runFactoryStagingSmoke(runtime, path.join(outputDir, artifact));
  evidence.artifacts.factory = path.join(runtime.outputDir, artifact);
  evidence.summary.checks.push({
    name: 'factory_staging_orchestrator',
    ok: factory.summary.passed,
    stage: factory.summary.stage,
  });
}

async function runMilestoneAStagingVerify(options = {}) {
  const runtime = assertStagingRuntimeReady(resolveStagingRuntime(options));
  runtime.fetchImpl = options.fetchImpl || fetch;
  const outputDir = path.resolve(process.cwd(), runtime.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const evidence = createMilestoneAEvidence(runtime);
  await recordWorkerSmoke(evidence, runtime, outputDir);
  await recordBridgeSmoke(evidence, runtime, outputDir);
  await recordIntakeSmoke(evidence, runtime, outputDir);
  await recordFactorySmoke(evidence, runtime, outputDir);

  evidence.summary.passed = evidence.summary.checks.every((check) => check.ok);
  const outputPath = options.outputPath || path.join(outputDir, 'milestone-a-staging-verify.json');
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

module.exports = {
  runMilestoneAStagingVerify,
  runGithubIntakeSmoke,
  runFactoryStagingSmoke,
};
