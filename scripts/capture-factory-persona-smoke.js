#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  submitFactoryRequirementsForQueue,
  runFactoryOrchestratorTick,
  resolveDeliveryStage,
  loadFactoryQueue,
  summarizeFactoryPersonaProgression,
  assertRequiredFactoryPersonas,
} = require('../lib/task-platform/factory-delivery');
const { loadPilotEvidence } = require('../lib/task-platform/golden-path-shared');

const DEFAULT_SCRATCH = '/var/folders/b6/fwvd5_ys3k1g3x2n495027r80000gn/T/grok-goal-6e0bcc204f49/implementer';

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function appendLog(scratchDir, text) {
  const logPath = path.join(scratchDir, 'factory-iteration.log');
  fs.mkdirSync(scratchDir, { recursive: true });
  fs.appendFileSync(logPath, text.endsWith('\n') ? text : `${text}\n`);
  return logPath;
}

function resolveScratchDir() {
  return path.resolve(process.cwd(), readArg('--scratch-dir', process.env.SCRATCH || DEFAULT_SCRATCH));
}

function configureFactoryEnv() {
  process.env.AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET || 'golden-path-local-dev-secret';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://audit:audit@127.0.0.1:15432/engineering_team';
  process.env.PGSSLMODE = process.env.PGSSLMODE || 'disable';
  process.env.PROJECTION_CATCHUP_WAIT_MS = process.env.PROJECTION_CATCHUP_WAIT_MS || '4000';
  process.env.FORGE_SERVICE_TOKEN = process.env.FORGE_SERVICE_TOKEN || 'local-golden-path-forge-token';
  process.env.FORGEADAPTER_SERVICE_TOKEN = process.env.FORGEADAPTER_SERVICE_TOKEN || 'local-forgeadapter-token';
}

function resolveRunConfig() {
  const scratchDir = resolveScratchDir();
  return {
    scratchDir,
    queuePath: path.join(scratchDir, `factory-persona-queue-${Date.now().toString(36)}.json`),
    deliveryDir: path.join(scratchDir, 'factory-delivery'),
    baseUrl: readArg('--base-url', process.env.FACTORY_BASE_URL || 'http://127.0.0.1:13000'),
    maxTicks: Number(readArg('--max-ticks', '6')),
    tier: readArg('--tier', 'Standard'),
    queueBackend: readArg('--queue-backend', process.env.FACTORY_QUEUE_BACKEND || 'postgres'),
    allowFileQueue: process.argv.includes('--allow-file-queue'),
  };
}

async function submitPersonaRequirement(config) {
  const captureSuffix = new Date().toISOString().replace(/[:.]/g, '-');
  return submitFactoryRequirementsForQueue([
    {
      title: readArg('--title', `Multi-persona SDLC test ${captureSuffix}`),
      requirements: readArg(
        '--requirements',
        'Implement a minimal feature exercising PM intake, architect handoff, jr/sr/principal dispatch, QA, SRE verification',
      ),
      templateTier: config.tier,
    },
  ], config);
}

function updateLastItemFromTick(config, lastItem, outcome) {
  if (config.queueBackend === 'file') {
    const queue = loadFactoryQueue(config.queuePath);
    return queue.items.find((entry) => entry.id === lastItem.id) || lastItem;
  }
  const result = outcome.results.find((entry) => entry.id === lastItem.id) || null;
  return {
    ...lastItem,
    stage: result?.stage || lastItem.stage,
    taskId: result?.taskId || lastItem.taskId,
    lastError: result?.error || lastItem.lastError,
  };
}

function writeSuccess(config, lastItem, stage, tick, progression, personaCheck) {
  const evidenceCopy = path.join(config.scratchDir, 'factory-evidence.json');
  fs.copyFileSync(path.resolve(process.cwd(), lastItem.evidencePath), evidenceCopy);
  appendLog(config.scratchDir, `=== factory persona progression summary ===`);
  appendLog(config.scratchDir, JSON.stringify(progression, null, 2));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    scratchDir: config.scratchDir,
    queuePath: config.queuePath,
    queueBackend: config.queueBackend,
    evidencePath: evidenceCopy,
    taskId: lastItem.taskId,
    stage,
    ticks: tick,
    personaProgression: progression,
    personaCheck,
  }, null, 2)}\n`);
}

async function main() {
  configureFactoryEnv();
  const config = resolveRunConfig();
  fs.mkdirSync(config.scratchDir, { recursive: true });
  fs.writeFileSync(path.join(config.scratchDir, 'factory-iteration.log'), '');

  const submit = await submitPersonaRequirement(config);
  appendLog(config.scratchDir, JSON.stringify({ step: 'submit', ...submit, at: new Date().toISOString() }, null, 2));

  let lastItem = submit.created[0];
  let tick = 0;

  while (tick < config.maxTicks) {
    tick += 1;
    appendLog(config.scratchDir, `=== orchestrator tick ${tick} ===`);
    const outcome = await runFactoryOrchestratorTick(config);
    appendLog(config.scratchDir, JSON.stringify({ ...outcome, at: new Date().toISOString() }, null, 2));

    lastItem = updateLastItemFromTick(config, lastItem, outcome);
    const evidence = lastItem.evidencePath ? loadPilotEvidence(lastItem.evidencePath) : null;
    const stage = resolveDeliveryStage(lastItem, evidence);
    const progression = summarizeFactoryPersonaProgression(evidence || {});
    const personaCheck = assertRequiredFactoryPersonas(progression);

    appendLog(config.scratchDir, `stage=${stage} taskId=${lastItem.taskId || 'null'} action=${lastItem.lastAction || 'null'}`);
    appendLog(config.scratchDir, `evidence.status=${evidence?.status || 'null'}`);
    appendLog(config.scratchDir, `personaProgression ${JSON.stringify(progression, null, 2)}`);
    appendLog(config.scratchDir, `personaCheck ${JSON.stringify(personaCheck, null, 2)}`);

    if (lastItem.stage === 'failed' || outcome.results.some((entry) => entry.error)) {
      throw new Error(lastItem.lastError || outcome.results.find((entry) => entry.error)?.error || 'factory tick failed');
    }
    if (stage === 'completed' || evidence?.status === 'phase6_complete') {
      if (!personaCheck.ok) {
        throw new Error(`Missing required personas: ${personaCheck.missing.join(', ')}`);
      }
      writeSuccess(config, lastItem, stage, tick, progression, personaCheck);
      return;
    }
  }

  throw new Error(`Factory orchestrator did not complete within ${config.maxTicks} ticks (last stage=${lastItem.stage})`);
}

main().catch((error) => {
  try {
    const scratchDir = resolveScratchDir();
    appendLog(scratchDir, `ERROR: ${error?.stack || error?.message || String(error)}`);
  } catch {
    // best effort
  }
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
