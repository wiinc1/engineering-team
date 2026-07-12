#!/usr/bin/env node
'use strict';

/**
 * GitLab #273 acceptance auditor: Simple-class forge-optional policy
 * (or live forge lifecycle — product path is optional skip when children blocked).
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  FORGE_GP_STEPS,
  POLICY_VERSION,
  POLICY_NAME,
  resolveForgeClaimPolicy,
  resolveForgeSkipDecision,
  assertForgeSkipAllowed,
  partitionForgeSteps,
  applyForgeSkipToStepInventory,
} = require('../lib/task-platform/forge-claim-policy');
const {
  shouldSkipForgePhases,
  buildSkippedForgeSeedApi,
} = require('../lib/task-platform/golden-path-forge-skip');

function criterion(id, ok, detail) {
  return { id, ok: Boolean(ok), detail };
}

function checkSpikeDocumented(root) {
  const policySrc = fs.readFileSync(path.join(root, 'lib/task-platform/forge-claim-policy.js'), 'utf8');
  const ok = /OpenClaw child-session|children|spike/i.test(policySrc)
    && /simple-class-forge-optional/i.test(policySrc);
  return criterion(
    'SCOPE-spike-or-optional',
    ok,
    ok
      ? 'Policy module documents OpenClaw children spike + Simple forge-optional product path'
      : 'Missing spike/optional documentation in forge-claim-policy',
  );
}

function checkHonestSkipLabeling() {
  const simpleDecision = resolveForgeSkipDecision(
    { skipForgeSeed: true, templateTier: 'Simple' },
    {},
  );
  const partition = partitionForgeSteps({
    skipped: true,
    includeGp013: true,
    includeGp012: true,
    includeGp014: true,
    phase: 'phase2',
  });
  const inventory = applyForgeSkipToStepInventory({
    stepsCompleted: ['GP-009', 'GP-010', 'GP-012', 'GP-013', 'GP-014', 'GP-015', 'GP-016', 'GP-021'],
  }, simpleDecision.record);
  const onlyForgeSkipped = FORGE_GP_STEPS.every((s) => partition.skipped.includes(s))
    && !partition.skipped.includes('GP-012')
    && !partition.skipped.includes('GP-014')
    && partition.completed.includes('GP-012')
    && partition.completed.includes('GP-013')
    && partition.completed.includes('GP-014')
    && !FORGE_GP_STEPS.includes('GP-012')
    && !FORGE_GP_STEPS.includes('GP-014');
  const inventoryOk = inventory.stepsCompleted.includes('GP-012')
    && inventory.stepsCompleted.includes('GP-014')
    && inventory.stepsCompleted.includes('GP-013')
    && inventory.stepsCompleted.includes('GP-015')
    && !inventory.stepsCompleted.some((s) => FORGE_GP_STEPS.includes(s))
    && inventory.stepsSkipped.includes('GP-009')
    && inventory.forgePolicy?.skipped === true;
  const honestSkip = simpleDecision.skip === true
    && simpleDecision.record.mode === 'simple_optional_skip'
    && simpleDecision.record.policyVersion === POLICY_VERSION
    && simpleDecision.record.policyName === POLICY_NAME
    && /optional|Simple|#273/i.test(simpleDecision.record.rationale)
    && onlyForgeSkipped
    && inventoryOk;
  return {
    criterion: criterion(
      'AC1-honest-skip-labeling',
      honestSkip,
      honestSkip
        ? `Simple skip mode=${simpleDecision.record.mode}; forgeadapter GPs skipped; GP-012/014 still completed`
        : 'Simple skip does not honestly label forgeadapter-only GP steps',
    ),
    simpleDecision,
    honestSkip,
  };
}

function checkSkipApiShape(simpleDecision) {
  const skippedApi = buildSkippedForgeSeedApi(simpleDecision.record);
  const skipApiOk = skippedApi.seed?.skipped === true
    && skippedApi.forgePolicy?.policyVersion === POLICY_VERSION
    && shouldSkipForgePhases({ skipForgePhases: true, templateTier: 'Simple' }) === true;
  return criterion(
    'AC1-skip-api-shape',
    skipApiOk,
    skipApiOk ? 'Skipped forge seed API carries policy record' : 'Skip API missing policy',
  );
}

function throwsForgeSkipForbidden(fn) {
  try {
    fn();
    return false;
  } catch (error) {
    return error.code === 'FORGE_SKIP_FORBIDDEN';
  }
}

function checkNoFalseGreen() {
  const standardForbidden = throwsForgeSkipForbidden(
    () => assertForgeSkipAllowed({ skipForgeSeed: true, templateTier: 'Standard' }, {}),
  );
  const complexForbidden = throwsForgeSkipForbidden(
    () => assertForgeSkipAllowed({ skipForgePhases: true, templateTier: 'Complex' }, {}),
  );
  const forceRequiredForbidden = throwsForgeSkipForbidden(
    () => assertForgeSkipAllowed(
      { skipForgeSeed: true, templateTier: 'Simple' },
      { FACTORY_FORGE_REQUIRED: '1' },
    ),
  );
  const liveNoSkip = resolveForgeClaimPolicy({ templateTier: 'Simple' }, {});
  const noFalseGreen = standardForbidden
    && complexForbidden
    && forceRequiredForbidden
    && liveNoSkip.mode === 'live_forge'
    && liveNoSkip.skipRequested === false;
  return {
    criterion: criterion(
      'AC2-no-false-green-forge-required',
      noFalseGreen,
      noFalseGreen
        ? 'Standard/Complex/FACTORY_FORGE_REQUIRED fail closed; unskipped Simple stays live_forge'
        : 'Forge-required class can still skip',
    ),
    noFalseGreen,
  };
}

function checkRunbook(root) {
  const runbook = fs.readFileSync(
    path.join(root, 'docs/runbooks/golden-path-autonomous-delivery.md'),
    'utf8',
  );
  const runbookOk = /#273|forge-optional|Simple-class forge/i.test(runbook)
    && /STAGING_SKIP_FORGE/i.test(runbook)
    && /FORGE_SKIP_FORBIDDEN|forge-required|non-Simple/i.test(runbook);
  return criterion(
    'SCOPE-runbook-policy',
    runbookOk,
    runbookOk
      ? 'Runbook documents #273 Simple forge-optional + fail-closed non-Simple'
      : 'Runbook missing #273 policy section',
  );
}

function checkSourceWiring(root) {
  const deliverySrc = fs.readFileSync(path.join(root, 'lib/task-platform/factory-delivery.js'), 'utf8');
  const deliveryGate = /assertForgeSkipAllowed/.test(deliverySrc)
    && /templateTier/.test(deliverySrc);
  const phasesSrc = fs.readFileSync(path.join(root, 'lib/task-platform/golden-path-phases.js'), 'utf8');
  const phasesWire = /applyForgeSkipToStepInventory/.test(phasesSrc)
    && /partitionPhaseStepsWithForgePolicy/.test(phasesSrc)
    && /stepsSkipped/.test(phasesSrc)
    && /resolveForgeSkipDecision/.test(phasesSrc);
  return [
    criterion(
      'SCOPE-factory-delivery-gate',
      deliveryGate,
      deliveryGate
        ? 'factory-delivery asserts forge skip policy before skip seed'
        : 'factory-delivery missing assertForgeSkipAllowed',
    ),
    criterion(
      'SCOPE-phases-inventory',
      phasesWire,
      phasesWire
        ? 'golden-path-phases wires policy decision + stepsSkipped inventory'
        : 'phases missing inventory honesty wiring',
    ),
  ];
}

function writeReport(root, report) {
  const outDir = path.join(root, 'observability/issue-273');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'acceptance-audit.json');
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  return outPath;
}

function buildReport(root) {
  const honest = checkHonestSkipLabeling();
  const falseGreen = checkNoFalseGreen();
  const runbook = checkRunbook(root);
  const criteria = [
    checkSpikeDocumented(root),
    honest.criterion,
    checkSkipApiShape(honest.simpleDecision),
    falseGreen.criterion,
    runbook,
    ...checkSourceWiring(root),
  ];
  const failed = criteria.filter((c) => !c.ok);
  return {
    issue: 273,
    title: 'Forgeadapter live integration or Simple-class forge-optional policy',
    verifiedAt: new Date().toISOString(),
    policyVersion: POLICY_VERSION,
    policyName: POLICY_NAME,
    forgeGpSteps: [...FORGE_GP_STEPS],
    openClawChildrenSpike: {
      status: 'blocked',
      health: 'live (:18789)',
      childrenEndpoints: 'not exposed (POST /sessions/:id/children and variants 404)',
      productPath: 'simple-class-forge-optional',
    },
    scope: [
      {
        bullet: 'Spike forgeadapter + live OpenClaw children or document Simple forge-optional',
        ok: criteria.find((c) => c.id === 'SCOPE-spike-or-optional')?.ok === true,
      },
      {
        bullet: 'If blocked: document Simple-class skip; evidence does not claim forge GP as real when skipped',
        ok: honest.honestSkip && falseGreen.noFalseGreen,
      },
      { bullet: 'Align milestone verify defaults with policy', ok: runbook.ok },
    ],
    criteria,
    ok: failed.length === 0,
    failed: failed.map((c) => c.id),
  };
}

function main() {
  const report = buildReport(process.cwd());
  const outPath = writeReport(process.cwd(), report);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ok: report.ok,
    issue: 273,
    failed: report.failed,
    outputPath: outPath,
    criteria: report.criteria.map((c) => ({ id: c.id, ok: c.ok })),
  }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
