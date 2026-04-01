const crypto = require('crypto');
const { isWorkflowAuditEventType } = require('./event-types');

function makeEventId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

function defaultMetrics() {
  return {
    workflow_audit_events_written_total: 0,
    workflow_audit_write_failures_total: 0,
    workflow_history_queries_total: 0,
    workflow_history_errors_total: 0,
    workflow_history_query_latency_regressions_total: 0,
    workflow_projection_failures_total: 0,
    workflow_projection_rebuilds_total: 0,
    workflow_current_state_queries_total: 0,
    workflow_relationship_queries_total: 0,
    workflow_observability_queries_total: 0,
    workflow_projection_events_processed_total: 0,
    workflow_outbox_events_published_total: 0,
    workflow_outbox_publish_failures_total: 0,
    workflow_projection_lag_seconds: 0,
    last_write_duration_ms: 0,
    last_history_query_duration_ms: 0,
    last_rebuild_at: null,
    projection_checkpoint: 0,
    outbox_checkpoint: 0,
  };
}

function makeTenantScopedKey(tenantId, value) {
  return `${tenantId || 'engineering-team'}::${value}`;
}

function makeProjectionKey(tenantId, taskId) {
  return makeTenantScopedKey(tenantId, taskId);
}

function matchesTenant(record, tenantId) {
  return !tenantId || record.tenant_id === tenantId;
}

function matchesFilters(event, filters = {}) {
  const eventTypes = Array.isArray(filters.eventTypes)
    ? filters.eventTypes.filter(Boolean)
    : filters.eventType
      ? [filters.eventType]
      : [];
  if (eventTypes.length && !eventTypes.includes(event.event_type)) return false;
  if (filters.actorId && event.actor_id !== filters.actorId) return false;
  const from = filters.from || filters.dateFrom;
  const to = filters.to || filters.dateTo;
  if (from && event.occurred_at < from) return false;
  if (to && event.occurred_at > to) return false;
  return true;
}

function toHistoryEntry(event) {
  return {
    event_id: event.event_id,
    tenant_id: event.tenant_id,
    event_type: event.event_type,
    occurred_at: event.occurred_at,
    recorded_at: event.recorded_at,
    actor_id: event.actor_id,
    actor_type: event.actor_type,
    sequence_number: event.sequence_number,
    correlation_id: event.correlation_id,
    trace_id: event.trace_id,
    summary: summarizeEvent(event),
    payload: event.payload,
    source: event.source,
  };
}

function summarizeEvent(event) {
  const payload = event.payload || {};
  switch (event.event_type) {
    case 'task.created':
      return `Task created: ${payload.title || event.task_id}`;
    case 'task.stage_changed':
      return `Stage changed ${payload.from_stage || '—'} → ${payload.to_stage || '—'}`;
    case 'task.assigned':
      return `Assigned to ${payload.assignee || 'unknown'}`;
    case 'task.unassigned':
      return 'Assignment cleared';
    case 'task.blocked':
      return `Task blocked${payload.reason ? `: ${payload.reason}` : ''}`;
    case 'task.unblocked':
      return 'Task unblocked';
    case 'task.priority_changed':
      return `Priority changed to ${payload.priority || 'unknown'}`;
    case 'task.escalated':
      return `Escalated: ${payload.reason || 'workflow escalation'}`;
    case 'task.escalation_resolved':
      return `Escalation resolved: ${payload.resolution || 'resolved'}`;
    case 'task.child_link_added':
      return `Child task linked: ${payload.child_task_id || 'unknown child task'}`;
    case 'task.child_link_removed':
      return `Child task unlinked: ${payload.child_task_id || 'unknown child task'}`;
    case 'task.decision_recorded':
      return `Decision recorded: ${payload.summary || 'decision'}`;
    case 'task.decision_revised':
      return `Decision revised: ${payload.summary || 'decision update'}`;
    case 'task.comment_workflow_recorded':
      return `Workflow comment recorded: ${payload.comment_type || 'note'}`;
    case 'task.rollback_recorded':
      return `Rollback recorded${payload.reason ? `: ${payload.reason}` : ''}`;
    case 'task.closed':
      return 'Task closed';
    default:
      return event.event_type;
  }
}

function buildCurrentState(previous = {}, event) {
  const next = {
    task_id: event.task_id,
    tenant_id: event.tenant_id,
    last_event_id: event.event_id,
    last_event_type: event.event_type,
    last_occurred_at: event.occurred_at,
    last_actor_id: event.actor_id,
    current_stage: previous.current_stage || null,
    assignee: previous.assignee || null,
    priority: previous.priority || null,
    blocked: previous.blocked || false,
    closed: previous.closed || false,
  };

  switch (event.event_type) {
    case 'task.created':
      next.current_stage = event.payload.initial_stage || 'BACKLOG';
      next.priority = event.payload.priority || next.priority;
      next.assignee = event.payload.assignee || next.assignee;
      next.closed = false;
      break;
    case 'task.stage_changed':
      next.current_stage = event.payload.to_stage || next.current_stage;
      next.closed = event.payload.to_stage === 'DONE';
      break;
    case 'task.assigned':
      next.assignee = event.payload.assignee || null;
      break;
    case 'task.unassigned':
      next.assignee = null;
      break;
    case 'task.priority_changed':
      next.priority = event.payload.priority || next.priority;
      break;
    case 'task.blocked':
      next.blocked = true;
      break;
    case 'task.unblocked':
      next.blocked = false;
      break;
    case 'task.closed':
      next.closed = true;
      next.current_stage = 'DONE';
      break;
    default:
      break;
  }

  return next;
}

function buildRelationshipState(previous = {}, event) {
  const next = {
    task_id: event.task_id,
    child_task_ids: Array.isArray(previous.child_task_ids) ? [...previous.child_task_ids] : [],
    escalations: Array.isArray(previous.escalations) ? [...previous.escalations] : [],
    decisions: Array.isArray(previous.decisions) ? [...previous.decisions] : [],
  };

  switch (event.event_type) {
    case 'task.child_link_added':
      if (event.payload.child_task_id && !next.child_task_ids.includes(event.payload.child_task_id)) {
        next.child_task_ids.push(event.payload.child_task_id);
      }
      break;
    case 'task.child_link_removed':
      next.child_task_ids = next.child_task_ids.filter(id => id !== event.payload.child_task_id);
      break;
    case 'task.escalated':
      next.escalations.push({
        event_id: event.event_id,
        severity: event.payload.severity || 'advisory',
        reason: event.payload.reason || null,
        status: 'open',
      });
      break;
    case 'task.escalation_resolved':
      next.escalations = next.escalations.map(entry => ({ ...entry, status: entry.status === 'open' ? 'resolved' : entry.status }));
      break;
    case 'task.decision_recorded':
    case 'task.decision_revised':
      next.decisions.push({ event_id: event.event_id, summary: event.payload.summary || null });
      break;
    default:
      break;
  }

  return next;
}

function createCanonicalEvent(input, sequenceNumber) {
  const occurredAt = input.occurredAt || new Date().toISOString();
  const recordedAt = new Date().toISOString();
  const schemaVersion = input.schemaVersion || 1;
  const idempotencyKey = input.idempotencyKey;

  if (!input.taskId) throw new Error('taskId is required');
  if (!input.actorId) throw new Error('actorId is required');
  if (!input.actorType) throw new Error('actorType is required');
  if (!input.eventType) throw new Error('eventType is required');
  if (!idempotencyKey) throw new Error('idempotencyKey is required');
  if (!isWorkflowAuditEventType(input.eventType)) {
    throw new Error(`Unsupported workflow audit event type: ${input.eventType}`);
  }

  return {
    event_id: makeEventId(),
    tenant_id: input.tenantId || 'engineering-team',
    task_id: input.taskId,
    event_type: input.eventType,
    occurred_at: occurredAt,
    recorded_at: recordedAt,
    actor_type: input.actorType,
    actor_id: input.actorId,
    correlation_id: input.correlationId || input.idempotencyKey,
    causation_id: input.causationId || null,
    sequence_number: sequenceNumber,
    schema_version: schemaVersion,
    idempotency_key: idempotencyKey,
    trace_id: input.traceId || null,
    source: input.source || 'system',
    payload: input.payload || {},
  };
}

module.exports = {
  defaultMetrics,
  makeTenantScopedKey,
  makeProjectionKey,
  matchesTenant,
  matchesFilters,
  toHistoryEntry,
  summarizeEvent,
  buildCurrentState,
  buildRelationshipState,
  createCanonicalEvent,
};
