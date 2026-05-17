const { deriveExecutionContractProjection } = require('./execution-contracts');
const { generateDeliveryRetrospectiveSignal } = require('./control-plane');
const {
  METRICS_POLICY_VERSION,
  METRICS_PROJECTION_SCHEMA_VERSION,
  OPERATOR_INTERVENTION_TAXONOMY_VERSION,
  RETROSPECTIVE_SIGNAL_SCHEMA_VERSION,
  actorLooksOperator,
  afterApproval,
  findLatest,
  firstOccurredAt,
  includesAny,
  lower,
  normalizeNumber,
  sortHistory,
  stableId,
} = require('./autonomous-delivery-metrics-shared');

const ROUTINE_NON_INTERVENTION_EVENTS = new Set([
  'task.created',
  'task.refinement_requested',
  'task.execution_contract_version_recorded',
  'task.execution_contract_validated',
  'task.execution_contract_markdown_generated',
  'task.execution_contract_approved',
  'task.execution_contract_verification_report_generated',
  'task.execution_contract_artifact_bundle_generated',
  'task.execution_contract_artifact_bundle_approved',
  'task.contract_coverage_audit_submitted',
  'task.contract_coverage_audit_validated',
  'task.sre_monitoring_started',
  'task.sre_approval_recorded',
  'task.github_pr_synced',
  'task.github_pr_comment_recorded',
  'task.closed',
  'task.lock_acquired',
  'task.lock_released',
  'task.lock_conflict',
  'task.check_in_recorded',
]);

function reasonText(event = {}) {
  const payload = event.payload || {};
  return [
    payload.reason_code,
    payload.reason,
    payload.summary,
    payload.rationale,
    payload.waiting_state,
    payload.next_required_action,
  ].filter(Boolean).join(' ');
}

function stageChangeCategory(event = {}, text = '') {
  const payload = event.payload || {};
  const fromStage = lower(payload.from_stage);
  const toStage = lower(payload.to_stage);
  const fromReview = ['qa_testing', 'sre_monitoring', 'pm_close_review', 'done'].includes(fromStage);
  const toRepair = ['implementation', 'in_progress', 'backlog', 'draft'].includes(toStage);
  if (!actorLooksOperator(event) || (!fromReview || !toRepair) && !includesAny(text, ['repair', 'restart', 'reopen', 'reroute', 'backtrack', 'manual'])) {
    return null;
  }
  return includesAny(text, ['restart', 'reopen', 'backtrack']) ? 'manual_restart' : 'manual_reroute';
}

function classifyInterventionCategory(event = {}, approvalOccurredAt = null) {
  if (!afterApproval(event, approvalOccurredAt)) return null;
  const payload = event.payload || {};
  const text = reasonText(event);
  if (payload.operator_intervention || payload.manual_intervention || payload.intervention_type) {
    return lower(payload.intervention_type || payload.reason_code || payload.reason).replace(/\s+/g, '_') || 'manual_intervention';
  }
  if (event.event_type === 'task.rollback_recorded') return 'manual_rollback_recovery';
  if (['task.reassigned', 'task.assigned', 'task.unassigned'].includes(event.event_type)) {
    return actorLooksOperator(event) ? 'manual_reroute' : null;
  }
  if (event.event_type === 'task.stage_changed') return stageChangeCategory(event, text);
  if (['task.blocked', 'task.unblocked'].includes(event.event_type)) return actorLooksOperator(event) ? 'manual_workflow_repair' : null;
  if (['task.decision_recorded', 'task.decision_revised'].includes(event.event_type)) return includesAny(text, ['override', 'manual', 'exception']) ? 'policy_override' : null;
  if (event.event_type === 'task.control_plane_exception_recorded') return 'exception_recovery';
  if (event.event_type === 'task.escalated') return 'manual_escalation_recovery';
  if (event.event_type === 'task.workflow_thread_created' && payload.blocking && actorLooksOperator(event)) return 'manual_clarification';
  if (event.event_type === 'task.pm_business_context_completed' && actorLooksOperator(event)) return 'scope_clarification';
  return null;
}

function rootCauseKey(event = {}, category = '') {
  const payload = event.payload || {};
  return payload.intervention_id ||
    payload.root_cause_id ||
    payload.coverage_audit_id ||
    payload.thread_id ||
    (event.correlation_id ? `${event.correlation_id}:${category}` : null);
}

function classifyOperatorInterventions(history = [], options = {}) {
  const sorted = sortHistory(history);
  const approvalOccurredAt = options.approvalOccurredAt || firstOccurredAt(sorted, 'task.execution_contract_approved');
  const seen = new Set();
  const items = [];
  let routineActionCount = 0;
  for (const event of sorted) {
    if (!afterApproval(event, approvalOccurredAt)) continue;
    if (ROUTINE_NON_INTERVENTION_EVENTS.has(event.event_type)) {
      routineActionCount += 1;
      continue;
    }
    const category = classifyInterventionCategory(event, approvalOccurredAt);
    if (!category) continue;
    const dedupeKey = rootCauseKey(event, category) || `${event.event_type}:${event.occurred_at || event.sequence_number || items.length}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    items.push(interventionItem(event, category, dedupeKey));
  }
  return { taxonomy_version: OPERATOR_INTERVENTION_TAXONOMY_VERSION, approval_occurred_at: approvalOccurredAt || null, count: items.length, routine_action_count: routineActionCount, items };
}

function interventionItem(event, category, dedupeKey) {
  return {
    event_id: event.event_id || null,
    event_type: event.event_type,
    occurred_at: event.occurred_at || null,
    actor_id: event.actor_id || null,
    actor_type: event.actor_type || null,
    category,
    root_cause_key: dedupeKey,
    summary: event.payload?.summary || event.payload?.reason || event.summary || null,
  };
}

function inferTaskClass({ state = {}, contractProjection = {} }) {
  const tier = contractProjection.latest?.template_tier || state.execution_contract_template_tier || null;
  if (tier) return tier;
  const type = lower(state.task_type);
  if (type.includes('bug') || type.includes('simple')) return 'Simple';
  if (type.includes('complex') || type.includes('migration')) return 'Complex';
  return 'Unknown';
}

function inferApprovalMode(contractProjection = {}, approvalEvent = null) {
  const autoApproval = contractProjection.approval?.autoApproval || contractProjection.latest?.auto_approval || null;
  if (autoApproval?.approved_by_policy || autoApproval?.requested) return 'policy_auto_approved';
  if (approvalEvent?.payload?.auto_approval?.approved_by_policy || approvalEvent?.payload?.autoApproval?.approved_by_policy) return 'policy_auto_approved';
  if (approvalEvent) return actorLooksOperator(approvalEvent) ? 'operator_approved' : 'manual_approved';
  return 'unknown';
}

function inferImplementationAgent({ state = {}, history = [] }) {
  const submission = findLatest(history, 'task.engineer_submission_recorded');
  return submission?.payload?.assignee || submission?.actor_id || state.wip_owner || state.current_owner || state.assignee || null;
}

function detectEscapedDefects(history = []) {
  const items = history.filter(event => {
    const payload = event?.payload || {};
    return event?.event_type === 'task.escaped_defect_recorded' ||
      payload.escaped_defect === true ||
      payload.escaped_defect_count > 0 ||
      includesAny(payload.reason || payload.summary, ['escaped defect', 'production regression']);
  });
  return { known: true, count: items.reduce((total, event) => total + Math.max(1, normalizeNumber(event.payload?.escaped_defect_count, 1)), 0), items: items.map(event => ({ event_id: event.event_id || null, event_type: event.event_type, occurred_at: event.occurred_at || null })) };
}

function detectRollback(history = []) {
  const event = history.find(item => item?.event_type === 'task.rollback_recorded' || item?.payload?.rollback === true);
  return { recorded: !!event, event_id: event?.event_id || null, occurred_at: event?.occurred_at || null, reason: event?.payload?.reason || event?.payload?.summary || null };
}

function deriveQaSreRework(history = []) {
  const qaFailures = history.filter(event => event?.event_type === 'task.qa_result_recorded' && lower(event.payload?.outcome) === 'fail');
  const sreEscalations = history.filter(event => event?.event_type === 'task.escalated' && includesAny(event.payload?.reason || event.payload?.summary, ['sre', 'monitoring', 'incident']));
  const coverageRework = history.filter(event => event?.event_type === 'task.contract_coverage_audit_validated' && lower(event.payload?.validation?.status || event.payload?.status) !== 'closed');
  const reworkCount = qaFailures.length + sreEscalations.length + coverageRework.length;
  return { qa_failure_count: qaFailures.length, sre_escalation_count: sreEscalations.length, coverage_rework_count: coverageRework.length, rework_count: reworkCount, rework_required: reworkCount > 0 };
}

function buildEvidenceQuality({ history = [], state = {}, approvalEvent = null, closedEvent = null, implementationEvent = null }) {
  const missing = [];
  if (!history.length) missing.push('history_unavailable');
  if (!history.some(event => event.event_type === 'task.created')) missing.push('task_created_event_missing');
  if (!approvalEvent) missing.push('execution_contract_approval_missing');
  if (!implementationEvent) missing.push('implementation_submission_missing');
  if (!closedEvent && !state.closed) missing.push('closeout_event_missing');
  return { status: missing.length ? 'unknown' : 'complete', missing, event_count: history.length };
}

function buildSignalContext({ taskId, tenantId, state, history, generatedAt }) {
  const sorted = sortHistory(history);
  const contractProjection = deriveExecutionContractProjection(sorted);
  const approvalEvent = findLatest(sorted, 'task.execution_contract_approved');
  const closedEvent = findLatest(sorted, 'task.closed');
  const implementationEvent = findLatest(sorted, 'task.engineer_submission_recorded');
  const evidenceQuality = buildEvidenceQuality({ history: sorted, state, approvalEvent, closedEvent, implementationEvent });
  const closedAt = closedEvent?.occurred_at || (state.closed ? state.last_occurred_at : null);
  return { taskId, tenantId, state, generatedAt, sorted, contractProjection, approvalEvent, closedEvent, implementationEvent, evidenceQuality, closedAt };
}

function signalEvidenceFingerprint({ history = [], state = {}, closedAt = null }) {
  const lastEvent = history[history.length - 1] || {};
  return stableId(closedAt || state.closed_at || state.last_occurred_at || 'open', history.length, lastEvent.event_id, lastEvent.event_type, lastEvent.occurred_at, state.updated_at);
}

function baseRetrospectiveSignal(context) {
  return generateDeliveryRetrospectiveSignal({
    taskId: context.taskId,
    state: context.state,
    history: context.sorted,
    closedEvent: context.closedEvent,
    generatedAt: context.generatedAt,
  });
}

function buildRetrospectiveSignal(input = {}) {
  const context = buildSignalContext({
    taskId: input.taskId,
    tenantId: input.tenantId,
    state: input.state || {},
    history: input.history || [],
    generatedAt: input.generatedAt || new Date().toISOString(),
  });
  const classificationStatus = context.evidenceQuality.status === 'complete' ? 'known' : 'unknown';
  const signalFingerprint = signalEvidenceFingerprint({ history: context.sorted, state: context.state, closedAt: context.closedAt });
  return buildSignalPayload(context, classificationStatus, signalFingerprint);
}

function buildSignalPayload(context, classificationStatus, signalFingerprint) {
  const finalStatus = context.state.closed || context.closedEvent ? 'closed' : 'open_or_unknown';
  return {
    signal_id: `adrs-${stableId(context.tenantId || context.state.tenant_id, context.taskId, signalFingerprint)}`,
    schema_version: RETROSPECTIVE_SIGNAL_SCHEMA_VERSION,
    projection_schema_version: METRICS_PROJECTION_SCHEMA_VERSION,
    policy_version: METRICS_POLICY_VERSION,
    generated_at: context.generatedAt,
    tenant_id: context.tenantId || context.state.tenant_id || null,
    task_id: context.taskId || context.state.task_id || null,
    task_class: inferTaskClass({ state: context.state, contractProjection: context.contractProjection }),
    template_tier: context.contractProjection.latest?.template_tier || context.state.execution_contract_template_tier || null,
    approval_mode: inferApprovalMode(context.contractProjection, context.approvalEvent),
    implementation_agent: inferImplementationAgent({ state: context.state, history: context.sorted }),
    final_outcome: { status: finalStatus, closed: finalStatus === 'closed', closed_at: context.closedAt, close_event_id: context.closedEvent?.event_id || null },
    evidence_quality: context.evidenceQuality,
    classification_status: classificationStatus,
    excluded_from_thresholds: classificationStatus !== 'known',
    operator_interventions: classifyOperatorInterventions(context.sorted, { approvalOccurredAt: context.approvalEvent?.occurred_at }),
    qa_sre_rework: deriveQaSreRework(context.sorted),
    rollback: detectRollback(context.sorted),
    escaped_defects: detectEscapedDefects(context.sorted),
    confidence_inputs: confidenceInputs(context),
  };
}

function confidenceInputs(context) {
  return {
    base_signal: baseRetrospectiveSignal(context),
    approval_event_id: context.approvalEvent?.event_id || null,
    implementation_event_id: context.implementationEvent?.event_id || null,
    first_event_at: context.sorted[0]?.occurred_at || null,
    last_event_at: context.sorted[context.sorted.length - 1]?.occurred_at || context.state.last_occurred_at || null,
  };
}

module.exports = {
  buildRetrospectiveSignal,
  classifyOperatorInterventions,
};
