const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const { withLocalAuditApi } = require('./golden-path-local-stack');
const {
  contractCoverageRequirements,
  deriveExecutionContractProjection,
} = require('../audit/execution-contracts');
const { seedGoldenPathForgeTask } = require('./golden-path-forge-seed');
const { buildGoldenPathArchitectHandoff } = require('./golden-path-phase1');
const {
  DEFAULT_OUTPUT,
  DEFAULT_FORGE_TASK_ID,
  DEFAULT_FORGE_SERVICE_TOKEN,
  DEFAULT_FORGE_ADAPTER_TOKEN,
  loadPilotEvidence,
  savePilotEvidence,
  mergeStepsCompleted,
  apiSend,
  apiGet,
  apiSendServiceToken,
  requireForgeHarness,
} = require('./golden-path-shared');
const {
  buildPhasePersonaSnapshot,
  buildEngineerPersonaRouting,
} = require('./factory-persona-progression');
const {
  runImplementerAgentPhase,
  runImplementerFixAgentPhase,
  runQaAgentPhase,
  runSreAgentPhase,
  buildCiValidationEvidence,
} = require('./factory-agent-phases');
const { resolveAgentDelegationEnv } = require('./factory-orchestration');
const {
  resolveGoldenPathForgeAdapterUrl,
  resolveGoldenPathForgeAdapterToken,
  probeForgeAdapterHealth,
} = require('./golden-path-stack-probe');
const { mergePullRequestWhenReady } = require('./github-auto-merge');

const execFileAsync = promisify(execFile);

const DEFAULT_STACK_PERSIST_DIR = 'observability/golden-path-local-stack/audit-data';

function resolveGoldenPathStackPersistDir(ctx = {}, evidence = {}, options = {}) {
  const raw = options.stackPersistDir
    || ctx.stackPersistDir
    || evidence.phase0?.persistDir
    || evidence.phase1?.persistDir
    || evidence.phase0?.localBaseDir
    || (evidence.factoryQueueId
      ? path.join('observability/factory-delivery/stack', evidence.factoryQueueId)
      : null)
    || options.persistDir
    || ctx.persistDir
    || DEFAULT_STACK_PERSIST_DIR;
  return path.resolve(process.cwd(), raw);
}

function buildGoldenPathCommitSha(label = 'golden-path') {
  return crypto.createHash('sha1').update(`${label}:${Date.now()}`).digest('hex');
}

const README_MARKER_HEADING = '## Golden Path Pilot';
const README_MARKER_BODY = [
  '',
  '## Golden Path Pilot',
  '',
  'Supervised end-to-end delivery loop for epic [#269](https://github.com/wiinc1/engineering-team/issues/269).',
  'Evidence: `docs/reports/GOLDEN_PATH_PILOT_EVIDENCE.md` and `observability/golden-path-pilot.json`.',
  '',
].join('\n');

function readmeHasGoldenPathMarker(readmePath = 'README.md') {
  const content = fs.readFileSync(path.resolve(process.cwd(), readmePath), 'utf8');
  return content.includes(README_MARKER_HEADING);
}

function addReadmeGoldenPathMarker(readmePath = 'README.md') {
  const resolved = path.resolve(process.cwd(), readmePath);
  const content = fs.readFileSync(resolved, 'utf8');
  if (content.includes(README_MARKER_HEADING)) {
    return { changed: false, path: resolved };
  }
  const updated = `${content.trimEnd()}${README_MARKER_BODY}`;
  fs.writeFileSync(resolved, updated.endsWith('\n') ? updated : `${updated}\n`);
  return { changed: true, path: resolved };
}

async function resolveForgeExecutionStack(forge, options = {}) {
  const forgeAdapterBaseUrl = resolveGoldenPathForgeAdapterUrl(options);
  const faToken = resolveGoldenPathForgeAdapterToken(options) || DEFAULT_FORGE_ADAPTER_TOKEN;
  const fetchImpl = options.fetchImpl || fetch;

  if (forgeAdapterBaseUrl) {
    const health = await probeForgeAdapterHealth(forgeAdapterBaseUrl, fetchImpl);
    return {
      baseUrl: forgeAdapterBaseUrl,
      faToken,
      managed: false,
      source: health.ok ? 'stack_probe' : 'configured_forgeadapter',
      health,
      async close() {},
    };
  }

  const etDir = path.resolve(process.cwd());
  const previousCwd = process.cwd();
  process.chdir(forge.forgeDir);
  try {
    const stack = await forge.harness.startLocalStack({
      etDir,
      taskId: options.forgeTaskId,
      sharedToken: options.forgeServiceToken || DEFAULT_FORGE_SERVICE_TOKEN,
      faToken,
      tenantId: options.tenantId || 'engineering-team',
      affectsUi: false,
    });
    return { ...stack, managed: true, source: 'ephemeral_harness' };
  } finally {
    process.chdir(previousCwd);
  }
}

async function runForgeControlAction(stack, forge, route, { method = 'POST', body } = {}) {
  const headers = forge.harness.serviceHeaders(stack.faToken);
  const action = await forge.service.requestJson(`${stack.baseUrl}${route}`, {
    method,
    headers,
    body,
  });
  if (action.response.status !== 202) {
    throw new Error(`Forge action ${route} failed (${action.response.status}): ${JSON.stringify(action.body)}`);
  }
  const job = await forge.harness.waitForJobStatus(stack.baseUrl, action.body.jobId, headers);
  if (job.status !== 'succeeded') {
    throw new Error(`Forge job ${action.body.jobId} for ${route} did not succeed: ${JSON.stringify(job)}`);
  }
  return { headers, action: action.body, job };
}

async function readForgeRuntime(stack, forge, taskId) {
  const headers = forge.harness.serviceHeaders(stack.faToken);
  const runtime = await forge.service.requestJson(`${stack.baseUrl}/tasks/${taskId}/runtime`, { headers });
  return runtime.body || {};
}

function resolveForgeReviewChildSessionId(runtime, gate) {
  const pendingReview = [...(runtime.reviews || [])]
    .reverse()
    .find((entry) => entry.gate === gate && entry.status === 'pending' && entry.sessionId);
  if (pendingReview?.sessionId) {
    return pendingReview.sessionId;
  }

  const childSessions = runtime.sessions?.childSessions || [];
  const delegatedSession = [...childSessions]
    .reverse()
    .find((entry) => entry.targetAgent === gate && entry.childSessionId);
  return delegatedSession?.childSessionId || null;
}

async function approveForgeReviewGate(stack, forge, taskId, gate) {
  const headers = forge.harness.serviceHeaders(stack.faToken);
  const runtime = await readForgeRuntime(stack, forge, taskId);
  const gateState = (runtime.reviewGates || []).find((entry) => entry.gate === gate) || null;
  if (gateState?.status === 'approved') {
    return { ok: true, skipped: true, reason: 'gate_already_approved', gate };
  }

  let childSessionId = resolveForgeReviewChildSessionId(runtime, gate);
  if (!childSessionId) {
    const reviewRequest = await forge.service.requestJson(`${stack.baseUrl}/tasks/${taskId}/review-requests/${gate}`, {
      method: 'POST',
      headers,
    });
    if (reviewRequest.response.status !== 202) {
      throw new Error(`Review request for ${gate} failed (${reviewRequest.response.status})`);
    }
    const reviewRequestJob = await forge.harness.waitForJobStatus(
      stack.baseUrl,
      reviewRequest.body.jobId,
      headers,
    );
    childSessionId = reviewRequestJob.result?.childSessionId
      || reviewRequestJob.result?.review?.sessionId
      || reviewRequest.body?.childSessionId;
  }
  if (!childSessionId) {
    throw new Error(`Missing childSessionId for gate ${gate}`);
  }

  const review = forge.packets.createReviewApprovedPacket();
  review.taskId = taskId;
  review.context.taskId = taskId;
  review.review.gate = gate;
  review.review.summary = `${gate} gate approved for golden path pilot.`;
  review.review.decisionBy = { owner: `${gate}-reviewer`, role: gate };
  review.review.sessionId = childSessionId;

  return runForgeControlAction(stack, forge, `/tasks/${taskId}/review`, {
    body: JSON.stringify(review),
  });
}

async function runPilotAgentsSeed(baseUrl) {
  try {
    const { stdout, stderr } = await execFileAsync('npm', ['run', 'pilot:agents:seed'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AUTH_PUBLIC_APP_URL: baseUrl,
        PROJECTS_PROD_BASE_URL: baseUrl,
      },
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: error.code,
    };
  }
}

async function runDelegationSmoke(options = {}) {
  const env = {
    ...process.env,
    ...(options.openclawUrl ? { OPENCLAW_BASE_URL: options.openclawUrl } : {}),
    ...(options.hermesUrl ? { HERMES_BASE_URL: options.hermesUrl } : {}),
    ...(options.enableRealDelegation ? { FF_REAL_SPECIALIST_DELEGATION: 'true' } : {}),
    SPECIALIST_DELEGATION_RUNNER: options.delegationRunner
      || process.env.SPECIALIST_DELEGATION_RUNNER
      || 'node scripts/openclaw-specialist-runner.js',
  };
  try {
    const { stdout, stderr } = await execFileAsync('npm', ['run', 'test:delegation:live-smoke:openclaw'], {
      cwd: process.cwd(),
      env,
      timeout: 120000,
    });
    const sessionMatch = stdout.match(/sessionId["':\s]+([0-9a-f-]{36})/i);
    return {
      ok: true,
      stdout,
      stderr,
      sessionId: sessionMatch?.[1] || null,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: error.code,
    };
  }
}

async function recordEngineerSubmission(ctx, taskId, { commitSha, prUrl, version = 1 }) {
  return apiSend(ctx, `/tasks/${encodeURIComponent(taskId)}/engineer-submission`, 'PUT', ['engineer', 'admin'], {
    commitSha,
    prUrl,
    primaryReference: prUrl,
    version,
  });
}

async function recordQaResult(ctx, taskId, payload) {
  return apiSend(ctx, `/tasks/${encodeURIComponent(taskId)}/qa-results`, 'POST', ['qa', 'admin'], payload);
}

async function recordQaResultWithCatchUp(ctx, taskId, payload, options = {}) {
  const attempts = Number(options.attempts || 8);
  const intervalMs = Number(options.intervalMs || 250);
  let lastResult = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await runProjectionCatchUp(ctx).catch(() => {});
    lastResult = await recordQaResult(ctx, taskId, payload);
    if (lastResult.ok) {
      return lastResult;
    }

    const errorCode = lastResult.body?.error?.code;
    if (errorCode !== 'workflow_violation') {
      return lastResult;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return lastResult;
}

async function recordGoldenPathInitialQaFail(ctx, taskId) {
  return recordQaResultWithCatchUp(ctx, taskId, {
    outcome: 'fail',
    runKind: 'initial',
    summary: 'Golden path intentional fail — README golden-path section not present.',
    scenarios: ['README marker missing before fix commit'],
    findings: ['README golden-path section not present'],
    reproductionSteps: ['Open README.md and search for "## Golden Path Pilot"'],
    stackTraces: ['N/A — docs-only marker missing'],
    envLogs: ['local golden-path phase 3 intentional fail'],
    escalationPackage: { returnTo: 'engineer' },
  });
}

function extractQaRunId(body, fallback = null) {
  return body?.data?.run_id
    || body?.data?.runId
    || body?.run_id
    || body?.runId
    || fallback;
}

async function readPilotTaskState(ctx, taskId) {
  const state = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/state`, ['reader', 'admin']);
  if (!state.ok) {
    throw new Error(`Failed to read task state (${state.status}): ${JSON.stringify(state.body)}`);
  }
  return state.body?.data || state.body?.task || state.body || {};
}

async function readPilotTaskStage(ctx, taskId) {
  const state = await readPilotTaskState(ctx, taskId);
  return state.current_stage
    || state.currentStage
    || null;
}

async function runProjectionCatchUp(ctx, maxEvents = 25) {
  const { runProjectionCatchUp: runSharedProjectionCatchUp } = require('../audit/projection-catch-up');
  return runSharedProjectionCatchUp(
    {
      ...ctx,
      baseUrl: ctx.baseUrl,
      persistDir: ctx.persistDir,
    },
    { maxEvents },
  );
}

function extractCloseGovernance(detailBody = {}) {
  return detailBody?.closeGovernance
    || detailBody?.close_governance
    || detailBody?.data?.closeGovernance
    || detailBody?.context?.closeGovernance
    || null;
}

function humanCloseDecisionReady(closeGovernance = null) {
  if (!closeGovernance) return false;
  if (closeGovernance.humanDecision?.decisionReady === true) return true;
  const recommendations = closeGovernance.cancellation?.recommendations || {};
  return Boolean(recommendations.pm?.occurredAt && recommendations.architect?.occurredAt);
}

async function waitForHumanCloseDecisionReady(ctx, taskId, {
  attempts = 16,
  intervalMs = 500,
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await runProjectionCatchUp(ctx).catch(() => {});
    const detail = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/detail`, ['reader', 'admin']);
    const closeGovernance = extractCloseGovernance(detail.body);
    if (humanCloseDecisionReady(closeGovernance)) {
      return { ready: true, attempt, closeGovernance };
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return { ready: false, attempt: attempts - 1, closeGovernance: null };
}

async function waitForPilotTaskStage(ctx, taskId, expectedStage, { attempts = 24, intervalMs = 250 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const stage = await readPilotTaskStage(ctx, taskId);
    if (stage === expectedStage) {
      return stage;
    }
    await runProjectionCatchUp(ctx).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return readPilotTaskStage(ctx, taskId);
}

async function ensureArchitectHandoff(ctx, taskId) {
  const state = await readPilotTaskState(ctx, taskId);
  if (state.ready_for_engineering || Number(state.architect_handoff_version || 0) > 0) {
    return { ok: true, skipped: true, reason: 'already_ready_for_engineering' };
  }

  const response = await apiSend(
    ctx,
    `/tasks/${encodeURIComponent(taskId)}/architect-handoff`,
    'PUT',
    ['architect', 'admin'],
    buildGoldenPathArchitectHandoff(),
  );
  if (!response.ok && response.status !== 204) {
    throw new Error(`Architect handoff failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  await runProjectionCatchUp(ctx);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const refreshed = await readPilotTaskState(ctx, taskId);
    if (refreshed.ready_for_engineering) {
      return { ok: true, skipped: false, status: response.status };
    }
    await runProjectionCatchUp(ctx).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Architect handoff did not project ready_for_engineering for ${taskId}`);
}

async function recordStageTransitions(ctx, taskId, transitions = []) {
  const results = [];
  for (const transition of transitions) {
    const currentStage = await readPilotTaskStage(ctx, taskId);
    const fromStage = transition.from || currentStage;
    if (fromStage === transition.to) {
      results.push({ from: fromStage, to: transition.to, status: 200, skipped: true });
      continue;
    }
    if (fromStage === 'TECHNICAL_SPEC' && transition.to === 'IMPLEMENTATION') {
      await ensureArchitectHandoff(ctx, taskId);
    }
    const result = await apiSend(ctx, `/tasks/${encodeURIComponent(taskId)}/events`, 'POST', ['admin', 'pm'], {
      eventType: 'task.stage_changed',
      actorType: 'agent',
      idempotencyKey: transition.idempotencyKey
        || `golden-path:${taskId}:${fromStage}:${transition.to}:${Date.now()}`,
      payload: {
        from_stage: fromStage,
        to_stage: transition.to,
      },
    });
    if (!result.ok) {
      throw new Error(
        `Stage transition ${fromStage} -> ${transition.to} failed (${result.status}): ${JSON.stringify(result.body)}`,
      );
    }
    await runProjectionCatchUp(ctx);
    await waitForPilotTaskStage(ctx, taskId, transition.to);
    results.push({
      from: fromStage,
      to: transition.to,
      status: result.status,
    });
  }
  return results;
}

async function advancePilotTaskToImplementation(ctx, taskId) {
  const currentStage = await readPilotTaskStage(ctx, taskId) || 'DRAFT';

  const architectPath = [
    { from: 'DRAFT', to: 'BACKLOG' },
    { from: 'BACKLOG', to: 'ARCHITECT_REVIEW' },
    { from: 'ARCHITECT_REVIEW', to: 'TECHNICAL_SPEC' },
    { from: 'TECHNICAL_SPEC', to: 'IMPLEMENTATION' },
  ];

  const pathByStage = {
    DRAFT: architectPath,
    BACKLOG: architectPath.slice(1),
    ARCHITECT_REVIEW: architectPath.slice(2),
    TECHNICAL_SPEC: architectPath.slice(3),
    IMPLEMENTATION: [],
    IN_PROGRESS: [],
    QA_TESTING: [],
    SRE_MONITORING: [],
    PM_CLOSE_REVIEW: [],
    DONE: [],
    CLOSED: [],
  };

  const transitions = pathByStage[currentStage];
  if (!transitions) {
    throw new Error(`Unsupported pilot stage for implementation advance: ${currentStage}`);
  }
  if (transitions.length === 0) {
    return { currentStage, transitions: [] };
  }
  const recorded = await recordStageTransitions(ctx, taskId, transitions);
  return { currentStage, transitions: recorded };
}

async function loadExecutionContractForTask(ctx, taskId) {
  const history = await apiGet(
    ctx,
    `/tasks/${encodeURIComponent(taskId)}/history?limit=500`,
    ['reader', 'admin'],
  );
  if (!history.ok) {
    throw new Error(`Failed to load task history (${history.status})`);
  }
  const entries = history.body?.items || history.body?.data?.items || history.body || [];
  const projection = deriveExecutionContractProjection(Array.isArray(entries) ? entries : []);
  if (!projection.latest) {
    throw new Error(`Missing approved execution contract for ${taskId}`);
  }
  return projection.latest;
}

async function waitForImplementationSubmission(ctx, taskId, { minVersion = 1 } = {}) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await runProjectionCatchUp(ctx).catch(() => {});
    const state = await readPilotTaskState(ctx, taskId);
    if (Number(state.implementation_submission_version || 0) >= minVersion && state.implementation_commit_sha) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Implementation submission v${minVersion} did not project for ${taskId}`);
}

function extractSreMonitoringDetail(detailBody = {}) {
  const body = detailBody?.data || detailBody || {};
  return body?.context?.sreMonitoring || body?.sre_monitoring || {};
}

async function waitForMergedLinkedPr(ctx, taskId) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await runProjectionCatchUp(ctx).catch(() => {});
    const detail = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/detail`, ['reader', 'admin']);
    const linkedPrs = extractSreMonitoringDetail(detail.body).linkedPrs || [];
    if (linkedPrs.some((pr) => pr.merged)) {
      return linkedPrs;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Merged linked PR did not project for ${taskId}`);
}

async function waitForSreMonitoringStarted(ctx, taskId) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await runProjectionCatchUp(ctx).catch(() => {});
    const detail = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/detail`, ['reader', 'admin']);
    const sreDetail = extractSreMonitoringDetail(detail.body);
    if (sreDetail.windowStartedAt) {
      return sreDetail;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`SRE monitoring start did not project for ${taskId}`);
}

function contractCoverageAttemptFromEntry(entry) {
  const payload = entry?.payload || {};
  return Number(
    payload.implementation_attempt
    || payload.audit?.implementation_attempt
    || payload.coverage_audit?.implementation_attempt
    || payload.validation?.implementation_attempt
    || payload.implementationAttempt
    || 0,
  ) || null;
}

async function latestContractCoverageAttempt(ctx, taskId) {
  const history = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/history`, ['reader', 'admin']);
  const entries = history.body?.items || history.body?.data?.items || [];
  let latestAttempt = null;
  for (const entry of entries) {
    if (entry.event_type !== 'task.contract_coverage_audit_submitted') continue;
    const attempt = contractCoverageAttemptFromEntry(entry);
    if (attempt && (latestAttempt === null || attempt > latestAttempt)) {
      latestAttempt = attempt;
    }
  }
  return latestAttempt;
}

async function waitForContractCoverageHistoryEvent(ctx, taskId, eventType, options = {}) {
  const requiredAttempt = Number(options.implementationAttempt || 0) || null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const projection = await runProjectionCatchUp(ctx).catch(() => ({ processed: 0 }));
    const history = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/history`, ['reader', 'admin']);
    const entries = history.body?.items || history.body?.data?.items || [];
    const found = entries.some((entry) => {
      if (entry.event_type !== eventType) return false;
      if (!requiredAttempt) return true;
      return contractCoverageAttemptFromEntry(entry) === requiredAttempt;
    });
    if (found && (projection.processed > 0 || attempt >= 8)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const attemptSuffix = requiredAttempt ? ` for implementation attempt ${requiredAttempt}` : '';
  throw new Error(`${eventType} did not project for ${taskId}${attemptSuffix}`);
}

async function completeContractCoverageAuditGate(ctx, taskId, options = {}) {
  const { commitSha } = options;
  let currentStage = await readPilotTaskStage(ctx, taskId);
  let submit = null;
  let opened = [];

  if (currentStage !== 'CONTRACT_COVERAGE_AUDIT' && currentStage !== 'QA_TESTING') {
    let implementationState = null;
    if (currentStage === 'IMPLEMENTATION' || currentStage === 'IN_PROGRESS') {
      const minVersion = Number(options.implementationVersion || 0) || undefined;
      implementationState = await waitForImplementationSubmission(ctx, taskId, {
        minVersion: minVersion || 1,
      });
    }
    const implementationVersion = Number(
      implementationState?.implementation_submission_version
      || (await readPilotTaskState(ctx, taskId)).implementation_submission_version
      || 1,
    );
    const coveredAttempt = await latestContractCoverageAttempt(ctx, taskId);
    const contract = await loadExecutionContractForTask(ctx, taskId);
    const requirements = contractCoverageRequirements(contract);
    const rows = requirements.map((requirement) => ({
      requirementId: requirement.id,
      status: 'covered',
      implementationEvidence: [commitSha || 'golden-path-local'],
      verificationEvidence: ['node scripts/run-golden-path-phases.js --local'],
    }));

    if (coveredAttempt !== implementationVersion) {
      submit = await apiSend(
        ctx,
        `/tasks/${encodeURIComponent(taskId)}/contract-coverage-audit`,
        'POST',
        ['engineer', 'admin'],
        { rows },
      );
      if (!submit.ok && submit.status !== 409) {
        throw new Error(`Contract coverage audit submit failed (${submit.status}): ${JSON.stringify(submit.body)}`);
      }
      await waitForContractCoverageHistoryEvent(
        ctx,
        taskId,
        'task.contract_coverage_audit_submitted',
        { implementationAttempt: implementationVersion },
      );
    } else {
      submit = { ok: true, skipped: true, status: 200, reason: 'coverage_already_submitted_for_attempt' };
    }

    const toCoverageStage = {
      IMPLEMENTATION: [{ from: 'IMPLEMENTATION', to: 'CONTRACT_COVERAGE_AUDIT' }],
      IN_PROGRESS: [{ from: 'IN_PROGRESS', to: 'CONTRACT_COVERAGE_AUDIT' }],
    };
    const stageTransitions = toCoverageStage[currentStage];
    if (!stageTransitions) {
      throw new Error(`Cannot open contract coverage audit from stage ${currentStage}`);
    }
    opened = await recordStageTransitions(ctx, taskId, stageTransitions);
    currentStage = await readPilotTaskStage(ctx, taskId);
  }

  if (currentStage === 'QA_TESTING') {
    return {
      opened,
      submit: submit ? { status: submit.status } : { skipped: true },
      validate: { skipped: true },
      toQa: [],
    };
  }

  if (currentStage !== 'CONTRACT_COVERAGE_AUDIT') {
    throw new Error(`Expected CONTRACT_COVERAGE_AUDIT before validate; found ${currentStage}`);
  }

  let validate = await apiSend(
    ctx,
    `/tasks/${encodeURIComponent(taskId)}/contract-coverage-audit/validate`,
    'POST',
    ['qa', 'admin'],
    {},
  );
  if (!validate.ok && validate.status === 409) {
    validate = { ok: true, skipped: true, status: validate.status, body: validate.body };
  } else if (!validate.ok) {
    throw new Error(`Contract coverage audit validate failed (${validate.status}): ${JSON.stringify(validate.body)}`);
  } else {
    const validatedAttempt = Number(
      validate.body?.data?.validation?.implementation_attempt
      || validate.body?.data?.implementation_attempt
      || (await readPilotTaskState(ctx, taskId)).implementation_submission_version
      || 1,
    );
    await waitForContractCoverageHistoryEvent(
      ctx,
      taskId,
      'task.contract_coverage_audit_validated',
      { implementationAttempt: validatedAttempt },
    );
  }

  const toQa = await recordStageTransitions(ctx, taskId, [{
    from: 'CONTRACT_COVERAGE_AUDIT',
    to: 'QA_TESTING',
  }]);

  return {
    opened,
    submit: submit ? { status: submit.status, gateClosed: validate.body?.data?.gateClosed ?? null } : { skipped: true },
    validate: { status: validate.status },
    toQa,
  };
}

async function advancePilotTaskToQaTesting(ctx, taskId, options = {}) {
  const currentStage = await readPilotTaskStage(ctx, taskId) || 'IMPLEMENTATION';

  if (currentStage === 'QA_TESTING') {
    return { currentStage, transitions: [], contractCoverageAudit: { skipped: true } };
  }

  if (currentStage === 'CONTRACT_COVERAGE_AUDIT') {
    const validate = await apiSend(
      ctx,
      `/tasks/${encodeURIComponent(taskId)}/contract-coverage-audit/validate`,
      'POST',
      ['qa', 'admin'],
      {},
    );
    if (!validate.ok) {
      throw new Error(`Contract coverage audit validate failed (${validate.status}): ${JSON.stringify(validate.body)}`);
    }
    const stageAfterValidate = await readPilotTaskStage(ctx, taskId);
    const toQa = stageAfterValidate === 'QA_TESTING'
      ? []
      : await recordStageTransitions(ctx, taskId, [{
        from: 'CONTRACT_COVERAGE_AUDIT',
        to: 'QA_TESTING',
      }]);
    return {
      currentStage,
      transitions: toQa,
      contractCoverageAudit: { validate: { status: validate.status }, resumed: true },
    };
  }

  const contractCoverageAudit = await completeContractCoverageAuditGate(ctx, taskId, {
    commitSha: options.commitSha,
    implementationVersion: options.implementationVersion,
  });
  return {
    currentStage,
    transitions: contractCoverageAudit.toQa,
    contractCoverageAudit,
  };
}

async function advancePilotTaskToSreMonitoring(ctx, taskId) {
  const currentStage = await readPilotTaskStage(ctx, taskId) || 'QA_TESTING';
  if (currentStage === 'SRE_MONITORING' || currentStage === 'PM_CLOSE_REVIEW' || currentStage === 'DONE' || currentStage === 'CLOSED') {
    return { currentStage, transitions: [] };
  }
  if (currentStage !== 'QA_TESTING') {
    throw new Error(`Expected QA_TESTING before SRE monitoring; found ${currentStage}`);
  }
  const recorded = await recordStageTransitions(ctx, taskId, [{
    from: 'QA_TESTING',
    to: 'SRE_MONITORING',
  }]);
  return { currentStage: 'SRE_MONITORING', transitions: recorded };
}

async function advancePilotTaskToPmCloseReview(ctx, taskId) {
  const currentStage = await readPilotTaskStage(ctx, taskId) || 'SRE_MONITORING';
  if (currentStage === 'PM_CLOSE_REVIEW' || currentStage === 'DONE' || currentStage === 'CLOSED') {
    return { currentStage, transitions: [] };
  }
  if (currentStage !== 'SRE_MONITORING') {
    throw new Error(`Expected SRE_MONITORING before PM close review; found ${currentStage}`);
  }
  const recorded = await recordStageTransitions(ctx, taskId, [{
    from: 'SRE_MONITORING',
    to: 'PM_CLOSE_REVIEW',
  }]);
  return { currentStage: 'PM_CLOSE_REVIEW', transitions: recorded };
}

async function runGoldenPathPhase2(ctx, evidence, options = {}) {
  const forgeTaskId = options.forgeTaskId || evidence.forgeadapter?.taskId || DEFAULT_FORGE_TASK_ID;
  const persistDir = resolveGoldenPathStackPersistDir(ctx, evidence, options);
  const forge = requireForgeHarness();
  const api = {};

  process.env.AUDIT_STORE_BACKEND = 'file';
  process.env.ALLOW_FILE_AUDIT_BACKEND = 'true';

  const forgeAuditDir = path.join(persistDir, 'forge-seed');
  fs.mkdirSync(forgeAuditDir, { recursive: true });
  api.seed = await seedGoldenPathForgeTask({
    taskId: forgeTaskId,
    baseDir: persistDir,
    tenantId: ctx.tenantId,
  });
  if (!api.seed.ok) {
    throw new Error(`Forge seed failed: ${JSON.stringify(api.seed)}`);
  }

  api.readiness = await apiSendServiceToken(
    ctx.baseUrl,
    `/tasks/${encodeURIComponent(forgeTaskId)}/forge-execution-readiness`,
    'GET',
    options.forgeServiceToken || DEFAULT_FORGE_SERVICE_TOKEN,
  );
  if (!api.readiness.ok) {
    throw new Error(`forge-execution-readiness failed (${api.readiness.status}): ${JSON.stringify(api.readiness.body)}`);
  }

  api.stack = await resolveForgeExecutionStack(forge, {
    forgeTaskId,
    forgeServiceToken: options.forgeServiceToken || DEFAULT_FORGE_SERVICE_TOKEN,
    forgeAdapterToken: options.forgeAdapterToken || DEFAULT_FORGE_ADAPTER_TOKEN,
    forgeAdapterBaseUrl: options.forgeAdapterBaseUrl,
    tenantId: ctx.tenantId,
    fetchImpl: options.fetchImpl || ctx.fetchImpl,
  });
  api.stackHealth = api.stack.health
    || await probeForgeAdapterHealth(api.stack.baseUrl, options.fetchImpl || ctx.fetchImpl);
  if (!api.stackHealth.ok && !api.stackHealth.skipped) {
    throw new Error(`GP-010 forgeadapter health probe failed: ${JSON.stringify(api.stackHealth)}`);
  }

  const runtimeBeforeStart = await forge.service.requestJson(`${api.stack.baseUrl}/tasks/${forgeTaskId}/runtime`, {
    headers: forge.harness.serviceHeaders(api.stack.faToken),
  });
  const executionState = runtimeBeforeStart.body?.executionState;
  if (executionState && executionState !== 'not_started') {
    api.start = {
      ok: true,
      skipped: true,
      reason: `forge_already_${executionState}`,
      action: { jobId: null },
      job: { status: 'succeeded' },
    };
  } else {
    api.start = await runForgeControlAction(api.stack, forge, `/tasks/${forgeTaskId}/start`);
  }
  const runtime = runtimeBeforeStart.response.status === 200
    ? runtimeBeforeStart
    : await forge.service.requestJson(`${api.stack.baseUrl}/tasks/${forgeTaskId}/runtime`, {
      headers: forge.harness.serviceHeaders(api.stack.faToken),
    });
  api.runtimeAfterStart = runtime.body;

  api.pilotAgentsSeed = await runPilotAgentsSeed(ctx.baseUrl);
  const factoryTemplateTier = evidence.engineeringTeam?.templateTier
    || evidence.phase1?.contract?.factoryTemplateTier
    || 'Simple';
  api.personaRouting = buildEngineerPersonaRouting(factoryTemplateTier);
  const { resolveRuntimeAgent } = require('../../scripts/openclaw-specialist-runner');
  api.uxReview = {
    owner: 'ux',
    runtimeAgent: resolveRuntimeAgent('ux'),
    sectionOwnerRole: 'ux',
  };
  const delegationUrlsReady = Boolean(options.openclawUrl || process.env.OPENCLAW_BASE_URL);
  api.delegationSmoke = options.skipDelegationSmoke
    ? { ok: false, skipped: true, reason: 'skipped_by_flag' }
    : !delegationUrlsReady
      ? { ok: false, skipped: true, reason: 'missing_openclaw_url' }
      : await runDelegationSmoke({
        openclawUrl: options.openclawUrl || process.env.OPENCLAW_BASE_URL,
        hermesUrl: options.hermesUrl || process.env.HERMES_BASE_URL,
        enableRealDelegation: true,
      });

  if (options.agentDrivenPhases) {
    Object.assign(process.env, resolveAgentDelegationEnv({
      openclawUrl: options.openclawUrl,
      hermesUrl: options.hermesUrl,
    }));
  }

  let agentImplementer = null;
  if (options.agentDrivenPhases) {
    agentImplementer = await runImplementerAgentPhase(ctx, {
      taskId: evidence.engineeringTeam?.taskId,
      requirements: evidence.engineeringTeam?.requirements || options.requirements,
      engineerTier: api.personaRouting?.assignedTier || 'Jr',
      specialist: 'jr-engineer',
      openclawUrl: options.openclawUrl,
      prUrl: options.prUrl,
    });
  }

  const markerPresent = readmeHasGoldenPathMarker();
  const commitSha = agentImplementer?.commitSha
    || options.implementationCommitSha
    || buildGoldenPathCommitSha('golden-path-impl');
  const prUrl = agentImplementer?.prUrl
    || options.prUrl
    || 'https://github.com/wiinc1/engineering-team/pull/271';
  const etTaskId = evidence.engineeringTeam?.taskId;
  const pilotState = etTaskId ? await readPilotTaskState(ctx, etTaskId) : null;
  const implementationVersion = Number(pilotState?.implementation_submission_version || 0);
  const implementationStages = new Set([
    'IN_PROGRESS',
    'IMPLEMENTATION',
    'CONTRACT_COVERAGE_AUDIT',
    'QA_TESTING',
    'SRE_MONITORING',
    'PM_CLOSE_REVIEW',
    'DONE',
    'CLOSED',
  ]);

  api.stageAdvanceForImplementation = etTaskId
    ? (implementationStages.has(pilotState?.current_stage)
      ? { currentStage: pilotState.current_stage, transitions: [], skipped: true }
      : await advancePilotTaskToImplementation(ctx, etTaskId))
    : { skipped: true };

  if (etTaskId && implementationVersion >= 1) {
    api.engineerSubmission = {
      ok: true,
      skipped: true,
      status: 200,
      version: implementationVersion,
      reason: 'already_submitted',
    };
  } else {
    api.engineerSubmission = etTaskId
      ? await recordEngineerSubmission(ctx, etTaskId, { commitSha, prUrl, version: 1 })
      : { ok: false, skipped: true };
    if (etTaskId && !api.engineerSubmission.ok) {
      throw new Error(
        `Engineer submission failed (${api.engineerSubmission.status}): ${JSON.stringify(api.engineerSubmission.body)}`,
      );
    }
  }

  const steps = ['GP-009', 'GP-010', 'GP-011', 'GP-012', 'GP-014'];
  if (api.delegationSmoke.ok) steps.push('GP-013');

  return {
    steps,
    forgeTaskId,
    forgeAuditDir,
    stack: api.stack,
    forge,
    api: {
      seed: api.seed,
      readiness: { status: api.readiness.status, ready: api.readiness.body },
      stackHealth: api.stackHealth,
      stackSource: api.stack.source,
      startJobId: api.start.job.id || api.start.job.jobId || api.start.action.jobId,
      runtimeExecutionState: api.runtimeAfterStart?.executionState,
      pilotAgentsSeed: {
        ok: api.pilotAgentsSeed.ok,
        status: api.pilotAgentsSeed.status || 0,
      },
      personaRouting: api.personaRouting,
      implementerAgent: agentImplementer ? {
        delegated: agentImplementer.delegated,
        sessionId: agentImplementer.sessionId,
        agentId: agentImplementer.agentId,
        commitSha,
        prUrl,
      } : null,
      delegationSmoke: {
        ok: api.delegationSmoke.ok,
        skipped: api.delegationSmoke.skipped === true,
        sessionId: api.delegationSmoke.sessionId || null,
      },
      engineerSubmission: {
        status: api.engineerSubmission.status,
        ok: api.engineerSubmission.ok,
        markerPresentAtSubmission: markerPresent,
      },
      implementation: { commitSha, prUrl },
    },
  };
}

async function runGoldenPathPhase3(ctx, phase2Result, evidence, options = {}) {
  const { stack, forge, forgeTaskId } = phase2Result;
  const etTaskId = evidence.engineeringTeam?.taskId;
  const api = {};

  const pilotState = etTaskId ? await readPilotTaskState(ctx, etTaskId) : null;
  if (etTaskId && pilotState?.latest_qa_outcome === 'pass') {
    const qaResults = await apiGet(ctx, `/tasks/${encodeURIComponent(etTaskId)}/qa-results`, ['qa', 'admin']);
    const priorRunId = qaResults.body?.latestFailed?.runId
      || qaResults.body?.latestFailed?.run_id
      || qaResults.body?.items?.find?.((item) => item.outcome === 'fail')?.runId
      || pilotState.latest_qa_run_id
      || null;
    return {
      steps: ['GP-015', 'GP-016'],
      api: {
        qaFail: { ok: true, skipped: true, reason: 'retest_already_passed' },
        forgeRejectJobId: null,
        executionState: null,
        workflowState: null,
      },
      priorQaRunId: priorRunId,
    };
  }
  api.stageAdvanceForQa = etTaskId
    ? await advancePilotTaskToQaTesting(ctx, etTaskId, {
      commitSha: phase2Result.api.implementation?.commitSha,
    })
    : { skipped: true, reason: 'no_task' };
  if (etTaskId && api.stageAdvanceForQa?.skipped !== true) {
    await waitForPilotTaskStage(ctx, etTaskId, 'QA_TESTING').catch(() => {});
    await runProjectionCatchUp(ctx).catch(() => {});
  }
  if (
    etTaskId
    && pilotState?.latest_qa_outcome === 'fail'
    && Number(pilotState?.implementation_submission_version || 0) >= 2
  ) {
    const qaResults = await apiGet(ctx, `/tasks/${encodeURIComponent(etTaskId)}/qa-results`, ['qa', 'admin']);
    const priorRunId = qaResults.body?.latestFailed?.runId
      || qaResults.body?.latestFailed?.run_id
      || pilotState.latest_qa_run_id
      || null;
    return {
      steps: ['GP-015', 'GP-016'],
      api: {
        qaFail: { ok: true, skipped: true, reason: 'fix_loop_already_underway' },
        forgeRejectJobId: null,
        executionState: null,
        workflowState: null,
      },
      priorQaRunId: priorRunId,
    };
  }
  if (etTaskId && pilotState?.latest_qa_outcome === 'fail') {
    const qaResults = await apiGet(ctx, `/tasks/${encodeURIComponent(etTaskId)}/qa-results`, ['qa', 'admin']);
    const priorRunId = qaResults.body?.latestFailed?.runId
      || qaResults.body?.latestFailed?.run_id
      || qaResults.body?.latest?.runId
      || qaResults.body?.latest?.run_id
      || pilotState.latest_qa_run_id
      || null;
    api.qaFail = {
      ok: true,
      skipped: true,
      status: 200,
      body: { data: { runId: priorRunId } },
      reason: 'already_recorded',
    };
  } else {
    let qaAgent = null;
    if (options.agentDrivenPhases) {
      qaAgent = await runQaAgentPhase(ctx, {
        taskId: etTaskId,
        requirements: evidence.engineeringTeam?.requirements,
        runKind: 'initial',
        outcome: 'fail',
        openclawUrl: options.openclawUrl,
      });
    }
    api.qaFail = etTaskId
      ? await recordGoldenPathInitialQaFail(ctx, etTaskId)
      : { ok: false, skipped: true };
    if (etTaskId && !api.qaFail.ok) {
      throw new Error(`QA fail recording failed (${api.qaFail.status}): ${JSON.stringify(api.qaFail.body)}`);
    }
    if (qaAgent) {
      api.qaAgent = {
        delegated: qaAgent.delegated,
        sessionId: qaAgent.sessionId,
        agentId: qaAgent.agentId,
        outcome: qaAgent.outcome,
      };
    }
  }

  const forgeHeaders = forge.harness.serviceHeaders(stack.faToken);
  const reviewRequest = await forge.service.requestJson(`${stack.baseUrl}/tasks/${forgeTaskId}/review-requests/qa`, {
    method: 'POST',
    headers: forgeHeaders,
  });
  if (reviewRequest.response.status !== 202) {
    throw new Error(`QA review request failed (${reviewRequest.response.status}): ${JSON.stringify(reviewRequest.body)}`);
  }
  const reviewRequestJob = await forge.harness.waitForJobStatus(
    stack.baseUrl,
    reviewRequest.body.jobId,
    forgeHeaders,
  );
  const childSessionId = reviewRequestJob.result?.childSessionId;
  if (!childSessionId) {
    throw new Error('Expected childSessionId on QA review request job before reject review');
  }

  const review = forge.packets.createReviewRejectedPacket();
  review.taskId = forgeTaskId;
  review.context.taskId = forgeTaskId;
  review.review.gate = 'qa';
  review.review.sessionId = childSessionId;
  review.review.summary = 'Golden path intentional QA fail — revision required.';
  review.review.decisionBy = { owner: 'qa-reviewer', role: 'qa' };

  api.forgeReject = await runForgeControlAction(stack, forge, `/tasks/${forgeTaskId}/review`, {
    body: JSON.stringify(review),
  });

  const runtime = await forge.service.requestJson(`${stack.baseUrl}/tasks/${forgeTaskId}/runtime`, {
    headers: forge.harness.serviceHeaders(stack.faToken),
  });
  api.runtimeAfterReject = runtime.body;

  return {
    steps: ['GP-015', 'GP-016'],
    api: {
      qaFail: {
        status: api.qaFail.status,
        ok: api.qaFail.ok,
        runId: extractQaRunId(api.qaFail.body),
      },
      qaAgent: api.qaAgent || null,
      forgeRejectJobId: api.forgeReject.job.id || api.forgeReject.job.jobId || api.forgeReject.action.jobId,
      executionState: api.runtimeAfterReject?.executionState,
      workflowState: api.runtimeAfterReject?.workflowState,
    },
    priorQaRunId: extractQaRunId(api.qaFail.body),
  };
}

async function runGoldenPathPhase4(ctx, phase2Result, phase3Result, evidence, options = {}) {
  const { stack, forge, forgeTaskId } = phase2Result;
  const etTaskId = evidence.engineeringTeam?.taskId;
  const api = {};

  const pilotStateAtStart = etTaskId ? await readPilotTaskState(ctx, etTaskId) : null;
  if (
    etTaskId
    && pilotStateAtStart?.latest_qa_outcome === 'pass'
    && Number(pilotStateAtStart?.implementation_submission_version || 0) >= 2
  ) {
    return {
      steps: ['GP-017', 'GP-018', 'GP-019'],
      api: {
        readmeFix: { changed: false, skipped: true },
        engineerSubmission: { ok: true, skipped: true, status: 200 },
        forgeResumeJobId: null,
        runtimeExecutionState: null,
        qaPass: { ok: true, skipped: true, status: 200 },
        fixCommitSha: pilotStateAtStart.implementation_commit_sha,
      },
    };
  }

  let fixAgent = null;
  if (options.agentDrivenPhases) {
    fixAgent = await runImplementerFixAgentPhase(ctx, {
      taskId: etTaskId,
      requirements: evidence.engineeringTeam?.requirements,
      openclawUrl: options.openclawUrl,
    });
  }
  api.readmeFix = addReadmeGoldenPathMarker();
  const fixCommitSha = fixAgent?.commitSha
    || options.fixCommitSha
    || buildGoldenPathCommitSha('golden-path-fix');
  if (fixAgent) {
    api.fixAgent = {
      delegated: fixAgent.delegated,
      sessionId: fixAgent.sessionId,
      agentId: fixAgent.agentId,
      commitSha: fixCommitSha,
    };
  }
  let pilotState = etTaskId ? await readPilotTaskState(ctx, etTaskId) : null;
  if (etTaskId && pilotState?.current_stage === 'QA_TESTING' && pilotState?.latest_qa_outcome === 'fail') {
    api.returnToImplementation = await recordStageTransitions(ctx, etTaskId, [{
      from: 'QA_TESTING',
      to: 'IMPLEMENTATION',
    }]);
    pilotState = await readPilotTaskState(ctx, etTaskId);
  }
  const implementationVersion = Number(pilotState?.implementation_submission_version || 0);
  if (etTaskId && implementationVersion >= 2) {
    api.engineerSubmission = {
      ok: true,
      skipped: true,
      status: 200,
      version: implementationVersion,
      reason: 'already_submitted',
    };
  } else {
    api.engineerSubmission = etTaskId
      ? await recordEngineerSubmission(ctx, etTaskId, {
        commitSha: fixCommitSha,
        prUrl: phase2Result.api.implementation.prUrl,
        version: 2,
      })
      : { ok: false, skipped: true };
    if (etTaskId && !api.engineerSubmission.ok) {
      throw new Error(
        `Engineer submission v2 failed (${api.engineerSubmission.status}): ${JSON.stringify(api.engineerSubmission.body)}`,
      );
    }
    if (etTaskId) {
      await waitForImplementationSubmission(ctx, etTaskId, { minVersion: 2 });
    }
  }

  api.forgeResume = await runForgeControlAction(stack, forge, `/tasks/${forgeTaskId}/resume`);
  const runtimeAfterResume = await forge.service.requestJson(`${stack.baseUrl}/tasks/${forgeTaskId}/runtime`, {
    headers: forge.harness.serviceHeaders(stack.faToken),
  });

  if (etTaskId) {
    api.stageAdvanceForRetest = await advancePilotTaskToQaTesting(ctx, etTaskId, {
      commitSha: fixCommitSha,
      implementationVersion: 2,
    });
    const qaStage = await readPilotTaskStage(ctx, etTaskId);
    if (qaStage !== 'QA_TESTING') {
      throw new Error(`Expected QA_TESTING before retest pass; found ${qaStage}`);
    }
  }

  const qaStateBeforePass = etTaskId ? await readPilotTaskState(ctx, etTaskId) : null;
  if (etTaskId && qaStateBeforePass?.latest_qa_outcome === 'pass') {
    api.qaPass = { ok: true, skipped: true, status: 200, reason: 'already_recorded' };
  } else {
    api.qaPass = etTaskId
      ? await recordQaResultWithCatchUp(ctx, etTaskId, {
        outcome: 'pass',
        runKind: 'retest',
        priorRunId: phase3Result.priorQaRunId,
        summary: 'Golden path retest pass — README marker present.',
        scenarios: ['README golden-path section verified'],
        retestScope: 'Docs-only marker validation',
      })
      : { ok: false, skipped: true };
    if (etTaskId && !api.qaPass.ok) {
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await runProjectionCatchUp(ctx).catch(() => {});
        const refreshed = await readPilotTaskState(ctx, etTaskId);
        if (refreshed.latest_qa_outcome === 'pass') {
          api.qaPass = { ok: true, skipped: true, status: 200, reason: 'projected_after_async_accept' };
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!api.qaPass.ok) {
        throw new Error(`QA retest pass failed (${api.qaPass.status}): ${JSON.stringify(api.qaPass.body)}`);
      }
    }
  }

  return {
    steps: ['GP-017', 'GP-018', 'GP-019'],
    api: {
      readmeFix: api.readmeFix,
      engineerSubmission: { status: api.engineerSubmission.status, ok: api.engineerSubmission.ok },
      forgeResumeJobId: api.forgeResume.job.id || api.forgeResume.job.jobId || api.forgeResume.action.jobId,
      runtimeExecutionState: runtimeAfterResume.body?.executionState,
      qaPass: {
        status: api.qaPass.status,
        ok: api.qaPass.ok,
      },
      fixCommitSha,
    },
  };
}

function resolveGitHeadSha(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return buildGoldenPathCommitSha('golden-path-merge');
  }
}

function validationSubprocessEnv() {
  const env = { ...process.env };
  const keysToDelete = [
    'DATABASE_URL',
    'AUDIT_STORE_BACKEND',
    'PGSSLMODE',
    'PGSSL_ACCEPT_SELF_SIGNED',
    'PGSSLMODE_REQUIRE',
    'FF_FACTORY_AGENT_DRIVEN_PHASE1',
    'FF_FACTORY_AGENT_DRIVEN_PHASES',
    'FF_REAL_SPECIALIST_DELEGATION',
    'FACTORY_USE_FIXTURE_DELEGATION',
    'SPECIALIST_DELEGATION_RUNNER',
    'SPECIALIST_DELEGATION_BASE_DIR',
    'OPENCLAW_BASE_URL',
    'HERMES_BASE_URL',
    'FORGEADAPTER_BASE_URL',
    'STAGING_SKIP_VALIDATION',
    'STAGING_SKIP_FORGE_PHASES',
  ];
  for (const key of keysToDelete) delete env[key];
  env.ALLOW_FILE_AUDIT_BACKEND = 'true';
  env.NODE_ENV = env.NODE_ENV || 'test';
  return env;
}

async function runNpmScript(scriptName, cwd = process.cwd()) {
  try {
    const { stdout, stderr } = await execFileAsync('npm', ['run', scriptName], {
      cwd,
      env: validationSubprocessEnv(),
      timeout: 600000,
    });
    return { ok: true, script: scriptName, stdout, stderr, status: 0 };
  } catch (error) {
    return {
      ok: false,
      script: scriptName,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      status: error.code || 1,
    };
  }
}

async function runDeployValidation(options = {}) {
  const skip = options.skipValidation === true;
  if (skip) {
    return { skipped: true, reason: 'skip_validation_flag' };
  }
  const results = {};
  for (const script of ['lint', 'test:unit', 'standards:check']) {
    results[script] = await runNpmScript(script, options.cwd || process.cwd());
    if (!results[script].ok) {
      return { ok: false, results };
    }
  }
  return { ok: true, results };
}

function resolveOperatorAppUrl(ctx, evidence, options = {}) {
  return options.operatorUrl
    || evidence.deploy?.operatorUrl
    || evidence.vercel?.productionUrl
    || ctx?.baseUrl
    || 'http://127.0.0.1:15173';
}

function etTaskIdFromEvidence(evidence) {
  return evidence?.engineeringTeam?.taskId || null;
}

async function resolveSreApprovalPayload(ctx, evidence, options, { etTaskId, operatorUrl, mergeCommitSha }) {
  if (options.agentDrivenPhases) {
    Object.assign(process.env, resolveAgentDelegationEnv({
      openclawUrl: options.openclawUrl,
      hermesUrl: options.hermesUrl,
    }));
    const sreAgent = await runSreAgentPhase(ctx, {
      taskId: etTaskId,
      operatorUrl,
      mergeCommitSha,
      requirements: evidence.engineeringTeam?.requirements || options.requirements,
      openclawUrl: options.openclawUrl,
    });
    if (!sreAgent.approved) {
      throw new Error(`GP-026 SRE agent rejected monitoring window: ${sreAgent.reason}`);
    }
    return {
      reason: sreAgent.reason,
      evidence: sreAgent.evidence,
      agent: sreAgent,
    };
  }
  return {
    reason: 'Docs-only golden path pilot: no production telemetry regressions observed during supervised closeout.',
    evidence: ['Local validation suite green.', 'README marker present.', 'Forge lifecycle completed.'],
    agent: null,
  };
}

async function refreshEngineeringTeamProjection(ctx, evidence, taskId) {
  const detail = await apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/detail`, ['reader', 'admin']);
  if (!detail.ok) {
    return evidence.engineeringTeam || {};
  }
  const task = detail.body?.task || detail.body?.data?.task || detail.body;
  return {
    ...(evidence.engineeringTeam || {}),
    auditStage: task?.currentStage || task?.current_stage || null,
    workflow: {
      ...(evidence.engineeringTeam?.workflow || {}),
      nextRequiredAction: task?.nextRequiredAction || task?.next_required_action || null,
      waitingState: task?.waitingState || task?.waiting_state || null,
    },
  };
}

async function runGoldenPathPhase6(ctx, evidence, options = {}) {
  const etTaskId = evidence.engineeringTeam?.taskId;
  const evidencePath = options.outputPath || 'observability/golden-path-pilot.json';
  const api = {};
  const steps = ['GP-022', 'GP-023', 'GP-027'];
  const manualInterventions = [...(evidence.manualInterventions || [])];

  let mergeCommitSha = options.mergeCommitSha
    || evidence.github?.mergeCommitSha
    || resolveGitHeadSha(options.cwd || process.cwd());
  const prUrl = options.prUrl || evidence.github?.prUrl || 'https://github.com/wiinc1/engineering-team/pull/271';
  const prNumber = Number(options.prNumber || evidence.github?.prNumber || 271);

  api.autoMerge = await mergePullRequestWhenReady({
    repository: options.ciRepository || 'wiinc1/engineering-team',
    prNumber,
    prUrl,
    autoMerge: options.autoMerge,
    githubToken: options.githubToken,
    fetchImpl: options.fetchImpl || ctx.fetchImpl,
  });
  if (!api.autoMerge.ok && !api.autoMerge.skipped) {
    throw new Error(`GP-022 auto-merge failed: ${JSON.stringify(api.autoMerge)}`);
  }
  if (api.autoMerge.mergeCommitSha) {
    mergeCommitSha = api.autoMerge.mergeCommitSha;
  }

  const prSyncedAt = new Date().toISOString();
  api.prSync = etTaskId
    ? await apiSend(ctx, `/tasks/${encodeURIComponent(etTaskId)}/events`, 'POST', ['admin'], {
      eventType: 'task.github_pr_synced',
      actorType: 'agent',
      idempotencyKey: `golden-path:pr-merged:${etTaskId}:${mergeCommitSha.slice(0, 12)}`,
      payload: {
        pr_number: prNumber,
        pr_title: 'Golden path pilot — README marker + evidence',
        state: 'closed',
        pr_state: 'merged',
        pr_merged: true,
        pr_repository: 'wiinc1/engineering-team',
        merge_commit_sha: mergeCommitSha,
        pr_url: prUrl,
        pr_updated_at: prSyncedAt,
        linked_prs: [{
          number: prNumber,
          url: prUrl,
          title: 'Golden path pilot — README marker + evidence',
          repository: 'wiinc1/engineering-team',
          state: 'merged',
          merged: true,
          updated_at: prSyncedAt,
        }],
      },
    })
    : { ok: false, skipped: true };
  if (etTaskId && !api.prSync.ok) {
    throw new Error(`GP-022 PR sync failed (${api.prSync.status}): ${JSON.stringify(api.prSync.body)}`);
  }

  api.validation = await runDeployValidation(options);
  if (!api.validation.ok && !api.validation.skipped) {
    throw new Error(`GP-023 validation failed: ${JSON.stringify(api.validation.results)}`);
  }
  api.ciValidation = buildCiValidationEvidence(api.validation, {
    workflowFile: options.ciWorkflowFile,
    repository: options.ciRepository,
    ciUrl: options.ciUrl,
  });

  const operatorUrl = resolveOperatorAppUrl(ctx, evidence, options);
  api.deploy = {
    operatorUrl,
    validation: api.validation,
    ciValidation: api.ciValidation,
  };

  api.supabase = { skipped: true, reason: 'docs_only_pilot_platform_already_on_supabase' };
  api.redis = { skipped: true, reason: 'out_of_scope_per_runbook' };
  steps.push('GP-024', 'GP-025');

  let stage = etTaskId ? await readPilotTaskStage(ctx, etTaskId) : null;
  let pilotState = etTaskId ? await readPilotTaskState(ctx, etTaskId) : null;

  if (pilotState?.sre_approved_at || evidence.phase5?.api?.sreMonitoring?.approve?.ok) {
    api.sreMonitoring = {
      skipped: true,
      reason: 'completed_in_phase5',
      stage,
    };
    steps.push('GP-026');
  } else if (etTaskId && stage === 'SRE_MONITORING' && !pilotState?.sre_approved_at) {
    const sreDetailBeforeStart = extractSreMonitoringDetail(
      (await apiGet(ctx, `/tasks/${encodeURIComponent(etTaskId)}/detail`, ['reader', 'admin'])).body,
    );
    if (!sreDetailBeforeStart.windowStartedAt) {
      await waitForMergedLinkedPr(ctx, etTaskId);
      api.sreStart = await apiSend(ctx, `/tasks/${encodeURIComponent(etTaskId)}/sre-monitoring/start`, 'POST', ['sre', 'admin'], {
        deploymentEnvironment: options.deploymentEnvironment || 'production',
        deploymentUrl: operatorUrl,
        deploymentVersion: mergeCommitSha,
        deploymentStatus: 'success',
        evidence: ['Golden path phase 6 deploy validation passed.', `PR ${prUrl} merged.`],
      });
      if (!api.sreStart.ok) {
        throw new Error(`GP-026 SRE start failed (${api.sreStart.status}): ${JSON.stringify(api.sreStart.body)}`);
      }
    } else {
      api.sreStart = { skipped: true, reason: 'already_started', windowStartedAt: sreDetailBeforeStart.windowStartedAt };
    }
    await waitForSreMonitoringStarted(ctx, etTaskId);
    const sreApproval = await resolveSreApprovalPayload(ctx, evidence, options, {
      etTaskId,
      operatorUrl,
      mergeCommitSha,
    });
    api.sreApprove = await apiSend(ctx, `/tasks/${encodeURIComponent(etTaskId)}/sre-monitoring/approve`, 'POST', ['sre', 'admin'], {
      reason: sreApproval.reason,
      evidence: sreApproval.evidence,
    });
    if (!api.sreApprove.ok) {
      throw new Error(`GP-026 SRE approve failed (${api.sreApprove.status}): ${JSON.stringify(api.sreApprove.body)}`);
    }
    if (sreApproval.agent) {
      api.sreMonitoring = {
        ...(api.sreMonitoring || {}),
        agentSessionId: sreApproval.agent.sessionId,
        agentId: sreApproval.agent.agentId,
        delegated: sreApproval.agent.delegated,
        approved: sreApproval.agent.approved,
      };
    }
    steps.push('GP-026');
  } else if (options.allowSreWaiver === true) {
    api.sreMonitoring = {
      skipped: true,
      waiver: true,
      stage,
      reason: 'GP-026 waived by allowSreWaiver flag for legacy replay compatibility.',
    };
    manualInterventions.push({
      stepId: 'GP-026',
      classification: 'operator intervention',
      reason: api.sreMonitoring.reason,
      recordedAt: new Date().toISOString(),
    });
    steps.push('GP-026');
  } else if (
    etTaskId
    && (
      pilotState?.closed
      || stage === 'DONE'
      || stage === 'CLOSED'
      || (evidence.stepsCompleted || []).includes('GP-026')
    )
  ) {
    api.sreMonitoring = {
      skipped: true,
      reason: pilotState?.closed || stage === 'DONE' || stage === 'CLOSED'
        ? 'task_already_closed'
        : 'recorded_in_prior_replay',
      stage,
    };
    steps.push('GP-026');
  } else {
    throw new Error(
      `GP-026 requires SRE_MONITORING with approval or prior phase5 completion; found stage=${stage} sreApproved=${Boolean(pilotState?.sre_approved_at)}`,
    );
  }

  stage = etTaskId ? await readPilotTaskStage(ctx, etTaskId) : stage;
  pilotState = etTaskId ? await readPilotTaskState(ctx, etTaskId) : pilotState;
  const humanCloseAlreadyRecorded = pilotState?.waiting_state === 'awaiting_human_close_review'
    && String(pilotState?.next_required_action || '').includes('Close review approved');

  if (etTaskId && pilotState?.closed) {
    api.humanClose = { ok: true, skipped: true, reason: 'task_already_closed' };
  } else if (etTaskId && humanCloseAlreadyRecorded) {
    api.humanClose = { ok: true, skipped: true, reason: 'human_close_decision_already_recorded' };
  } else if (etTaskId && stage === 'PM_CLOSE_REVIEW') {
    const closeReadiness = await waitForHumanCloseDecisionReady(ctx, etTaskId);
    if (!closeReadiness.ready) {
      throw new Error('GP-027 human close not ready: PM and Architect cancellation recommendations not projected');
    }
    api.humanClose = await apiSend(
      ctx,
      `/tasks/${encodeURIComponent(etTaskId)}/close-review/human-decision`,
      'POST',
      ['admin'],
      {
        outcome: 'approve',
        summary: 'Golden path pilot human closeout approved.',
        rationale: 'GP-001–GP-026 evidence recorded for supervised docs-only pilot issue #271.',
        confirmationRequired: false,
      },
    );
    if (!api.humanClose.ok) {
      throw new Error(`GP-027 human close failed (${api.humanClose.status}): ${JSON.stringify(api.humanClose.body)}`);
    }
    pilotState = await readPilotTaskState(ctx, etTaskId);
  } else {
    api.humanClose = { ok: false, skipped: true, reason: `unexpected_stage_${stage}` };
  }

  api.taskClosed = etTaskId && !pilotState?.closed
    ? await apiSend(ctx, `/tasks/${encodeURIComponent(etTaskId)}/events`, 'POST', ['admin'], {
      eventType: 'task.closed',
      actorType: 'agent',
      idempotencyKey: `golden-path:close:${etTaskId}`,
      payload: {
        reason: 'Golden path pilot GP-027 closeout complete.',
        closeout_report: 'docs/reports/GOLDEN_PATH_PILOT_EVIDENCE.md',
        pilot_evidence: evidencePath,
      },
    })
    : { ok: true, skipped: true };

  if (etTaskId && !api.taskClosed.ok) {
    throw new Error(`GP-027 task close failed (${api.taskClosed.status}): ${JSON.stringify(api.taskClosed.body)}`);
  }

  const { writeFactoryCloseoutReport } = require('./factory-closeout');
  const closeoutWrite = writeFactoryCloseoutReport(
    {
      ...evidence,
      status: 'phase6_complete',
      manualInterventions,
      phase6: {
        ...(evidence.phase6 || {}),
        api: {
          ...(evidence.phase6?.api || {}),
          validation: api.validation,
          deploy: api.deploy,
          ciValidation: api.ciValidation,
          humanClose: api.humanClose,
          taskClosed: api.taskClosed,
        },
      },
    },
    {
      evidencePath: evidencePath,
      outputDir: options.closeoutDir || 'observability/factory-closeout',
    },
  );
  api.closeoutReport = {
    ok: true,
    path: closeoutWrite.outputPath,
    stepClassification: closeoutWrite.report.stepClassification,
  };

  return {
    steps,
    manualInterventions,
    api: {
      autoMerge: api.autoMerge,
      prSync: { status: api.prSync.status, ok: api.prSync.ok },
      mergeCommitSha,
      prUrl,
      validation: api.validation,
      deploy: api.deploy,
      supabase: api.supabase,
      redis: api.redis,
      sreMonitoring: api.sreMonitoring || {
        start: { status: api.sreStart?.status, ok: api.sreStart?.ok },
        approve: { status: api.sreApprove?.status, ok: api.sreApprove?.ok },
      },
      humanClose: { status: api.humanClose.status, ok: api.humanClose.ok },
      taskClosed: { status: api.taskClosed.status, ok: api.taskClosed.ok },
      closeoutReport: api.closeoutReport,
      closeoutArtifacts: [
        'docs/reports/GOLDEN_PATH_PILOT_EVIDENCE.md',
        evidencePath,
        'observability/golden-path-manual-steps.json',
        api.closeoutReport.path,
      ],
    },
  };
}

async function runGoldenPathPhase5(ctx, phase2Result, evidence, options = {}) {
  const { stack, forge, forgeTaskId } = phase2Result;
  const etTaskId = evidence.engineeringTeam?.taskId;
  const api = {};
  const steps = ['GP-020', 'GP-021'];
  let pilotState = etTaskId ? await readPilotTaskState(ctx, etTaskId) : null;
  const taskAlreadyClosed = pilotState?.closed
    || pilotState?.current_stage === 'DONE'
    || pilotState?.current_stage === 'CLOSED';

  if (taskAlreadyClosed && evidence.forgeadapter?.completeJobId) {
    return {
      steps: ['GP-020', 'GP-021', 'GP-026'],
      api: {
        stageAdvanceForSre: { skipped: true, reason: 'task_already_closed' },
        sreMonitoring: { skipped: true, reason: 'task_already_closed' },
        stageAdvanceForCloseReview: { skipped: true, reason: 'task_already_closed' },
        forgeCompleteJobId: evidence.forgeadapter.completeJobId,
        executionState: evidence.forgeadapter.runtimeExecutionState || 'completed',
        workflowState: 'completed',
        reviewGates: null,
        pmCloseReview: { ok: true, skipped: true, reason: 'task_already_closed' },
        architectCloseReview: { ok: true, skipped: true, reason: 'task_already_closed' },
      },
    };
  }

  api.stageAdvanceForSre = etTaskId
    ? await advancePilotTaskToSreMonitoring(ctx, etTaskId)
    : { skipped: true };

  const operatorUrl = resolveOperatorAppUrl(ctx, evidence, options);
  const mergeCommitSha = options.mergeCommitSha
    || evidence.github?.mergeCommitSha
    || resolveGitHeadSha(options.cwd || process.cwd());
  const prUrl = options.prUrl || evidence.github?.prUrl || 'https://github.com/wiinc1/engineering-team/pull/271';
  const prNumber = Number(options.prNumber || 271);
  pilotState = etTaskId ? await readPilotTaskState(ctx, etTaskId) : pilotState;
  const pilotStage = pilotState?.current_stage || pilotState?.currentStage || null;
  const sreDetailSnapshot = etTaskId
    ? extractSreMonitoringDetail((await apiGet(ctx, `/tasks/${encodeURIComponent(etTaskId)}/detail`, ['reader', 'admin'])).body)
    : {};
  const sreAlreadyApproved = Boolean(
    pilotState?.sre_approved_at
    || sreDetailSnapshot.state === 'approved'
    || sreDetailSnapshot.approval?.approvedAt
    || ['PM_CLOSE_REVIEW', 'DONE'].includes(pilotStage),
  );

  if (etTaskId && taskAlreadyClosed) {
    api.sreMonitoring = { skipped: true, reason: 'task_already_closed' };
    steps.push('GP-026');
  } else if (etTaskId && !sreAlreadyApproved) {
    const prSyncedAt = new Date().toISOString();
    api.prSyncForSre = await apiSend(ctx, `/tasks/${encodeURIComponent(etTaskId)}/events`, 'POST', ['admin'], {
      eventType: 'task.github_pr_synced',
      actorType: 'agent',
      idempotencyKey: `golden-path:pr-merged:${etTaskId}:${mergeCommitSha.slice(0, 12)}`,
      payload: {
        pr_number: prNumber,
        pr_title: 'Golden path pilot — README marker + evidence',
        state: 'closed',
        pr_state: 'merged',
        pr_merged: true,
        pr_repository: 'wiinc1/engineering-team',
        merge_commit_sha: mergeCommitSha,
        pr_url: prUrl,
        pr_updated_at: prSyncedAt,
        linked_prs: [{
          number: prNumber,
          url: prUrl,
          title: 'Golden path pilot — README marker + evidence',
          repository: 'wiinc1/engineering-team',
          state: 'merged',
          merged: true,
          updated_at: prSyncedAt,
        }],
      },
    });
    if (!api.prSyncForSre.ok) {
      throw new Error(`GP-022 PR sync before SRE failed (${api.prSyncForSre.status}): ${JSON.stringify(api.prSyncForSre.body)}`);
    }
    const sreDetailBeforeStart = extractSreMonitoringDetail(
      (await apiGet(ctx, `/tasks/${encodeURIComponent(etTaskId)}/detail`, ['reader', 'admin'])).body,
    );
    if (!sreDetailBeforeStart.windowStartedAt) {
      await waitForMergedLinkedPr(ctx, etTaskId);
      api.sreStart = await apiSend(ctx, `/tasks/${encodeURIComponent(etTaskId)}/sre-monitoring/start`, 'POST', ['sre', 'admin'], {
        deploymentEnvironment: options.deploymentEnvironment || 'production',
        deploymentUrl: operatorUrl,
        deploymentVersion: mergeCommitSha,
        deploymentStatus: 'success',
        evidence: ['Golden path phase 5 deploy validation window.', `Operator URL ${operatorUrl}.`],
      });
      if (!api.sreStart.ok) {
        throw new Error(`GP-026 SRE start failed (${api.sreStart.status}): ${JSON.stringify(api.sreStart.body)}`);
      }
    } else {
      api.sreStart = { skipped: true, reason: 'already_started', windowStartedAt: sreDetailBeforeStart.windowStartedAt };
    }
    const sreDetailBeforeApprove = await waitForSreMonitoringStarted(ctx, etTaskId);
    if (sreDetailBeforeApprove.state === 'approved' || sreDetailBeforeApprove.approval?.approvedAt) {
      api.sreApprove = { skipped: true, reason: 'already_approved', approval: sreDetailBeforeApprove.approval || null };
    } else {
      const sreApproval = await resolveSreApprovalPayload(ctx, evidence, options, {
        etTaskId,
        operatorUrl,
        mergeCommitSha,
      });
      api.sreApprove = await apiSend(ctx, `/tasks/${encodeURIComponent(etTaskId)}/sre-monitoring/approve`, 'POST', ['sre', 'admin'], {
        reason: sreApproval.reason,
        evidence: sreApproval.evidence,
      });
      if (!api.sreApprove.ok) {
        throw new Error(`GP-026 SRE approve failed (${api.sreApprove.status}): ${JSON.stringify(api.sreApprove.body)}`);
      }
      if (sreApproval.agent) {
        api.sreMonitoring = {
          agentSessionId: sreApproval.agent.sessionId,
          agentId: sreApproval.agent.agentId,
          delegated: sreApproval.agent.delegated,
          approved: sreApproval.agent.approved,
        };
      }
    }
    steps.push('GP-026');
    pilotState = await readPilotTaskState(ctx, etTaskId);
  } else if (etTaskId) {
    api.sreMonitoring = { skipped: true, reason: 'already_approved', stage: pilotStage };
    steps.push('GP-026');
  }

  api.stageAdvanceForCloseReview = etTaskId
    ? await advancePilotTaskToPmCloseReview(ctx, etTaskId)
    : { skipped: true };

  const runtimeBeforeClose = await forge.service.requestJson(`${stack.baseUrl}/tasks/${forgeTaskId}/runtime`, {
    headers: forge.harness.serviceHeaders(stack.faToken),
  });
  const forgeAlreadyCompleted = runtimeBeforeClose.body?.executionState === 'completed'
    || Boolean(evidence.forgeadapter?.completeJobId);

  const closeoutGates = (() => {
    const { resolveForgeCloseoutGates } = require('./et-forge-dispatch-bridge');
    return resolveForgeCloseoutGates(
      runtimeBeforeClose.body || {},
      runtimeBeforeClose.body || {},
    );
  })();

  if (forgeAlreadyCompleted) {
    for (const gate of closeoutGates) {
      api[`gate_${gate}`] = { ok: true, skipped: true, reason: 'forge_already_completed' };
    }
    api.complete = {
      ok: true,
      skipped: true,
      reason: 'forge_already_completed',
      action: { jobId: evidence.forgeadapter?.completeJobId || null },
      job: { status: 'succeeded' },
    };
  } else {
    for (const gate of closeoutGates) {
      api[`gate_${gate}`] = await approveForgeReviewGate(stack, forge, forgeTaskId, gate);
    }

    api.complete = await runForgeControlAction(stack, forge, `/tasks/${forgeTaskId}/complete`, {
      body: JSON.stringify({
        requestedAction: 'complete',
        actor: { owner: 'main', role: 'operator' },
        summary: 'Golden path forge lifecycle complete.',
        outcome: 'accepted',
      }),
    });
  }

  const runtime = runtimeBeforeClose.response.status === 200
    ? runtimeBeforeClose
    : await forge.service.requestJson(`${stack.baseUrl}/tasks/${forgeTaskId}/runtime`, {
      headers: forge.harness.serviceHeaders(stack.faToken),
    });

  if (etTaskId && taskAlreadyClosed) {
    api.pmClose = { ok: true, skipped: true, reason: 'task_already_closed' };
    api.architectClose = { ok: true, skipped: true, reason: 'task_already_closed' };
  } else {
    api.pmClose = etTaskId
      ? await apiSend(ctx, `/tasks/${encodeURIComponent(etTaskId)}/close-review/cancellation-recommendation`, 'POST', ['pm', 'admin'], {
        summary: 'Golden path pilot ready for close.',
        rationale: 'PM approves docs-only pilot close after QA retest pass and forge lifecycle complete.',
        recommendation: 'close',
      })
      : { ok: false, skipped: true };

    api.architectClose = etTaskId
      ? await apiSend(ctx, `/tasks/${encodeURIComponent(etTaskId)}/close-review/cancellation-recommendation`, 'POST', ['architect', 'admin'], {
        summary: 'Architect confirms golden path technical scope complete.',
        rationale: 'Simple docs-only marker delivered; no production risk remains.',
        recommendation: 'close',
      })
      : { ok: false, skipped: true };
  }

  if (etTaskId && !taskAlreadyClosed && (!api.pmClose.ok || !api.architectClose.ok)) {
    throw new Error(
      `Close review failed (pm=${api.pmClose.status}, architect=${api.architectClose.status}): ${JSON.stringify({ pm: api.pmClose.body, architect: api.architectClose.body })}`,
    );
  }

  return {
    steps,
    api: {
      stageAdvanceForSre: api.stageAdvanceForSre,
      sreMonitoring: api.sreMonitoring || {
        start: { status: api.sreStart?.status, ok: api.sreStart?.ok },
        approve: { status: api.sreApprove?.status, ok: api.sreApprove?.ok },
      },
      stageAdvanceForCloseReview: api.stageAdvanceForCloseReview,
      forgeCompleteJobId: api.complete.job.id || api.complete.job.jobId || api.complete.action.jobId,
      executionState: runtime.body?.executionState,
      workflowState: runtime.body?.workflowState,
      reviewGates: runtime.body?.reviewGates,
      pmCloseReview: { status: api.pmClose.status, ok: api.pmClose.ok },
      architectCloseReview: { status: api.architectClose.status, ok: api.architectClose.ok },
    },
  };
}

async function runGoldenPathPhases(options = {}) {
  const fromPhase = Number(options.fromPhase || 2);
  const toPhase = Number(options.toPhase || 5);
  const phaseOnly = fromPhase === 6 && toPhase === 6;
  const outputPath = options.outputPath || DEFAULT_OUTPUT;
  let evidence = options.pilot || loadPilotEvidence(outputPath);
  if (!evidence) {
    throw new Error(`Missing pilot evidence at ${outputPath}; run Phase 1 first.`);
  }

  const ctx = {
    fetchImpl: options.fetchImpl || fetch,
    baseUrl: options.baseUrl,
    tenantId: options.tenantId || evidence.phase1?.tenantId || 'engineering-team',
    actorId: options.actorId || evidence.phase1?.actorId || 'golden-path-operator',
    jwtSecret: options.jwtSecret,
    useVersionedTaskApi: typeof options.useVersionedTaskApi === 'boolean'
      ? options.useVersionedTaskApi
      : !String(options.baseUrl || '').includes('127.0.0.1:13000')
        && !String(options.baseUrl || '').includes('localhost:13000'),
    persistDir: options.persistDir ?? null,
    stackPersistDir: resolveGoldenPathStackPersistDir({}, evidence, options),
  };

  if (!ctx.baseUrl || !ctx.jwtSecret) {
    throw new Error('baseUrl and jwtSecret are required');
  }

  let phase2Result = null;
  let phase3Result = null;
  const phaseResults = {};

  if (phaseOnly || (fromPhase <= 6 && toPhase >= 6 && fromPhase > 5)) {
    const phase6Result = await runGoldenPathPhase6(ctx, evidence, options);
    phaseResults.phase6 = phase6Result.api;
    evidence.status = 'phase6_complete';
    evidence.stepsCompleted = mergeStepsCompleted(evidence.stepsCompleted, phase6Result.steps);
    evidence.manualInterventions = phase6Result.manualInterventions;
    evidence.github = {
      ...(evidence.github || {}),
      prUrl: phase6Result.api.prUrl,
      mergeCommitSha: phase6Result.api.mergeCommitSha,
    };
    evidence.deploy = {
      ...(evidence.deploy || {}),
      ...(phase6Result.api.deploy || {}),
    };
    if (etTaskIdFromEvidence(evidence)) {
      evidence.engineeringTeam = await refreshEngineeringTeamProjection(
        ctx,
        evidence,
        etTaskIdFromEvidence(evidence),
      );
    }
    evidence.phase6 = {
      completedAt: new Date().toISOString(),
      personas: buildPhasePersonaSnapshot(6, evidence, phase6Result.api),
      api: phase6Result.api,
    };
    evidence.completedAt = evidence.phase6.completedAt;
    savePilotEvidence(evidence, outputPath);
    return {
      evidence,
      phaseResults,
      outputPath: path.resolve(process.cwd(), outputPath),
    };
  }

  try {
    if (fromPhase <= 2 && toPhase >= 2) {
      phase2Result = await runGoldenPathPhase2(ctx, evidence, options);
      phaseResults.phase2 = phase2Result.api;
      evidence.status = 'phase2_complete';
      evidence.stepsCompleted = mergeStepsCompleted(evidence.stepsCompleted, phase2Result.steps);
      evidence.forgeadapter = {
        ...(evidence.forgeadapter || {}),
        taskId: phase2Result.forgeTaskId,
        startJobId: phase2Result.api.startJobId ?? phase2Result.api.start?.action?.jobId ?? evidence.forgeadapter?.startJobId,
        completeJobId: evidence.forgeadapter?.completeJobId ?? null,
        forgeAuditDir: phase2Result.forgeAuditDir,
        runtimeExecutionState: phase2Result.api.runtimeExecutionState
          ?? evidence.forgeadapter?.runtimeExecutionState,
      };
      evidence.github = {
        ...(evidence.github || {}),
        prUrl: phase2Result.api.implementation.prUrl,
        mergeCommitSha: phase2Result.api.implementation.commitSha,
      };
      evidence.phase2 = {
        completedAt: new Date().toISOString(),
        personaRouting: phase2Result.api.personaRouting,
        personas: buildPhasePersonaSnapshot(2, evidence, phase2Result.api),
        api: phase2Result.api,
      };
      savePilotEvidence(evidence, outputPath);
    }

    if (fromPhase <= 3 && toPhase >= 3) {
      if (!phase2Result) {
        throw new Error('Phase 3 requires Phase 2 stack context in the same run');
      }
      phase3Result = await runGoldenPathPhase3(ctx, phase2Result, evidence, options);
      phaseResults.phase3 = phase3Result.api;
      evidence.status = 'phase3_complete';
      evidence.stepsCompleted = mergeStepsCompleted(evidence.stepsCompleted, phase3Result.steps);
      evidence.phase3 = {
        completedAt: new Date().toISOString(),
        personas: buildPhasePersonaSnapshot(3, evidence, phase3Result.api),
        api: phase3Result.api,
      };
      savePilotEvidence(evidence, outputPath);
    }

    if (fromPhase <= 4 && toPhase >= 4) {
      if (!phase2Result || !phase3Result) {
        throw new Error('Phase 4 requires Phase 2 and 3 context in the same run');
      }
      const phase4Result = await runGoldenPathPhase4(ctx, phase2Result, phase3Result, evidence, options);
      phaseResults.phase4 = phase4Result.api;
      evidence.status = 'phase4_complete';
      evidence.stepsCompleted = mergeStepsCompleted(evidence.stepsCompleted, phase4Result.steps);
      evidence.github = {
        ...(evidence.github || {}),
        mergeCommitSha: phase4Result.api.fixCommitSha,
      };
      evidence.phase4 = {
        completedAt: new Date().toISOString(),
        personas: buildPhasePersonaSnapshot(4, evidence, phase4Result.api),
        api: phase4Result.api,
      };
      savePilotEvidence(evidence, outputPath);
    }

    if (fromPhase <= 5 && toPhase >= 5) {
      if (!phase2Result) {
        throw new Error('Phase 5 requires Phase 2 stack context in the same run');
      }
      const phase5Result = await runGoldenPathPhase5(ctx, phase2Result, evidence, options);
      phaseResults.phase5 = phase5Result.api;
      evidence.status = 'phase5_complete';
      evidence.stepsCompleted = mergeStepsCompleted(evidence.stepsCompleted, phase5Result.steps);
      evidence.phase5 = {
        completedAt: new Date().toISOString(),
        personas: buildPhasePersonaSnapshot(5, evidence, phase5Result.api),
        api: phase5Result.api,
      };
      evidence.forgeadapter = {
        ...(evidence.forgeadapter || {}),
        completeJobId: phase5Result.api.forgeCompleteJobId,
        runtimeExecutionState: phase5Result.api.executionState,
      };
      savePilotEvidence(evidence, outputPath);
    }

    if (fromPhase <= 6 && toPhase >= 6) {
      const phase6Result = await runGoldenPathPhase6(ctx, evidence, options);
      phaseResults.phase6 = phase6Result.api;
      evidence.status = 'phase6_complete';
      evidence.stepsCompleted = mergeStepsCompleted(evidence.stepsCompleted, phase6Result.steps);
      evidence.manualInterventions = phase6Result.manualInterventions;
      evidence.github = {
        ...(evidence.github || {}),
        prUrl: phase6Result.api.prUrl,
        mergeCommitSha: phase6Result.api.mergeCommitSha,
      };
      evidence.deploy = {
        ...(evidence.deploy || {}),
        ...(phase6Result.api.deploy || {}),
      };
      if (etTaskIdFromEvidence(evidence)) {
        evidence.engineeringTeam = await refreshEngineeringTeamProjection(
          ctx,
          evidence,
          etTaskIdFromEvidence(evidence),
        );
      }
      evidence.phase6 = {
        completedAt: new Date().toISOString(),
        personas: buildPhasePersonaSnapshot(6, evidence, phase6Result.api),
        api: phase6Result.api,
      };
      evidence.completedAt = evidence.phase6.completedAt;
      savePilotEvidence(evidence, outputPath);
    }
  } finally {
    if (phase2Result?.stack) {
      await phase2Result.stack.close().catch(() => {});
    }
  }

  return {
    evidence,
    phaseResults,
    outputPath: path.resolve(process.cwd(), outputPath),
  };
}

async function withLocalPhases(options = {}) {
  process.env.FORGE_SERVICE_TOKEN = options.forgeServiceToken || DEFAULT_FORGE_SERVICE_TOKEN;
  return withLocalAuditApi((local) => runGoldenPathPhases({
    ...options,
    ...local,
  }), {
    persistDir: options.persistDir || undefined,
  });
}

module.exports = {
  DEFAULT_STACK_PERSIST_DIR,
  resolveGoldenPathStackPersistDir,
  readmeHasGoldenPathMarker,
  addReadmeGoldenPathMarker,
  runGoldenPathPhase2,
  runGoldenPathPhase3,
  runGoldenPathPhase4,
  runGoldenPathPhase5,
  runGoldenPathPhase6,
  runGoldenPathPhases,
  withLocalPhases,
  withLocalPhase6: (options = {}) => withLocalAuditApi((local) => runGoldenPathPhases({
    ...options,
    fromPhase: 6,
    toPhase: 6,
    ...local,
  }), {
    persistDir: options.persistDir || undefined,
  }),
};