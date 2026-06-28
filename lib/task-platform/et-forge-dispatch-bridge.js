const path = require('node:path');
const {
  resolveForgeadapterDir,
  makeBearerToken,
  buildUrl,
} = require('./golden-path-shared');

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function resolveEtForgeDispatchConfig(env = process.env) {
  const enabled = parseBooleanEnv(env.ET_FORGE_DISPATCH_ENABLED, false);
  const forgeAdapterBaseUrl = String(env.FORGEADAPTER_BASE_URL || '').replace(/\/+$/, '');
  const engineeringTeamBaseUrl = String(
    env.ENGINEERING_TEAM_BASE_URL || env.AUTH_PUBLIC_APP_URL || '',
  ).replace(/\/+$/, '');
  return {
    enabled,
    forgeAdapterBaseUrl,
    engineeringTeamBaseUrl,
    forgeAdapterToken: env.FORGEADAPTER_SERVICE_TOKEN || 'local-forgeadapter-token',
    forgeServiceToken: env.FORGE_SERVICE_TOKEN || 'local-golden-path-forge-token',
    lifecycleTaskId: env.ET_FORGE_LIFECYCLE_TASK_ID || null,
    jwtSecret: env.AUTH_JWT_SECRET || env.GOLDEN_PATH_JWT_SECRET || null,
    tenantId: env.DEFAULT_TENANT_ID || env.ENGINEERING_TEAM_TENANT_ID || 'engineering-team',
    actorId: env.ET_FORGE_DISPATCH_ACTOR_ID || 'et-forge-bridge',
    jobPollAttempts: Number(env.ET_FORGE_JOB_POLL_ATTEMPTS || 200),
    jobPollIntervalMs: Number(env.ET_FORGE_JOB_POLL_INTERVAL_MS || 25),
    fetchImpl: globalThis.fetch,
  };
}

function normalizeOutboxEvent(event = {}) {
  const nested = event.event && typeof event.event === 'object' ? event.event : event;
  return {
    eventId: nested.event_id || nested.eventId || event.event_id || null,
    taskId: nested.task_id || nested.taskId || event.task_id || null,
    tenantId: nested.tenant_id || nested.tenantId || event.tenant_id || 'engineering-team',
    eventType: nested.event_type || nested.eventType || event.event_type || null,
    payload: nested.payload || event.payload || {},
  };
}

function loadForgePacketFixtures() {
  const forgeDir = resolveForgeadapterDir();
  if (forgeDir) {
    try {
      return require(path.join(forgeDir, 'tests/unit/runtime/packet-fixtures.js'));
    } catch {
      // Fall through to the bundled fixtures used when forgeadapter is not checked out.
    }
  }
  try {
    return require('./forge-packet-fixtures');
  } catch {
    return null;
  }
}

function forgeServiceHeaders(token) {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  };
}

async function forgeAdapterRequest(config, route, { method = 'POST', body } = {}) {
  if (!config.forgeAdapterBaseUrl) {
    throw new Error('FORGEADAPTER_BASE_URL is required for et-forge dispatch');
  }
  const response = await config.fetchImpl(`${config.forgeAdapterBaseUrl}${route}`, {
    method,
    headers: forgeServiceHeaders(config.forgeAdapterToken),
    body: body == null ? undefined : JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    body: responseBody,
  };
}

async function waitForForgeJob(config, jobId, expectedStatus = 'succeeded') {
  const headers = forgeServiceHeaders(config.forgeAdapterToken);
  let lastStatus = '(unknown)';
  for (let attempt = 0; attempt < config.jobPollAttempts; attempt += 1) {
    const job = await forgeAdapterRequest(config, `/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' });
    if (!job.ok) {
      throw new Error(`Forge job ${jobId} poll failed (${job.status}): ${JSON.stringify(job.body)}`);
    }
    lastStatus = job.body.status;
    if (job.body.status === expectedStatus) {
      return job.body;
    }
    if (job.body.status === 'failed') {
      throw new Error(`Forge job ${jobId} failed: ${JSON.stringify(job.body.error || job.body)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, config.jobPollIntervalMs));
  }
  throw new Error(`Timed out waiting for forge job ${jobId} (last status: ${lastStatus})`);
}

async function runForgeControlRoute(config, route, body) {
  const action = await forgeAdapterRequest(config, route, { body });
  if (action.status !== 202) {
    throw new Error(`Forge action ${route} failed (${action.status}): ${JSON.stringify(action.body)}`);
  }
  const job = await waitForForgeJob(config, action.body.jobId);
  return { action: action.body, job };
}

async function readForgeExecutionReadiness(config, taskId) {
  if (!config.engineeringTeamBaseUrl) {
    return { ok: false, skipped: true, reason: 'missing_engineering_team_base_url' };
  }
  const response = await config.fetchImpl(
    `${config.engineeringTeamBaseUrl}/tasks/${encodeURIComponent(taskId)}/forge-execution-readiness`,
    {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${config.forgeServiceToken}`,
      },
    },
  );
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

async function engineeringTeamJwtRequest(config, route, method, roles, body) {
  if (!config.engineeringTeamBaseUrl || !config.jwtSecret) {
    return { ok: false, skipped: true, reason: 'missing_et_jwt_config' };
  }
  const response = await config.fetchImpl(buildUrl(config.engineeringTeamBaseUrl, route), {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${makeBearerToken({
        jwtSecret: config.jwtSecret,
        tenantId: config.tenantId,
        actorId: config.actorId,
        roles,
      })}`,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    ok: response.ok,
    body: await response.json().catch(() => ({})),
  };
}

function resolveForgeLifecycleTaskId(config, eventTaskId) {
  return config.lifecycleTaskId || eventTaskId;
}

function forgeRuntimeIsMaterialized(runtime = {}) {
  const state = String(runtime.executionState || '').trim().toLowerCase();
  if (state && !['not_started', 'idle', 'pending'].includes(state)) {
    return true;
  }
  if (runtime.sessions?.parentSessionId) return true;
  if (Array.isArray(runtime.reviewGates) && runtime.reviewGates.length > 0) return true;
  if (runtime.binding?.worktreePath || runtime.binding?.repoPath) return true;
  return false;
}

function forgeQaFailureRecorded(runtime = {}) {
  const qaGate = findForgeReviewGate(runtime, 'qa');
  const qaGateStatus = String(qaGate?.status || '').trim().toLowerCase();
  if (qaGateStatus === 'rejected' || qaGateStatus === 'failed') {
    return true;
  }
  return (runtime.reviews || []).some(
    (entry) => entry.gate === 'qa' && String(entry.status || '').trim().toLowerCase() === 'rejected',
  );
}

async function resolveForgeDispatchTaskId(config, eventTaskId, { bridge = null } = {}) {
  const lifecycleTaskId = config.lifecycleTaskId || null;
  if (!lifecycleTaskId || lifecycleTaskId === eventTaskId) {
    return eventTaskId;
  }

  const eventRuntime = await readForgeRuntime(config, eventTaskId);
  if (eventRuntime.ok && forgeRuntimeIsMaterialized(eventRuntime.body)) {
    return eventTaskId;
  }

  if (bridge === 'contract_approved_to_forge_start') {
    return lifecycleTaskId;
  }

  const lifecycleRuntime = await readForgeRuntime(config, lifecycleTaskId);
  if (lifecycleRuntime.ok && forgeRuntimeIsMaterialized(lifecycleRuntime.body)) {
    return lifecycleTaskId;
  }

  return eventTaskId;
}

function resolveForgeReviewChildSessionId(runtime = {}, gate) {
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

function findForgeReviewGate(runtime = {}, gate) {
  return (runtime.reviewGates || []).find((entry) => entry.gate === gate) || null;
}

function resolveForgeCloseoutGates(readinessBody = {}, runtime = {}) {
  const gates = ['qa', 'architect', 'pm'];
  const uxGate = findForgeReviewGate(runtime, 'ux');
  if (readinessBody.affectsUi === true || uxGate?.required === true) {
    return ['ux', ...gates];
  }
  return gates;
}

function buildReviewPacket(packets, kind, taskId, gate, childSessionId, summary) {
  const factory = kind === 'rejected'
    ? packets.createReviewRejectedPacket
    : packets.createReviewApprovedPacket;
  const review = factory();
  review.taskId = taskId;
  review.context.taskId = taskId;
  review.review.gate = gate;
  review.review.sessionId = childSessionId;
  review.review.summary = summary;
  review.review.decisionBy = {
    owner: `${gate}-reviewer`,
    role: gate,
  };
  return review;
}

async function dispatchForgeReviewGate(config, taskId, gate, {
  approved = true,
  childSessionId = null,
  summary = null,
} = {}) {
  let sessionId = childSessionId;
  if (!sessionId) {
    const runtimeResult = await readForgeRuntime(config, taskId);
    if (runtimeResult.ok) {
      sessionId = resolveForgeReviewChildSessionId(runtimeResult.body, gate);
    }
  }
  if (!sessionId) {
    const reviewRequest = await runForgeControlRoute(
      config,
      `/tasks/${encodeURIComponent(taskId)}/review-requests/${gate}`,
      undefined,
    );
    sessionId = reviewRequest.job.result?.childSessionId
      || reviewRequest.job.result?.review?.sessionId;
    if (!sessionId) {
      throw new Error(`Missing childSessionId for forge gate ${gate}`);
    }
  }
  const packets = loadForgePacketFixtures();
  if (!packets) {
    throw new Error('forgeadapter packet fixtures are required for review dispatch');
  }
  const reviewPacket = buildReviewPacket(
    packets,
    approved ? 'approved' : 'rejected',
    taskId,
    gate,
    sessionId,
    summary || (approved
      ? `${gate} gate approved via et-forge dispatch bridge.`
      : 'Golden path intentional QA fail — revision required.'),
  );
  const review = await runForgeControlRoute(
    config,
    `/tasks/${encodeURIComponent(taskId)}/review`,
    reviewPacket,
  );
  return {
    ok: true,
    gate,
    childSessionId: sessionId,
    reviewJobId: review.action.jobId,
  };
}

function forgeUxReviewAutomationEnabled(config = {}) {
  return config.enabled && parseBooleanEnv(process.env.FORGE_AUTO_COMPLETE_UX_REVIEW_GATE, true);
}

async function maybeResumeForgeAfterUxReview(config, taskId) {
  if (!forgeUxReviewAutomationEnabled(config)) {
    return { ok: false, skipped: true, reason: 'automation_disabled' };
  }

  const runtimeResult = await readForgeRuntime(config, taskId);
  if (!runtimeResult.ok) {
    return { ok: false, skipped: true, reason: 'runtime_unavailable', status: runtimeResult.status };
  }

  const runtime = runtimeResult.body || {};
  const uxGate = findForgeReviewGate(runtime, 'ux');
  if (!uxGate || uxGate.status !== 'approved') {
    return { ok: false, skipped: true, reason: 'ux_gate_not_approved' };
  }

  const reviews = runtime.reviews || [];
  const uxApprovedReview = [...reviews].reverse().find((entry) => entry.gate === 'ux' && entry.status === 'approved');
  if (!uxApprovedReview && runtime.lastAction !== 'review') {
    return { ok: false, skipped: true, reason: 'ux_review_not_recorded' };
  }

  if (runtime.lastAction === 'resume') {
    return { ok: true, skipped: true, reason: 'already_resumed', taskId };
  }

  const resume = await dispatchForgeResume(config, taskId);
  return {
    ok: true,
    skipped: false,
    action: 'resume',
    taskId,
    jobId: resume.jobId,
  };
}

async function maybeCompleteForgeUxReviewGate(config, taskId, {
  summary = 'UX delegation completed; forge UX review gate approved automatically.',
} = {}) {
  if (!forgeUxReviewAutomationEnabled(config)) {
    return { ok: false, skipped: true, reason: 'automation_disabled' };
  }

  const runtimeResult = await readForgeRuntime(config, taskId);
  if (!runtimeResult.ok) {
    return { ok: false, skipped: true, reason: 'runtime_unavailable', status: runtimeResult.status };
  }

  const runtime = runtimeResult.body || {};
  const uxGate = findForgeReviewGate(runtime, 'ux');
  if (!uxGate) {
    return { ok: false, skipped: true, reason: 'ux_gate_not_materialized' };
  }
  if (uxGate.required !== true) {
    return { ok: false, skipped: true, reason: 'ux_gate_not_required' };
  }

  let review = null;
  if (uxGate.status === 'approved') {
    review = { ok: true, skipped: true, reason: 'gate_already_approved', gate: 'ux' };
  } else {
    const childSessionId = resolveForgeReviewChildSessionId(runtime, 'ux');
    const gateResult = await dispatchForgeReviewGate(config, taskId, 'ux', {
      approved: true,
      childSessionId,
      summary,
    });
    review = {
      ok: true,
      skipped: false,
      gate: 'ux',
      childSessionId: childSessionId || null,
      ...gateResult,
    };
  }

  const resume = await maybeResumeForgeAfterUxReview(config, taskId);
  return {
    ok: true,
    skipped: review.skipped === true && resume.skipped === true,
    action: 'ux_handoff_complete',
    taskId,
    review,
    resume,
  };
}

async function handleForgeUxDelegationCompletion({
  taskId,
  targetAgent,
  exitCode,
  delegationId = null,
  stdout = '',
  stderr = '',
  env = process.env,
} = {}) {
  const normalizedAgent = String(targetAgent || '').trim().toLowerCase();
  if (normalizedAgent !== 'ux') {
    return { ok: false, skipped: true, reason: 'not_ux_delegation' };
  }
  if (!taskId) {
    return { ok: false, skipped: true, reason: 'missing_task_id' };
  }

  const config = resolveEtForgeDispatchConfig(env);
  if (Number(exitCode) !== 0) {
    return {
      ok: false,
      skipped: true,
      reason: 'delegation_failed',
      taskId,
      exitCode,
      delegationId,
      stderr: String(stderr || '').slice(0, 500),
      stdout: String(stdout || '').slice(0, 500),
    };
  }

  const summary = delegationId
    ? `UX specialist delegation ${delegationId} completed; approving forge UX review gate.`
    : 'UX specialist delegation completed; approving forge UX review gate.';

  return maybeCompleteForgeUxReviewGate(config, taskId, { summary });
}

async function ensureForgeExecutionReady(config, taskId) {
  let readiness = await readForgeExecutionReadiness(config, taskId);
  if (readiness.ok) {
    return { readiness, seeded: false };
  }
  try {
    const { seedGoldenPathForgeTask } = require('./golden-path-forge-seed');
    const seed = await seedGoldenPathForgeTask({
      taskId,
      tenantId: config.tenantId || 'engineering-team',
      baseDir: process.cwd(),
    });
    if (seed.ok) {
      readiness = await readForgeExecutionReadiness(config, taskId);
      return { readiness, seeded: seed.skipped !== true };
    }
  } catch {
    // fall through with original readiness result
  }
  return { readiness, seeded: false };
}

async function readForgeRuntime(config, taskId) {
  return forgeAdapterRequest(config, `/tasks/${encodeURIComponent(taskId)}/runtime`, { method: 'GET' });
}

function buildForgeDelegatePacket(packets, taskId, runtime, readinessBody = {}) {
  const packet = packets.createExecutionDelegatePacket();
  packet.taskId = taskId;
  packet.context.taskId = taskId;
  if (readinessBody.projectId) packet.context.projectId = readinessBody.projectId;
  if (readinessBody.targetRepo) packet.context.targetRepo = readinessBody.targetRepo;
  if (readinessBody.taskVersion) packet.taskVersion = String(readinessBody.taskVersion);
  if (Array.isArray(readinessBody.acceptanceCriteria) && readinessBody.acceptanceCriteria.length) {
    packet.execution.acceptanceCriteria = readinessBody.acceptanceCriteria;
  }
  if (readinessBody.summary) packet.execution.summary = readinessBody.summary;
  if (readinessBody.affectsUi === true) packet.execution.affectsUi = true;

  const targetAgent = runtime.routedOwner;
  packet.execution.delegate.targetAgent = targetAgent;
  packet.execution.delegate.reason = targetAgent === 'ux'
    ? 'UI-affecting implementation requires UX specialist delegation after architect engineer assignment.'
    : `Delegate routed specialist ${targetAgent} after architect engineer assignment.`;
  packet.execution.resumeContext.latestTaskState = `Task ${taskId} is active in IMPLEMENTATION and awaiting specialist work.`;
  packet.execution.resumeContext.memorySummary = readinessBody.summary
    || 'Architect engineer assignment recorded; forge runtime is established.';
  packet.execution.resumeContext.parentSessionId = runtime.sessions?.parentSessionId
    || runtime.parentSessionId
    || 'sess_parent_unknown';
  return packet;
}

async function ensureForgeStarted(config, taskId) {
  const { readiness, seeded } = await ensureForgeExecutionReady(config, taskId);
  if (!readiness.ok) {
    return {
      ok: false,
      skipped: true,
      reason: 'not_execution_ready',
      readinessStatus: readiness.status,
      forgeSeedAttempted: seeded,
    };
  }

  let runtimeResult = await readForgeRuntime(config, taskId);
  if (!runtimeResult.ok) {
    return {
      ok: false,
      skipped: true,
      reason: 'runtime_unavailable',
      readinessStatus: runtimeResult.status,
      forgeSeedAttempted: seeded,
    };
  }

  const executionState = runtimeResult.body?.executionState;
  if (executionState && executionState !== 'not_started') {
    return {
      ok: true,
      skipped: false,
      runtime: runtimeResult.body,
      forgeSeedAttempted: seeded,
      started: false,
    };
  }

  const start = await runForgeControlRoute(config, `/tasks/${encodeURIComponent(taskId)}/start`);
  runtimeResult = await readForgeRuntime(config, taskId);
  if (!runtimeResult.ok) {
    return {
      ok: false,
      skipped: true,
      reason: 'runtime_unavailable_after_start',
      startJobId: start.action.jobId,
      forgeSeedAttempted: seeded,
    };
  }

  return {
    ok: true,
    skipped: false,
    runtime: runtimeResult.body,
    forgeSeedAttempted: seeded,
    started: true,
    startJobId: start.action.jobId,
  };
}

async function dispatchForgeDelegate(config, taskId) {
  const started = await ensureForgeStarted(config, taskId);
  if (!started.ok) {
    return {
      ok: false,
      skipped: started.skipped === true,
      action: 'delegate',
      taskId,
      reason: started.reason,
      readinessStatus: started.readinessStatus,
      forgeSeedAttempted: started.forgeSeedAttempted,
    };
  }

  const runtime = started.runtime;
  const existingChildren = runtime?.sessions?.childSessions || [];
  if (existingChildren.length > 0) {
    const targetAgent = existingChildren[existingChildren.length - 1]?.targetAgent || runtime.routedOwner;
    const uxReview = targetAgent === 'ux'
      ? await maybeCompleteForgeUxReviewGate(config, taskId, {
        summary: 'UX delegation already active; completing forge UX review gate if still required.',
      })
      : null;
    return {
      ok: true,
      skipped: true,
      action: 'delegate',
      taskId,
      reason: 'already_delegated',
      targetAgent,
      childSessionId: existingChildren[existingChildren.length - 1]?.childSessionId || null,
      forgeStarted: started.started === true,
      startJobId: started.startJobId || null,
      uxReview,
    };
  }

  const routedOwner = runtime?.routedOwner;
  if (!routedOwner) {
    return {
      ok: false,
      skipped: true,
      action: 'delegate',
      taskId,
      reason: 'missing_routed_owner',
      forgeStarted: started.started === true,
      startJobId: started.startJobId || null,
    };
  }

  const packets = loadForgePacketFixtures();
  if (!packets) {
    return {
      ok: false,
      skipped: true,
      action: 'delegate',
      taskId,
      reason: 'missing_packet_fixtures',
    };
  }

  const readiness = await readForgeExecutionReadiness(config, taskId);
  const delegatePacket = buildForgeDelegatePacket(
    packets,
    taskId,
    runtime,
    readiness.ok ? readiness.body : {},
  );
  const delegate = await runForgeControlRoute(
    config,
    `/tasks/${encodeURIComponent(taskId)}/delegate`,
    delegatePacket,
  );

  return {
    ok: true,
    skipped: false,
    action: 'delegate',
    taskId,
    targetAgent: routedOwner,
    jobId: delegate.action.jobId,
    forgeStarted: started.started === true,
    startJobId: started.startJobId || null,
  };
}

async function dispatchForgeStart(config, taskId) {
  const { readiness, seeded } = await ensureForgeExecutionReady(config, taskId);
  if (!readiness.ok) {
    return {
      ok: false,
      skipped: true,
      action: 'start',
      taskId,
      reason: 'not_execution_ready',
      readinessStatus: readiness.status,
      forgeSeedAttempted: seeded,
    };
  }

  const start = await forgeAdapterRequest(config, `/tasks/${encodeURIComponent(taskId)}/start`);
  return {
    ok: start.ok,
    skipped: false,
    action: 'start',
    taskId,
    status: start.status,
    body: start.body,
    forgeSeedAttempted: seeded,
  };
}

async function dispatchForgeResume(config, taskId) {
  const resume = await runForgeControlRoute(config, `/tasks/${encodeURIComponent(taskId)}/resume`);
  return {
    ok: true,
    skipped: false,
    action: 'resume',
    taskId,
    status: 202,
    jobId: resume.action.jobId,
  };
}

async function dispatchForgeQaReject(config, taskId) {
  const reject = await dispatchForgeReviewGate(config, taskId, 'qa', { approved: false });
  return {
    ok: true,
    skipped: false,
    action: 'qa_reject',
    taskId,
    ...reject,
  };
}

async function dispatchForgeCloseout(config, forgeTaskId, etTaskId) {
  const readiness = await readForgeExecutionReadiness(config, forgeTaskId);
  const runtimeResult = await readForgeRuntime(config, forgeTaskId);
  const closeoutGates = resolveForgeCloseoutGates(
    readiness.ok ? readiness.body : {},
    runtimeResult.ok ? runtimeResult.body : {},
  );
  const gates = [];
  for (const gate of closeoutGates) {
    const gateState = runtimeResult.ok ? findForgeReviewGate(runtimeResult.body, gate) : null;
    if (gateState?.status === 'approved') {
      gates.push({ ok: true, skipped: true, reason: 'gate_already_approved', gate });
      continue;
    }
    gates.push(await dispatchForgeReviewGate(config, forgeTaskId, gate, { approved: true }));
  }
  const complete = await runForgeControlRoute(
    config,
    `/tasks/${encodeURIComponent(forgeTaskId)}/complete`,
    {
      requestedAction: 'complete',
      actor: { owner: 'et-forge-bridge', role: 'operator' },
      summary: 'Golden path forge lifecycle complete via et-forge dispatch bridge.',
      outcome: 'accepted',
    },
  );

  const etClose = { pm: null, architect: null };
  if (etTaskId) {
    etClose.pm = await engineeringTeamJwtRequest(
      config,
      `/tasks/${encodeURIComponent(etTaskId)}/close-review/cancellation-recommendation`,
      'POST',
      ['pm', 'admin'],
      {
        summary: 'Golden path pilot ready for close.',
        rationale: 'PM approves docs-only pilot close after QA retest pass and forge lifecycle complete.',
        recommendation: 'close',
      },
    );
    etClose.architect = await engineeringTeamJwtRequest(
      config,
      `/tasks/${encodeURIComponent(etTaskId)}/close-review/cancellation-recommendation`,
      'POST',
      ['architect', 'admin'],
      {
        summary: 'Architect confirms golden path technical scope complete.',
        rationale: 'Simple docs-only marker delivered; no production risk remains.',
        recommendation: 'close',
      },
    );
  }

  return {
    ok: true,
    skipped: false,
    action: 'closeout',
    taskId: forgeTaskId,
    etTaskId,
    gates,
    completeJobId: complete.action.jobId,
    etClose,
  };
}

function resolveSubmissionVersion(payload = {}) {
  return Number(payload.version || payload.submission_version || payload.submissionVersion || 0);
}

async function handleEtForgeDispatchEvent(rawEvent, config = resolveEtForgeDispatchConfig()) {
  if (!config.enabled) {
    return { handled: false, skipped: true, reason: 'dispatch_disabled' };
  }
  if (!config.forgeAdapterBaseUrl) {
    return { handled: false, skipped: true, reason: 'missing_forgeadapter_base_url' };
  }

  const event = normalizeOutboxEvent(rawEvent);
  if (!event.eventType || !event.taskId) {
    return { handled: false, skipped: true, reason: 'invalid_outbox_event' };
  }

  if (event.eventType === 'task.execution_contract_approved') {
    const taskId = await resolveForgeDispatchTaskId(config, event.taskId, {
      bridge: 'contract_approved_to_forge_start',
    });
    const result = await dispatchForgeStart(config, taskId);
    return { handled: true, bridge: 'contract_approved_to_forge_start', ...result };
  }

  if (event.eventType === 'task.architect_engineer_assignment_recorded') {
    const taskId = event.taskId;
    const result = await dispatchForgeDelegate(config, taskId);
    return { handled: true, bridge: 'architect_assignment_to_forge_delegate', ...result };
  }

  if (event.eventType === 'task.qa_result_recorded') {
    const outcome = event.payload?.outcome || event.payload?.qa_outcome;
    const runKind = event.payload?.run_kind || event.payload?.runKind;
    const taskId = await resolveForgeDispatchTaskId(config, event.taskId);

    if (outcome === 'fail' && runKind !== 'retest') {
      const result = await dispatchForgeQaReject(config, taskId);
      return { handled: true, bridge: 'qa_fail_to_forge_reject', ...result };
    }

    if (outcome === 'pass' && runKind === 'retest') {
      const result = await dispatchForgeCloseout(config, taskId, event.taskId);
      return { handled: true, bridge: 'qa_retest_pass_to_forge_closeout', ...result };
    }

    return { handled: false, skipped: true, reason: 'qa_event_not_routed' };
  }

  if (event.eventType === 'task.engineer_submission_recorded') {
    const version = resolveSubmissionVersion(event.payload);
    if (version < 2) {
      return { handled: false, skipped: true, reason: 'engineer_submission_not_fix_loop' };
    }
    const taskId = await resolveForgeDispatchTaskId(config, event.taskId);
    const runtimeResult = await readForgeRuntime(config, taskId);
    if (!runtimeResult.ok || !forgeQaFailureRecorded(runtimeResult.body)) {
      return {
        handled: false,
        skipped: true,
        reason: 'no_prior_qa_fail',
        taskId,
      };
    }
    const result = await dispatchForgeResume(config, taskId);
    return { handled: true, bridge: 'engineer_submission_v2_to_forge_resume', ...result };
  }

  return { handled: false, skipped: true, reason: 'event_type_not_routed' };
}

function createEtForgeDispatchOutboxPublisher(config = resolveEtForgeDispatchConfig(), options = {}) {
  const log = options.log || ((line) => process.stdout.write(`${line}\n`));
  return async function etForgeDispatchPublisher(event) {
    const result = await handleEtForgeDispatchEvent(event, config);
    if (result.handled) {
      log(JSON.stringify({
        et_forge_dispatch: true,
        bridge: result.bridge,
        task_id: result.taskId,
        action: result.action,
        ok: result.ok,
        skipped: result.skipped === true,
        status: result.status || null,
        reason: result.reason || null,
      }));
    }
    return result;
  };
}

function createCombinedOutboxPublisher(publishers = []) {
  return async function combinedPublisher(event) {
    for (const publisher of publishers) {
      await publisher(event);
    }
  };
}

module.exports = {
  parseBooleanEnv,
  resolveEtForgeDispatchConfig,
  normalizeOutboxEvent,
  resolveForgeLifecycleTaskId,
  resolveForgeDispatchTaskId,
  forgeRuntimeIsMaterialized,
  forgeQaFailureRecorded,
  resolveSubmissionVersion,
  resolveForgeReviewChildSessionId,
  findForgeReviewGate,
  resolveForgeCloseoutGates,
  readForgeExecutionReadiness,
  ensureForgeExecutionReady,
  waitForForgeJob,
  readForgeRuntime,
  buildForgeDelegatePacket,
  ensureForgeStarted,
  dispatchForgeStart,
  dispatchForgeDelegate,
  dispatchForgeResume,
  dispatchForgeQaReject,
  dispatchForgeReviewGate,
  maybeResumeForgeAfterUxReview,
  maybeCompleteForgeUxReviewGate,
  handleForgeUxDelegationCompletion,
  dispatchForgeCloseout,
  handleEtForgeDispatchEvent,
  createEtForgeDispatchOutboxPublisher,
  createCombinedOutboxPublisher,
};