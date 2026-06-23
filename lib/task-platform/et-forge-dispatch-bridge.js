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

async function forgeAdapterRequest(config, route, { method = 'POST', body } = {}) {
  if (!config.forgeAdapterBaseUrl) {
    throw new Error('FORGEADAPTER_BASE_URL is required for et-forge dispatch');
  }
  const response = await config.fetchImpl(`${config.forgeAdapterBaseUrl}${route}`, {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${config.forgeAdapterToken}`,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    body: responseBody,
  };
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

function resolveForgeLifecycleTaskId(config, eventTaskId) {
  return config.lifecycleTaskId || eventTaskId;
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
  const resume = await forgeAdapterRequest(config, `/tasks/${encodeURIComponent(taskId)}/resume`);
  return {
    ok: resume.ok,
    skipped: false,
    action: 'resume',
    taskId,
    status: resume.status,
    body: resume.body,
  };
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
    if (outcome !== 'fail' || runKind === 'retest') {
      return { handled: false, skipped: true, reason: 'qa_event_not_initial_fail' };
    }
    const taskId = resolveForgeLifecycleTaskId(config, event.taskId);
    const result = await dispatchForgeResume(config, taskId);
    return { handled: true, bridge: 'qa_fail_to_forge_resume', ...result };
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
  readForgeExecutionReadiness,
  dispatchForgeStart,
  dispatchForgeResume,
  handleEtForgeDispatchEvent,
  createEtForgeDispatchOutboxPublisher,
  createCombinedOutboxPublisher,
};