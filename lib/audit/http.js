const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const { createAuditStore } = require('./store');
const { authorize } = require('./authz');
const { verifyHmacJwt, signHmacJwt, getBearerToken, buildPrincipalFromClaims, verifyBrowserAuthCode } = require('../auth/jwt');
const { createAuditLogger } = require('./logger');
const {
  isAuditFoundationEnabled,
  isWorkflowEngineEnabled,
  assertAuditFoundationEnabled,
  assertWorkflowEngineEnabled,
  isTaskCreationEnabled,
  assertTaskCreationEnabled,
  assertArchitectSpecTieringEnabled,
  assertEngineerSubmissionEnabled,
  assertTaskLockingEnabled,
  assertStructuredCommentsEnabled,
  assertQaStageEnabled,
  assertQaContextRoutingEnabled,
} = require('./feature-flags');
const { isWorkflowAuditEventType } = require('./event-types');
const { resolveAgentRegistry, findAgentById } = require('./agents');
const { WorkflowError, STAGES } = require('./workflow');
const { deriveReviewQuestions, REVIEW_QUESTION_STATES } = require('./review-questions');
const { deriveWorkflowThreads, WORKFLOW_COMMENT_TYPES, WORKFLOW_THREAD_STATES, defaultNotificationTargets, normalizeCommentType, normalizeArray: normalizeThreadArray } = require('./workflow-threads');
const { deriveImplementationHistory, deriveQaResults, normalizeArray: normalizeQaArray } = require('./qa-results');
const { createTaskLockPayload, getActiveTaskLock, isTaskLockEventType } = require('./task-locks');

const ENGINEER_TIERS = Object.freeze(['Principal', 'Sr', 'Jr']);
const TECHNICAL_SPEC_FIELDS = Object.freeze(['summary', 'scope', 'design', 'rolloutPlan']);
const MONITORING_SPEC_FIELDS = Object.freeze(['service', 'dashboardUrls', 'alertPolicies', 'runbook', 'successMetrics']);
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const GITHUB_PR_URL_PATTERN = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+(?:\/?\S*)?$/i;
const BROWSER_SESSION_TTL_SECONDS = 60 * 60;

function parseJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        const error = new Error('request body too large');
        error.code = 'payload_too_large';
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error('invalid json body');
        error.code = 'invalid_json';
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}


function sendJson(res, statusCode, payload, requestId) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'x-request-id': requestId,
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, payload, requestId, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'content-type': contentType,
    'x-request-id': requestId,
  });
  res.end(payload);
}

function toPrometheus(metrics) {
  return Object.entries(metrics)
    .map(([key, value]) => (typeof value === 'number' ? `# TYPE ${key} gauge\n${key} ${value}` : null))
    .filter(Boolean)
    .join('\n') + '\n';
}

function getRequestContext(req, options = {}) {
  const token = getBearerToken(req);
  if (token) {
    const claims = verifyHmacJwt(token, options.jwtSecret || process.env.AUTH_JWT_SECRET, {
      issuer: options.jwtIssuer || process.env.AUTH_JWT_ISSUER,
      audience: options.jwtAudience || process.env.AUTH_JWT_AUDIENCE,
    });
    return buildPrincipalFromClaims(claims, options);
  }
  if (options.allowLegacyHeaders) {
    return {
      tenantId: req.headers['x-tenant-id'] || null,
      actorId: req.headers['x-actor-id'] || null,
      roles: String(req.headers['x-roles'] || '').split(',').map(v => v.trim()).filter(Boolean),
      authType: 'legacy-header',
    };
  }
  return null;
}

function createErrorResponse(error, requestId) {
  return {
    error: {
      code: error.code || 'internal_error',
      message: error.message || 'Internal server error',
      details: error.details || undefined,
      request_id: requestId,
    },
  };
}

function createHttpError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeError(error) {
  if (error?.statusCode) return error;
  const normalized = new Error(error?.message || 'Internal server error');
  normalized.statusCode = 500;
  normalized.code = error?.code || 'internal_error';
  normalized.details = error?.details;
  return normalized;
}

function requireTenantAccess(req, options) {
  try {
    const context = getRequestContext(req, options);
    if (!context?.tenantId || !context?.actorId) {
      throw createHttpError(401, 'missing_auth_context', 'Bearer token with tenant and actor claims is required');
    }
    return context;
  } catch (error) {
    if (!error.statusCode) {
      throw createHttpError(401, 'invalid_token', error.message);
    }
    throw error;
  }
}

function requirePermission(context, permission) {
  if (!authorize(context, permission)) {
    throw createHttpError(403, 'forbidden', `missing permission: ${permission}`, { permission });
  }
}

function hasAnyRole(context, roles = []) {
  return roles.some(role => context?.roles?.includes(role));
}

function formatActor(actorId, fallbackLabel = 'Unassigned') {
  if (!actorId) {
    return { id: null, label: fallbackLabel, kind: 'unassigned' };
  }

  return {
    id: actorId,
    label: actorId,
    kind: 'assigned',
  };
}

function inferTaskStatus(summary) {
  if (summary?.closed || summary?.current_stage === 'DONE') return 'done';
  if (summary?.blocked) return 'blocked';
  if (summary?.waiting_state) return 'waiting';
  return 'active';
}

function toSentenceCase(value) {
  return String(value || '')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

function formatDurationFromMs(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  const minutes = Math.floor(value / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

function lastDefinedPayloadValue(history = [], keys = []) {
  for (const event of history) {
    const payload = event?.payload || {};
    for (const key of keys) {
      if (payload[key] != null && payload[key] !== '') return payload[key];
    }
  }
  return null;
}

function normalizeMultilineList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatSpecSectionValue(value) {
  if (Array.isArray(value)) {
    return value.join('\n');
  }
  return String(value || '').trim();
}

function findLatestArchitectHandoff(history = []) {
  return history.find((event) => event?.event_type === 'task.architect_handoff_recorded') || null;
}

function architectHandoffFromEvent(event) {
  if (!event) return null;
  const payload = event.payload || {};
  return {
    version: Number(payload.version) || 1,
    readyForEngineering: Boolean(payload.ready_for_engineering),
    engineerTier: payload.engineer_tier || null,
    tierRationale: payload.tier_rationale || '',
    technicalSpec: {
      summary: payload.technical_spec?.summary || '',
      scope: payload.technical_spec?.scope || '',
      design: payload.technical_spec?.design || '',
      rolloutPlan: payload.technical_spec?.rolloutPlan || '',
    },
    monitoringSpec: {
      service: payload.monitoring_spec?.service || '',
      dashboardUrls: normalizeMultilineList(payload.monitoring_spec?.dashboardUrls),
      alertPolicies: normalizeMultilineList(payload.monitoring_spec?.alertPolicies),
      runbook: payload.monitoring_spec?.runbook || '',
      successMetrics: normalizeMultilineList(payload.monitoring_spec?.successMetrics),
    },
    submittedAt: event.occurred_at || null,
    submittedBy: event.actor_id || null,
  };
}

function formatArchitectHandoffTechnicalSpec(handoff) {
  if (!handoff) return null;
  return TECHNICAL_SPEC_FIELDS
    .map((field) => formatSpecSectionValue(handoff.technicalSpec?.[field]))
    .filter(Boolean)
    .join('\n\n');
}

function formatArchitectHandoffMonitoringSpec(handoff) {
  if (!handoff) return null;
  return MONITORING_SPEC_FIELDS
    .map((field) => formatSpecSectionValue(handoff.monitoringSpec?.[field]))
    .filter(Boolean)
    .join('\n\n');
}

function findLatestEngineerSubmission(history = []) {
  return history.find((event) => event?.event_type === 'task.engineer_submission_recorded') || null;
}

function normalizeCommitSha(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizePrUrl(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function engineerSubmissionFromEvent(event) {
  if (!event) return null;
  const payload = event.payload || {};
  return {
    version: Number(payload.version) || 1,
    commitSha: payload.commit_sha || '',
    prUrl: payload.pr_url || '',
    primaryReference: payload.primary_reference || null,
    preview: payload.preview || null,
    submittedAt: event.occurred_at || null,
    submittedBy: event.actor_id || null,
  };
}

function lastQaResultEvent(history = []) {
  return history.find((event) => event?.event_type === 'task.qa_result_recorded') || null;
}

function hasMutationPermission(context) {
  return authorize(context, 'events:write') || authorize(context, 'assignment:write');
}

function requireMutationPermission(context) {
  if (!hasMutationPermission(context)) {
    throw createHttpError(403, 'forbidden', 'missing permission: events:write or assignment:write');
  }
}

function buildLockError(lock) {
  return createHttpError(409, 'task_locked', `This task is currently locked by ${lock.ownerId}. Refresh to see the latest state or retry after the lock expires.`, {
    lock: {
      owner_id: lock.ownerId,
      acquired_at: lock.acquiredAt,
      expires_at: lock.expiresAt,
      reason: lock.reason || null,
      action: lock.action || null,
    },
  });
}

function isArchitectReadOnlyCheckIn(input = {}) {
  if (input.resource !== 'events') return false;
  if (input.eventType !== 'task.comment_workflow_recorded') return false;
  return String(input.payload?.comment_type || '').trim().toLowerCase() === 'architect_check_in';
}

async function assertTaskUnlockedForMutation({ store, taskId, tenantId, actorId, resource, eventType, payload, options, requestBody }) {
  if (isArchitectReadOnlyCheckIn({ resource, eventType, payload: requestBody?.payload || payload })) {
    return null;
  }

  const state = await store.getTaskCurrentState(taskId, { tenantId });
  if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
  const activeLock = getActiveTaskLock(state);
  if (!activeLock) return null;
  if (activeLock.ownerId === actorId) return activeLock;

  if (options) {
    try {
      await store.appendEvent({
        taskId,
        tenantId,
        eventType: 'task.lock_conflict',
        actorId,
        actorType: 'user',
        idempotencyKey: `${resource || 'mutation'}-lock-conflict:${taskId}:${actorId}:${state.last_event_id || 'initial'}`,
        payload: {
          requested_by: actorId,
          resource: resource || 'mutation',
          blocking_owner_id: activeLock.ownerId,
          lock_expires_at: activeLock.expiresAt,
        },
        source: 'http',
      });
    } catch {}
  }
  throw buildLockError(activeLock);
}

function validateWorkflowThreadBody(body = {}) {
  const title = String(body.title || '').trim();
  const threadBody = String(body.body || '').trim();
  const commentType = normalizeCommentType(body.commentType);
  if (!title) {
    throw createHttpError(400, 'missing_thread_title', 'Workflow thread title is required.');
  }
  if (!threadBody) {
    throw createHttpError(400, 'missing_thread_body', 'Workflow thread body is required.');
  }
  return {
    title,
    body: threadBody,
    comment_type: commentType,
    blocking: body.blocking === true,
    linked_event_id: String(body.linkedEventId || '').trim() || null,
    notification_targets: normalizeThreadArray(body.notificationTargets).length
      ? normalizeThreadArray(body.notificationTargets)
      : defaultNotificationTargets(commentType, body.blocking === true),
  };
}

function validateWorkflowThreadReplyBody(body = {}, action) {
  const text = String(body.body || body.resolution || '').trim();
  if (!text) {
    throw createHttpError(400, 'missing_thread_message', `${action} text is required.`);
  }
  return text;
}

function buildQaEscalationPackage({ taskId, summary, architectHandoff, implementationHistory, latestFailedQa, body, context }) {
  const findings = normalizeQaArray(body.findings);
  const reproductionSteps = normalizeQaArray(body.reproductionSteps);
  const stackTraces = normalizeQaArray(body.stackTraces);
  const envLogs = normalizeQaArray(body.envLogs);
  const scenarios = normalizeQaArray(body.scenarios);
  const recipientAgentId = summary.current_owner || null;
  const recipientRole = 'engineer';
  const requiredEngineerTier = architectHandoff?.engineerTier || null;
  const escalationChain = latestFailedQa ? ['qa', 'engineer', 'pm'] : ['qa', 'engineer'];

  return {
    task_id: taskId,
    summary: String(body.summary || '').trim(),
    failing_scenarios: scenarios,
    findings,
    reproduction_steps: reproductionSteps,
    stack_traces: stackTraces,
    env_logs: envLogs,
    pm_requirements: {
      business_context: summary.business_context || null,
      acceptance_criteria: Array.isArray(summary.acceptance_criteria) ? summary.acceptance_criteria : [],
      definition_of_done: Array.isArray(summary.definition_of_done) ? summary.definition_of_done : [],
    },
    architect_context: architectHandoff
      ? {
          engineer_tier: architectHandoff.engineerTier,
          tier_rationale: architectHandoff.tierRationale,
          technical_spec: architectHandoff.technicalSpec,
          monitoring_spec: architectHandoff.monitoringSpec,
        }
      : null,
    previous_fix_history: implementationHistory.map((entry) => ({
      version: entry.version,
      primary_reference: entry.primaryReference,
      commit_sha: entry.commitSha || null,
      pr_url: entry.prUrl || null,
      submitted_at: entry.submittedAt,
      submitted_by: entry.submittedBy,
    })),
    routing: {
      recipient_role: recipientRole,
      recipient_agent_id: recipientAgentId,
      required_engineer_tier: requiredEngineerTier,
      escalation_chain: escalationChain,
    },
    notification_preview: {
      headline: `QA ${body.outcome === 'fail' ? 'failure' : 'update'} for ${taskId}`,
      recipient_role: recipientRole,
      recipient_agent_id: recipientAgentId,
      required_engineer_tier: requiredEngineerTier,
      highlights: [
        String(body.summary || '').trim(),
        reproductionSteps[0] || null,
        scenarios[0] || null,
      ].filter(Boolean),
      collapsed_sections: {
        stack_trace_count: stackTraces.length,
        env_log_count: envLogs.length,
      },
      escalation_chain: escalationChain,
    },
    attachment_strategy: {
      stack_traces: stackTraces.length > 5 ? 'collapsed_after_summary' : 'inline_summary',
      env_logs: envLogs.length > 5 ? 'collapsed_after_summary' : 'inline_summary',
    },
    generated_by: context.actorId,
  };
}

async function releaseActiveLockAfterTransition({
  store,
  taskId,
  tenantId,
  actorId,
  actorType = 'user',
  source = 'http',
  idempotencyKey,
}) {
  const state = await store.getTaskCurrentState(taskId, { tenantId });
  const activeLock = getActiveTaskLock(state);
  if (!activeLock || activeLock.ownerId !== actorId) return null;
  return store.appendEvent({
    taskId,
    tenantId,
    eventType: 'task.lock_released',
    actorId,
    actorType,
    idempotencyKey,
    payload: {
      owner_id: activeLock.ownerId,
      released_by: actorId,
      release_reason: 'transition_completed',
    },
    source,
  });
}

function validateQaResultBody(body = {}) {
  const outcome = String(body.outcome || '').trim().toLowerCase();
  if (!['pass', 'fail'].includes(outcome)) {
    throw createHttpError(400, 'invalid_qa_outcome', 'QA outcome must be pass or fail.');
  }
  const summary = String(body.summary || '').trim();
  if (!summary) {
    throw createHttpError(400, 'missing_qa_summary', 'QA summary is required.');
  }

  const normalized = {
    outcome,
    summary,
    scenarios: normalizeQaArray(body.scenarios),
    findings: normalizeQaArray(body.findings),
    reproduction_steps: normalizeQaArray(body.reproductionSteps),
    stack_traces: normalizeQaArray(body.stackTraces),
    env_logs: normalizeQaArray(body.envLogs),
    retest_scope: normalizeQaArray(body.retestScope),
  };

  if (outcome === 'fail') {
    const missingFields = [];
    if (!normalized.scenarios.length) missingFields.push('scenarios');
    if (!normalized.findings.length) missingFields.push('findings');
    if (!normalized.reproduction_steps.length) missingFields.push('reproductionSteps');
    if (!normalized.stack_traces.length) missingFields.push('stackTraces');
    if (!normalized.env_logs.length) missingFields.push('envLogs');
    if (missingFields.length) {
      throw createHttpError(400, 'missing_qa_failure_context', 'Failing QA submissions require scenarios, findings, reproduction steps, stack traces, and environment logs.', {
        missing_fields: missingFields,
      });
    }
  }

  return normalized;
}

function validateEngineerSubmissionBody(body = {}) {
  const commitSha = normalizeCommitSha(body.commitSha);
  const prUrl = normalizePrUrl(body.prUrl);
  const missingFields = [];
  const invalidFields = [];

  if (!commitSha && !prUrl) {
    missingFields.push('commitShaOrPrUrl');
  }
  if (commitSha && !COMMIT_SHA_PATTERN.test(commitSha)) {
    invalidFields.push('commitSha');
  }
  if (prUrl && !GITHUB_PR_URL_PATTERN.test(prUrl)) {
    invalidFields.push('prUrl');
  }

  if (missingFields.length) {
    throw createHttpError(400, 'missing_required_engineer_metadata', 'Engineer submission requires a commit SHA or GitHub PR URL before QA handoff.', { missing_fields: missingFields });
  }
  if (invalidFields.length) {
    throw createHttpError(400, 'invalid_engineer_metadata', 'Engineer submission metadata must use an accepted commit SHA or GitHub PR URL format.', { invalid_fields: invalidFields });
  }

  const primaryReference = prUrl
    ? { type: 'pr_url', label: prUrl, value: prUrl }
    : { type: 'commit_sha', label: commitSha, value: commitSha };

  return {
    commit_sha: commitSha,
    pr_url: prUrl,
    primary_reference: primaryReference,
    preview: {
      commitSha: commitSha || null,
      prUrl: prUrl || null,
      acceptedFormats: {
        commitSha: '7-40 hexadecimal characters',
        prUrl: 'https://github.com/<owner>/<repo>/pull/<number>',
      },
    },
  };
}

function validateArchitectHandoffBody(body = {}) {
  const technicalSpec = body.technicalSpec || {};
  const monitoringSpec = body.monitoringSpec || {};
  const engineerTier = String(body.engineerTier || '').trim();
  const tierRationale = String(body.tierRationale || '').trim();
  const readyForEngineering = body.readyForEngineering === true;

  const missingFields = [];
  for (const field of TECHNICAL_SPEC_FIELDS) {
    if (!String(technicalSpec[field] || '').trim()) missingFields.push(`technicalSpec.${field}`);
  }
  for (const field of MONITORING_SPEC_FIELDS) {
    const value = field === 'service' || field === 'runbook'
      ? String(monitoringSpec[field] || '').trim()
      : normalizeMultilineList(monitoringSpec[field]);
    if (!value || (Array.isArray(value) && !value.length)) missingFields.push(`monitoringSpec.${field}`);
  }
  if (!ENGINEER_TIERS.includes(engineerTier)) missingFields.push('engineerTier');
  if (!tierRationale) missingFields.push('tierRationale');
  if (!readyForEngineering) missingFields.push('readyForEngineering');

  if (missingFields.length) {
    throw createHttpError(400, 'missing_required_architect_fields', 'Architect handoff requires all technical, monitoring, and tier fields before engineering can start.', { missing_fields: missingFields });
  }

  return {
    ready_for_engineering: true,
    engineer_tier: engineerTier,
    tier_rationale: tierRationale,
    technical_spec: {
      summary: String(technicalSpec.summary).trim(),
      scope: String(technicalSpec.scope).trim(),
      design: String(technicalSpec.design).trim(),
      rolloutPlan: String(technicalSpec.rolloutPlan).trim(),
    },
    monitoring_spec: {
      service: String(monitoringSpec.service).trim(),
      dashboardUrls: normalizeMultilineList(monitoringSpec.dashboardUrls),
      alertPolicies: normalizeMultilineList(monitoringSpec.alertPolicies),
      runbook: String(monitoringSpec.runbook).trim(),
      successMetrics: normalizeMultilineList(monitoringSpec.successMetrics),
    },
  };
}

function normalizeLinkedPr(entry, fallbackTaskId) {
  if (entry == null) return null;
  if (typeof entry === 'string' || typeof entry === 'number') {
    return {
      id: String(entry),
      number: typeof entry === 'number' || /^\d+$/.test(String(entry)) ? Number(entry) : null,
      title: `PR ${entry}`,
      url: null,
      repository: null,
      state: 'open',
      merged: false,
      draft: false,
      targetTaskId: fallbackTaskId || null,
    };
  }

  const id = entry.id || entry.pr_id || entry.url || (entry.number != null ? `pr-${entry.number}` : null);
  if (!id) return null;

  const state = String(entry.state || entry.status || (entry.merged ? 'merged' : 'open')).toLowerCase();
  return {
    id: String(id),
    number: entry.number != null ? Number(entry.number) : null,
    title: entry.title || (entry.number != null ? `PR #${entry.number}` : 'Linked pull request'),
    url: entry.url || entry.html_url || null,
    repository: entry.repository || entry.repo || null,
    state,
    merged: Boolean(entry.merged || state === 'merged'),
    draft: Boolean(entry.draft),
    targetTaskId: entry.task_id || entry.taskId || fallbackTaskId || null,
  };
}

function collectLinkedPrs(history = [], relationships = {}, taskId) {
  const candidates = [];
  const relationshipPrs = Array.isArray(relationships?.linked_prs) ? relationships.linked_prs : [];
  candidates.push(...relationshipPrs.map((entry) => normalizeLinkedPr(entry, taskId)));

  for (const event of history) {
    const payload = event?.payload || {};
    const payloadPrs = [
      ...(Array.isArray(payload.linked_prs) ? payload.linked_prs : []),
      ...(Array.isArray(payload.linkedPrs) ? payload.linkedPrs : []),
      ...(Array.isArray(payload.pull_requests) ? payload.pull_requests : []),
      ...(Array.isArray(payload.pullRequests) ? payload.pullRequests : []),
    ];
    if (payload.linked_pr) payloadPrs.push(payload.linked_pr);
    if (payload.linkedPr) payloadPrs.push(payload.linkedPr);
    if (payload.pull_request) payloadPrs.push(payload.pull_request);
    if (payload.pullRequest) payloadPrs.push(payload.pullRequest);
    if (payload.pr_number != null || payload.pr_url || payload.pr_title) {
      payloadPrs.push({ number: payload.pr_number, url: payload.pr_url, title: payload.pr_title, state: payload.pr_state, merged: payload.pr_merged, repository: payload.pr_repository });
    }
    candidates.push(...payloadPrs.map((entry) => normalizeLinkedPr(entry, taskId)));
  }

  const deduped = new Map();
  for (const pr of candidates.filter(Boolean)) {
    deduped.set(pr.id, { ...(deduped.get(pr.id) || {}), ...pr });
  }
  return [...deduped.values()];
}

function summarizePrStatus(linkedPrs = []) {
  if (!linkedPrs.length) return { label: 'No linked PRs', state: 'empty', total: 0, mergedCount: 0, openCount: 0, draftCount: 0 };
  const mergedCount = linkedPrs.filter((pr) => pr.merged).length;
  const draftCount = linkedPrs.filter((pr) => pr.draft).length;
  const openCount = linkedPrs.filter((pr) => !pr.merged && pr.state !== 'closed').length;
  const state = mergedCount === linkedPrs.length ? 'done' : draftCount ? 'draft' : openCount ? 'active' : 'mixed';
  const label = mergedCount === linkedPrs.length
    ? `${mergedCount} linked PRs merged`
    : draftCount
      ? `${draftCount} draft PR${draftCount === 1 ? '' : 's'} in progress`
      : openCount
        ? `${openCount} open PR${openCount === 1 ? '' : 's'} linked`
        : `${linkedPrs.length} linked PRs`;
  return { label, state, total: linkedPrs.length, mergedCount, openCount, draftCount };
}

function summarizeTaskForDetail(taskId, state, history = []) {
  const createdEvent = history.find(event => event.event_type === 'task.created');
  const newestEvent = history[0] || null;
  const latestPayload = newestEvent?.payload || {};
  const title = createdEvent?.payload?.title || latestPayload.title || taskId;
  const now = Date.now();
  const lastOccurredAt = state?.last_occurred_at || newestEvent?.occurred_at || null;
  const ageMs = lastOccurredAt ? Math.max(0, now - Date.parse(lastOccurredAt)) : null;
  const freshnessStatus = ageMs == null
    ? 'unknown'
    : ageMs > 5 * 60 * 1000
      ? 'stale'
      : 'fresh';
  const reviewQuestions = deriveReviewQuestions(history);
  const hasBlockingReviewQuestions = reviewQuestions.summary.unresolvedBlockingCount > 0;

  return {
    task_id: taskId,
    tenant_id: state.tenant_id,
    title,
    priority: state.priority,
    current_stage: state.current_stage,
    current_owner: state.assignee,
    owner: state.assignee
      ? {
          actor_id: state.assignee,
          display_name: state.assignee,
        }
      : null,
    blocked: Boolean(state.blocked) || hasBlockingReviewQuestions,
    waiting_state: hasBlockingReviewQuestions ? 'pm_review_question_resolution' : latestPayload.waiting_state || null,
    next_required_action: hasBlockingReviewQuestions ? 'Resolve blocking architect review questions' : latestPayload.next_required_action || null,
    freshness: {
      status: freshnessStatus,
      last_updated_at: lastOccurredAt,
    },
    status_indicator: freshnessStatus,
    status: {
      blocked: Boolean(state.blocked) || hasBlockingReviewQuestions,
      waiting_state: hasBlockingReviewQuestions ? 'pm_review_question_resolution' : latestPayload.waiting_state || null,
      closed: Boolean(state.closed),
      freshness: freshnessStatus,
    },
    closed: Boolean(state.closed),
    business_context: createdEvent?.payload?.business_context || null,
    acceptance_criteria: createdEvent?.payload?.acceptance_criteria || null,
    definition_of_done: createdEvent?.payload?.definition_of_done || null,
    task_type: createdEvent?.payload?.task_type || null,
    lock: getActiveTaskLock(state),
    latest_qa_outcome: state.latest_qa_outcome || null,
  };
}

function summarizeTaskForList(summary) {
  return {
    task_id: summary.task_id,
    tenant_id: summary.tenant_id,
    title: summary.title,
    priority: summary.priority,
    current_stage: summary.current_stage,
    current_owner: summary.current_owner,
    owner: summary.owner,
    blocked: Boolean(summary.blocked),
    closed: Boolean(summary.closed),
    waiting_state: summary.waiting_state || null,
    next_required_action: summary.next_required_action || null,
    queue_entered_at: summary.queue_entered_at || null,
    wip_owner: summary.wip_owner || null,
    wip_started_at: summary.wip_started_at || null,
    freshness: summary.freshness,
  };
}

function isTaskDetailPageEnabled() {
  const rawValue = String(process.env.FF_TASK_DETAIL_PAGE ?? '1').trim().toLowerCase();
  return rawValue !== '0' && rawValue !== 'false' && rawValue !== 'off';
}

function buildTaskDetailViewModel({ taskId, summary, relationships, history, telemetry, childTaskSummaries = [], context }) {
  const status = inferTaskStatus(summary);
  const newestEvent = history[0] || null;
  const createdEvent = history.find(event => event.event_type === 'task.created');
  const canViewHistory = authorize(context, 'history:read');
  const reviewQuestions = deriveReviewQuestions(history);
  const workflowThreads = deriveWorkflowThreads(history);
  const canViewRelationships = authorize(context, 'relationships:read');
  const canViewTelemetry = authorize(context, 'observability:read');
  const canViewLinkedPrMetadata = canViewRelationships;
  const linkedPrs = canViewLinkedPrMetadata ? collectLinkedPrs(history, relationships, taskId) : [];
  const prStatus = summarizePrStatus(linkedPrs);
  const architectHandoff = architectHandoffFromEvent(findLatestArchitectHandoff(history));
  const implementationHistory = deriveImplementationHistory(history);
  const engineerSubmission = engineerSubmissionFromEvent(findLatestEngineerSubmission(history));
  const qaResults = deriveQaResults(history);
  const technicalSpec = formatArchitectHandoffTechnicalSpec(architectHandoff) || lastDefinedPayloadValue(history, ['technical_spec', 'technicalSpec']);
  const monitoringSpec = formatArchitectHandoffMonitoringSpec(architectHandoff) || lastDefinedPayloadValue(history, ['monitoring_spec', 'monitoringSpec']);
  const queueStartedAt = summary.queue_entered_at || createdEvent?.occurred_at || null;
  const blockerEvents = history.filter(event => event.event_type === 'task.blocked');
  const commentEvents = canViewHistory ? history.filter(event => event.event_type === 'task.comment_workflow_recorded') : [];
  const childTasks = canViewRelationships ? childTaskSummaries.map((child) => ({
    id: child.task_id,
    title: child.title || child.task_id,
    stage: child.current_stage || null,
    status: inferTaskStatus(child),
    owner: formatActor(child.current_owner),
    blocked: Boolean(child.blocked),
  })) : [];
  const blockedChildren = childTasks.filter((child) => child.status === 'blocked');
  const childStatus = childTasks.length
    ? blockedChildren.length
      ? 'blocked'
      : childTasks.every((child) => child.status === 'done')
        ? 'done'
        : childTasks.some((child) => child.status === 'waiting')
          ? 'waiting'
          : 'active'
    : 'empty';
  const blockers = blockerEvents.map((event) => {
    const ageMs = event.occurred_at ? Math.max(0, Date.now() - Date.parse(event.occurred_at)) : null;
    return {
      id: event.event_id,
      type: event.payload?.blocker_type || event.payload?.waiting_state || 'workflow_blocker',
      label: event.payload?.summary || event.payload?.reason || 'Task is blocked',
      source: blockedChildren.some((child) => child.id === event.payload?.child_task_id)
        ? 'child_task'
        : event.payload?.external_dependency
          ? 'external_dependency'
          : event.payload?.review_required
            ? 'review'
            : event.payload?.approval_required
              ? 'approval'
              : summary.waiting_state || 'workflow',
      owner: formatActor(event.payload?.owner_id || null, 'No blocker owner'),
      ageLabel: formatDurationFromMs(ageMs) || 'Unknown age',
      occurredAt: event.occurred_at || null,
    };
  });

  return {
    task: {
      id: summary.task_id,
      title: summary.title,
      priority: summary.priority,
      stage: summary.current_stage,
      status,
    },
    summary: {
      owner: formatActor(summary.current_owner),
      workflowStage: {
        value: summary.current_stage,
        label: summary.current_stage ? toSentenceCase(summary.current_stage) : 'Unknown stage',
      },
      nextAction: {
        label: summary.next_required_action || 'No next step defined',
        source: summary.next_required_action ? 'system' : 'none',
        overdue: telemetry?.freshness?.status === 'stale',
        waitingOn: summary.waiting_state ? toSentenceCase(summary.waiting_state) : null,
      },
      prStatus,
      childStatus: {
        label: childTasks.length ? `${childTasks.length} linked child tasks` : 'No child tasks',
        state: childStatus,
        total: childTasks.length,
        blockedCount: blockedChildren.length,
      },
      timers: {
        queueEnteredAt: queueStartedAt,
        queueAgeLabel: queueStartedAt ? formatDurationFromMs(Math.max(0, Date.now() - Date.parse(queueStartedAt))) : 'Not started',
        lastUpdatedAt: summary.freshness?.last_updated_at || null,
        freshness: summary.freshness?.status || 'unknown',
      },
      blockedState: {
        isBlocked: status === 'blocked' || workflowThreads.summary.unresolvedBlockingCount > 0,
        label: status === 'blocked' || workflowThreads.summary.unresolvedBlockingCount > 0 ? 'Blocked' : status === 'waiting' ? 'Waiting' : status === 'done' ? 'Done' : 'Active',
        waitingOn: reviewQuestions.summary.unresolvedBlockingCount > 0
          ? 'PM review question resolution'
          : workflowThreads.summary.unresolvedBlockingCount > 0
            ? 'Workflow thread resolution'
            : summary.waiting_state ? toSentenceCase(summary.waiting_state) : null,
      },
    },
    reviewQuestions: {
      summary: reviewQuestions.summary,
      pinned: canViewHistory
        ? reviewQuestions.items
            .filter((item) => item.blocking && item.state !== REVIEW_QUESTION_STATES.RESOLVED)
            .map((item) => ({ id: item.id, prompt: item.prompt, state: item.state }))
        : [],
      items: canViewHistory
        ? reviewQuestions.items.map((item) => ({
            id: item.id,
            prompt: item.prompt,
            blocking: item.blocking,
            state: item.state,
            createdAt: item.createdAt,
            createdBy: item.createdBy,
            answer: item.answer,
            resolution: item.resolution,
            resolvedAt: item.resolvedAt,
            resolvedBy: item.resolvedBy,
            lastUpdatedAt: item.lastUpdatedAt,
            messages: item.messages,
          }))
        : [],
    },
    blockers,
    context: {
      businessContext: summary.business_context || null,
      acceptanceCriteria: Array.isArray(summary.acceptance_criteria)
        ? summary.acceptance_criteria
        : String(summary.acceptance_criteria || '')
            .split(/\n+/)
            .map((entry) => entry.trim())
            .filter(Boolean),
      definitionOfDone: Array.isArray(summary.definition_of_done)
        ? summary.definition_of_done
        : String(summary.definition_of_done || '')
            .split(/\n+/)
            .map((entry) => entry.trim())
            .filter(Boolean),
      technicalSpec,
      monitoringSpec,
      architectHandoff,
      engineerSubmission,
      implementationHistory,
      qaResults,
    },
    relations: {
      linkedPrs,
      childTasks,
    },
    activity: {
      comments: commentEvents.slice(0, 10).map((event) => ({
        id: event.event_id,
        actor: formatActor(event.actor_id, event.actor_id || 'Unknown actor'),
        summary: event.summary,
        body: event.payload?.body || null,
        occurredAt: event.occurred_at,
      })),
      workflowThreads: canViewHistory
        ? workflowThreads
        : { items: [], summary: { total: 0, unresolvedCount: 0, unresolvedBlockingCount: 0, resolvedCount: 0 } },
      auditLog: canViewHistory ? history.slice(0, 20).map((event) => ({
        id: event.event_id,
        type: event.event_type,
        summary: event.summary,
        actor: formatActor(event.actor_id, event.actor_id || 'Unknown actor'),
        occurredAt: event.occurred_at,
      })) : [],
    },
    telemetry: !canViewTelemetry
      ? {
          availability: 'restricted',
          lastUpdatedAt: null,
          summary: {},
          emptyStateReason: 'Telemetry is hidden for this session.',
          access: {
            restricted: true,
            scope: 'none',
            omission_applied: true,
            omitted_fields: ['telemetry'],
          },
        }
      : telemetry
        ? {
            availability: telemetry.access?.restricted ? 'restricted' : telemetry.degraded ? 'stale' : telemetry.event_count ? 'available' : 'empty',
            lastUpdatedAt: telemetry.last_updated_at || null,
            summary: telemetry.key_signals || {},
            emptyStateReason: telemetry.event_count ? null : 'No telemetry signals are linked to this task yet.',
            access: telemetry.access,
          }
        : {
            availability: 'error',
            lastUpdatedAt: null,
            summary: {},
            emptyStateReason: 'Telemetry unavailable.',
            access: null,
          },
    meta: {
      lock: summary.lock
        ? {
            ownerId: summary.lock.ownerId,
            acquiredAt: summary.lock.acquiredAt,
            expiresAt: summary.lock.expiresAt,
            reason: summary.lock.reason,
            action: summary.lock.action,
          }
        : null,
      permissions: {
        canViewComments: canViewHistory,
        canViewAuditLog: canViewHistory,
        canViewTelemetry: canViewTelemetry,
        canViewChildTasks: canViewRelationships,
        canViewLinkedPrMetadata,
      },
      freshness: {
        status: summary.freshness?.status || 'unknown',
        lastUpdatedAt: summary.freshness?.last_updated_at || null,
        liveUpdates: false,
        refreshBehavior: 'manual_refresh',
      },
    },
  };
}

function toTelemetryResponse(summary, context) {
  const privileged = hasAnyRole(context, ['admin', 'sre', 'contributor']);
  const base = {
    task_id: summary.task_id,
    tenant_id: summary.tenant_id,
    status: summary.status,
    last_updated_at: summary.last_updated_at,
    freshness: summary.freshness,
    degraded: summary.degraded,
    event_count: summary.event_count,
    stale: summary.freshness?.status === 'stale',
    key_signals: summary.key_signals,
    correlation: {
      approved_correlation_ids: summary.approved_correlation_ids || [],
      approved_links: summary.approved_links || [],
    },
    access: {
      restricted: !privileged,
      scope: privileged ? 'operator' : 'summary_only',
      omission_applied: !privileged,
      omitted_fields: privileged ? [] : ['trace_ids', 'metrics', 'privileged_links'],
    },
  };

  if (privileged) {
    return {
      ...base,
      last_event_id: summary.last_event_id,
      last_event_type: summary.last_event_type,
      current_stage: summary.current_stage,
      correlation_ids: summary.correlation_ids,
      trace_ids: summary.trace_ids,
      metrics: summary.metrics,
      links: summary.privileged_links || [],
    };
  }

  return base;
}

function normalizeHistoryItem(item) {
  return {
    item_id: item.event_id,
    event_id: item.event_id,
    tenant_id: item.tenant_id,
    event_type: item.event_type,
    event_type_label: item.event_type,
    occurred_at: item.occurred_at,
    recorded_at: item.recorded_at,
    actor: {
      actor_id: item.actor_id,
      actor_type: item.actor_type,
      display_name: item.actor_id,
    },
    actor_id: item.actor_id,
    actor_type: item.actor_type,
    sequence_number: item.sequence_number,
    summary: item.summary,
    display: {
      summary: item.summary,
      event_type_label: item.event_type,
      is_known_type: isWorkflowAuditEventType(item.event_type),
      fallback_used: !isWorkflowAuditEventType(item.event_type),
    },
    correlation: item.correlation_id || item.trace_id
      ? {
          correlation_id: item.correlation_id || null,
          trace_id: item.trace_id || null,
        }
      : null,
    source: item.source,
    payload: item.payload,
  };
}

function wantsPaginatedHistory(url) {
  return url.searchParams.has('limit') || url.searchParams.has('cursor');
}

function buildPaginatedHistoryResponse(items, limit) {
  const boundedLimit = Number.isFinite(limit) ? limit : items.length;
  const last = items.at(-1) || null;
  return {
    items: items.map(normalizeHistoryItem),
    page_info: {
      limit: boundedLimit,
      next_cursor: items.length === boundedLimit && last ? String(last.sequence_number) : null,
      has_more: items.length === boundedLimit,
    },
  };
}

function formatAssignmentOwner(agent) {
  if (!agent) return null;
  return {
    agentId: agent.id,
    displayName: agent.display_name,
    role: agent.role,
  };
}

function createAssignmentIdempotencyKey(req, taskId, state, agentId) {
  return req.headers['idempotency-key']
    || req.headers['x-idempotency-key']
    || `assignment:${taskId}:${agentId || 'unassigned'}:${state?.last_event_id || 'initial'}`;
}

function normalizeRoutePath(pathname = '') {
  if (pathname === '/api' || pathname === '/api/') return '/';
  return pathname.startsWith('/api/') ? pathname.slice(4) || '/' : pathname;
}

function createReviewQuestionId() {
  return `rq-${crypto.randomUUID().slice(0, 8)}`;
}

function requireTrustedBrowserAuthCode(authCode, options = {}) {
  const raw = String(authCode || '').trim();
  if (!raw) {
    throw createHttpError(400, 'missing_auth_code', 'The authCode field is required.');
  }

  try {
    return verifyBrowserAuthCode(
      raw,
      options.browserAuthCodeSecret || process.env.AUTH_BROWSER_AUTH_CODE_SECRET || options.jwtSecret || process.env.AUTH_JWT_SECRET,
      {
        issuer: options.browserAuthCodeIssuer || process.env.AUTH_BROWSER_AUTH_CODE_ISSUER,
        audience: options.browserAuthCodeAudience || process.env.AUTH_BROWSER_AUTH_CODE_AUDIENCE,
      },
    );
  } catch {
    throw createHttpError(401, 'invalid_auth_code', 'The sign-in code is invalid, expired, or untrusted.');
  }
}

function canAskReviewQuestion(context) {
  return hasAnyRole(context, ['architect', 'admin']);
}

function canAnswerReviewQuestion(context) {
  return hasAnyRole(context, ['pm', 'admin']);
}

function canResolveReviewQuestion(context) {
  return hasAnyRole(context, ['pm', 'admin']);
}

function canReopenReviewQuestion(context) {
  return hasAnyRole(context, ['pm', 'admin', 'architect']);
}

function canManageArchitectHandoff(context) {
  return hasAnyRole(context, ['architect', 'admin']);
}

function canManageEngineerSubmission(context) {
  return hasAnyRole(context, ['engineer', 'admin']);
}

async function loadReviewQuestionContext(store, taskId, tenantId, questionId) {
  const [state, history] = await Promise.all([
    store.getTaskCurrentState(taskId, { tenantId }),
    store.getTaskHistory(taskId, { tenantId, limit: 500 }),
  ]);
  if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
  const questions = deriveReviewQuestions(history);
  const question = questionId ? questions.items.find((item) => item.id === questionId) : null;
  return { state, history, questions, question };
}

function reviewQuestionWorkflowPayload(questions, base = {}) {
  const unresolvedBlockingCount = questions.summary.unresolvedBlockingCount;
  return {
    ...base,
    blocked: unresolvedBlockingCount > 0,
    waiting_state: unresolvedBlockingCount > 0 ? 'pm_review_question_resolution' : null,
    next_required_action: unresolvedBlockingCount > 0 ? 'Resolve blocking architect review questions' : null,
  };
}

function createAuditApiServer(options = {}) {
  const store = options.store || createAuditStore(options);
  const logger = options.logger || createAuditLogger(options.baseDir || process.cwd());
  const agentRegistry = resolveAgentRegistry(options);
  const server = http.createServer(async (req, res) => {
    const requestId = req.headers['x-request-id'] || (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}`);
    const startedAt = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const routePath = normalizeRoutePath(url.pathname);

    try {
      if (routePath === '/healthz') {
        return sendJson(res, 200, { ok: true, backend: store.kind, ff_audit_foundation: isAuditFoundationEnabled(options) }, requestId);
      }

      if (routePath === '/auth/session' && req.method === 'POST') {
        const body = await parseJson(req);
        const { actorId, tenantId, roles } = requireTrustedBrowserAuthCode(body.authCode, options);
        const expiresAt = new Date(Date.now() + BROWSER_SESSION_TTL_SECONDS * 1000).toISOString();
        const claims = {
          sub: actorId,
          tenant_id: tenantId,
          roles,
          exp: Math.floor(Date.parse(expiresAt) / 1000),
        };
        const jwtIssuer = options.jwtIssuer || process.env.AUTH_JWT_ISSUER;
        const jwtAudience = options.jwtAudience || process.env.AUTH_JWT_AUDIENCE;
        if (jwtIssuer) claims.iss = jwtIssuer;
        if (jwtAudience) claims.aud = jwtAudience;

        return sendJson(res, 200, {
          success: true,
          data: {
            accessToken: signHmacJwt(claims, options.jwtSecret || process.env.AUTH_JWT_SECRET),
            expiresAt,
            claims: {
              tenant_id: tenantId,
              actor_id: actorId,
              roles,
            },
          },
        }, requestId);
      }

      if (!isAuditFoundationEnabled(options)) {
        throw createHttpError(503, 'feature_disabled', 'Audit foundation is disabled by ff_audit_foundation', { feature: 'ff_audit_foundation' });
      }

      if (routePath === '/metrics' && req.method === 'GET') {
        const context = requireTenantAccess(req, options);
        requirePermission(context, 'metrics:read');
        const metrics = store.readMetrics ? await store.readMetrics() : {};
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, resource: 'metrics', duration_ms: Date.now() - startedAt });
        return sendText(res, 200, toPrometheus(metrics), requestId);
      }

      if (routePath === '/projections/process' && req.method === 'POST') {
        const context = requireTenantAccess(req, options);
        requirePermission(context, 'projections:rebuild');
        if (!store.processProjectionQueue) throw createHttpError(501, 'not_supported', 'Projection processing is not supported by this store');
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, resource: 'projection_queue', limit: Number(url.searchParams.get('limit') || 100), duration_ms: Date.now() - startedAt });
        return sendJson(res, 202, await store.processProjectionQueue(Number(url.searchParams.get('limit') || 100)), requestId);
      }

      if (routePath === '/ai-agents' && req.method === 'GET') {
        const context = requireTenantAccess(req, options);
        requirePermission(context, 'agents:read');
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, resource: 'ai_agents', duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, { items: agentRegistry.filter(agent => agent.active) }, requestId);
      }

      if (routePath === '/tasks' && req.method === 'POST') {
        assertTaskCreationEnabled(options);
        const context = requireTenantAccess(req, options);
        requirePermission(context, 'tasks:create');
        const body = await parseJson(req);

        if (!body.title || !body.business_context || !body.acceptance_criteria || !body.definition_of_done || !body.priority || !body.task_type) {
          throw createHttpError(400, 'missing_required_fields', 'The following fields are required: title, business_context, acceptance_criteria, definition_of_done, priority, task_type');
        }

        const taskId = `TSK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const idempotencyKey = body.idempotencyKey || `create:${taskId}`;

        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.created',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey,
          payload: {
            title: body.title,
            business_context: body.business_context,
            acceptance_criteria: body.acceptance_criteria,
            definition_of_done: body.definition_of_done,
            priority: body.priority,
            task_type: body.task_type,
            initial_stage: 'DRAFT',
          },
          source: 'http',
        });

        logger.info({
          feature: 'ff_task_creation',
          action: 'task_created',
          outcome: 'success',
          request_id: requestId,
          task_id: taskId,
          tenant_id: context.tenantId,
          actor_id: context.actorId,
          duration_ms: Date.now() - startedAt,
        });

        return sendJson(res, 201, {
          taskId,
          status: 'DRAFT',
          createdAt: result.event.occurred_at,
        }, requestId);
      }
      if (routePath === '/tasks' && req.method === 'GET') {
        const context = requireTenantAccess(req, options);
        requirePermission(context, 'state:read');
        if (typeof store.listTaskSummaries !== 'function') {
          throw createHttpError(501, 'not_supported', 'Task list summaries are not supported by this store');
        }
        const items = await store.listTaskSummaries({ tenantId: context.tenantId });
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, resource: 'task_list', result_count: items.length, duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, { items: items.map(summarizeTaskForList) }, requestId);
      }

      const summaryMatch = routePath.match(/^\/tasks\/([^/]+)$/);
      const assignmentMatch = routePath.match(/^\/tasks\/([^/]+)\/assignment$/);
      const lockMatch = routePath.match(/^\/tasks\/([^/]+)\/lock$/);
      const architectHandoffMatch = routePath.match(/^\/tasks\/([^/]+)\/architect-handoff$/);
      const engineerSubmissionMatch = routePath.match(/^\/tasks\/([^/]+)\/engineer-submission$/);
      const workflowThreadsMatch = routePath.match(/^\/tasks\/([^/]+)\/workflow-threads$/);
      const workflowThreadActionMatch = routePath.match(/^\/tasks\/([^/]+)\/workflow-threads\/([^/]+)\/(replies|resolve|reopen)$/);
      const qaResultsMatch = routePath.match(/^\/tasks\/([^/]+)\/qa-results$/);
      const reviewQuestionsMatch = routePath.match(/^\/tasks\/([^/]+)\/review-questions$/);
      const reviewQuestionActionMatch = routePath.match(/^\/tasks\/([^/]+)\/review-questions\/([^/]+)\/(answers|resolve|reopen)$/);
      const resourceMatch = routePath.match(/^\/tasks\/([^/]+)\/(detail|events|history|state|relationships|observability-summary)$/);
      if (!summaryMatch && !resourceMatch && !assignmentMatch && !lockMatch && !architectHandoffMatch && !engineerSubmissionMatch && !workflowThreadsMatch && !workflowThreadActionMatch && !qaResultsMatch && !reviewQuestionsMatch && !reviewQuestionActionMatch) throw createHttpError(404, 'not_found', 'Route not found');
      const taskId = (summaryMatch || resourceMatch || assignmentMatch || lockMatch || architectHandoffMatch || engineerSubmissionMatch || workflowThreadsMatch || workflowThreadActionMatch || qaResultsMatch || reviewQuestionsMatch || reviewQuestionActionMatch)[1];
      const resource = assignmentMatch
        ? 'assignment'
        : lockMatch
          ? 'lock'
        : architectHandoffMatch
          ? 'architect-handoff'
        : engineerSubmissionMatch
          ? 'engineer-submission'
        : workflowThreadsMatch
          ? 'workflow-threads'
        : workflowThreadActionMatch
          ? `workflow-thread-${workflowThreadActionMatch[3]}`
        : qaResultsMatch
          ? 'qa-results'
        : reviewQuestionsMatch
          ? 'review-questions'
          : reviewQuestionActionMatch
            ? `review-question-${reviewQuestionActionMatch[3]}`
            : resourceMatch
              ? resourceMatch[2]
              : 'summary';
      const questionId = reviewQuestionActionMatch ? reviewQuestionActionMatch[2] : null;
      const workflowThreadId = workflowThreadActionMatch ? workflowThreadActionMatch[2] : null;
      const context = requireTenantAccess(req, options);

      if (resource === 'lock' && req.method === 'GET') {
        assertTaskLockingEnabled(options);
        requireMutationPermission(context);
        const state = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        return sendJson(res, 200, { lock: getActiveTaskLock(state) }, requestId);
      }
      if (resource === 'lock' && req.method === 'POST') {
        assertTaskLockingEnabled(options);
        requireMutationPermission(context);
        const body = await parseJson(req);
        const state = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        const activeLock = getActiveTaskLock(state);
        if (activeLock && activeLock.ownerId !== context.actorId) {
          try {
            await store.appendEvent({
              taskId,
              tenantId: context.tenantId,
              eventType: 'task.lock_conflict',
              actorId: context.actorId,
              actorType: body.actorType || 'user',
              idempotencyKey: body.idempotencyKey || `lock-conflict:${taskId}:${context.actorId}:${state.last_event_id || 'initial'}`,
              payload: {
                requested_by: context.actorId,
                blocking_owner_id: activeLock.ownerId,
                lock_expires_at: activeLock.expiresAt,
              },
              source: body.source || 'http',
            });
          } catch {}
          throw buildLockError(activeLock);
        }

        const payload = createTaskLockPayload({
          actorId: context.actorId,
          reason: body.reason,
          action: body.action,
          ttlSeconds: body.ttlSeconds,
        });
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.lock_acquired',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `lock-acquire:${taskId}:${context.actorId}:${payload.expires_at}`,
          payload,
          source: body.source || 'http',
        });
        return sendJson(res, 200, { success: true, data: { lock: getActiveTaskLock({ ...state, lock_owner: payload.owner_id, lock_acquired_at: payload.acquired_at, lock_expires_at: payload.expires_at, lock_reason: payload.reason, lock_action: payload.action }), updatedAt: result.event.occurred_at } }, requestId);
      }
      if (resource === 'lock' && req.method === 'DELETE') {
        assertTaskLockingEnabled(options);
        requireMutationPermission(context);
        const body = await parseJson(req).catch(() => ({}));
        const state = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        const activeLock = getActiveTaskLock(state);
        if (!activeLock) {
          return sendJson(res, 200, { success: true, data: { released: false, reason: 'no_active_lock' } }, requestId);
        }
        if (activeLock.ownerId !== context.actorId && !hasAnyRole(context, ['admin'])) {
          throw createHttpError(403, 'forbidden', 'Only the lock holder or admin may release the active task lock.');
        }
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.lock_released',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `lock-release:${taskId}:${context.actorId}:${state.last_event_id || 'initial'}`,
          payload: {
            owner_id: activeLock.ownerId,
            released_by: context.actorId,
          },
          source: body.source || 'http',
        });
        return sendJson(res, 200, { success: true, data: { released: true, updatedAt: result.event.occurred_at } }, requestId);
      }

      if (resource === 'workflow-threads' && req.method === 'GET') {
        assertStructuredCommentsEnabled(options);
        requirePermission(context, 'history:read');
        const history = await store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 });
        return sendJson(res, 200, deriveWorkflowThreads(history), requestId);
      }
      if (resource === 'workflow-threads' && req.method === 'POST') {
        assertStructuredCommentsEnabled(options);
        requirePermission(context, 'events:write');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options });
        const body = await parseJson(req);
        const normalized = validateWorkflowThreadBody(body);
        const threadId = `wt-${crypto.randomUUID().slice(0, 8)}`;
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.workflow_thread_created',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `workflow-thread:${taskId}:${threadId}`,
          payload: {
            thread_id: threadId,
            ...normalized,
            state: WORKFLOW_THREAD_STATES.OPEN,
            blocked: normalized.blocking,
            waiting_state: normalized.blocking ? 'workflow_thread_resolution' : null,
            next_required_action: normalized.blocking ? `Resolve blocking ${normalized.comment_type} thread.` : null,
          },
          source: body.source || 'http',
        });
        return sendJson(res, 201, { threadId, eventId: result.event.event_id, occurredAt: result.event.occurred_at }, requestId);
      }
      if (resource === 'workflow-thread-replies' && req.method === 'POST') {
        assertStructuredCommentsEnabled(options);
        requirePermission(context, 'events:write');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options });
        const body = await parseJson(req);
        const replyText = validateWorkflowThreadReplyBody(body, 'Reply');
        const history = await store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 });
        const thread = deriveWorkflowThreads(history).items.find((item) => item.id === workflowThreadId);
        if (!thread) throw createHttpError(404, 'workflow_thread_not_found', 'Workflow thread not found.', { thread_id: workflowThreadId });
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.workflow_thread_reply_added',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `workflow-thread-reply:${taskId}:${workflowThreadId}:${history[0]?.event_id || 'initial'}`,
          payload: {
            thread_id: workflowThreadId,
            comment_type: thread.commentType,
            blocking: thread.blocking,
            body: replyText,
            linked_event_id: thread.linkedEventId,
            notification_targets: thread.notificationTargets,
            waiting_state: thread.blocking && thread.state !== WORKFLOW_THREAD_STATES.RESOLVED ? 'workflow_thread_resolution' : null,
            next_required_action: thread.blocking && thread.state !== WORKFLOW_THREAD_STATES.RESOLVED ? `Resolve blocking ${thread.commentType} thread.` : null,
          },
          source: body.source || 'http',
        });
        return sendJson(res, 202, result, requestId);
      }
      if (resource === 'workflow-thread-resolve' && req.method === 'POST') {
        assertStructuredCommentsEnabled(options);
        requirePermission(context, 'events:write');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options });
        const body = await parseJson(req);
        const resolutionText = validateWorkflowThreadReplyBody(body, 'Resolution');
        const history = await store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 });
        const thread = deriveWorkflowThreads(history).items.find((item) => item.id === workflowThreadId);
        if (!thread) throw createHttpError(404, 'workflow_thread_not_found', 'Workflow thread not found.', { thread_id: workflowThreadId });
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.workflow_thread_resolved',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `workflow-thread-resolve:${taskId}:${workflowThreadId}:${history[0]?.event_id || 'initial'}`,
          payload: {
            thread_id: workflowThreadId,
            comment_type: thread.commentType,
            blocking: thread.blocking,
            resolution: resolutionText,
            body: resolutionText,
            linked_event_id: thread.linkedEventId,
            notification_targets: thread.notificationTargets,
            waiting_state: null,
            next_required_action: null,
            blocked: false,
          },
          source: body.source || 'http',
        });
        return sendJson(res, 202, result, requestId);
      }
      if (resource === 'workflow-thread-reopen' && req.method === 'POST') {
        assertStructuredCommentsEnabled(options);
        requirePermission(context, 'events:write');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options });
        const body = await parseJson(req);
        const reopenText = validateWorkflowThreadReplyBody(body, 'Reopen');
        const history = await store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 });
        const thread = deriveWorkflowThreads(history).items.find((item) => item.id === workflowThreadId);
        if (!thread) throw createHttpError(404, 'workflow_thread_not_found', 'Workflow thread not found.', { thread_id: workflowThreadId });
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.workflow_thread_reopened',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `workflow-thread-reopen:${taskId}:${workflowThreadId}:${history[0]?.event_id || 'initial'}`,
          payload: {
            thread_id: workflowThreadId,
            comment_type: thread.commentType,
            blocking: thread.blocking,
            body: reopenText,
            linked_event_id: thread.linkedEventId,
            notification_targets: thread.notificationTargets,
            waiting_state: thread.blocking ? 'workflow_thread_resolution' : null,
            next_required_action: thread.blocking ? `Resolve blocking ${thread.commentType} thread.` : null,
            blocked: thread.blocking,
          },
          source: body.source || 'http',
        });
        return sendJson(res, 202, result, requestId);
      }

      if (resource === 'qa-results' && req.method === 'GET') {
        assertQaStageEnabled(options);
        requirePermission(context, 'history:read');
        const history = await store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 });
        return sendJson(res, 200, deriveQaResults(history), requestId);
      }
      if (resource === 'qa-results' && req.method === 'POST') {
        assertQaStageEnabled(options);
        assertQaContextRoutingEnabled(options);
        requirePermission(context, 'events:write');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options });
        const body = await parseJson(req);
        const normalized = validateQaResultBody(body);
        const [state, history] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 }),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        if (state.current_stage !== STAGES.QA_TESTING) {
          throw createHttpError(409, 'invalid_stage', 'QA results can only be submitted while the task is in QA Testing.', { current_stage: state.current_stage });
        }
        const summary = summarizeTaskForDetail(taskId, state, history);
        const architectHandoff = architectHandoffFromEvent(findLatestArchitectHandoff(history));
        const implementationHistory = deriveImplementationHistory(history);
        const qaResults = deriveQaResults(history);
        const currentImplementation = implementationHistory[0] || null;
        const latestFailedQa = qaResults.latestFailed;
        const runId = `qa-${crypto.randomUUID().slice(0, 8)}`;
        const isRetest = Boolean(latestFailedQa && currentImplementation && currentImplementation.version > (latestFailedQa.implementationVersion || 0));
        const escalationPackage = normalized.outcome === 'fail'
          ? buildQaEscalationPackage({ taskId, summary, architectHandoff, implementationHistory, latestFailedQa, body: normalized, context })
          : null;

        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.qa_result_recorded',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `qa-result:${taskId}:${runId}`,
          payload: {
            run_id: runId,
            run_kind: isRetest ? 'retest' : 'initial',
            prior_run_id: isRetest ? latestFailedQa?.runId || null : null,
            outcome: normalized.outcome,
            summary: normalized.summary,
            scenarios: normalized.scenarios,
            findings: normalized.findings,
            reproduction_steps: normalized.reproduction_steps,
            stack_traces: normalized.stack_traces,
            env_logs: normalized.env_logs,
            retest_scope: normalized.retest_scope,
            implementation_version: currentImplementation?.version || 0,
            implementation_reference: currentImplementation?.primaryReference || null,
            escalation_package: escalationPackage,
            routed_to_stage: normalized.outcome === 'pass' ? STAGES.SRE_MONITORING : STAGES.IMPLEMENTATION,
          },
          source: body.source || 'http',
        });

        const transitionPayload = normalized.outcome === 'pass'
          ? {
              from_stage: STAGES.QA_TESTING,
              to_stage: STAGES.SRE_MONITORING,
              qa_run_id: runId,
              next_required_action: 'SRE monitoring validation is required.',
            }
          : {
              from_stage: STAGES.QA_TESTING,
              to_stage: STAGES.IMPLEMENTATION,
              qa_run_id: runId,
              waiting_state: 'engineering_fix_required',
              next_required_action: 'Address QA findings and resubmit implementation metadata.',
            };
        await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.stage_changed',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: `qa-stage-route:${taskId}:${runId}`,
          payload: transitionPayload,
          source: body.source || 'http',
        });
        await releaseActiveLockAfterTransition({
          store,
          taskId,
          tenantId: context.tenantId,
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          source: body.source || 'http',
          idempotencyKey: `lock-release:${taskId}:${runId}:qa-stage-transition`,
        });
        return sendJson(res, 201, {
          success: true,
          data: {
            runId,
            outcome: normalized.outcome,
            runKind: isRetest ? 'retest' : 'initial',
            routedToStage: normalized.outcome === 'pass' ? STAGES.SRE_MONITORING : STAGES.IMPLEMENTATION,
            implementationReference: currentImplementation?.primaryReference || null,
            escalationPackage,
            updatedAt: result.event.occurred_at,
          },
        }, requestId);
      }

      if (resource === 'review-questions' && req.method === 'GET') {
        requirePermission(context, 'history:read');
        const { questions } = await loadReviewQuestionContext(store, taskId, context.tenantId);
        return sendJson(res, 200, questions, requestId);
      }
      if (resource === 'review-questions' && req.method === 'POST') {
        requirePermission(context, 'events:write');
        if (!canAskReviewQuestion(context)) throw createHttpError(403, 'forbidden', 'Only architect/admin may create review questions.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options });
        const body = await parseJson(req);
        if (!String(body.prompt || '').trim()) {
          throw createHttpError(400, 'missing_prompt', 'Review question prompt is required.');
        }
        const { state, history } = await loadReviewQuestionContext(store, taskId, context.tenantId);
        if (state.current_stage !== STAGES.ARCHITECT_REVIEW) {
          throw createHttpError(409, 'invalid_stage', 'Review questions can only be created during Architect Review.');
        }
        const questionIdValue = createReviewQuestionId();
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.review_question_asked',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `review-question:${taskId}:${questionIdValue}`,
          payload: reviewQuestionWorkflowPayload(deriveReviewQuestions(history.concat([{ event_type: 'task.review_question_asked', sequence_number: (history[0]?.sequence_number || 0) + 1, payload: { question_id: questionIdValue, prompt: String(body.prompt).trim(), blocking: body.blocking !== false } }])), {
            question_id: questionIdValue,
            prompt: String(body.prompt).trim(),
            body: String(body.prompt).trim(),
            blocking: body.blocking !== false,
            state: REVIEW_QUESTION_STATES.OPEN,
          }),
          source: body.source || 'http',
        });
        return sendJson(res, 201, { questionId: questionIdValue, eventId: result.event.event_id, occurredAt: result.event.occurred_at }, requestId);
      }
      if (resource === 'review-question-answers' && req.method === 'POST') {
        requirePermission(context, 'events:write');
        if (!canAnswerReviewQuestion(context)) throw createHttpError(403, 'forbidden', 'Only PM/admin may answer review questions.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options });
        const body = await parseJson(req);
        if (!String(body.body || '').trim()) {
          throw createHttpError(400, 'missing_body', 'Review question answer body is required.');
        }
        const { question, history } = await loadReviewQuestionContext(store, taskId, context.tenantId, questionId);
        if (!question) throw createHttpError(404, 'review_question_not_found', 'Review question not found', { question_id: questionId });
        if (question.state === REVIEW_QUESTION_STATES.RESOLVED) {
          throw createHttpError(409, 'review_question_resolved', 'Resolved questions must be reopened before adding follow-up.');
        }
        const nextQuestions = deriveReviewQuestions(history.concat([{ event_type: 'task.review_question_answered', sequence_number: (history[0]?.sequence_number || 0) + 1, actor_id: context.actorId, payload: { question_id: questionId, body: String(body.body).trim(), state: REVIEW_QUESTION_STATES.ANSWERED, blocking: question.blocking } }]));
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.review_question_answered',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `review-question-answer:${taskId}:${questionId}:${history[0]?.event_id || 'initial'}`,
          payload: reviewQuestionWorkflowPayload(nextQuestions, { question_id: questionId, body: String(body.body).trim(), state: REVIEW_QUESTION_STATES.ANSWERED, blocking: question.blocking }),
          source: body.source || 'http',
        });
        return sendJson(res, 202, result, requestId);
      }
      if (resource === 'review-question-resolve' && req.method === 'POST') {
        if (!canResolveReviewQuestion(context)) throw createHttpError(403, 'forbidden', 'Only PM/admin may resolve review questions.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options });
        const body = await parseJson(req);
        const resolutionText = String(body.resolution || body.body || 'resolved').trim();
        const { question, history } = await loadReviewQuestionContext(store, taskId, context.tenantId, questionId);
        if (!question) throw createHttpError(404, 'review_question_not_found', 'Review question not found', { question_id: questionId });
        if (question.state === REVIEW_QUESTION_STATES.RESOLVED) {
          throw createHttpError(409, 'review_question_already_resolved', 'Review question is already resolved.', { question_id: questionId });
        }
        const nextQuestions = deriveReviewQuestions(history.concat([{ event_type: 'task.review_question_resolved', sequence_number: (history[0]?.sequence_number || 0) + 1, actor_id: context.actorId, payload: { question_id: questionId, resolution: resolutionText, blocking: question.blocking } }]));
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.review_question_resolved',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `review-question-resolve:${taskId}:${questionId}:${history[0]?.event_id || 'initial'}`,
          payload: reviewQuestionWorkflowPayload(nextQuestions, { question_id: questionId, resolution: resolutionText, body: resolutionText, state: REVIEW_QUESTION_STATES.RESOLVED, blocking: question.blocking }),
          source: body.source || 'http',
        });
        return sendJson(res, 202, result, requestId);
      }
      if (resource === 'review-question-reopen' && req.method === 'POST') {
        if (!canReopenReviewQuestion(context)) throw createHttpError(403, 'forbidden', 'Only architect, PM, or admin may reopen review questions.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options });
        const body = await parseJson(req);
        const reopenText = String(body.body || body.reason || 'reopened').trim();
        const { question, history } = await loadReviewQuestionContext(store, taskId, context.tenantId, questionId);
        if (!question) throw createHttpError(404, 'review_question_not_found', 'Review question not found', { question_id: questionId });
        if (question.state !== REVIEW_QUESTION_STATES.RESOLVED) {
          throw createHttpError(409, 'review_question_not_resolved', 'Only resolved review questions may be reopened.', { question_id: questionId });
        }
        const nextQuestions = deriveReviewQuestions(history.concat([{ event_type: 'task.review_question_reopened', sequence_number: (history[0]?.sequence_number || 0) + 1, actor_id: context.actorId, payload: { question_id: questionId, body: reopenText, blocking: question.blocking } }]));
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.review_question_reopened',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `review-question-reopen:${taskId}:${questionId}:${history[0]?.event_id || 'initial'}`,
          payload: reviewQuestionWorkflowPayload(nextQuestions, { question_id: questionId, body: reopenText, state: REVIEW_QUESTION_STATES.OPEN, blocking: question.blocking }),
          source: body.source || 'http',
        });
        return sendJson(res, 202, result, requestId);
      }
      if (resource === 'architect-handoff' && req.method === 'PUT') {
        assertArchitectSpecTieringEnabled(options);
        requirePermission(context, 'events:write');
        if (!canManageArchitectHandoff(context)) throw createHttpError(403, 'forbidden', 'Only architect/admin may submit the engineering handoff.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options });
        const body = await parseJson(req);
        const state = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        if (![STAGES.ARCHITECT_REVIEW, STAGES.TECHNICAL_SPEC].includes(state.current_stage)) {
          throw createHttpError(409, 'invalid_stage', 'Architect handoff can only be submitted during Architect Review or Technical Spec.', { current_stage: state.current_stage });
        }

        const normalized = validateArchitectHandoffBody(body);
        const history = await store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 });
        const priorHandoff = architectHandoffFromEvent(findLatestArchitectHandoff(history));
        const version = (priorHandoff?.version || 0) + 1;
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.architect_handoff_recorded',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `architect-handoff:${taskId}:v${version}`,
          payload: {
            ...normalized,
            version,
            next_required_action: 'Engineering handoff is complete. Implementation may begin.',
          },
          source: body.source || 'http',
        });
        return sendJson(res, 200, {
          success: true,
          data: {
            taskId,
            version,
            engineerTier: normalized.engineer_tier,
            readyForEngineering: true,
            updatedAt: result.event.occurred_at,
            duplicate: result.duplicate,
            eventId: result.event.event_id,
          },
        }, requestId);
      }
      if (resource === 'engineer-submission' && req.method === 'PUT') {
        assertEngineerSubmissionEnabled(options);
        requirePermission(context, 'events:write');
        if (!canManageEngineerSubmission(context)) throw createHttpError(403, 'forbidden', 'Only engineer/admin may submit implementation metadata.');
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options });
        const body = await parseJson(req);
        const state = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        if (![STAGES.IMPLEMENTATION, STAGES.IN_PROGRESS].includes(state.current_stage)) {
          throw createHttpError(409, 'invalid_stage', 'Engineer submission can only be submitted during Implementation.', { current_stage: state.current_stage });
        }

        const normalized = validateEngineerSubmissionBody(body);
        const history = await store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 500 });
        const priorSubmission = engineerSubmissionFromEvent(findLatestEngineerSubmission(history));
        const version = (priorSubmission?.version || 0) + 1;
        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: 'task.engineer_submission_recorded',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || `engineer-submission:${taskId}:v${version}`,
          payload: {
            ...normalized,
            version,
            next_required_action: 'Implementation metadata recorded. Task is ready for QA handoff.',
          },
          source: body.source || 'http',
        });
        return sendJson(res, 200, {
          success: true,
          data: {
            taskId,
            version,
            commitSha: normalized.commit_sha,
            prUrl: normalized.pr_url,
            primaryReference: normalized.primary_reference,
            updatedAt: result.event.occurred_at,
            duplicate: result.duplicate,
            eventId: result.event.event_id,
          },
        }, requestId);
      }
      if (resource === 'summary' && req.method === 'GET') {
        requirePermission(context, 'state:read');
        const [state, history] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 25 }),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        const result = summarizeTaskForDetail(taskId, state, history);
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'task_summary', duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, result, requestId);
      }
      if (resource === 'detail' && req.method === 'GET') {
        if (!isTaskDetailPageEnabled()) {
          throw createHttpError(503, 'feature_disabled', 'Task detail page is disabled by feature flag', { feature: 'ff_task_detail_page' });
        }
        requirePermission(context, 'state:read');
        const [state, history, relationships, telemetry, taskSummaries] = await Promise.all([
          store.getTaskCurrentState(taskId, { tenantId: context.tenantId }),
          authorize(context, 'history:read') ? store.getTaskHistory(taskId, { tenantId: context.tenantId, limit: 200 }) : Promise.resolve([]),
          store.getTaskRelationships(taskId, { tenantId: context.tenantId }),
          authorize(context, 'observability:read') ? store.getTaskObservabilitySummary(taskId, { tenantId: context.tenantId }) : Promise.resolve(null),
          authorize(context, 'relationships:read') ? store.listTaskSummaries({ tenantId: context.tenantId }) : Promise.resolve([]),
        ]);
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        const summary = summarizeTaskForDetail(taskId, state, history);
        const childTaskIds = Array.isArray(relationships?.child_task_ids) ? relationships.child_task_ids : [];
        const taskSummaryById = new Map((taskSummaries || []).map((item) => [item.task_id, item]));
        const childTaskSummaries = childTaskIds.map((childTaskId) => taskSummaryById.get(childTaskId) || {
          task_id: childTaskId,
          title: childTaskId,
          current_stage: null,
          current_owner: null,
          blocked: false,
          closed: false,
        });
        const result = buildTaskDetailViewModel({
          taskId,
          summary,
          relationships: relationships || { child_task_ids: [], escalations: [], decisions: [] },
          history: history.map(normalizeHistoryItem),
          telemetry: telemetry ? toTelemetryResponse(telemetry, context) : null,
          childTaskSummaries,
          context,
        });
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'task_detail', duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, result, requestId);
      }

      if (resource === 'events' && req.method === 'POST') {
        requirePermission(context, 'events:write');
        const body = await parseJson(req);
        if (!isTaskLockEventType(body.eventType) && body.eventType !== 'task.created') {
          await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, eventType: body.eventType, payload: body.payload, requestBody: body, options });
        }
        try {
          const result = await store.appendEvent({
            taskId,
            tenantId: context.tenantId,
            eventType: body.eventType,
            actorId: body.actorId || context.actorId,
            actorType: body.actorType,
            idempotencyKey: body.idempotencyKey,
            payload: body.payload,
            occurredAt: body.occurredAt,
            correlationId: body.correlationId,
            causationId: body.causationId,
            traceId: body.traceId,
            source: body.source || 'http',
          });
          if (body.eventType === 'task.stage_changed') {
            await releaseActiveLockAfterTransition({
              store,
              taskId,
              tenantId: context.tenantId,
              actorId: body.actorId || context.actorId,
              actorType: body.actorType || 'user',
              source: body.source || 'http',
              idempotencyKey: `lock-release:${taskId}:${result.event.event_id}:stage-transition`,
            });
          }
          logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'events', duration_ms: Date.now() - startedAt });
          return sendJson(res, 202, result, requestId);
        } catch (error) {
          if (error instanceof WorkflowError) {
            return sendJson(res, error.statusCode || 400, createErrorResponse(error, requestId), requestId);
          }
          throw error;
        }
      }
      if (resource === 'assignment' && req.method === 'PATCH') {
        requirePermission(context, 'assignment:write');
        const body = await parseJson(req);
        await assertTaskUnlockedForMutation({ store, taskId, tenantId: context.tenantId, actorId: context.actorId, resource, options });
        const state = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!state) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });

        const requestedAgentId = typeof body.agentId === 'string' ? body.agentId.trim() : body.agentId;
        const wantsUnassign = requestedAgentId == null || requestedAgentId === '';
        const agent = wantsUnassign ? null : findAgentById(agentRegistry, requestedAgentId);
        if (!wantsUnassign && !agent) {
          throw createHttpError(400, 'invalid_agent', 'Unknown AI agent id', { agent_id: requestedAgentId });
        }
        if (agent && !agent.active) {
          throw createHttpError(400, 'inactive_agent', 'AI agent is inactive', { agent_id: requestedAgentId });
        }

        const result = await store.appendEvent({
          taskId,
          tenantId: context.tenantId,
          eventType: wantsUnassign ? 'task.unassigned' : 'task.assigned',
          actorId: context.actorId,
          actorType: body.actorType || 'user',
          idempotencyKey: body.idempotencyKey || createAssignmentIdempotencyKey(req, taskId, state, agent?.id || null),
          payload: wantsUnassign
            ? { previous_assignee: state.assignee }
            : { previous_assignee: state.assignee, assignee: agent.id },
          occurredAt: body.occurredAt,
          correlationId: body.correlationId,
          causationId: body.causationId,
          traceId: body.traceId,
          source: body.source || 'http',
        });
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'assignment', assignee: agent?.id || null, duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, {
          success: true,
          data: {
            taskId,
            owner: formatAssignmentOwner(agent),
            updatedAt: result.event.occurred_at,
            duplicate: result.duplicate,
            eventId: result.event.event_id,
          },
        }, requestId);
      }
      if (resource === 'history' && req.method === 'GET') {
        requirePermission(context, 'history:read');
        const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 25;
        const cursor = url.searchParams.has('cursor') ? Number(url.searchParams.get('cursor')) : undefined;
        const eventTypes = url.searchParams.getAll('eventType').filter(Boolean);
        const history = await store.getTaskHistory(taskId, {
          tenantId: context.tenantId,
          eventType: eventTypes.length === 1 ? eventTypes[0] : undefined,
          eventTypes: eventTypes.length ? eventTypes : undefined,
          actorId: url.searchParams.get('actorId') || undefined,
          from: url.searchParams.get('from') || undefined,
          to: url.searchParams.get('to') || undefined,
          dateFrom: url.searchParams.get('dateFrom') || undefined,
          dateTo: url.searchParams.get('dateTo') || undefined,
          limit,
          cursor,
        });
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'history', limit: limit || null, cursor: Number.isFinite(cursor) ? cursor : null, result_count: history.length, duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, buildPaginatedHistoryResponse(history, limit), requestId);
      }
      if (resource === 'state' && req.method === 'GET') {
        requirePermission(context, 'state:read');
        const result = await store.getTaskCurrentState(taskId, { tenantId: context.tenantId });
        if (!result) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'state', duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, result, requestId);
      }
      if (resource === 'relationships' && req.method === 'GET') {
        requirePermission(context, 'relationships:read');
        const result = await store.getTaskRelationships(taskId, { tenantId: context.tenantId });
        if (!result) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'relationships', duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, result, requestId);
      }
      if (resource === 'observability-summary' && req.method === 'GET') {
        requirePermission(context, 'observability:read');
        const result = await store.getTaskObservabilitySummary(taskId, { tenantId: context.tenantId });
        if (!result) throw createHttpError(404, 'task_not_found', 'Task not found', { task_id: taskId });
        logger.info({ feature: 'ff_audit_foundation', action: 'audit_access', outcome: 'success', request_id: requestId, method: req.method, path: url.pathname, tenant_id: context.tenantId, actor_id: context.actorId, task_id: taskId, resource: 'observability_summary', duration_ms: Date.now() - startedAt });
        return sendJson(res, 200, toTelemetryResponse(result, context), requestId);
      }

      throw createHttpError(405, 'method_not_allowed', 'Method not allowed', { method: req.method, resource });
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error({
        feature: 'ff_audit_foundation',
        action: 'http_request',
        outcome: 'error',
        request_id: requestId,
        method: req.method,
        path: url.pathname,
        status_code: normalized.statusCode,
        error_code: normalized.code,
        error_message: normalized.message,
        duration_ms: Date.now() - startedAt,
      });
      return sendJson(res, normalized.statusCode, createErrorResponse(normalized, requestId), requestId);
    }
  });
  return { server, store };
}

module.exports = { createAuditApiServer, getRequestContext };
