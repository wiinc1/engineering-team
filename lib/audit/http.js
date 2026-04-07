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
} = require('./feature-flags');
const { isWorkflowAuditEventType } = require('./event-types');
const { resolveAgentRegistry, findAgentById } = require('./agents');
const { WorkflowError } = require('./workflow');

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
    blocked: Boolean(state.blocked),
    waiting_state: latestPayload.waiting_state || null,
    next_required_action: latestPayload.next_required_action || null,
    freshness: {
      status: freshnessStatus,
      last_updated_at: lastOccurredAt,
    },
    status_indicator: freshnessStatus,
    status: {
      blocked: Boolean(state.blocked),
      waiting_state: latestPayload.waiting_state || null,
      closed: Boolean(state.closed),
      freshness: freshnessStatus,
    },
    closed: Boolean(state.closed),
    // New fields from task creation
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
      const resourceMatch = routePath.match(/^\/tasks\/([^/]+)\/(events|history|state|relationships|observability-summary)$/);
      if (!summaryMatch && !resourceMatch && !assignmentMatch) throw createHttpError(404, 'not_found', 'Route not found');
      const taskId = (summaryMatch || resourceMatch || assignmentMatch)[1];
      const resource = assignmentMatch ? 'assignment' : resourceMatch ? resourceMatch[2] : 'summary';
      const context = requireTenantAccess(req, options);

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
