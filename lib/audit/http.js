const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const { createAuditStore } = require('./store');
const { authorize } = require('./authz');
const { verifyHmacJwt, getBearerToken, buildPrincipalFromClaims } = require('../auth/jwt');
const { createAuditLogger } = require('./logger');
const {
  isAuditFoundationEnabled,
  isWorkflowEngineEnabled,
  assertAuditFoundationEnabled,
  assertWorkflowEngineEnabled,
  isTaskCreationEnabled,
  assertTaskCreationEnabled,
  assertArchitectSpecTieringEnabled,
} = require('./feature-flags');
const { isWorkflowAuditEventType } = require('./event-types');
const { resolveAgentRegistry, findAgentById } = require('./agents');
const { WorkflowError, STAGES } = require('./workflow');
const { deriveReviewQuestions, REVIEW_QUESTION_STATES } = require('./review-questions');

const ENGINEER_TIERS = Object.freeze(['Principal', 'Sr', 'Jr']);
const TECHNICAL_SPEC_FIELDS = Object.freeze(['summary', 'scope', 'design', 'rolloutPlan']);
const MONITORING_SPEC_FIELDS = Object.freeze(['service', 'dashboardUrls', 'alertPolicies', 'runbook', 'successMetrics']);

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
  const canViewRelationships = authorize(context, 'relationships:read');
  const canViewTelemetry = authorize(context, 'observability:read');
  const canViewLinkedPrMetadata = canViewRelationships;
  const linkedPrs = canViewLinkedPrMetadata ? collectLinkedPrs(history, relationships, taskId) : [];
  const prStatus = summarizePrStatus(linkedPrs);
  const architectHandoff = architectHandoffFromEvent(findLatestArchitectHandoff(history));
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
        isBlocked: status === 'blocked',
        label: status === 'blocked' ? 'Blocked' : status === 'waiting' ? 'Waiting' : status === 'done' ? 'Done' : 'Active',
        waitingOn: reviewQuestions.summary.unresolvedBlockingCount > 0 ? 'PM review question resolution' : summary.waiting_state ? toSentenceCase(summary.waiting_state) : null,
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

function canResolveReviewQuestion(context) {
  return hasAnyRole(context, ['pm', 'admin']);
}

function canReopenReviewQuestion(context) {
  return hasAnyRole(context, ['pm', 'admin', 'architect']);
}

function canManageArchitectHandoff(context) {
  return hasAnyRole(context, ['architect', 'admin']);
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
      const architectHandoffMatch = routePath.match(/^\/tasks\/([^/]+)\/architect-handoff$/);
      const reviewQuestionsMatch = routePath.match(/^\/tasks\/([^/]+)\/review-questions$/);
      const reviewQuestionActionMatch = routePath.match(/^\/tasks\/([^/]+)\/review-questions\/([^/]+)\/(answers|resolve|reopen)$/);
      const resourceMatch = routePath.match(/^\/tasks\/([^/]+)\/(detail|events|history|state|relationships|observability-summary)$/);
      if (!summaryMatch && !resourceMatch && !assignmentMatch && !architectHandoffMatch && !reviewQuestionsMatch && !reviewQuestionActionMatch) throw createHttpError(404, 'not_found', 'Route not found');
      const taskId = (summaryMatch || resourceMatch || assignmentMatch || architectHandoffMatch || reviewQuestionsMatch || reviewQuestionActionMatch)[1];
      const resource = assignmentMatch
        ? 'assignment'
        : architectHandoffMatch
          ? 'architect-handoff'
        : reviewQuestionsMatch
          ? 'review-questions'
          : reviewQuestionActionMatch
            ? `review-question-${reviewQuestionActionMatch[3]}`
            : resourceMatch
              ? resourceMatch[2]
              : 'summary';
      const questionId = reviewQuestionActionMatch ? reviewQuestionActionMatch[2] : null;
      const context = requireTenantAccess(req, options);

      if (resource === 'review-questions' && req.method === 'GET') {
        requirePermission(context, 'history:read');
        const { questions } = await loadReviewQuestionContext(store, taskId, context.tenantId);
        return sendJson(res, 200, questions, requestId);
      }
      if (resource === 'review-questions' && req.method === 'POST') {
        requirePermission(context, 'events:write');
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
