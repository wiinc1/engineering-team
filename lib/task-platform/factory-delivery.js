const path = require('node:path');
const { runGoldenPathPhase1 } = require('./golden-path-phase1');
const { runGoldenPathPhases } = require('./golden-path-phases');
const { loadPilotEvidence, pollForgeExecutionReadiness } = require('./golden-path-shared');
const { seedGoldenPathForgeTask } = require('./golden-path-forge-seed');
const {
  createFactoryIntake,
  writeIntakeEvidence,
  completeIntakeRefinementAfterContract,
} = require('./factory-intake');
const {
  DEFAULT_QUEUE_PATH,
  DEFAULT_DELIVERY_DIR,
  resolveFactoryConfig,
  loadFactoryQueue,
  saveFactoryQueue,
  normalizeRequirement,
  evidencePathForItem,
  persistDirForItem,
  makeForgeTaskId,
} = require('./factory-delivery-shared');

const FACTORY_STAGES = Object.freeze([
  'queued',
  'intake_complete',
  'phase1_complete',
  'phase6_complete',
  'completed',
  'failed',
]);

function isFactoryItemPending(item, evidence = null) {
  const stage = resolveDeliveryStage(item, evidence);
  return !['completed', 'failed'].includes(stage);
}

function resolveDeliveryStage(item, evidence = null) {
  const evidenceStatus = evidence?.status || null;
  if (item.stage === 'completed' || evidenceStatus === 'phase6_complete') return 'completed';
  if (
    evidenceStatus === 'phase1_complete'
    || /^phase[2-6]_/.test(String(evidenceStatus || ''))
    || item.stage === 'phase1_complete'
  ) {
    return 'phase1_complete';
  }
  if (item.taskId && item.projectId) return 'intake_complete';
  if (item.stage === 'failed' && evidenceStatus) {
    if (evidenceStatus === 'phase6_complete') return 'completed';
    if (evidenceStatus === 'phase1_complete' || /^phase[2-6]_/.test(evidenceStatus)) return 'phase1_complete';
    if (evidenceStatus === 'phase0_started') return 'intake_complete';
  }
  if (item.stage === 'failed') return 'failed';
  return item.stage || 'queued';
}

function buildPhaseRunnerOptions(config, item) {
  const evidencePath = item.evidencePath || evidencePathForItem(item, config.deliveryDir);
  // Factory phases always call the HTTP API; persistDir would skip postgres projection catch-up.
  const persistDir = null;
  return {
    baseUrl: config.baseUrl,
    jwtSecret: config.jwtSecret,
    tenantId: config.tenantId,
    actorId: config.actorId,
    outputPath: evidencePath,
    persistDir,
    taskId: item.taskId,
    projectId: item.projectId,
    forgeTaskId: item.forgeTaskId || makeForgeTaskId(item.id),
    forgeAdapterBaseUrl: config.forgeAdapterUrl,
    forgeServiceToken: config.forgeServiceToken,
    forgeAdapterToken: config.forgeAdapterToken,
    operatorUrl: config.operatorUrl,
    openclawUrl: config.openclawUrl || undefined,
    hermesUrl: config.hermesUrl || undefined,
    skipDelegationSmoke: !config.requireDelegationSmoke,
  };
}

async function runFactoryIntake(config, item) {
  const ctx = {
    fetchImpl: config.fetchImpl,
    baseUrl: config.baseUrl,
    tenantId: config.tenantId,
    actorId: config.actorId,
    jwtSecret: config.jwtSecret,
  };
  const intake = await createFactoryIntake(ctx, item);
  const paths = writeIntakeEvidence(config, item, intake);
  return {
    ...item,
    taskId: intake.taskId,
    projectId: intake.projectId,
    projectName: intake.projectName,
    evidencePath: paths.evidencePath,
    persistDir: paths.persistDir,
    forgeTaskId: item.forgeTaskId || makeForgeTaskId(item.id),
    stage: 'intake_complete',
    updatedAt: new Date().toISOString(),
  };
}

async function runFactoryPhase1(config, item) {
  const options = buildPhaseRunnerOptions(config, item);
  const existing = loadPilotEvidence(options.outputPath);
  if (existing?.status === 'phase1_complete') {
    return {
      ...item,
      stage: 'phase1_complete',
      evidenceStatus: existing.status,
      updatedAt: new Date().toISOString(),
      lastAction: 'phase1',
    };
  }
  await runGoldenPathPhase1({
    ...options,
    bootstrapPhase0: false,
    childIssue: item.githubIssueUrl ? undefined : 'factory',
    childIssueUrl: item.githubIssueUrl || undefined,
    projectName: item.projectName,
    pilot: loadPilotEvidence(options.outputPath),
  });
  const refreshed = loadPilotEvidence(options.outputPath);
  const contractVersion = refreshed?.engineeringTeam?.contractVersion;
  if (contractVersion) {
    const ctx = {
      fetchImpl: config.fetchImpl,
      baseUrl: config.baseUrl,
      tenantId: config.tenantId,
      actorId: config.actorId,
      jwtSecret: config.jwtSecret,
    };
    await completeIntakeRefinementAfterContract(ctx, item.taskId || refreshed.engineeringTeam.taskId, contractVersion);
  }
  return {
    ...item,
    stage: refreshed?.status === 'phase1_complete' ? 'phase1_complete' : 'failed',
    evidenceStatus: refreshed?.status || null,
    updatedAt: new Date().toISOString(),
    lastAction: 'phase1',
  };
}

async function seedFactoryForgeTask(config, forgeTaskId) {
  const { createAuditStore } = require('../audit');
  const { assertAuditBackendConfiguration } = require('../audit/config');
  const backendConfig = assertAuditBackendConfiguration({ runtimeGuard: false });
  const seed = await seedGoldenPathForgeTask({
    taskId: forgeTaskId,
    tenantId: config.tenantId,
    baseDir: process.cwd(),
    store: createAuditStore({
      baseDir: process.cwd(),
      backend: backendConfig.backend,
      connectionString: backendConfig.connectionString,
      workflowEngineEnabled: false,
    }),
  });
  const readiness = await pollForgeExecutionReadiness(
    config.baseUrl,
    forgeTaskId,
    config.forgeServiceToken,
  );
  if (!readiness.ok) {
    throw new Error(`${forgeTaskId} forge readiness failed (${readiness.status}): ${JSON.stringify(readiness.body)}`);
  }
  return seed;
}

async function runFactoryExecutionPhases(config, item) {
  const options = buildPhaseRunnerOptions(config, item);
  const evidence = loadPilotEvidence(options.outputPath);
  if (!evidence) throw new Error(`Missing factory evidence at ${options.outputPath}`);
  await seedFactoryForgeTask(config, options.forgeTaskId);
  await runGoldenPathPhases({ ...options, fromPhase: 2, toPhase: 6, pilot: evidence });
  const refreshed = loadPilotEvidence(options.outputPath);
  return {
    ...item,
    stage: refreshed?.status === 'phase6_complete' ? 'phase6_complete' : 'phase1_complete',
    evidenceStatus: refreshed?.status || null,
    updatedAt: new Date().toISOString(),
    lastAction: 'phases_2_6',
    completedAt: refreshed?.status === 'phase6_complete' ? new Date().toISOString() : null,
  };
}

async function advanceFactoryItem(item, config = {}) {
  const resolved = resolveFactoryConfig(config);
  if (!resolved.jwtSecret) throw new Error('AUTH_JWT_SECRET is required for factory delivery');

  const evidence = item.evidencePath ? loadPilotEvidence(item.evidencePath) : null;
  const stage = resolveDeliveryStage(item, evidence);
  const working = { ...item, stage };

  try {
    if (stage === 'queued') return { item: await runFactoryIntake(resolved, working), action: 'intake' };
    if (stage === 'intake_complete') return { item: await runFactoryPhase1(resolved, working), action: 'phase1' };
    if (stage === 'phase1_complete') return { item: await runFactoryExecutionPhases(resolved, working), action: 'phases_2_6' };
    if (stage === 'phase6_complete') {
      return {
        item: { ...working, stage: 'completed', updatedAt: new Date().toISOString(), lastAction: 'complete' },
        action: 'complete',
      };
    }
    return { item: working, action: 'noop' };
  } catch (error) {
    return {
      item: {
        ...working,
        stage: 'failed',
        updatedAt: new Date().toISOString(),
        lastError: error?.message || String(error),
        lastAction: 'error',
      },
      action: 'error',
      error,
    };
  }
}

function submitFactoryRequirements(requirements = [], options = {}) {
  const config = resolveFactoryConfig(options);
  const queue = loadFactoryQueue(config.queuePath);
  const now = new Date().toISOString();
  const created = requirements.map((entry, index) => normalizeRequirement(entry, index)).map((requirement) => ({
    id: requirement.id,
    title: requirement.title,
    requirements: requirement.requirements,
    templateTier: requirement.templateTier,
    githubIssueUrl: requirement.githubIssueUrl,
    stage: 'queued',
    taskId: null,
    projectId: null,
    evidencePath: evidencePathForItem({ id: requirement.id }, config.deliveryDir),
    persistDir: null,
    forgeTaskId: makeForgeTaskId(requirement.id),
    createdAt: now,
    updatedAt: now,
    lastAction: null,
    lastError: null,
  }));
  queue.items = [...(queue.items || []), ...created];
  return { queuePath: saveFactoryQueue(queue, config.queuePath), created };
}

async function runFactoryOrchestratorTick(options = {}) {
  const config = resolveFactoryConfig(options);
  const queue = loadFactoryQueue(config.queuePath);
  const maxItems = Number(options.maxItems || process.env.FACTORY_ORCHESTRATOR_BATCH || 1);
  const results = [];
  const pending = (queue.items || []).filter((item) => {
    const evidence = item.evidencePath ? loadPilotEvidence(item.evidencePath) : null;
    return isFactoryItemPending(item, evidence);
  });

  for (const item of pending.slice(0, maxItems)) {
    const outcome = await advanceFactoryItem(item, config);
    const index = queue.items.findIndex((entry) => entry.id === item.id);
    if (index !== -1) queue.items[index] = outcome.item;
    results.push({
      id: item.id,
      action: outcome.action,
      stage: outcome.item.stage,
      taskId: outcome.item.taskId || null,
      error: outcome.error?.message || outcome.item.lastError || null,
    });
  }

  saveFactoryQueue(queue, config.queuePath);
  return {
    queuePath: path.resolve(process.cwd(), config.queuePath),
    processed: results.length,
    results,
    pendingCount: (queue.items || []).filter((entry) => {
      const evidence = entry.evidencePath ? loadPilotEvidence(entry.evidencePath) : null;
      return isFactoryItemPending(entry, evidence);
    }).length,
  };
}

module.exports = {
  FACTORY_STAGES,
  DEFAULT_QUEUE_PATH,
  DEFAULT_DELIVERY_DIR,
  resolveFactoryConfig,
  resolveDeliveryStage,
  isFactoryItemPending,
  loadFactoryQueue,
  saveFactoryQueue,
  normalizeRequirement,
  submitFactoryRequirements,
  advanceFactoryItem,
  runFactoryOrchestratorTick,
  createFactoryIntake,
};