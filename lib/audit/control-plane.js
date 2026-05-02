const crypto = require('crypto');

const CONTROL_PLANE_DECISION_POLICY_VERSION = 'control-plane-policy-decision.v1';
const CONTROL_PLANE_CAPABILITY_MODEL_VERSION = 'control-plane-capability-model.v1';
const CONTROL_PLANE_CONTEXT_PROVENANCE_VERSION = 'control-plane-context-provenance.v1';
const DELIVERY_RETROSPECTIVE_SIGNAL_VERSION = 'delivery-retrospective-signal.v1';
const AUTONOMY_CONFIDENCE_POLICY_VERSION = 'autonomy-confidence-thresholds.v1';
const CONTROL_PLANE_EXCEPTION_POLICY_VERSION = 'control-plane-exception-recovery.v1';
const WORK_PRIORITIZATION_POLICY_VERSION = 'control-plane-work-prioritization.v1';
const WIP_LIMIT_POLICY_VERSION = 'control-plane-wip-limits.v1';
const DELIVERY_BUDGET_POLICY_VERSION = 'control-plane-delivery-budgets.v1';
const PROMPT_BOUNDARY_POLICY_VERSION = 'control-plane-prompt-boundary.v1';

const POLICY_SURFACES = Object.freeze({
  reviewer_routing: {
    policy_name: 'reviewer_routing',
    policy_version: 'execution-contract-reviewer-routing.v1',
    status: 'implemented',
  },
  dispatch_routing: {
    policy_name: 'dispatch_routing',
    policy_version: 'execution-contract-dispatch-policy.v1',
    status: 'implemented',
  },
  auto_approval: {
    policy_name: 'auto_approval',
    policy_version: 'execution-contract-low-risk-simple-auto-approval.v1',
    status: 'implemented',
  },
  principal_escalation: {
    policy_name: 'principal_escalation',
    policy_version: 'execution-contract-dispatch-policy.v1',
    status: 'implemented',
  },
  capability_model: {
    policy_name: 'capability_model',
    policy_version: CONTROL_PLANE_CAPABILITY_MODEL_VERSION,
    status: 'implemented',
  },
  context_provenance: {
    policy_name: 'context_provenance',
    policy_version: CONTROL_PLANE_CONTEXT_PROVENANCE_VERSION,
    status: 'implemented',
  },
  delivery_retrospective_signals: {
    policy_name: 'delivery_retrospective_signals',
    policy_version: DELIVERY_RETROSPECTIVE_SIGNAL_VERSION,
    status: 'implemented',
  },
  autonomy_confidence: {
    policy_name: 'autonomy_confidence',
    policy_version: AUTONOMY_CONFIDENCE_POLICY_VERSION,
    status: 'implemented',
  },
  exceptions: {
    policy_name: 'exception_recovery',
    policy_version: CONTROL_PLANE_EXCEPTION_POLICY_VERSION,
    status: 'implemented',
  },
  prioritization: {
    policy_name: 'work_prioritization',
    policy_version: WORK_PRIORITIZATION_POLICY_VERSION,
    status: 'implemented',
  },
  wip_limits: {
    policy_name: 'wip_limits',
    policy_version: WIP_LIMIT_POLICY_VERSION,
    status: 'implemented',
  },
  delivery_budgets: {
    policy_name: 'delivery_budgets',
    policy_version: DELIVERY_BUDGET_POLICY_VERSION,
    status: 'implemented',
  },
  prompt_boundary: {
    policy_name: 'prompt_boundary_enforcement',
    policy_version: PROMPT_BOUNDARY_POLICY_VERSION,
    status: 'implemented',
  },
});

const CONTEXT_PROVENANCE_CATEGORIES = Object.freeze([
  'source_intake',
  'repo_docs',
  'adrs',
  'code_inspection',
  'issue_pr_history',
  'logs',
  'external_sources',
  'previous_failures',
  'specialist_contributions',
]);

const RISK_ORDER = Object.freeze(['none', 'low', 'medium', 'high', 'critical']);
const PRIORITY_ORDER = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 });
const URGENCY_ORDER = Object.freeze({ immediate: 0, high: 1, normal: 2, low: 3 });

const DEFAULT_AUTONOMY_THRESHOLDS = Object.freeze({
  Simple: Object.freeze({
    min_clean_closed_tasks: 3,
    min_success_rate: 0.85,
    min_first_pass_rate: 0.7,
    max_operator_intervention_rate: 0.1,
    max_escaped_defects: 0,
  }),
  Standard: Object.freeze({
    min_clean_closed_tasks: 5,
    min_success_rate: 0.9,
    min_first_pass_rate: 0.75,
    max_operator_intervention_rate: 0.08,
    max_escaped_defects: 0,
  }),
  Complex: Object.freeze({
    min_clean_closed_tasks: 8,
    min_success_rate: 0.95,
    min_first_pass_rate: 0.85,
    max_operator_intervention_rate: 0.05,
    max_escaped_defects: 0,
  }),
  Epic: Object.freeze({
    min_clean_closed_tasks: 12,
    min_success_rate: 0.97,
    min_first_pass_rate: 0.9,
    max_operator_intervention_rate: 0.03,
    max_escaped_defects: 0,
  }),
});

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return fallback;
  const normalized = normalizeText(value).toLowerCase();
  if (['true', 'yes', 'y', '1', 'required', 'blocked', 'active'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0', 'optional', 'not_required', 'not-required', 'inactive'].includes(normalized)) return false;
  return fallback;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.filter((entry) => entry != null && entry !== '');
  if (value && typeof value === 'object') return Object.values(value).filter((entry) => entry != null && entry !== '');
  return normalizeText(value)
    .split(/[,\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value ?? null;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function defaultTimestamp(value) {
  return normalizeText(value) || new Date().toISOString();
}

function normalizeProvenanceEntry(entry, fallback = {}) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const label = normalizeText(entry.label ?? entry.title ?? entry.summary ?? entry.path ?? entry.reference ?? entry.value);
    const reference = normalizeText(entry.reference ?? entry.path ?? entry.url ?? entry.event_id ?? entry.value ?? label);
    if (!label && !reference) return null;
    return {
      label: label || reference,
      reference: reference || label,
      source_type: normalizeKey(entry.sourceType ?? entry.source_type ?? fallback.source_type ?? fallback.category) || null,
      source_event_id: normalizeText(entry.sourceEventId ?? entry.source_event_id ?? entry.event_id) || null,
      used_for_decision: normalizeBoolean(entry.usedForDecision ?? entry.used_for_decision, true),
      notes: normalizeText(entry.notes ?? entry.rationale ?? entry.detail) || null,
    };
  }
  const label = normalizeText(entry);
  if (!label) return null;
  return {
    label,
    reference: label,
    source_type: normalizeKey(fallback.source_type ?? fallback.category) || null,
    source_event_id: null,
    used_for_decision: true,
    notes: null,
  };
}

function normalizeContextProvenance(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const fallbackSource = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
  const categories = {};

  for (const category of CONTEXT_PROVENANCE_CATEGORIES) {
    const entries = normalizeList(
      source[category]
        ?? source[category.replace(/_([a-z])/g, (_, char) => char.toUpperCase())]
        ?? fallbackSource[category]
        ?? [],
    );
    categories[category] = uniqueBy(
      entries
        .map((entry) => normalizeProvenanceEntry(entry, { category }))
        .filter(Boolean),
      (entry) => `${entry.reference}::${entry.source_event_id || ''}`,
    );
  }

  return {
    policy_version: CONTROL_PLANE_CONTEXT_PROVENANCE_VERSION,
    ...categories,
    summary: Object.fromEntries(CONTEXT_PROVENANCE_CATEGORIES.map((category) => [
      category,
      categories[category].length,
    ])),
  };
}

function inferContextProvenanceFromHistory(history = []) {
  const chronological = [...history].sort((a, b) => Number(a.sequence_number || 0) - Number(b.sequence_number || 0));
  const sourceIntake = [];
  const repoDocs = [];
  const adrs = [];
  const codeInspection = [];
  const issuePrHistory = [];
  const logs = [];
  const externalSources = [];
  const previousFailures = [];
  const specialistContributions = [];

  for (const event of chronological) {
    const payload = event?.payload || {};
    if (['task.created', 'task.refinement_requested'].includes(event?.event_type)) {
      if (payload.raw_requirements || payload.intake_draft) {
        sourceIntake.push({
          label: event.event_type,
          reference: event.event_id,
          source_type: 'audit_event',
          source_event_id: event.event_id,
        });
      }
    }

    const contract = payload.contract || null;
    const provenance = contract?.context_provenance || payload.context_provenance || null;
    if (provenance) {
      const normalized = normalizeContextProvenance(provenance);
      repoDocs.push(...normalized.repo_docs);
      adrs.push(...normalized.adrs);
      codeInspection.push(...normalized.code_inspection);
      issuePrHistory.push(...normalized.issue_pr_history);
      logs.push(...normalized.logs);
      externalSources.push(...normalized.external_sources);
      previousFailures.push(...normalized.previous_failures);
      specialistContributions.push(...normalized.specialist_contributions);
    }

    if (event?.event_type === 'task.qa_result_recorded' && payload.outcome === 'fail') {
      previousFailures.push({
        label: payload.summary || 'QA failure',
        reference: event.event_id,
        source_type: 'qa_result',
        source_event_id: event.event_id,
        used_for_decision: true,
        notes: null,
      });
    }
    if (event?.event_type === 'task.rollback_recorded') {
      previousFailures.push({
        label: payload.reason || 'Rollback recorded',
        reference: event.event_id,
        source_type: 'rollback',
        source_event_id: event.event_id,
        used_for_decision: true,
        notes: null,
      });
    }
    if (event?.event_type === 'task.workflow_thread_created' || event?.event_type === 'task.review_question_asked') {
      specialistContributions.push({
        label: payload.title || payload.prompt || payload.comment_type || event.event_type,
        reference: event.event_id,
        source_type: event.event_type,
        source_event_id: event.event_id,
        used_for_decision: true,
        notes: payload.summary || null,
      });
    }
  }

  return normalizeContextProvenance({
    source_intake: sourceIntake,
    repo_docs: repoDocs,
    adrs,
    code_inspection: codeInspection,
    issue_pr_history: issuePrHistory,
    logs,
    external_sources: externalSources,
    previous_failures: previousFailures,
    specialist_contributions: specialistContributions,
  });
}

function normalizeOverride(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const requested = normalizeBoolean(source.requested ?? source.applied ?? source.override ?? false, false);
  return {
    requested,
    applied: normalizeBoolean(source.applied ?? source.approved, requested),
    reason: normalizeText(source.reason ?? source.rationale ?? source.summary) || null,
    actor_id: normalizeText(source.actorId ?? source.actor_id ?? source.approvedBy ?? source.approved_by) || null,
    approved_at: normalizeText(source.approvedAt ?? source.approved_at) || null,
  };
}

function normalizePolicyDecision(input = {}, context = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const policyName = normalizeKey(source.policyName ?? source.policy_name ?? source.policy ?? context.policyName);
  const policyVersion = normalizeText(source.policyVersion ?? source.policy_version ?? context.policyVersion)
    || CONTROL_PLANE_DECISION_POLICY_VERSION;
  const actorId = normalizeText(source.actorId ?? source.actor_id ?? context.actorId) || null;
  const actorType = normalizeText(source.actorType ?? source.actor_type ?? context.actorType) || null;
  const timestamp = defaultTimestamp(source.timestamp ?? source.occurred_at ?? context.timestamp);
  const inputFacts = stableValue(source.inputFacts ?? source.input_facts ?? source.facts ?? context.inputFacts ?? {});
  const decision = normalizeText(source.decision ?? source.outcome ?? source.result ?? context.decision) || 'recorded';
  const rationale = normalizeText(source.rationale ?? source.reason ?? source.summary ?? context.rationale)
    || 'Control-plane policy decision recorded.';

  return {
    policy_name: policyName || 'control_plane_policy',
    policy_version: policyVersion,
    input_facts: inputFacts,
    decision,
    rationale,
    override: normalizeOverride(source.override ?? source.policyOverride ?? source.policy_override ?? {}),
    actor: {
      actor_id: actorId,
      actor_type: actorType,
    },
    timestamp,
    context_provenance: normalizeContextProvenance(
      source.contextProvenance ?? source.context_provenance ?? {},
      context.contextProvenance ?? {},
    ),
  };
}

function decisionFromEvent(event = {}) {
  const payload = event.payload || {};
  if (event.event_type === 'task.control_plane_decision_recorded') {
    return normalizePolicyDecision(payload.control_plane_decision || payload, {
      actorId: event.actor_id,
      actorType: event.actor_type,
      timestamp: event.occurred_at,
    });
  }
  if (payload.control_plane_decision || payload.policy_decision) {
    return normalizePolicyDecision(payload.control_plane_decision || payload.policy_decision, {
      actorId: event.actor_id,
      actorType: event.actor_type,
      timestamp: event.occurred_at,
    });
  }
  if (payload.auto_approval?.approved_by_policy) {
    return normalizePolicyDecision({
      policy_name: 'auto_approval',
      policy_version: payload.auto_approval.policy_version,
      input_facts: payload.auto_approval.criteria || {},
      decision: 'approved_by_policy',
      rationale: payload.auto_approval.rationale,
      actor_id: event.actor_id,
      actor_type: event.actor_type,
      timestamp: event.occurred_at,
      override: { requested: false, applied: false },
    });
  }
  if (payload.control_plane_wip_decision) {
    return normalizePolicyDecision(payload.control_plane_wip_decision, {
      actorId: event.actor_id,
      actorType: event.actor_type,
      timestamp: event.occurred_at,
    });
  }
  if (payload.control_plane_budget_decision) {
    return normalizePolicyDecision(payload.control_plane_budget_decision, {
      actorId: event.actor_id,
      actorType: event.actor_type,
      timestamp: event.occurred_at,
    });
  }
  return null;
}

function riskIndex(value) {
  const normalized = normalizeKey(value || 'none');
  const index = RISK_ORDER.indexOf(normalized);
  return index === -1 ? RISK_ORDER.indexOf('medium') : index;
}

function maxRiskValue(values = []) {
  const maxIndex = values.reduce((max, value) => Math.max(max, riskIndex(value)), 0);
  return RISK_ORDER[maxIndex] || 'none';
}

function normalizeEvidenceHistory(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    clean_closed_tasks: Number(source.cleanClosedTasks ?? source.clean_closed_tasks ?? source.successes ?? 0) || 0,
    failed_tasks: Number(source.failedTasks ?? source.failed_tasks ?? source.failures ?? 0) || 0,
    escaped_defects: Number(source.escapedDefects ?? source.escaped_defects ?? 0) || 0,
    policy_overrides: Number(source.policyOverrides ?? source.policy_overrides ?? 0) || 0,
    evidence_refs: normalizeList(source.evidenceRefs ?? source.evidence_refs ?? source.refs),
  };
}

function normalizeRecentOutcomes(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    sample_size: Number(source.sampleSize ?? source.sample_size ?? source.total ?? 0) || 0,
    success_rate: Number(source.successRate ?? source.success_rate ?? source.passRate ?? source.pass_rate ?? 0) || 0,
    qa_rework_rate: Number(source.qaReworkRate ?? source.qa_rework_rate ?? 0) || 0,
    operator_intervention_rate: Number(source.operatorInterventionRate ?? source.operator_intervention_rate ?? 0) || 0,
    latest_outcomes: normalizeList(source.latestOutcomes ?? source.latest_outcomes),
  };
}

function evaluateCapabilityModel({
  agent = {},
  task = {},
  openClawProfile = agent.openClawProfile || agent.openclaw_profile || {},
  permissions = agent.permissions || [],
  riskLimits = agent.riskLimits || agent.risk_limits || {},
  evidenceHistory = agent.evidenceHistory || agent.evidence_history || {},
  recentOutcomes = agent.recentOutcomes || agent.recent_outcomes || {},
  timestamp = new Date().toISOString(),
} = {}) {
  const normalizedPermissions = new Set(normalizeList(permissions).map(normalizeKey));
  const requiredPermissions = normalizeList(task.requiredPermissions ?? task.required_permissions).map(normalizeKey);
  const eligibleTaskClasses = normalizeList(agent.eligibleTaskClasses ?? agent.eligible_task_classes ?? openClawProfile.eligibleTaskClasses ?? openClawProfile.eligible_task_classes);
  const taskClass = normalizeText(task.taskClass ?? task.task_class ?? task.template_tier ?? task.templateTier ?? 'Simple') || 'Simple';
  const taskRisk = maxRiskValue([
    task.riskLevel ?? task.risk_level,
    ...normalizeList(task.riskFlags ?? task.risk_flags).map((flag) => (
      typeof flag === 'object' ? flag.risk || flag.level || flag.id : flag
    )),
  ]);
  const maxAllowedRisk = normalizeText(riskLimits.maxRisk ?? riskLimits.max_risk ?? openClawProfile.maxRisk ?? openClawProfile.max_risk ?? 'medium');
  const evidence = normalizeEvidenceHistory(evidenceHistory);
  const outcomes = normalizeRecentOutcomes(recentOutcomes);
  const blockers = [];

  if (agent.active === false || openClawProfile.active === false) {
    blockers.push({
      code: 'profile_inactive',
      detail: 'OpenClaw profile or control-plane agent profile is inactive.',
    });
  }
  const missingPermissions = requiredPermissions.filter((permission) => !normalizedPermissions.has(permission));
  if (missingPermissions.length) {
    blockers.push({
      code: 'missing_control_plane_permissions',
      detail: 'Agent lacks one or more control-plane permissions required for the task.',
      missing_permissions: missingPermissions,
    });
  }
  if (eligibleTaskClasses.length && !eligibleTaskClasses.map(normalizeKey).includes(normalizeKey(taskClass))) {
    blockers.push({
      code: 'task_class_not_eligible',
      detail: 'Agent is not eligible for this task class.',
      task_class: taskClass,
      eligible_task_classes: eligibleTaskClasses,
    });
  }
  if (riskIndex(taskRisk) > riskIndex(maxAllowedRisk)) {
    blockers.push({
      code: 'risk_limit_exceeded',
      detail: 'Task risk exceeds the agent control-plane risk limit.',
      task_risk: taskRisk,
      max_allowed_risk: maxAllowedRisk,
    });
  }
  if (evidence.escaped_defects > 0 || evidence.policy_overrides > 0) {
    blockers.push({
      code: 'evidence_history_requires_review',
      detail: 'Recent evidence history contains escaped defects or policy overrides.',
      evidence_history: evidence,
    });
  }
  if (outcomes.sample_size > 0 && outcomes.success_rate > 0 && outcomes.success_rate < 0.8) {
    blockers.push({
      code: 'recent_outcomes_below_floor',
      detail: 'Recent outcome success rate is below the control-plane routing floor.',
      recent_outcomes: outcomes,
    });
  }

  return {
    policy_version: CONTROL_PLANE_CAPABILITY_MODEL_VERSION,
    evaluated_at: timestamp,
    agent: {
      id: normalizeText(agent.id ?? openClawProfile.id) || null,
      role: normalizeText(agent.role ?? openClawProfile.role) || null,
      open_claw_profile: stableValue(openClawProfile),
    },
    task: {
      task_id: normalizeText(task.taskId ?? task.task_id) || null,
      task_class: taskClass,
      risk: taskRisk,
      required_permissions: requiredPermissions,
    },
    control_plane_permissions: [...normalizedPermissions],
    risk_limits: {
      ...stableValue(riskLimits),
      max_risk: maxAllowedRisk,
    },
    eligible_task_classes: eligibleTaskClasses,
    evidence_history: evidence,
    recent_outcomes: outcomes,
    routing_eligibility: {
      eligible: blockers.length === 0,
      status: blockers.length ? 'blocked' : 'eligible',
      based_on: [
        'open_claw_profile',
        'control_plane_permissions',
        'risk_limits',
        'eligible_task_classes',
        'evidence_history',
        'recent_outcomes',
      ],
      blockers,
    },
  };
}

function normalizeRetrospectiveSignal(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    policy_version: source.policy_version || DELIVERY_RETROSPECTIVE_SIGNAL_VERSION,
    signal_id: normalizeText(source.signal_id) || `DRS-${crypto.randomUUID().slice(0, 8)}`,
    task_id: normalizeText(source.task_id) || null,
    task_class: normalizeText(source.task_class) || 'unknown',
    generated_at: defaultTimestamp(source.generated_at),
    contract_quality: source.contract_quality || {},
    routing_quality: source.routing_quality || {},
    test_plan_quality: source.test_plan_quality || {},
    implementation_quality: source.implementation_quality || {},
    qa_sre_rework: source.qa_sre_rework || {},
    operator_interventions: source.operator_interventions || {},
    escaped_defects: source.escaped_defects || {},
    rollback: source.rollback || {},
    policy_overrides: source.policy_overrides || {},
    final_outcome: source.final_outcome || {},
    autonomy_confidence_signal: source.autonomy_confidence_signal || {},
  };
}

function latestEvent(history = [], type) {
  return history.find((event) => event?.event_type === type) || null;
}

function countEvents(history = [], predicate) {
  return history.filter(predicate).length;
}

function generateDeliveryRetrospectiveSignal({
  taskId,
  history = [],
  state = {},
  closedEvent = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const contractVersionEvent = latestEvent(history, 'task.execution_contract_version_recorded');
  const contract = contractVersionEvent?.payload?.contract || {};
  const approvedEvent = latestEvent(history, 'task.execution_contract_approved');
  const coverageValidation = latestEvent(history, 'task.contract_coverage_audit_validated');
  const dispatchPolicy = contract?.dispatch_readiness?.dispatchPolicy || contract?.dispatch_policy || null;
  const qaFailures = countEvents(history, (event) => event?.event_type === 'task.qa_result_recorded' && event.payload?.outcome === 'fail');
  const qaPasses = countEvents(history, (event) => event?.event_type === 'task.qa_result_recorded' && event.payload?.outcome === 'pass');
  const sreEscalations = countEvents(history, (event) => event?.event_type === 'task.escalated' && String(event.payload?.reason || '').startsWith('sre_'));
  const rollbackEvents = history.filter((event) => event?.event_type === 'task.rollback_recorded');
  const policyDecisions = history.map(decisionFromEvent).filter(Boolean);
  const policyOverrides = policyDecisions.filter((decision) => decision.override?.applied);
  const operatorInterventionEvents = history.filter((event) => (
    ['operator', 'human'].includes(String(event.actor_type || '').toLowerCase())
    || String(event.actor_id || '').toLowerCase().includes('operator')
  ) && !['task.closed'].includes(event.event_type));
  const escapedDefectEvents = history.filter((event) => (
    event?.payload?.escaped_defect === true
    || normalizeKey(event?.payload?.reason).includes('escaped_defect')
  ));
  const finalOutcome = {
    status: closedEvent?.payload?.outcome || closedEvent?.payload?.final_outcome || (state.closed ? 'closed' : 'closed'),
    closed: true,
    closed_at: closedEvent?.occurred_at || generatedAt,
    closed_by: closedEvent?.actor_id || null,
  };
  const cleanClose = qaFailures === 0
    && sreEscalations === 0
    && rollbackEvents.length === 0
    && escapedDefectEvents.length === 0
    && policyOverrides.length === 0
    && operatorInterventionEvents.length === 0;

  return normalizeRetrospectiveSignal({
    signal_id: `DRS-${taskId || 'task'}-${crypto.createHash('sha1').update(`${taskId || ''}:${generatedAt}`).digest('hex').slice(0, 8)}`,
    task_id: taskId,
    task_class: contract.template_tier || state.execution_contract_template_tier || 'unknown',
    generated_at: generatedAt,
    contract_quality: {
      contract_version: Number(contract.version || state.execution_contract_version) || null,
      validation_status: contract.validation?.status || state.execution_contract_validation_status || null,
      approved: Boolean(approvedEvent),
      committed_requirements_count: contract.committed_scope?.committed_requirements?.length || 0,
      status: approvedEvent ? 'approved_contract_available' : 'no_approved_contract',
    },
    routing_quality: {
      selected_engineer_tier: dispatchPolicy?.selectedEngineerTier || null,
      selected_assignee: dispatchPolicy?.selectedAssignee || state.assignee || null,
      principal_escalation_required: Boolean(dispatchPolicy?.principalReview?.required),
      status: dispatchPolicy?.blockingReasons?.length ? 'blocked_or_overridden' : 'routed',
    },
    test_plan_quality: {
      qa_passes: qaPasses,
      qa_failures: qaFailures,
      coverage_status: coverageValidation?.payload?.validation?.status || null,
      automated_evidence_required: Boolean(contract.sections?.['4']?.body),
      status: qaFailures ? 'rework_required' : 'clean',
    },
    implementation_quality: {
      implementation_attempts: countEvents(history, (event) => event?.event_type === 'task.engineer_submission_recorded'),
      contract_coverage_status: coverageValidation?.payload?.validation?.status || null,
      first_pass_qa: qaFailures === 0 && qaPasses > 0,
      status: qaFailures || rollbackEvents.length ? 'rework_or_rollback' : 'clean',
    },
    qa_sre_rework: {
      qa_failure_count: qaFailures,
      sre_escalation_count: sreEscalations,
      rework_required: qaFailures > 0 || sreEscalations > 0,
    },
    operator_interventions: {
      count: operatorInterventionEvents.length,
      events: operatorInterventionEvents.map((event) => ({
        event_id: event.event_id,
        event_type: event.event_type,
        actor_id: event.actor_id,
        occurred_at: event.occurred_at,
      })),
    },
    escaped_defects: {
      count: escapedDefectEvents.length,
      events: escapedDefectEvents.map((event) => event.event_id),
    },
    rollback: {
      recorded: rollbackEvents.length > 0,
      count: rollbackEvents.length,
      events: rollbackEvents.map((event) => event.event_id),
    },
    policy_overrides: {
      count: policyOverrides.length,
      decisions: policyOverrides.map((decision) => ({
        policy_name: decision.policy_name,
        policy_version: decision.policy_version,
        decision: decision.decision,
        timestamp: decision.timestamp,
      })),
    },
    final_outcome: finalOutcome,
    autonomy_confidence_signal: {
      outcome: cleanClose ? 'positive' : escapedDefectEvents.length || rollbackEvents.length ? 'negative' : 'neutral',
      clean_close: cleanClose,
      reason: cleanClose
        ? 'Task closed without operator intervention, rework, rollback, escaped defect, or policy override.'
        : 'Task closed with one or more rework, intervention, rollback, escaped-defect, or override signals.',
    },
  });
}

function normalizeSignalOutcome(signal = {}) {
  const finalStatus = normalizeKey(signal.final_outcome?.status || signal.finalOutcome?.status || signal.outcome || '');
  const escapedDefects = Number(signal.escaped_defects?.count ?? signal.escapedDefects?.count ?? signal.escaped_defects ?? 0) || 0;
  const rollback = normalizeBoolean(signal.rollback?.recorded ?? signal.rollback_recorded, false);
  const operatorInterventions = Number(signal.operator_interventions?.count ?? signal.operatorInterventions?.count ?? signal.operator_interventions ?? 0) || 0;
  const policyOverrides = Number(signal.policy_overrides?.count ?? signal.policyOverrides?.count ?? signal.policy_overrides ?? 0) || 0;
  const qaRework = Number(signal.qa_sre_rework?.qa_failure_count ?? signal.qa_failures ?? 0) || 0;
  const firstPass = normalizeBoolean(signal.implementation_quality?.first_pass_qa ?? signal.first_pass_qa, false);
  const success = ['closed', 'success', 'verified', 'done'].includes(finalStatus) || signal.final_outcome?.closed === true;
  const clean = success && escapedDefects === 0 && !rollback && operatorInterventions === 0 && policyOverrides === 0 && qaRework === 0;
  return {
    success,
    clean,
    first_pass: firstPass || (clean && qaRework === 0),
    escaped_defects: escapedDefects,
    rollback,
    operator_interventions: operatorInterventions,
    policy_overrides: policyOverrides,
    qa_rework: qaRework,
  };
}

function evaluateAutonomyExpansion({
  taskClass = 'Simple',
  retrospectiveSignals = [],
  thresholds = DEFAULT_AUTONOMY_THRESHOLDS,
  timestamp = new Date().toISOString(),
} = {}) {
  const className = normalizeText(taskClass) || 'Simple';
  const policyThreshold = thresholds[className] || thresholds[normalizeKey(className)] || DEFAULT_AUTONOMY_THRESHOLDS.Simple;
  const applicableSignals = retrospectiveSignals
    .filter((signal) => !signal.task_class || normalizeKey(signal.task_class) === normalizeKey(className))
    .map(normalizeSignalOutcome);
  const total = applicableSignals.length;
  const cleanClosed = applicableSignals.filter((signal) => signal.clean).length;
  const successes = applicableSignals.filter((signal) => signal.success).length;
  const firstPasses = applicableSignals.filter((signal) => signal.first_pass).length;
  const operatorInterventions = applicableSignals.reduce((sum, signal) => sum + signal.operator_interventions, 0);
  const escapedDefects = applicableSignals.reduce((sum, signal) => sum + signal.escaped_defects, 0);
  const successRate = total ? successes / total : 0;
  const firstPassRate = total ? firstPasses / total : 0;
  const operatorInterventionRate = total ? operatorInterventions / total : 0;
  const blockers = [];

  if (cleanClosed < policyThreshold.min_clean_closed_tasks) {
    blockers.push({
      code: 'insufficient_clean_closed_task_evidence',
      detail: 'Autonomy expansion requires more clean closed-task evidence for this task class.',
      required: policyThreshold.min_clean_closed_tasks,
      actual: cleanClosed,
    });
  }
  if (successRate < policyThreshold.min_success_rate) {
    blockers.push({
      code: 'success_rate_below_threshold',
      detail: 'Closed-task success rate is below the class-specific autonomy threshold.',
      required: policyThreshold.min_success_rate,
      actual: successRate,
    });
  }
  if (firstPassRate < policyThreshold.min_first_pass_rate) {
    blockers.push({
      code: 'first_pass_rate_below_threshold',
      detail: 'First-pass verification rate is below the class-specific autonomy threshold.',
      required: policyThreshold.min_first_pass_rate,
      actual: firstPassRate,
    });
  }
  if (operatorInterventionRate > policyThreshold.max_operator_intervention_rate) {
    blockers.push({
      code: 'operator_intervention_rate_above_threshold',
      detail: 'Operator interventions exceed the task-class threshold.',
      required_max: policyThreshold.max_operator_intervention_rate,
      actual: operatorInterventionRate,
    });
  }
  if (escapedDefects > policyThreshold.max_escaped_defects) {
    blockers.push({
      code: 'escaped_defects_above_threshold',
      detail: 'Autonomy expansion is blocked while escaped defects exist in the evidence window.',
      required_max: policyThreshold.max_escaped_defects,
      actual: escapedDefects,
    });
  }

  return {
    policy_version: AUTONOMY_CONFIDENCE_POLICY_VERSION,
    evaluated_at: timestamp,
    task_class: className,
    status: blockers.length ? 'blocked' : 'eligible',
    can_expand: blockers.length === 0,
    thresholds: policyThreshold,
    evidence: {
      total_closed_tasks: total,
      clean_closed_tasks: cleanClosed,
      success_rate: successRate,
      first_pass_rate: firstPassRate,
      operator_intervention_rate: operatorInterventionRate,
      escaped_defects: escapedDefects,
    },
    blockers,
  };
}

function normalizeException(input = {}, event = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const exceptionId = normalizeText(source.exceptionId ?? source.exception_id)
    || `EX-${event.task_id || 'task'}-${event.event_id || crypto.randomUUID().slice(0, 8)}`;
  const type = normalizeKey(source.type ?? source.exceptionType ?? source.exception_type ?? source.reason ?? 'workflow_exception');
  const auditHistory = normalizeList(source.auditHistory ?? source.audit_history).map((entry) => (
    entry && typeof entry === 'object' ? entry : { event_id: normalizeText(entry), status: 'recorded' }
  )).filter((entry) => entry.event_id || entry.summary);
  if (event.event_id && !auditHistory.some((entry) => entry.event_id === event.event_id)) {
    auditHistory.push({
      event_id: event.event_id,
      event_type: event.event_type,
      occurred_at: event.occurred_at,
      actor_id: event.actor_id,
    });
  }
  return {
    policy_version: CONTROL_PLANE_EXCEPTION_POLICY_VERSION,
    exception_id: exceptionId,
    task_id: normalizeText(source.taskId ?? source.task_id ?? event.task_id) || null,
    type,
    owner: normalizeText(source.owner ?? source.ownerId ?? source.owner_id ?? source.assignee) || null,
    blocked_state: normalizeBoolean(source.blockedState ?? source.blocked_state ?? source.blocked, Boolean(source.waiting_state)),
    severity: normalizeKey(source.severity || 'warning'),
    escalation: normalizeText(source.escalation ?? source.escalationPath ?? source.escalation_path) || null,
    verifier: normalizeText(source.verifier ?? source.verifierId ?? source.verifier_id) || null,
    resolution: source.resolution ? stableValue(source.resolution) : null,
    resolution_rules: normalizeList(source.resolutionRules ?? source.resolution_rules).map((rule) => normalizeText(rule)).filter(Boolean),
    audit_history: auditHistory,
  };
}

function exceptionFromEvent(event = {}) {
  const payload = event.payload || {};
  if (event.event_type === 'task.control_plane_exception_recorded') {
    return normalizeException(payload.exception || payload.control_plane_exception || payload, event);
  }
  if (payload.workflow_exception || payload.control_plane_exception) {
    return normalizeException(payload.workflow_exception || payload.control_plane_exception, event);
  }
  if (event.event_type === 'task.escalated') {
    return normalizeException({
      exception_id: payload.exception_id,
      type: payload.reason || 'escalation',
      owner: payload.owner_id || payload.owner,
      blocked_state: Boolean(payload.waiting_state),
      severity: payload.severity || 'warning',
      escalation: payload.next_required_action,
      verifier: payload.verifier,
      resolution: payload.resolution,
      resolution_rules: payload.resolution_rules,
    }, event);
  }
  if (event.event_type === 'task.blocked') {
    return normalizeException({
      exception_id: payload.exception_id,
      type: payload.blocker_type || payload.waiting_state || 'blocked_task',
      owner: payload.owner_id || payload.owner,
      blocked_state: true,
      severity: payload.severity || 'warning',
      escalation: payload.next_required_action,
      verifier: payload.verifier,
      resolution: payload.resolution,
      resolution_rules: payload.resolution_rules,
    }, event);
  }
  if (event.event_type === 'task.contract_coverage_audit_validated') {
    const exceptions = event.payload?.validation?.blocking_exceptions || [];
    return exceptions.map((exception, index) => normalizeException({
      exception_id: exception.exception_id || `EX-${event.task_id}-${event.event_id}-${index + 1}`,
      type: exception.exception_type || 'implementation_incomplete',
      owner: exception.owner || 'engineer',
      blocked_state: true,
      severity: exception.severity || 'high',
      escalation: exception.detail,
      verifier: 'qa',
      resolution_rules: exception.blocks || ['qa_verification', 'operator_closeout'],
    }, event));
  }
  return null;
}

function priorityRank(priority) {
  const normalized = normalizeText(priority).toUpperCase();
  return PRIORITY_ORDER[normalized] ?? 5;
}

function urgencyRank(urgency) {
  const normalized = normalizeKey(urgency || 'normal');
  return URGENCY_ORDER[normalized] ?? URGENCY_ORDER.normal;
}

function prioritizeReadyTasks(tasks = [], context = {}) {
  const nowMs = Date.parse(context.now || new Date().toISOString());
  const ranked = tasks.map((task) => {
    const createdAt = Date.parse(task.createdAt ?? task.created_at ?? task.queue_entered_at ?? task.last_occurred_at ?? context.now ?? new Date().toISOString());
    const ageDays = Number.isFinite(createdAt) && Number.isFinite(nowMs)
      ? Math.max(0, (nowMs - createdAt) / 86400000)
      : Number(task.ageDays ?? task.age_days ?? 0) || 0;
    const productionRisk = normalizeBoolean(task.productionRisk ?? task.production_risk ?? task.incident ?? task.production_incident, false);
    const s1SecurityDataRisk = normalizeBoolean(task.s1SecurityDataRisk ?? task.s1_security_data_risk, false)
      || ['s1', 'critical'].includes(normalizeKey(task.securityDataRisk ?? task.security_data_risk));
    const override = normalizeBoolean(task.operatorOverride ?? task.operator_override, false);
    const dependencyUnblocks = Number(task.dependencyUnblocks ?? task.dependency_unblocks ?? task.unblocks ?? 0) || 0;
    const availability = task.specialistAvailable ?? task.specialist_available;
    const specialistAvailable = availability == null ? true : normalizeBoolean(availability, true);
    const wipPressure = Number(task.wipPressure ?? task.wip_pressure ?? 0) || 0;
    const rank = {
      production_or_s1_risk: productionRisk || s1SecurityDataRisk ? 0 : 1,
      operator_override: override ? 0 : 1,
      dependency_unblocks: -dependencyUnblocks,
      urgency: urgencyRank(task.urgency),
      age: -ageDays,
      normal_priority: priorityRank(task.priority),
      wip_specialist_availability: specialistAvailable ? wipPressure : wipPressure + 100,
    };
    return {
      task,
      rank,
      rationale: [
        productionRisk || s1SecurityDataRisk ? 'Production/S1 security or data risk has top priority.' : null,
        override ? 'Operator override raises this task above normal priority.' : null,
        dependencyUnblocks ? `Unblocks ${dependencyUnblocks} dependent task${dependencyUnblocks === 1 ? '' : 's'}.` : null,
        `Urgency ${normalizeText(task.urgency || 'normal')}.`,
        `Age ${ageDays.toFixed(2)} days.`,
        `Priority ${normalizeText(task.priority || 'P3')}.`,
        specialistAvailable ? 'Specialist capacity is available.' : 'Specialist capacity is unavailable; WIP pressure lowers ordering.',
      ].filter(Boolean),
    };
  });

  ranked.sort((left, right) => {
    for (const key of ['production_or_s1_risk', 'operator_override', 'dependency_unblocks', 'urgency', 'age', 'normal_priority', 'wip_specialist_availability']) {
      if (left.rank[key] !== right.rank[key]) return left.rank[key] - right.rank[key];
    }
    return normalizeText(left.task.task_id || left.task.id).localeCompare(normalizeText(right.task.task_id || right.task.id));
  });

  return {
    policy_version: WORK_PRIORITIZATION_POLICY_VERSION,
    ordered_tasks: ranked.map((entry, index) => ({
      rank: index + 1,
      task_id: entry.task.task_id || entry.task.id || null,
      title: entry.task.title || null,
      ordering_facts: entry.rank,
      rationale: entry.rationale,
    })),
  };
}

function isPreemptingRisk(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return normalizeBoolean(source.productionIncident ?? source.production_incident, false)
    || normalizeKey(source.incidentSeverity ?? source.incident_severity) === 'production'
    || normalizeBoolean(source.s1SecurityDataRisk ?? source.s1_security_data_risk, false)
    || ['s1', 'critical'].includes(normalizeKey(source.securityDataRisk ?? source.security_data_risk));
}

function evaluateWipLimit({
  scopeType = 'stage',
  scopeId = null,
  mode = 'observe_only',
  currentCount = 0,
  limit = 1,
  requestedObligations = 1,
  taskRisk = {},
  actorId = null,
  timestamp = new Date().toISOString(),
} = {}) {
  const numericCurrentCount = Number(currentCount) || 0;
  const numericLimit = Number(limit) || 0;
  const numericRequested = Number(requestedObligations) || 1;
  const wouldBlock = numericLimit >= 0 && numericCurrentCount + numericRequested > numericLimit;
  const enforcementActive = ['enforce', 'enforced', 'active'].includes(normalizeKey(mode));
  const preempted = wouldBlock && isPreemptingRisk(taskRisk);
  const blocked = wouldBlock && enforcementActive && !preempted;
  return {
    policy_name: 'wip_limits',
    policy_version: WIP_LIMIT_POLICY_VERSION,
    input_facts: {
      scope_type: normalizeKey(scopeType) || 'stage',
      scope_id: normalizeText(scopeId) || null,
      mode: enforcementActive ? 'enforced' : 'observe_only',
      current_count: numericCurrentCount,
      limit: numericLimit,
      requested_obligations: numericRequested,
      task_risk: stableValue(taskRisk),
    },
    decision: blocked
      ? 'block_transition'
      : wouldBlock
        ? preempted ? 'allow_preempted' : 'observe_would_block'
        : 'allow',
    rationale: blocked
      ? 'WIP enforcement is active and the new lifecycle obligation exceeds policy.'
      : wouldBlock && preempted
        ? 'Production incident or S1 security/data-risk work preempts the WIP limit with audit.'
        : wouldBlock
          ? 'Observe-only WIP limit would block this transition, so a metric is recorded without blocking.'
          : 'WIP limit allows this transition.',
    override: {
      requested: preempted,
      applied: preempted,
      reason: preempted ? 'Production incident or S1 security/data-risk preemption.' : null,
      actor_id: actorId,
      approved_at: preempted ? timestamp : null,
    },
    actor: {
      actor_id: actorId,
      actor_type: actorId ? 'system_or_operator' : null,
    },
    timestamp,
    would_block: wouldBlock,
    blocked,
    preempted,
    metric: wouldBlock ? 'feature_control_plane_wip_would_block_total' : null,
  };
}

function evaluateWipLimits({ obligations = [], ...defaults } = {}) {
  const evaluations = obligations.length
    ? obligations.map((obligation) => evaluateWipLimit({ ...defaults, ...obligation }))
    : [evaluateWipLimit(defaults)];
  return {
    policy_version: WIP_LIMIT_POLICY_VERSION,
    evaluations,
    blocked: evaluations.some((evaluation) => evaluation.blocked),
    would_block_count: evaluations.filter((evaluation) => evaluation.would_block).length,
  };
}

function budgetDimension(name, spent, limit) {
  const spentNumber = Number(spent) || 0;
  const limitNumber = Number(limit) || 0;
  const configured = limit != null && limit !== '' && limitNumber >= 0;
  return {
    name,
    spent: spentNumber,
    limit: configured ? limitNumber : null,
    exhausted: configured && spentNumber >= limitNumber,
  };
}

function evaluateBudgetPolicy({
  taskId = null,
  owner = 'pm',
  verifier = 'operator',
  timeSpentMinutes = null,
  timeBudgetMinutes = null,
  costSpentUsd = null,
  costBudgetUsd = null,
  iterations = null,
  iterationBudget = null,
  retries = null,
  retryBudget = null,
  actorId = null,
  timestamp = new Date().toISOString(),
} = {}) {
  const dimensions = [
    budgetDimension('time', timeSpentMinutes, timeBudgetMinutes),
    budgetDimension('cost', costSpentUsd, costBudgetUsd),
    budgetDimension('iterations', iterations, iterationBudget),
    budgetDimension('retries', retries, retryBudget),
  ];
  const exhausted = dimensions.filter((dimension) => dimension.exhausted);
  const hasException = exhausted.length > 0;
  const exception = hasException ? normalizeException({
    exception_id: `EX-${taskId || 'task'}-budget-${crypto.createHash('sha1').update(`${taskId || ''}:${timestamp}`).digest('hex').slice(0, 8)}`,
    task_id: taskId,
    type: 'budget_exhausted',
    owner,
    blocked_state: true,
    severity: exhausted.some((dimension) => ['cost', 'time'].includes(dimension.name)) ? 'high' : 'warning',
    escalation: 'Budget policy requires a workflow exception and explicit next action.',
    verifier,
    resolution_rules: [
      'Record recovery action before continuing.',
      'Escalate to PM/operator when time, cost, iteration, or retry budget is exhausted.',
      'Reset or extend budget only through an auditable policy override.',
    ],
  }) : null;

  return {
    policy_name: 'delivery_budgets',
    policy_version: DELIVERY_BUDGET_POLICY_VERSION,
    input_facts: {
      task_id: taskId,
      dimensions,
    },
    decision: hasException ? 'record_workflow_exception' : 'continue',
    rationale: hasException
      ? 'One or more delivery budget dimensions are exhausted.'
      : 'Delivery budgets remain within policy.',
    override: {
      requested: false,
      applied: false,
      reason: null,
      actor_id: null,
      approved_at: null,
    },
    actor: {
      actor_id: actorId,
      actor_type: actorId ? 'system_or_operator' : null,
    },
    timestamp,
    exhausted_dimensions: exhausted.map((dimension) => dimension.name),
    workflow_exception: exception,
    next_required_action: hasException
      ? 'Record exception recovery decision before continuing delivery.'
      : null,
  };
}

function evaluatePromptBoundaryPolicy({
  prompt = '',
  allowedSources = [],
  requestedSources = [],
  containsSecret = false,
  actorId = null,
  timestamp = new Date().toISOString(),
} = {}) {
  const allowed = new Set(normalizeList(allowedSources).map(normalizeKey));
  const requested = normalizeList(requestedSources).map((source) => normalizeText(source));
  const disallowedSources = requested.filter((source) => allowed.size && !allowed.has(normalizeKey(source)));
  const boundaryTerms = /\b(secret|credential|token|private key|password|exfiltrate|ignore previous|bypass policy)\b/i;
  const secretRisk = normalizeBoolean(containsSecret, false) || boundaryTerms.test(prompt);
  const blocked = disallowedSources.length > 0 || secretRisk;
  return {
    policy_name: 'prompt_boundary_enforcement',
    policy_version: PROMPT_BOUNDARY_POLICY_VERSION,
    input_facts: {
      allowed_sources: [...allowed],
      requested_sources: requested,
      contains_secret_or_bypass_text: secretRisk,
    },
    decision: blocked ? 'block_prompt_boundary' : 'allow',
    rationale: blocked
      ? 'Prompt-boundary policy blocks disallowed sources, secrets, credential requests, or bypass instructions.'
      : 'Prompt stays within allowed task context boundaries.',
    override: {
      requested: false,
      applied: false,
      reason: null,
      actor_id: null,
      approved_at: null,
    },
    actor: {
      actor_id: actorId,
      actor_type: actorId ? 'system_or_operator' : null,
    },
    timestamp,
    blocked,
    disallowed_sources: disallowedSources,
  };
}

function deriveControlPlaneProjection(history = [], state = {}) {
  const decisions = history
    .map(decisionFromEvent)
    .filter(Boolean)
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  const exceptions = history
    .flatMap((event) => {
      const exception = exceptionFromEvent(event);
      if (!exception) return [];
      return Array.isArray(exception) ? exception : [exception];
    })
    .sort((a, b) => String(b.audit_history?.[0]?.occurred_at || '').localeCompare(String(a.audit_history?.[0]?.occurred_at || '')));
  const closeEvent = latestEvent(history, 'task.closed');
  const retrospective = closeEvent?.payload?.delivery_retrospective_signal
    ? normalizeRetrospectiveSignal(closeEvent.payload.delivery_retrospective_signal)
    : closeEvent
      ? generateDeliveryRetrospectiveSignal({
          taskId: closeEvent.task_id,
          history,
          state,
          closedEvent: closeEvent,
          generatedAt: closeEvent.occurred_at,
        })
      : null;
  const provenance = inferContextProvenanceFromHistory(history);
  const classSignals = retrospective ? [retrospective] : [];
  return {
    active: decisions.length > 0 || exceptions.length > 0 || Boolean(retrospective),
    policy_surfaces: POLICY_SURFACES,
    decisions,
    latest_decision: decisions[0] || null,
    context_provenance: provenance,
    exceptions,
    open_exceptions: exceptions.filter((exception) => exception.blocked_state && !exception.resolution),
    delivery_retrospective_signal: retrospective,
    autonomy_confidence: retrospective ? evaluateAutonomyExpansion({
      taskClass: retrospective.task_class || state.execution_contract_template_tier || 'Simple',
      retrospectiveSignals: classSignals,
    }) : null,
  };
}

module.exports = {
  CONTROL_PLANE_DECISION_POLICY_VERSION,
  CONTROL_PLANE_CAPABILITY_MODEL_VERSION,
  CONTROL_PLANE_CONTEXT_PROVENANCE_VERSION,
  DELIVERY_RETROSPECTIVE_SIGNAL_VERSION,
  AUTONOMY_CONFIDENCE_POLICY_VERSION,
  CONTROL_PLANE_EXCEPTION_POLICY_VERSION,
  WORK_PRIORITIZATION_POLICY_VERSION,
  WIP_LIMIT_POLICY_VERSION,
  DELIVERY_BUDGET_POLICY_VERSION,
  PROMPT_BOUNDARY_POLICY_VERSION,
  POLICY_SURFACES,
  DEFAULT_AUTONOMY_THRESHOLDS,
  normalizeContextProvenance,
  inferContextProvenanceFromHistory,
  normalizePolicyDecision,
  evaluateCapabilityModel,
  generateDeliveryRetrospectiveSignal,
  evaluateAutonomyExpansion,
  normalizeException,
  prioritizeReadyTasks,
  evaluateWipLimit,
  evaluateWipLimits,
  evaluateBudgetPolicy,
  evaluatePromptBoundaryPolicy,
  deriveControlPlaneProjection,
};
