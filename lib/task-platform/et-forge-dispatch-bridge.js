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
  if (!forgeDir) return null;
  try {
    return require(path.join(forgeDir, 'tests/unit/runtime/packet-fixtures.js'));
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

async function dispatchForgeReviewGate(config, taskId, gate, { approved = true } = {}) {
  const reviewRequest = await runForgeControlRoute(
    config,
    `/tasks/${encodeURIComponent(taskId)}/review-requests/${gate}`,
    undefined,
  );
  const childSessionId = reviewRequest.job.result?.childSessionId;
  if (!childSessionId) {
    throw new Error(`Missing childSessionId for forge gate ${gate}`);
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
    childSessionId,
    approved
      ? `${gate} gate approved via et-forge dispatch bridge.`
      : 'Golden path intentional QA fail — revision required.',
  );
  const review = await runForgeControlRoute(
    config,
    `/tasks/${encodeURIComponent(taskId)}/review`,
    reviewPacket,
  );
  return {
    ok: true,
    gate,
    reviewRequestJobId: reviewRequest.action.jobId,
    reviewJobId: review.action.jobId,
  };
}

async function dispatchForgeStart(config, taskId) {
  const readiness = await readForgeExecutionReadiness(config, taskId);
  if (!readiness.ok) {
    return {
      ok: false,
      skipped: true,
      action: 'start',
      taskId,
      reason: 'not_execution_ready',
      readinessStatus: readiness.status,
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
  const gates = [];
  for (const gate of ['qa', 'architect', 'pm']) {
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
    const taskId = resolveForgeLifecycleTaskId(config, event.taskId);
    const result = await dispatchForgeStart(config, taskId);
    return { handled: true, bridge: 'contract_approved_to_forge_start', ...result };
  }

  if (event.eventType === 'task.qa_result_recorded') {
    const outcome = event.payload?.outcome || event.payload?.qa_outcome;
    const runKind = event.payload?.run_kind || event.payload?.runKind;
    const taskId = resolveForgeLifecycleTaskId(config, event.taskId);

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
    const taskId = resolveForgeLifecycleTaskId(config, event.taskId);
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
  resolveSubmissionVersion,
  readForgeExecutionReadiness,
  waitForForgeJob,
  dispatchForgeStart,
  dispatchForgeResume,
  dispatchForgeQaReject,
  dispatchForgeCloseout,
  handleEtForgeDispatchEvent,
  createEtForgeDispatchOutboxPublisher,
  createCombinedOutboxPublisher,
};