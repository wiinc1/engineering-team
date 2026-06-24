const fs = require('node:fs');
const path = require('node:path');
const { runMilestoneCAgentVerify } = require('./milestone-c-agent-verify');
const { buildFactoryCloseoutReport } = require('../task-platform/factory-closeout');

function buildMilestoneDCompleteEvidence(verifyResult = {}) {
  const checks = verifyResult.summary?.checks || [];
  const check = (name) => checks.find((entry) => entry.name === name) || { ok: false };
  const factoryEvidencePath = verifyResult.artifacts?.factoryEvidence || null;
  const factoryEvidence = factoryEvidencePath && fs.existsSync(factoryEvidencePath)
    ? JSON.parse(fs.readFileSync(factoryEvidencePath, 'utf8'))
    : null;
  const closeout = verifyResult.closeout || null;

  return {
    schemaVersion: '1.0',
    kind: 'milestone-d-complete',
    milestone: 'D',
    title: 'Closeout automation and delivery report',
    generatedAt: new Date().toISOString(),
    profile: verifyResult.profile || 'coordinated-stack',
    baseUrl: verifyResult.baseUrl || null,
    summary: {
      passed: verifyResult.summary?.passed === true,
      standardsCheck: check('gp023_validation_in_closeout').ok,
      verifyPassed: verifyResult.summary?.passed === true,
      factoryPhase6Complete: check('factory_phase6_complete').ok,
      gp027CloseoutReport: check('gp027_closeout_report').ok,
      gp027TaskClosed: check('gp027_task_closed').ok,
      gp027StepClassification: check('gp027_step_classification').ok,
      gp023ValidationInCloseout: check('gp023_validation_in_closeout').ok,
      automatedSteps: closeout?.stepClassification?.automated ?? 0,
      stillManualSteps: closeout?.stepClassification?.stillManual ?? 0,
    },
    exitCriteria: {
      milestoneDVerify: verifyResult.summary?.passed === true,
      gp027CloseoutReport: check('gp027_closeout_report').ok,
      gp027TaskClosed: check('gp027_task_closed').ok,
      gp027StepClassification: check('gp027_step_classification').ok,
      gp023ValidationInCloseout: check('gp023_validation_in_closeout').ok,
      factoryPhase6Complete: check('factory_phase6_complete').ok,
      validationWithoutSkip: factoryEvidence?.phase6?.api?.validation?.skipped !== true,
      automatedStepsAtLeast12: (closeout?.stepClassification?.automated ?? 0) >= 12,
    },
    artifacts: {
      verify: verifyResult.artifacts?.milestoneC
        ? path.join(verifyResult.outputDir || 'observability/milestone-d-staging', 'milestone-d-closeout-verify.json')
        : null,
      milestoneC: verifyResult.artifacts?.milestoneC || null,
      factoryQueue: verifyResult.artifacts?.factoryQueue || null,
      factoryEvidence: factoryEvidencePath,
      closeoutReport: verifyResult.artifacts?.closeoutReport || null,
    },
    factoryDelivery: factoryEvidence ? {
      queueId: factoryEvidence.factoryQueueId || null,
      taskId: factoryEvidence.engineeringTeam?.taskId || null,
      projectId: factoryEvidence.engineeringTeam?.projectId || null,
      stage: factoryEvidence.status || null,
      stepsCompleted: (factoryEvidence.stepsCompleted || []).length,
    } : null,
    notes: [
      'Milestone D extends Milestone C with GP-027 closeout report generation and GP-023 validation embedded in closeout.',
      'Closeout classification reads observability/golden-path-manual-steps.json against factory evidence stepsCompleted.',
      'P3.2 GP-022 auto-merge and P3.3 GP-026 SRE agent gate ship via lib/task-platform/github-auto-merge.js and factory-agent-phases runSreAgentPhase.',
      'Hosted phase 6 promotion replay: npm run golden-path:replay:hosted-phase6 (see docs/runbooks/milestone-e-deploy-automation.md).',
    ],
  };
}

async function runMilestoneDCloseoutVerify(options = {}) {
  const outputDir = options.outputDir || 'observability/milestone-d-staging';
  const evidence = await runMilestoneCAgentVerify({
    ...options,
    outputDir,
    outputPath: path.join(outputDir, 'milestone-c-agent-verify.json'),
  });

  const factoryEvidencePath = evidence.artifacts?.factoryEvidence;
  const factoryEvidence = factoryEvidencePath && fs.existsSync(factoryEvidencePath)
    ? JSON.parse(fs.readFileSync(factoryEvidencePath, 'utf8'))
    : null;
  const closeoutPath = factoryEvidence?.phase6?.api?.closeoutReport?.path
    || (factoryEvidence?.engineeringTeam?.taskId
      ? path.resolve(process.cwd(), 'observability/factory-closeout', `${factoryEvidence.engineeringTeam.taskId}.json`)
      : null);
  const closeoutReport = closeoutPath && fs.existsSync(closeoutPath)
    ? JSON.parse(fs.readFileSync(closeoutPath, 'utf8'))
    : (factoryEvidence ? buildFactoryCloseoutReport(factoryEvidence) : null);

  const result = {
    schemaVersion: '1.0',
    kind: 'milestone-d-closeout-verify',
    generatedAt: new Date().toISOString(),
    profile: evidence.profile,
    baseUrl: evidence.baseUrl,
    outputDir,
    summary: {
      passed: false,
      checks: [...(evidence.summary?.checks || [])],
    },
    artifacts: {
      ...evidence.artifacts,
      milestoneC: path.join(outputDir, 'milestone-c-agent-verify.json'),
      closeoutReport: closeoutPath,
    },
    factory: evidence.factory,
  };

  result.summary.checks.push({
    name: 'gp027_closeout_report',
    ok: Boolean(closeoutReport?.kind === 'factory-closeout-report'),
    path: closeoutPath,
  });
  result.summary.checks.push({
    name: 'gp027_task_closed',
    ok: factoryEvidence?.phase6?.api?.taskClosed?.ok === true
      || closeoutReport?.phase6?.taskClosedOk === true,
  });
  result.summary.checks.push({
    name: 'gp027_step_classification',
    ok: Boolean(closeoutReport?.stepClassification?.total >= 27),
    automated: closeoutReport?.stepClassification?.automated ?? 0,
    stillManual: closeoutReport?.stepClassification?.stillManual ?? 0,
  });
  result.summary.checks.push({
    name: 'gp023_validation_in_closeout',
    ok: closeoutReport?.phase6?.validationOk === true
      || factoryEvidence?.phase6?.api?.validation?.ok === true,
  });

  result.closeout = closeoutReport;
  result.summary.passed = result.summary.checks.every((check) => check.ok);
  const outputPath = options.outputPath || path.join(outputDir, 'milestone-d-closeout-verify.json');
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`);
  if (result.summary.passed) {
    const complete = buildMilestoneDCompleteEvidence(result);
    const completePath = options.completePath
      || path.resolve(process.cwd(), 'observability/milestone-d-complete.json');
    fs.writeFileSync(completePath, `${JSON.stringify(complete, null, 2)}\n`);
    result.artifacts.milestoneDComplete = completePath;
  }
  return result;
}

module.exports = {
  buildMilestoneDCompleteEvidence,
  runMilestoneDCloseoutVerify,
};