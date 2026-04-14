const crypto = require('crypto');
const { isWorkflowAuditEventType } = require('./event-types');
const { mergeLinkedPrs, payloadLinkedPrs } = require('./linked-prs');

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
    feature_task_assignment_requests_total: 0,
    feature_task_assignment_errors_total: 0,
    feature_task_assignment_business_metric: 0,
    feature_task_assignment_duration_ms_last: 0,
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
    case 'task.skill_escalation_requested':
      return `Above-skill escalation requested${payload.current_engineer_tier ? ` from ${payload.current_engineer_tier}` : ''}`;
    case 'task.architect_handoff_recorded':
      return `Architect handoff recorded: ${payload.engineer_tier || 'tier pending'}${payload.version ? ` v${payload.version}` : ''}`;
    case 'task.retiered':
      return `Engineer tier updated ${payload.previous_engineer_tier || 'unknown'} → ${payload.engineer_tier || 'unknown'}`;
    case 'task.engineer_submission_recorded':
      return `Engineer submission recorded: ${payload.primary_reference?.label || payload.commit_sha || payload.pr_url || 'implementation reference'}`;
    case 'task.check_in_recorded':
      return `Engineer check-in recorded${payload.summary ? `: ${payload.summary}` : ''}`;
    case 'task.lock_acquired':
      return `Task lock acquired by ${payload.owner_id || event.actor_id || 'unknown actor'}`;
    case 'task.lock_released':
      return `Task lock released by ${payload.owner_id || event.actor_id || 'unknown actor'}`;
    case 'task.lock_conflict':
      return `Task lock conflict for ${payload.requested_by || event.actor_id || 'unknown actor'}`;
    case 'task.assigned':
      return `Assigned to ${payload.assignee || 'unknown'}`;
    case 'task.reassigned':
      return `Reassigned to ${payload.assignee || 'unknown'}${payload.reason ? `: ${payload.reason}` : ''}`;
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
    case 'task.workflow_thread_created':
      return `Workflow thread opened: ${payload.comment_type || 'note'}${payload.title ? ` · ${payload.title}` : ''}`;
    case 'task.workflow_thread_reply_added':
      return `Workflow thread updated: ${payload.thread_id || 'thread'}`;
    case 'task.workflow_thread_resolved':
      return `Workflow thread resolved: ${payload.thread_id || 'thread'}`;
    case 'task.workflow_thread_reopened':
      return `Workflow thread reopened: ${payload.thread_id || 'thread'}`;
    case 'task.qa_result_recorded':
      return `QA ${payload.outcome === 'pass' ? 'approved' : 'reported issues'}${payload.run_kind === 'retest' ? ' (re-test)' : ''}`;
    case 'task.review_question_asked':
      return `Review question opened: ${payload.prompt || payload.question_id || 'question'}`;
    case 'task.review_question_answered':
      return `Review question answered: ${payload.question_id || 'question'}`;
    case 'task.review_question_resolved':
      return `Review question resolved: ${payload.question_id || 'question'}`;
    case 'task.review_question_reopened':
      return `Review question reopened: ${payload.question_id || 'question'}`;
    case 'task.rollback_recorded':
      return `Rollback recorded${payload.reason ? `: ${payload.reason}` : ''}`;
    case 'task.ghosting_review_created':
      return `Inactivity review created: ${payload.review_task_id || 'review task'}`;
    case 'task.closed':
      return 'Task closed';
    case 'task.github_pr_synced':
      return `GitHub PR synced: ${payload.title || payload.pr_title || payload.pr_number || payload.pr_id || 'pull request'}`;
    case 'task.github_pr_comment_recorded':
      return `GitHub PR comment synced: ${payload.pr_number || payload.pr_id || 'pull request'}`;
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
    engineer_tier: previous.engineer_tier || null,
    engineer_tier_rationale: previous.engineer_tier_rationale || null,
    architect_handoff_version: previous.architect_handoff_version || 0,
    ready_for_engineering: previous.ready_for_engineering || false,
    implementation_commit_sha: previous.implementation_commit_sha || null,
    implementation_pr_url: previous.implementation_pr_url || null,
    implementation_primary_reference: previous.implementation_primary_reference || null,
    implementation_submission_version: previous.implementation_submission_version || 0,
    lock_owner: previous.lock_owner || null,
    lock_acquired_at: previous.lock_acquired_at || null,
    lock_expires_at: previous.lock_expires_at || null,
    lock_reason: previous.lock_reason || null,
    lock_action: previous.lock_action || null,
    latest_qa_outcome: previous.latest_qa_outcome || null,
    latest_qa_run_id: previous.latest_qa_run_id || null,
    latest_qa_actor_id: previous.latest_qa_actor_id || null,
    latest_qa_retest_scope: previous.latest_qa_retest_scope || [],
    latest_qa_submission_version: previous.latest_qa_submission_version || 0,
    latest_qa_routed_stage: previous.latest_qa_routed_stage || null,
    blocked: previous.blocked || false,
    closed: previous.closed || false,
    waiting_state: previous.waiting_state || null,
    next_required_action: previous.next_required_action || null,
    queue_entered_at: previous.queue_entered_at || null,
    wip_owner: previous.wip_owner || null,
    wip_started_at: previous.wip_started_at || null,
  };

  switch (event.event_type) {
    case 'task.created':
      next.current_stage = event.payload.initial_stage || 'BACKLOG';
      next.priority = event.payload.priority || next.priority;
      next.assignee = event.payload.assignee || next.assignee;
      next.waiting_state = event.payload.waiting_state || null;
      next.next_required_action = event.payload.next_required_action || null;
      next.queue_entered_at = event.occurred_at;
      next.closed = false;
      break;
    case 'task.stage_changed': {
      const toStage = event.payload.to_stage || next.current_stage;
      next.current_stage = toStage;
      next.waiting_state = event.payload.waiting_state || null;
      next.next_required_action = event.payload.next_required_action || null;
      next.closed = toStage === 'DONE';
      if (toStage === 'IMPLEMENT' || toStage === 'IN_PROGRESS') {
        next.wip_owner = next.assignee || event.actor_id || null;
        next.wip_started_at = event.occurred_at;
      } else if (toStage !== 'IMPLEMENT' && toStage !== 'IN_PROGRESS') {
        next.wip_owner = null;
        next.wip_started_at = null;
        next.queue_entered_at = event.occurred_at;
      }
      break;
    }
    case 'task.architect_handoff_recorded':
    case 'task.retiered':
      next.engineer_tier = event.payload.engineer_tier || next.engineer_tier;
      next.engineer_tier_rationale = event.payload.tier_rationale || next.engineer_tier_rationale;
      if (event.event_type === 'task.architect_handoff_recorded') {
        next.architect_handoff_version = Number(event.payload.version) || next.architect_handoff_version || 1;
        next.ready_for_engineering = Boolean(event.payload.ready_for_engineering);
      }
      next.next_required_action = event.payload.next_required_action || next.next_required_action;
      next.queue_entered_at = event.occurred_at;
      break;
    case 'task.engineer_submission_recorded':
      next.implementation_commit_sha = event.payload.commit_sha || null;
      next.implementation_pr_url = event.payload.pr_url || null;
      next.implementation_primary_reference = event.payload.primary_reference || null;
      next.implementation_submission_version = Number(event.payload.version) || next.implementation_submission_version || 1;
      next.next_required_action = event.payload.next_required_action || next.next_required_action;
      next.queue_entered_at = event.occurred_at;
      break;
    case 'task.lock_acquired':
      next.lock_owner = event.payload.owner_id || event.actor_id || null;
      next.lock_acquired_at = event.payload.acquired_at || event.occurred_at;
      next.lock_expires_at = event.payload.expires_at || null;
      next.lock_reason = event.payload.reason || null;
      next.lock_action = event.payload.action || null;
      break;
    case 'task.lock_released':
      next.lock_owner = null;
      next.lock_acquired_at = null;
      next.lock_expires_at = null;
      next.lock_reason = null;
      next.lock_action = null;
      break;
    case 'task.assigned':
    case 'task.reassigned':
      next.assignee = event.payload.assignee || null;
      next.queue_entered_at = event.occurred_at;
      break;
    case 'task.unassigned':
      next.assignee = null;
      next.wip_owner = null;
      next.wip_started_at = null;
      next.queue_entered_at = event.occurred_at;
      break;
    case 'task.priority_changed':
      next.priority = event.payload.priority || next.priority;
      next.queue_entered_at = event.occurred_at;
      break;
    case 'task.blocked':
      next.blocked = true;
      next.waiting_state = event.payload.waiting_state || next.waiting_state;
      next.next_required_action = event.payload.next_required_action || next.next_required_action;
      break;
    case 'task.unblocked':
      next.blocked = false;
      break;
    case 'task.escalated':
    case 'task.decision_recorded':
    case 'task.decision_revised':
    case 'task.skill_escalation_requested':
    case 'task.check_in_recorded':
    case 'task.ghosting_review_created':
    case 'task.comment_workflow_recorded':
      next.waiting_state = event.payload.waiting_state || next.waiting_state;
      next.next_required_action = event.payload.next_required_action || next.next_required_action;
      next.queue_entered_at = event.occurred_at;
      break;
    case 'task.review_question_asked':
    case 'task.review_question_answered':
    case 'task.review_question_resolved':
    case 'task.review_question_reopened':
    case 'task.workflow_thread_created':
    case 'task.workflow_thread_reply_added':
    case 'task.workflow_thread_resolved':
    case 'task.workflow_thread_reopened':
      next.blocked = Boolean(event.payload.blocked ?? next.blocked);
      next.waiting_state = event.payload.waiting_state || next.waiting_state;
      next.next_required_action = event.payload.next_required_action || next.next_required_action;
      next.queue_entered_at = event.occurred_at;
      break;
    case 'task.qa_result_recorded':
      next.latest_qa_outcome = event.payload.outcome || null;
      next.latest_qa_run_id = event.payload.run_id || event.event_id;
      next.latest_qa_actor_id = event.actor_id || null;
      next.latest_qa_retest_scope = Array.isArray(event.payload.retest_scope) ? event.payload.retest_scope : [];
      next.latest_qa_submission_version = Number(event.payload.implementation_version) || next.latest_qa_submission_version || 0;
      next.latest_qa_routed_stage = event.payload.routed_to_stage || null;
      next.waiting_state = event.payload.outcome === 'fail' ? 'engineering_fix_required' : null;
      next.next_required_action = event.payload.outcome === 'fail'
        ? 'Address QA findings and resubmit implementation metadata.'
        : 'SRE monitoring handoff is ready.';
      next.queue_entered_at = event.occurred_at;
      break;
    case 'task.closed':
      next.closed = true;
      next.current_stage = 'DONE';
      next.wip_owner = null;
      next.wip_started_at = null;
      break;
    default:
      break;
  }

  return next;
}

function buildRelationshipState(previous = {}, event) {
  const next = {
    tenant_id: event.tenant_id || previous.tenant_id || null,
    task_id: event.task_id,
    child_task_ids: Array.isArray(previous.child_task_ids) ? [...previous.child_task_ids] : [],
    escalations: Array.isArray(previous.escalations) ? [...previous.escalations] : [],
    decisions: Array.isArray(previous.decisions) ? [...previous.decisions] : [],
    linked_prs: Array.isArray(previous.linked_prs) ? [...previous.linked_prs] : [],
    github_sync: previous.github_sync ? { ...previous.github_sync } : null,
  };

  switch (event.event_type) {
    case 'task.created':
    case 'task.engineer_submission_recorded':
    case 'task.comment_workflow_recorded':
      next.linked_prs = mergeLinkedPrs(next.linked_prs, payloadLinkedPrs(event.payload || {}, event.task_id), event.task_id);
      break;
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
    case 'task.qa_result_recorded':
      next.escalations.push({
        event_id: event.event_id,
        severity: event.payload.outcome === 'fail' ? 'high' : 'info',
        reason: event.payload.summary || null,
        status: event.payload.outcome === 'fail' ? 'open' : 'resolved',
      });
      break;
    case 'task.github_pr_synced':
    case 'task.github_pr_comment_recorded':
      next.linked_prs = mergeLinkedPrs(next.linked_prs, payloadLinkedPrs(event.payload || {}, event.task_id), event.task_id);
      next.github_sync = {
        last_event_id: event.event_id,
        last_event_type: event.event_type,
        last_delivery_id: event.payload?.delivery_id || next.github_sync?.last_delivery_id || null,
        last_synced_at: event.occurred_at,
        status: event.payload?.sync_status || 'ok',
      };
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
