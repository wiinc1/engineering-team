const path = require('node:path');
const { runGoldenPathPhase1 } = require('./golden-path-phase1');
const { runGoldenPathPhases } = require('./golden-path-phases');
const { loadPilotEvidence, pollForgeExecutionReadiness } = require('./golden-path-shared');
const { assertGoldenPathRealEvidencePreflight } = require('./golden-path-real-evidence-preflight');
const { seedGoldenPathForgeTask } = require('./golden-path-forge-seed');
const { createFactoryIntake, writeIntakeEvidence, completeIntakeRefinementAfterContract, bootstrapFactoryIntakeAgents } = require('./factory-intake');
const { applyForgeLifecycleEnv, resolveAgentDelegationEnv } = require('./factory-orchestration');
const {
  DEFAULT_QUEUE_PATH,
  DEFAULT_DELIVERY_DIR,
  resolveFactoryConfig,
  loadFactoryQueue,
  saveFactoryQueue,
  assertActiveFactoryQueueFile,
  normalizeRequirement,
  evidencePathForItem,
  hasFactoryItemRealDeliveryIntent,
  makeForgeTaskId,
} = require('./factory-delivery-shared');
const {
  summarizeFactoryPersonaProgression,
  assertRequiredFactoryPersonas,
} = require('./factory-persona-progression');
const { verifyFactoryRealDeliveryCandidate } = require('./factory-real-delivery-candidate');
const { completeFactoryRealDeliveryProof, itemWithFinalProofMetadata } = require('./factory-real-delivery-completion');
const { createPostgresFactoryQueueStore } = require('./factory-delivery-queue-postgres');
const { buildPhaseRunnerOptions } = require('./factory-phase-runner-options');
const { assertFactoryItemRealEvidencePreflightForStage } = require('./factory-real-delivery-preflight');
const { prepareFactorySubmitRequirements } = require('./factory-delivery-submit-preflight');
const FACTORY_STAGES = Object.freeze([
  'queued',
  'intake_complete',
  'phase1_complete',
  'phase6_complete',
  'completed',
  'failed',
  'dead_letter',
]);

function isFactoryItemPending(item, evidence = null) {
  const stage = resolveDeliveryStage(item, evidence);
  return !['completed', 'failed', 'dead_letter'].includes(stage);
}

function assertDurableQueueForFactoryItem(config = {}, item = {}) {
  if (config.queueBackend !== 'file' || !hasFactoryItemRealDeliveryIntent(item)) return;
  throw new Error('Factory real-delivery items require FACTORY_QUEUE_BACKEND=postgres; file queues are local smoke fixtures only');
}

function resolveDeliveryStage(item, evidence = null) {
  const evidenceStatus = evidence?.status || null;
  if (item.stage === 'dead_letter') return 'dead_letter';
  if (item.stage === 'completed') return 'completed';
  if (item.stage === 'phase6_complete' || evidenceStatus === 'phase6_complete') return 'phase6_complete';
  if (
    evidenceStatus === 'phase1_complete'
    || /^phase[2-6]_/.test(String(evidenceStatus || ''))
    || item.stage === 'phase1_complete'
  ) {
    return 'phase1_complete';
  }
  if (item.taskId && item.projectId) return 'intake_complete';
  if (item.stage === 'failed') {
    if (!evidenceStatus) return 'failed';
    if (evidenceStatus === 'phase0_started') return 'intake_complete';
    return 'failed';
  }
  return item.stage || 'queued';
}

function factoryDelegationEnv(config, item = {}) {
  const itemRequiresRealEvidence = hasFactoryItemRealDeliveryIntent(item);
  return resolveAgentDelegationEnv({
    openclawUrl: config.openclawUrl,
    hermesUrl: config.hermesUrl,
    collectRealEvidence: config.collectRealEvidence === true || itemRequiresRealEvidence,
    requireRealEvidence: config.requireRealEvidence === true || itemRequiresRealEvidence,
    agentDrivenPhases: config.agentDrivenPhases === true,
  });
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
  if (!config.skipPilotAgentsSeed) {
    await bootstrapFactoryIntakeAgents(config.baseUrl);
  }
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
    lastAction: 'intake',
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
  applyForgeLifecycleEnv(options.forgeTaskId);
  Object.assign(process.env, factoryDelegationEnv(config, item));
  await runGoldenPathPhase1({
    ...options,
    bootstrapPhase0: false,
    templateTier: item.templateTier,
    childIssue: item.githubIssueUrl ? undefined : 'factory',
    childIssueUrl: item.githubIssueUrl || undefined,
    projectName: item.projectName,
    pilot: loadPilotEvidence(options.outputPath),
    agentDrivenPhase1: options.agentDrivenPhase1 === true,
    factoryRequirements: item.requirements,
  });
  const refreshed = loadPilotEvidence(options.outputPath);
  const contractVersion = refreshed?.engineeringTeam?.contractVersion;
  if (contractVersion && options.agentDrivenPhase1 !== true) {
    const ctx = {
      fetchImpl: config.fetchImpl,
      baseUrl: config.baseUrl,
      tenantId: config.tenantId,
      actorId: config.actorId,
      jwtSecret: config.jwtSecret,
    };
    await completeIntakeRefinementAfterContract(ctx, item.taskId || refreshed.engineeringTeam.taskId, contractVersion);
  }
  if (!config.skipForgeSeed) {
    await seedFactoryForgeTask(config, options.forgeTaskId);
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

function resolveFactoryExecutionPhaseRange(evidence = {}) {
  const status = String(evidence.status || '');
  if (status === 'phase5_complete') {
    return { fromPhase: 6, toPhase: 6, resumePhase6Only: true };
  }
  return { fromPhase: 2, toPhase: 6, resumePhase6Only: false };
}

function assertFactoryItemRealEvidencePreflight(config = {}, item = {}, evidence = null) {
  return assertFactoryItemRealEvidencePreflightForStage(
    config,
    item,
    resolveDeliveryStage(item, evidence),
    evidence,
  );
}

async function runFactoryExecutionPhases(config, item) {
  const runPhasesFn = config.runPhasesFn || runGoldenPathPhases;
  const options = buildPhaseRunnerOptions(config, item);
  const evidence = loadPilotEvidence(options.outputPath);
  if (!evidence) throw new Error(`Missing factory evidence at ${options.outputPath}`);
  const phaseRange = resolveFactoryExecutionPhaseRange(evidence);
  assertGoldenPathRealEvidencePreflight({
    ...options,
    ...phaseRange,
  }, { context: 'Factory delivery item' });
  await verifyFactoryRealDeliveryCandidate(config, item);
  if (!phaseRange.resumePhase6Only && !config.skipForgeSeed) {
    await seedFactoryForgeTask(config, options.forgeTaskId);
  }
  applyForgeLifecycleEnv(options.forgeTaskId);
  Object.assign(process.env, factoryDelegationEnv(config, item));
  await runPhasesFn({
    ...options,
    ...phaseRange,
    pilot: evidence,
    agentDrivenPhases: options.agentDrivenPhases === true,
    requirements: item.requirements,
  });
  const refreshed = loadPilotEvidence(options.outputPath);
  const phase6Complete = refreshed?.status === 'phase6_complete';
  return {
    ...item,
    stage: phase6Complete ? 'phase6_complete' : 'phase1_complete',
    evidenceStatus: refreshed?.status || null,
    updatedAt: new Date().toISOString(),
    lastAction: 'phases_2_6',
    lastError: phase6Complete ? null : item.lastError || null,
    completedAt: null,
  };
}

async function advanceFactoryItem(item, config = {}) {
  const resolved = resolveFactoryConfig(config);
  if (!resolved.jwtSecret) throw new Error('AUTH_JWT_SECRET is required for factory delivery');

  const evidence = item.evidencePath ? loadPilotEvidence(item.evidencePath) : null;
  const stage = resolveDeliveryStage(item, evidence);
  const working = { ...item, stage };

  try {
    assertDurableQueueForFactoryItem(resolved, working);
    if (stage !== 'phase6_complete') assertFactoryItemRealEvidencePreflight(resolved, working, evidence);
    if (stage === 'queued') return { item: await runFactoryIntake(resolved, working), action: 'intake' };
    if (stage === 'intake_complete') return { item: await runFactoryPhase1(resolved, working), action: 'phase1' };
    if (stage === 'phase1_complete') return { item: await runFactoryExecutionPhases(resolved, working), action: 'phases_2_6' };
    if (stage === 'phase6_complete') {
      const completion = await completeFactoryRealDeliveryProof(resolved, working);
      const completedAt = new Date().toISOString();
      return {
        item: { ...itemWithFinalProofMetadata(working, completion), stage: 'completed', updatedAt: completedAt, completedAt, lastAction: 'complete' },
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
  const config = resolveFactoryConfig({ ...options, queueBackend: 'file' });
  const normalizedRequirements = requirements.map((entry, index) => normalizeRequirement(entry, index));
  normalizedRequirements.forEach((entry) => assertDurableQueueForFactoryItem(config, entry));
  const queue = loadFactoryQueue(config.queuePath);
  assertActiveFactoryQueueFile(queue, config.queuePath, 'factory requirement submission');
  const now = new Date().toISOString();
  const created = normalizedRequirements.map((requirement) => ({
    id: requirement.id,
    title: requirement.title,
    requirements: requirement.requirements,
    templateTier: requirement.templateTier,
    changeKind: requirement.changeKind,
    changedFiles: requirement.changedFiles,
    githubIssueUrl: requirement.githubIssueUrl,
    metadata: requirement.metadata || {},
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

async function submitFactoryRequirementsForQueue(requirements = [], options = {}) {
  const config = resolveFactoryConfig(options);
  if (config.queueBackend !== 'postgres') {
    return submitFactoryRequirements(requirements, options);
  }
  const preparedRequirements = prepareFactorySubmitRequirements(requirements, config);
  const store = options.queueStore || createPostgresFactoryQueueStore(config);
  try {
    return await store.submit(preparedRequirements, config);
  } finally {
    if (!options.queueStore) await store.close();
  }
}

async function runPostgresFactoryOrchestratorTick(options = {}) {
  const config = resolveFactoryConfig(options);
  const maxItems = Number(options.maxItems || process.env.FACTORY_ORCHESTRATOR_BATCH || 1);
  const store = options.queueStore || createPostgresFactoryQueueStore(config);
  const results = [];
  try {
    const claims = await store.claim({ ...config, maxItems });
    for (const claim of claims) {
      const outcome = await advanceFactoryItem(claim.item, config);
      const released = await store.release(claim, outcome, config);
      results.push({
        id: claim.item.id,
        action: outcome.action,
        stage: released.item.stage,
        taskId: released.item.taskId || null,
        attempts: released.item.attempts,
        deadLetter: released.deadLetter,
        error: outcome.error?.message || outcome.item.lastError || null,
      });
    }
    return {
      queueBackend: 'postgres',
      queueTable: 'factory_delivery_queue',
      processed: results.length,
      recovery: claims.recovery || { recovered: 0, deadLettered: 0 },
      results,
      pendingCount: await store.pendingCount(config),
    };
  } finally {
    if (!options.queueStore) await store.close();
  }
}
async function runFactoryOrchestratorTick(options = {}) {
  const config = resolveFactoryConfig(options);
  if (config.queueBackend === 'postgres') {
    return runPostgresFactoryOrchestratorTick({ ...options, ...config });
  }
  const queue = loadFactoryQueue(config.queuePath);
  assertActiveFactoryQueueFile(queue, config.queuePath, 'factory orchestration');
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
  FACTORY_STAGES, DEFAULT_QUEUE_PATH, DEFAULT_DELIVERY_DIR, resolveFactoryConfig,
  resolveDeliveryStage, resolveFactoryExecutionPhaseRange, summarizeFactoryPersonaProgression,
  assertRequiredFactoryPersonas, isFactoryItemPending, loadFactoryQueue, saveFactoryQueue,
  assertDurableQueueForFactoryItem, assertFactoryItemRealEvidencePreflight,
  normalizeRequirement, submitFactoryRequirements, submitFactoryRequirementsForQueue,
  advanceFactoryItem, runFactoryOrchestratorTick, runPostgresFactoryOrchestratorTick, createFactoryIntake,
};
