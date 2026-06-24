const path = require('node:path');
const { runGoldenPathPhase1 } = require('./golden-path-phase1');
const { runGoldenPathPhases } = require('./golden-path-phases');
const { loadPilotEvidence } = require('./golden-path-shared');
const { createFactoryIntake, writeIntakeEvidence } = require('./factory-intake');
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

function resolveDeliveryStage(item, evidence = null) {
  if (item.stage === 'failed' || item.stage === 'completed') return item.stage;
  if (item.stage === 'phase6_complete') return 'completed';
  if (evidence?.status === 'phase6_complete') return 'completed';
  if (evidence?.status === 'phase1_complete' || item.stage === 'phase1_complete') return 'phase1_complete';
  if (item.taskId && item.projectId) return 'intake_complete';
  return item.stage || 'queued';
}

function buildPhaseRunnerOptions(config, item) {
  const evidencePath = item.evidencePath || evidencePathForItem(item, config.deliveryDir);
  const persistDir = item.persistDir || persistDirForItem(item, config.deliveryDir);
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
  await runGoldenPathPhase1({
    ...options,
    bootstrapPhase0: false,
    childIssue: item.githubIssueUrl ? undefined : 'factory',
    childIssueUrl: item.githubIssueUrl || undefined,
    projectName: item.projectName,
    pilot: loadPilotEvidence(options.outputPath),
  });
  const refreshed = loadPilotEvidence(options.outputPath);
  return {
    ...item,
    stage: refreshed?.status === 'phase1_complete' ? 'phase1_complete' : 'failed',
    evidenceStatus: refreshed?.status || null,
    updatedAt: new Date().toISOString(),
    lastAction: 'phase1',
  };
}

async function runFactoryExecutionPhases(config, item) {
  const options = buildPhaseRunnerOptions(config, item);
  const evidence = loadPilotEvidence(options.outputPath);
  if (!evidence) throw new Error(`Missing factory evidence at ${options.outputPath}`);
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
  const pending = (queue.items || []).filter((item) => !['completed', 'failed'].includes(item.stage));

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
    pendingCount: (queue.items || []).filter((entry) => !['completed', 'failed'].includes(entry.stage)).length,
  };
}

module.exports = {
  FACTORY_STAGES,
  DEFAULT_QUEUE_PATH,
  DEFAULT_DELIVERY_DIR,
  resolveFactoryConfig,
  resolveDeliveryStage,
  loadFactoryQueue,
  saveFactoryQueue,
  normalizeRequirement,
  submitFactoryRequirements,
  advanceFactoryItem,
  runFactoryOrchestratorTick,
  createFactoryIntake,
};