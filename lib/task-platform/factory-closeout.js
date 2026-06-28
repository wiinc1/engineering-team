const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_INVENTORY_PATH = 'observability/golden-path-manual-steps.json';

function loadManualStepsInventory(inventoryPath = DEFAULT_INVENTORY_PATH) {
  const resolved = path.resolve(process.cwd(), inventoryPath);
  if (!fs.existsSync(resolved)) {
    return { steps: [], summary: { totalSteps: 0, manualToday: 0, automatedToday: 0 } };
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function stepsCompletedSet(evidence = {}) {
  return new Set((evidence.stepsCompleted || []).map((step) => String(step).trim()));
}

function classifyStepStatus(step, evidence = {}, inventoryStep = {}) {
  const completed = stepsCompletedSet(evidence);
  if (completed.has(step.id)) {
    return inventoryStep.manual === false ? 'automated' : 'completed_manual';
  }
  if (inventoryStep.manual === false) {
    return 'automated_pending';
  }
  return 'manual';
}

function extractManualInterventions(evidence = {}) {
  const fromEvidence = Array.isArray(evidence.manualInterventions) ? evidence.manualInterventions : [];
  return fromEvidence.map((entry) => ({
    stepId: entry.stepId || entry.step_id || null,
    classification: entry.classification || 'operator_intervention',
    reason: entry.reason || null,
    recordedAt: entry.recordedAt || entry.recorded_at || null,
  }));
}

function buildFactoryCloseoutReport(evidence = {}, options = {}) {
  const inventory = loadManualStepsInventory(options.inventoryPath);
  const steps = (inventory.steps || []).map((step) => ({
    id: step.id,
    phase: step.phase,
    action: step.action,
    system: step.system,
    status: classifyStepStatus(step, evidence, step),
    manualInInventory: step.manual !== false,
    automatedBy: step.automatedBy || null,
  }));

  const automated = steps.filter((step) => step.status === 'automated').length;
  const completedManual = steps.filter((step) => step.status === 'completed_manual').length;
  const stillManual = steps.filter((step) => step.status === 'manual').length;
  const manualInterventions = extractManualInterventions(evidence);

  return {
    schemaVersion: '1.0',
    kind: 'factory-closeout-report',
    generatedAt: new Date().toISOString(),
    taskId: evidence.engineeringTeam?.taskId || null,
    factoryQueueId: evidence.factoryQueueId || null,
    projectId: evidence.engineeringTeam?.projectId || null,
    deliveryStatus: evidence.status || null,
    stepsCompleted: [...stepsCompletedSet(evidence)].sort(),
    stepClassification: {
      total: steps.length,
      automated,
      completedManual,
      stillManual,
      automatedPending: steps.filter((step) => step.status === 'automated_pending').length,
    },
    steps,
    manualInterventions,
    phase6: {
      validationOk: evidence.phase6?.api?.validation?.ok === true,
      taskClosedOk: evidence.phase6?.api?.taskClosed?.ok === true,
      humanCloseOk: evidence.phase6?.api?.humanClose?.ok === true,
      ciValidation: evidence.phase6?.api?.ciValidation || evidence.deploy?.ciValidation || null,
    },
    artifacts: {
      factoryEvidence: options.evidencePath || null,
      inventory: options.inventoryPath || DEFAULT_INVENTORY_PATH,
    },
  };
}

function resolveCloseoutOutputPath(evidence = {}, options = {}) {
  if (options.outputPath) return path.resolve(process.cwd(), options.outputPath);
  const taskId = evidence.engineeringTeam?.taskId || evidence.factoryQueueId || 'factory';
  const dir = options.outputDir || 'observability/factory-closeout';
  return path.resolve(process.cwd(), dir, `${taskId}.json`);
}

function writeFactoryCloseoutReport(evidence = {}, options = {}) {
  const report = buildFactoryCloseoutReport(evidence, options);
  const outputPath = resolveCloseoutOutputPath(evidence, { ...options, evidencePath: options.evidencePath });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, outputPath };
}

module.exports = {
  DEFAULT_INVENTORY_PATH,
  loadManualStepsInventory,
  buildFactoryCloseoutReport,
  writeFactoryCloseoutReport,
  classifyStepStatus,
};