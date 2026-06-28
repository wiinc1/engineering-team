const fs = require('node:fs');
const path = require('node:path');
const { resolveStagingRuntime, assertStagingRuntimeReady } = require('../task-platform/staging-runtime');
const { runAuditWorkersProductionSmoke } = require('./audit-workers-production-smoke');
const { runEtForgeBridgeSmoke } = require('./et-forge-bridge-smoke');
const {
  submitFactoryRequirements,
  runFactoryOrchestratorTick,
} = require('../task-platform/factory-delivery');

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

async function runFactoryStagingSmoke(runtime, outputPath) {
  const runId = Date.now().toString(36);
  const queuePath = path.join(runtime.outputDir, `factory-staging-queue-${runId}.json`);
  const deliveryDir = path.join(runtime.outputDir, `factory-delivery-${runId}`);
  const queueId = `factory-staging-${runId}`;
  const requirement = {
    id: queueId,
    title: `Milestone A staging factory smoke ${new Date().toISOString()}`,
    requirements: 'Docs-only Simple tier staging smoke for factory orchestrator intake + phase1.',
    templateTier: 'Simple',
    githubIssueUrl: runtime.githubIssueUrl
      || 'https://github.com/wiinc1/engineering-team/issues/271',
  };

  submitFactoryRequirements([requirement], {
    baseUrl: runtime.baseUrl,
    tenantId: runtime.tenantId,
    jwtSecret: runtime.jwtSecret,
    fetchImpl: runtime.fetchImpl,
    queuePath,
    deliveryDir,
    requireDelegationSmoke: runtime.requireDelegationSmoke,
    skipValidation: runtime.skipValidation,
    skipForgeSeed: runtime.skipForgeSeed === true,
    skipPilotAgentsSeed: runtime.skipPilotAgentsSeed === true,
    openclawUrl: runtime.openclawUrl || undefined,
    forgeAdapterUrl: runtime.forgeAdapterUrl || 'http://127.0.0.1:14010',
    operatorUrl: runtime.operatorUrl,
  });

  const targetStages = runtime.skipForgePhases
    ? ['phase1_complete', 'phase6_complete', 'completed']
    : ['phase6_complete', 'completed'];
  const maxTicks = runtime.skipForgePhases ? 2 : 4;

  const ticks = [];
  let lastTick = null;
  let processed = null;
  for (let attempt = 0; attempt < maxTicks; attempt += 1) {
    lastTick = await runFactoryOrchestratorTick({
      baseUrl: runtime.baseUrl,
      tenantId: runtime.tenantId,
      jwtSecret: runtime.jwtSecret,
      queuePath,
      deliveryDir,
      requireDelegationSmoke: runtime.requireDelegationSmoke,
      skipValidation: runtime.skipValidation,
      skipForgeSeed: runtime.skipForgeSeed === true,
      skipPilotAgentsSeed: runtime.skipPilotAgentsSeed === true,
      openclawUrl: runtime.openclawUrl || undefined,
      forgeAdapterUrl: runtime.forgeAdapterUrl || 'http://127.0.0.1:14010',
      operatorUrl: runtime.operatorUrl,
      maxItems: 1,
      fetchImpl: runtime.fetchImpl,
    });
    ticks.push(lastTick);
    processed = lastTick.results?.[0] || null;
    if (processed && targetStages.includes(processed.stage)) {
      break;
    }
    if (processed?.stage === 'failed') {
      break;
    }
  }

  const passed = Boolean(processed && targetStages.includes(processed.stage));
  const evidence = {
    schemaVersion: '1.0',
    kind: 'factory-staging-smoke',
    generatedAt: new Date().toISOString(),
    baseUrl: runtime.baseUrl,
    queuePath,
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

async function runMilestoneAStagingVerify(options = {}) {
  const runtime = assertStagingRuntimeReady(resolveStagingRuntime(options));
  runtime.fetchImpl = options.fetchImpl || fetch;
  const outputDir = path.resolve(process.cwd(), runtime.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const evidence = {
    schemaVersion: '1.0',
    kind: 'milestone-a-staging-verify',
    generatedAt: new Date().toISOString(),
    profile: runtime.profile,
    baseUrl: runtime.baseUrl,
    outputDir: runtime.outputDir,
    summary: { passed: false, checks: [] },
    artifacts: {},
  };

  const workers = await runAuditWorkersProductionSmoke({
    fetchImpl: runtime.fetchImpl,
    baseUrl: runtime.baseUrl,
    tenantId: runtime.tenantId,
    jwtSecret: runtime.jwtSecret,
    outputPath: path.join(outputDir, 'audit-workers-production-smoke.json'),
  });
  evidence.artifacts.workers = path.join(runtime.outputDir, 'audit-workers-production-smoke.json');
  evidence.summary.checks.push({ name: 'gp_007_workers', ok: workers.summary.passed, lagSeconds: workers.metrics.projectionLagSecondsAfter });

  const bridge = await runEtForgeBridgeSmoke({
    fetchImpl: runtime.fetchImpl,
    enabled: process.env.ET_FORGE_DISPATCH_ENABLED || 'true',
    engineeringTeamBaseUrl: runtime.baseUrl,
    forgeAdapterBaseUrl: runtime.forgeAdapterUrl || 'http://forge.staging.local',
    outputPath: path.join(outputDir, 'et-forge-bridge-smoke.json'),
    probeLiveForge: Boolean(runtime.forgeAdapterUrl),
  });
  evidence.artifacts.bridge = path.join(runtime.outputDir, 'et-forge-bridge-smoke.json');
  evidence.summary.checks.push({ name: 'et_forge_bridge', ok: bridge.summary.passed });

  const intake = await runGithubIntakeSmoke(runtime, path.join(outputDir, 'gp-002-github-intake-smoke.json'));
  evidence.artifacts.intake = path.join(runtime.outputDir, 'gp-002-github-intake-smoke.json');
  evidence.summary.checks.push({ name: 'gp_002_intake', ok: intake.summary.passed });

  const factory = await runFactoryStagingSmoke(runtime, path.join(outputDir, 'factory-staging-smoke.json'));
  evidence.artifacts.factory = path.join(runtime.outputDir, 'factory-staging-smoke.json');
  evidence.summary.checks.push({
    name: 'factory_staging_orchestrator',
    ok: factory.summary.passed,
    stage: factory.summary.stage,
  });

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