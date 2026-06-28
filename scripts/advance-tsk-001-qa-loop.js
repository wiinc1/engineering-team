#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const {
  apiSend,
  apiGet,
} = require('../lib/task-platform/golden-path-shared');
const {
  evaluateRunnableSurfaceVerification,
  visualGateOverrideEnabled,
} = require('../lib/audit/product-delivery-integrity');
const {
  contractCoverageRequirements,
  deriveExecutionContractProjection,
} = require('../lib/audit/execution-contracts');
const {
  handleEtForgeDispatchEvent,
  resolveEtForgeDispatchConfig,
} = require('../lib/task-platform/et-forge-dispatch-bridge');

const TASK_ID = process.env.TSK_ADVANCE_TASK_ID || 'TSK-001';
const BASE_URL = (process.env.ENGINEERING_TEAM_BASE_URL || 'http://127.0.0.1:13000').replace(/\/+$/, '');
const FORGE_URL = (process.env.FORGEADAPTER_BASE_URL || 'http://127.0.0.1:14010').replace(/\/+$/, '');
const JWT_SECRET = process.env.AUTH_JWT_SECRET || 'golden-path-local-dev-secret';
const UX_COMMIT_SHA = process.env.TSK_UX_COMMIT_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const GOLDEN_PATH_VISUAL_EVIDENCE = {
  screenshotPath: process.env.TSK_VISUAL_SCREENSHOT_PATH || 'observability/product-visual/tsk-001-on-load.png',
  routePath: '/tasks?view=list',
  viewportWidth: 1280,
  capturePhase: 'on_load',
  comparabilityNote: 'Golden-path browser profile on-load screenshot at http://127.0.0.1:15173.',
  goldenPathBrowserProfile: 'playwright.golden-path',
};

function buildCtx() {
  return {
    baseUrl: BASE_URL,
    jwtSecret: JWT_SECRET,
    tenantId: 'engineering-team',
    actorId: 'golden-path-operator',
    fetchImpl: globalThis.fetch,
  };
}

async function readStage(ctx, taskId) {
  const state = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/state`, ['reader', 'admin']);
  if (!state.ok) {
    throw new Error(`Failed to read task state (${state.status}): ${JSON.stringify(state.body)}`);
  }
  const body = state.body?.data || state.body?.task || state.body || {};
  return {
    stage: body.current_stage || body.currentStage || null,
    implementationVersion: Number(body.implementation_submission_version || 0),
    latestQaOutcome: body.latest_qa_outcome || null,
  };
}

async function runProjectionCatchUp(ctx) {
  const { runProjectionCatchUp: runShared } = require('../lib/audit/projection-catch-up');
  return runShared({
    ...ctx,
    baseUrl: ctx.baseUrl,
    persistDir: process.cwd(),
  }, { maxEvents: 50 }).catch(() => null);
}

async function recordStage(ctx, taskId, from, to) {
  const result = await apiSend(ctx, `/tasks/${encodeURIComponent(taskId)}/events`, 'POST', ['admin', 'pm'], {
    eventType: 'task.stage_changed',
    actorType: 'agent',
    idempotencyKey: `tsk-advance:${taskId}:${from}:${to}:${Date.now()}`,
    payload: {
      from_stage: from,
      to_stage: to,
    },
  });
  if (!result.ok) {
    throw new Error(`Stage transition ${from} -> ${to} failed (${result.status}): ${JSON.stringify(result.body)}`);
  }
  await runProjectionCatchUp(ctx);
  await sleep(300);
  return result;
}

async function loadApprovedContract(ctx, taskId) {
  const history = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/history?limit=500`, ['reader', 'admin']);
  if (!history.ok) {
    throw new Error(`Failed to load task history (${history.status})`);
  }
  const entries = history.body?.items || history.body?.data?.items || [];
  const projection = deriveExecutionContractProjection(Array.isArray(entries) ? entries : []);
  if (!projection.latest) {
    throw new Error(`Missing approved execution contract for ${taskId}`);
  }
  return projection.latest;
}

async function latestCoverageAttempt(ctx, taskId) {
  const history = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/history`, ['reader', 'admin']);
  const entries = history.body?.items || history.body?.data?.items || [];
  let latestAttempt = null;
  for (const entry of entries) {
    if (entry.event_type !== 'task.contract_coverage_audit_submitted') continue;
    const attempt = Number(entry.payload?.implementation_attempt || entry.payload?.implementationAttempt || 0) || null;
    if (attempt && (latestAttempt === null || attempt > latestAttempt)) {
      latestAttempt = attempt;
    }
  }
  return latestAttempt;
}

async function submitContractCoverage(ctx, taskId, commitSha, implementationVersion) {
  const existing = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/contract-coverage-audit`, ['reader', 'admin']);
  const existingReadiness = existing.body?.data?.readiness || {};
  if (existingReadiness.gate_closed === true) {
    console.log(`[coverage] gate already closed for attempt ${existingReadiness.implementation_attempt || implementationVersion}`);
    return { ok: true, skipped: true };
  }

  const coveredAttempt = await latestCoverageAttempt(ctx, taskId);
  if (coveredAttempt && existingReadiness.gate_closed === true) {
    console.log(`[coverage] already submitted for attempt ${coveredAttempt}`);
    return { ok: true, skipped: true };
  }

  const contract = await loadApprovedContract(ctx, taskId);
  const requirements = contractCoverageRequirements(contract);
  const rows = requirements.map((requirement) => ({
    requirementId: requirement.id,
    status: 'covered',
    implementationEvidence: [commitSha],
    verificationEvidence: ['tests/browser/task-workspace.browser.spec.ts'],
  }));

  const submit = await apiSend(
    ctx,
    `/tasks/${encodeURIComponent(taskId)}/contract-coverage-audit`,
    'POST',
    ['engineer', 'admin'],
    {
      rows,
      idempotencyKey: `tsk-advance-coverage:${taskId}:v${implementationVersion}:${Date.now()}`,
    },
  );
  if (!submit.ok && submit.status !== 409) {
    throw new Error(`Contract coverage submit failed (${submit.status}): ${JSON.stringify(submit.body)}`);
  }
  let readiness = submit.body?.data?.readiness || {};
  if (readiness.gate_closed !== true) {
    const refreshed = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/contract-coverage-audit`, ['reader', 'admin']);
    readiness = refreshed.body?.data?.readiness || readiness;
  }
  if (readiness.gate_closed !== true) {
    throw new Error(`Contract coverage gate not closed (${readiness.status || 'unknown'}): ${JSON.stringify(readiness).slice(0, 500)}`);
  }
  await runProjectionCatchUp(ctx);
  await sleep(1500);
  console.log(`[coverage] submitted ${rows.length} rows for attempt ${implementationVersion}`);
  return submit;
}

async function advanceToQaTesting(ctx, taskId, commitSha, implementationVersion) {
  let { stage } = await readStage(ctx, taskId);
  console.log(`[stage] start=${stage}`);

  if (stage === 'QA_TESTING') {
    return stage;
  }

  if (stage === 'IMPLEMENTATION' || stage === 'IN_PROGRESS') {
    await submitContractCoverage(ctx, taskId, commitSha, implementationVersion);
    await recordStage(ctx, taskId, stage, 'CONTRACT_COVERAGE_AUDIT');
    stage = 'CONTRACT_COVERAGE_AUDIT';
  }

  if (stage === 'CONTRACT_COVERAGE_AUDIT') {
    const validate = await apiSend(
      ctx,
      `/tasks/${encodeURIComponent(taskId)}/contract-coverage-audit/validate`,
      'POST',
      ['qa', 'admin'],
      {},
    );
    if (!validate.ok && validate.status !== 409) {
      throw new Error(`Contract coverage validate failed (${validate.status}): ${JSON.stringify(validate.body)}`);
    }
    await recordStage(ctx, taskId, 'CONTRACT_COVERAGE_AUDIT', 'QA_TESTING');
    stage = 'QA_TESTING';
  }

  console.log(`[stage] advanced=${stage}`);
  return stage;
}

async function recordInitialQaFail(ctx, taskId) {
  const result = await apiSend(ctx, `/tasks/${encodeURIComponent(taskId)}/qa-results`, 'POST', ['qa', 'admin'], {
    outcome: 'fail',
    runKind: 'initial',
    summary: 'TSK-001 intentional QA fail — persistent inspector missing focus-return validation.',
    scenarios: ['Queue inspector opens without preserving queue scroll context'],
    findings: ['Focus does not return to the selected queue row after inspector close'],
    reproductionSteps: ['Open Command Center, select a task, close inspector, tab through queue'],
    stackTraces: ['N/A — UI interaction validation'],
    envLogs: ['local golden-path TSK-001 intentional fail'],
    escalationPackage: { returnTo: 'engineer' },
  });
  if (!result.ok) {
    throw new Error(`QA fail recording failed (${result.status}): ${JSON.stringify(result.body)}`);
  }
  const runId = result.body?.data?.runId || result.body?.data?.run_id || null;
  console.log(`[qa] initial fail recorded runId=${runId}`);
  return runId;
}

function assertRunnableCommitOrOverride(contract, commitSha) {
  if (visualGateOverrideEnabled()) {
    console.log('[product-delivery] VISUAL_GATE_OVERRIDE enabled — skipping runnable surface precheck');
    return;
  }
  const verification = evaluateRunnableSurfaceVerification({
    contract,
    commitSha,
    options: { repoRoot: process.cwd() },
  });
  if (!verification.verified) {
    throw new Error(`Submission commit ${commitSha.slice(0, 12)} is not on runnable surface branch (${verification.reason || 'runnable_surface_not_merged'})`);
  }
}

async function recordRetestPass(ctx, taskId, priorRunId) {
  const result = await apiSend(ctx, `/tasks/${encodeURIComponent(taskId)}/qa-results`, 'POST', ['qa', 'admin'], {
    outcome: 'pass',
    runKind: 'retest',
    priorRunId,
    summary: 'TSK-001 retest pass — queue-first Command Center and persistent inspector validated.',
    scenarios: ['Browser smoke confirms queue inspector behavior'],
    retestScope: 'UI Command Center layout + inspector persistence',
    visualEvidence: GOLDEN_PATH_VISUAL_EVIDENCE,
    humanVisualSignoffRecorded: true,
  });
  if (!result.ok) {
    throw new Error(`QA retest pass failed (${result.status}): ${JSON.stringify(result.body)}`);
  }
  console.log('[qa] retest pass recorded');
  return result;
}

async function recordEngineerSubmission(ctx, taskId, { version, commitSha, contract = null }) {
  if (contract) {
    assertRunnableCommitOrOverride(contract, commitSha);
  }
  const result = await apiSend(ctx, `/tasks/${encodeURIComponent(taskId)}/engineer-submission`, 'PUT', ['engineer', 'admin'], {
    commitSha,
    prUrl: '',
    primaryReference: commitSha,
    version,
    visualEvidence: GOLDEN_PATH_VISUAL_EVIDENCE,
  });
  if (!result.ok) {
    throw new Error(`Engineer submission v${version} failed (${result.status}): ${JSON.stringify(result.body)}`);
  }
  console.log(`[engineer] submission v${version} recorded (${commitSha.slice(0, 12)})`);
  return result;
}

async function dispatchBridgeEvent(event) {
  const config = resolveEtForgeDispatchConfig({
    ...process.env,
    ET_FORGE_DISPATCH_ENABLED: process.env.ET_FORGE_DISPATCH_ENABLED || 'true',
    ENGINEERING_TEAM_BASE_URL: BASE_URL,
    FORGEADAPTER_BASE_URL: FORGE_URL,
    FORGEADAPTER_SERVICE_TOKEN: process.env.FORGEADAPTER_SERVICE_TOKEN || 'local-forgeadapter-token',
    FORGE_SERVICE_TOKEN: process.env.FORGE_SERVICE_TOKEN || 'local-golden-path-forge-token',
    AUTH_JWT_SECRET: JWT_SECRET,
    ET_FORGE_LIFECYCLE_TASK_ID: process.env.ET_FORGE_LIFECYCLE_TASK_ID || '',
  });
  const result = await handleEtForgeDispatchEvent(event, config);
  console.log(`[bridge] ${event.event_type} -> ${JSON.stringify({
    handled: result.handled,
    bridge: result.bridge,
    action: result.action,
    taskId: result.taskId,
    skipped: result.skipped,
    reason: result.reason,
  })}`);
  return result;
}

async function readForgeRuntime(taskId) {
  const token = process.env.FORGEADAPTER_SERVICE_TOKEN || 'local-forgeadapter-token';
  const response = await fetch(`${FORGE_URL}/tasks/${encodeURIComponent(taskId)}/runtime`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await response.json().catch(() => ({})),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOutboxBridge(eventType, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(1500);
    const runtime = await readForgeRuntime(TASK_ID);
    if (!runtime.ok) continue;
    const qaGate = (runtime.body.reviewGates || []).find((gate) => gate.gate === 'qa');
    if (eventType === 'task.qa_result_recorded' && qaGate?.status === 'rejected') {
      return runtime.body;
    }
    if (eventType === 'task.engineer_submission_recorded' && runtime.body.lastAction === 'resume') {
      return runtime.body;
    }
    if (eventType === 'task.qa_result_recorded:retest' && runtime.body.executionState === 'completed') {
      return runtime.body;
    }
  }
  return null;
}

async function main() {
  const ctx = buildCtx();
  const contract = await loadApprovedContract(ctx, TASK_ID).catch(() => null);
  let { stage, implementationVersion, latestQaOutcome } = await readStage(ctx, TASK_ID);
  console.log(`[tsk-001] stage=${stage} submission_v=${implementationVersion} qa=${latestQaOutcome || 'none'}`);

  const postQaStages = new Set(['SRE_MONITORING', 'PM_CLOSE_REVIEW', 'DONE']);
  const skipInitialQaFailLoop = postQaStages.has(stage) || (latestQaOutcome === 'pass' && stage !== 'QA_TESTING');

  if (!skipInitialQaFailLoop && (stage !== 'QA_TESTING' || latestQaOutcome !== 'fail')) {
    if (implementationVersion < 2 && ['IMPLEMENTATION', 'IN_PROGRESS', 'TECHNICAL_SPEC'].includes(stage)) {
      await recordEngineerSubmission(ctx, TASK_ID, { version: 2, commitSha: UX_COMMIT_SHA, contract });
      await runProjectionCatchUp(ctx);
      await sleep(1500);
      ({ implementationVersion } = await readStage(ctx, TASK_ID));
    }
    await advanceToQaTesting(ctx, TASK_ID, UX_COMMIT_SHA, implementationVersion || 2);
    ({ latestQaOutcome } = await readStage(ctx, TASK_ID));
    if (latestQaOutcome !== 'fail') {
      const priorRunId = await recordInitialQaFail(ctx, TASK_ID);
      let bridge = await dispatchBridgeEvent({
        event_type: 'task.qa_result_recorded',
        task_id: TASK_ID,
        payload: { outcome: 'fail', runKind: 'initial' },
      });
      if (!bridge.handled) {
        throw new Error(`Forge QA reject bridge did not handle event: ${bridge.reason || 'unknown'}`);
      }
      await waitForOutboxBridge('task.qa_result_recorded');
      ({ stage, latestQaOutcome } = await readStage(ctx, TASK_ID));
      if (stage === 'QA_TESTING' && latestQaOutcome === 'fail') {
        await recordStage(ctx, TASK_ID, 'QA_TESTING', 'IMPLEMENTATION');
        stage = 'IMPLEMENTATION';
      }
      if (!globalThis.__priorQaRunId) globalThis.__priorQaRunId = priorRunId;
    }
  }

  ({ stage, implementationVersion } = await readStage(ctx, TASK_ID));
  if (stage === 'QA_TESTING' && latestQaOutcome === 'fail') {
    await recordStage(ctx, TASK_ID, 'QA_TESTING', 'IMPLEMENTATION');
    stage = 'IMPLEMENTATION';
  }

  if (implementationVersion < 3) {
    await recordEngineerSubmission(ctx, TASK_ID, { version: 3, commitSha: UX_COMMIT_SHA, contract });
    implementationVersion = 3;
    let bridge = await dispatchBridgeEvent({
      event_type: 'task.engineer_submission_recorded',
      task_id: TASK_ID,
      payload: { version: 3 },
    });
    if (!bridge.handled) {
      throw new Error(`Forge resume bridge did not handle v3 submission: ${bridge.reason || 'unknown'}`);
    }
    await waitForOutboxBridge('task.engineer_submission_recorded');
  }

  if (!postQaStages.has(stage)) {
    await advanceToQaTesting(ctx, TASK_ID, UX_COMMIT_SHA, implementationVersion);
  }
  ({ stage, latestQaOutcome, implementationVersion } = await readStage(ctx, TASK_ID));
  if (latestQaOutcome !== 'pass' && !postQaStages.has(stage)) {
    const qaResults = await apiGet(ctx, `/tasks/${encodeURIComponent(TASK_ID)}/qa-results`, ['qa', 'admin']);
    const priorRunId = qaResults.body?.data?.latestFailed?.runId
      || qaResults.body?.data?.latestFailed?.run_id
      || globalThis.__priorQaRunId
      || null;
    await recordRetestPass(ctx, TASK_ID, priorRunId);
    const bridge = await dispatchBridgeEvent({
      event_type: 'task.qa_result_recorded',
      task_id: TASK_ID,
      payload: { outcome: 'pass', runKind: 'retest' },
    });
    if (!bridge.handled) {
      throw new Error(`Forge closeout bridge did not handle retest pass: ${bridge.reason || 'unknown'}`);
    }
    await waitForOutboxBridge('task.qa_result_recorded:retest');
  }

  const runtime = await readForgeRuntime(TASK_ID);
  const finalStage = await readStage(ctx, TASK_ID);
  console.log('[done]', JSON.stringify({
    etStage: finalStage.stage,
    qaOutcome: finalStage.latestQaOutcome,
    submissionVersion: finalStage.implementationVersion,
    forgeExecutionState: runtime.body?.executionState || null,
    forgeLastAction: runtime.body?.lastAction || null,
    qaGate: (runtime.body?.reviewGates || []).find((gate) => gate.gate === 'qa')?.status || null,
    architectGate: (runtime.body?.reviewGates || []).find((gate) => gate.gate === 'architect')?.status || null,
    pmGate: (runtime.body?.reviewGates || []).find((gate) => gate.gate === 'pm')?.status || null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});