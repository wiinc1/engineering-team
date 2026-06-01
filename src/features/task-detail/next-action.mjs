const DISABLED_FLAG_VALUES = new Set(['0', 'false', 'off', 'disabled', 'no']);
const ROLE_LABELS = {
  admin: 'Admin',
  architect: 'Architect',
  engineer: 'Engineer',
  human: 'Human stakeholder',
  pm: 'PM',
  qa: 'QA',
  reader: 'Reader',
  sre: 'SRE',
};

const ROLE_PRIORITY = ['pm', 'qa', 'sre', 'architect', 'engineer', 'human', 'admin', 'reader'];

const ROLE_SECTION_LINKS = {
  architect: '#task-detail-delivery-section',
  engineer: '#task-detail-delivery-section',
  human: '#task-detail-close-review-section',
  pm: '#task-detail-overview-section',
  qa: '#task-detail-qa-section',
  reader: '#task-detail-history-section',
  sre: '#task-detail-sre-section',
};

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeStage(value) {
  return String(value || '').trim().toUpperCase();
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function normalizeTaskDetailRoles(principal = {}) {
  const roles = Array.isArray(principal?.roles) ? principal.roles : [];
  const normalized = roles.map(normalize).map((role) => (role === 'stakeholder' ? 'human' : role));
  return unique(normalized.length ? normalized : ['reader']);
}

export function isTaskDetailNextActionRedesignEnabled(config = globalThis?.__ENGINEERING_TEAM_RUNTIME_CONFIG__) {
  const rawValue =
    config?.ff_task_detail_next_action_redesign ??
    config?.ffTaskDetailNextActionRedesign ??
    config?.taskDetailNextActionRedesign ??
    config?.VITE_FF_TASK_DETAIL_NEXT_ACTION_REDESIGN;

  if (rawValue == null || rawValue === '') return true;
  return !DISABLED_FLAG_VALUES.has(normalize(rawValue));
}

function fieldText(...values) {
  return values.map((value) => String(value || '').trim()).filter(Boolean).join(' ');
}

function taskSignals(screen = {}) {
  const detail = screen.detail || {};
  const summary = screen.summary || {};
  const task = detail.task || {};
  const detailSummary = detail.summary || {};
  const context = detail.context || {};
  const blockedState = detailSummary.blockedState || {};
  const timers = detailSummary.timers || {};
  const metaFreshness = detail.meta?.freshness || {};
  const summaryFreshness = summary.freshness || {};
  const closeGovernance = context.closeGovernance || {};
  const pmRefinementStatus = refinementStatus(context);
  const monitoring = context.sreMonitoring || detail.monitoring || detailSummary.monitoring || null;
  const actionText = fieldText(
    detailSummary.nextAction?.label,
    summary.nextRequiredAction,
    blockedState.waitingOn,
    summary.waitingState,
    task.status,
    task.stage,
    context.operatorIntakeRequirements,
  ).toLowerCase();

  return {
    actionText,
    blockedReason: blockedState.waitingOn || summary.waitingState || detail.blockers?.[0]?.label || null,
    closeGovernance,
    context,
    currentOwner: detailSummary.owner?.label || summary.currentOwner || summary.current_owner || 'Unassigned',
    freshness: metaFreshness.status || summaryFreshness.status || timers.freshness || 'unknown',
    lastUpdatedAt: metaFreshness.lastUpdatedAt || summaryFreshness.last_updated_at || timers.lastUpdatedAt || null,
    monitoring,
    permissions: detail.meta?.permissions || {},
    primaryNextAction: detailSummary.nextAction?.label || summary.nextRequiredAction || null,
    stage: normalizeStage(task.stage || summary.currentStage || summary.current_stage),
    status: normalize(task.status || summary.statusIndicator || (summary.closed ? 'done' : summary.blocked ? 'blocked' : 'active')),
    taskId: task.id || summary.taskId || summary.task_id || screen.route?.taskId || null,
    title: task.title || summary.title || 'Task detail',
    waitingState: blockedState.waitingOn || summary.waitingState || summary.waiting_state || null,
    isBlocked: Boolean(blockedState.isBlocked || summary.blocked || task.status === 'blocked'),
    isDone: task.status === 'done' || summary.closed,
    isIntakeDraft: Boolean(context.intakeDraft || summary.intakeDraft || summary.intake_draft),
    isUnassigned: !detailSummary.owner?.id && !summary.currentOwner && !summary.current_owner,
    isStale: normalize(metaFreshness.status || summaryFreshness.status || timers.freshness) === 'stale',
    pmRefinementStatus,
  };
}

function refinementStatus(context = {}) {
  const contract = context.executionContract || {};
  const approval = contract.approval || null;
  const latest = contract.latest || null;

  if (approval?.approvedAt || approval?.approved_at || latest?.status === 'approved') {
    return {
      label: 'PM refinement',
      value: 'Complete',
      detail: 'Approved Execution Contract recorded.',
    };
  }

  if (contract.active || latest) {
    return {
      label: 'PM refinement',
      value: 'In progress',
      detail: latest?.version ? `Execution Contract v${latest.version} is not approved yet.` : 'Draft Execution Contract exists.',
    };
  }

  if (context.intakeDraft) {
    return {
      label: 'PM refinement',
      value: 'Requested/pending',
      detail: 'The task is queued for PM refinement; no refinement artifact is complete yet.',
    };
  }

  return null;
}

function userCanAct(roles) {
  return roles.some((role) => role !== 'reader');
}

function roleMatch(roles, role) {
  return roles.includes(role) || roles.includes('admin');
}

function pickRole(roles, signals) {
  if (signals.closeGovernance?.humanDecision?.required && roleMatch(roles, 'human')) return 'human';
  if (isSreAction(signals) && roleMatch(roles, 'sre')) return 'sre';
  if (isQaAction(signals) && roleMatch(roles, 'qa')) return 'qa';
  if (isPmAction(signals) && roleMatch(roles, 'pm')) return 'pm';
  if (isArchitectAction(signals) && roleMatch(roles, 'architect')) return 'architect';
  if (isEngineerAction(signals) && roleMatch(roles, 'engineer')) return 'engineer';
  return ROLE_PRIORITY.find((role) => roles.includes(role)) || roles[0] || 'reader';
}

function isPmAction(signals) {
  return (
    signals.isIntakeDraft ||
    signals.isUnassigned ||
    /pm|refinement|assignment|business context|deferred/.test(signals.actionText) ||
    signals.stage === 'DRAFT' ||
    signals.stage === 'BACKLOG'
  );
}

function isArchitectAction(signals) {
  return /architect|technical spec|handoff|tier/.test(signals.actionText) || ['ARCHITECT_REVIEW', 'TECHNICAL_SPEC'].includes(signals.stage);
}

function isEngineerAction(signals) {
  return /engineer|implementation|check-in|handoff|pull request|commit/.test(signals.actionText) ||
    ['IMPLEMENT', 'IMPLEMENTATION', 'IN_PROGRESS', 'TODO'].includes(signals.stage);
}

function isQaAction(signals) {
  return /qa|verification|re-test|retest|test result/.test(signals.actionText) || ['QA_TESTING', 'VERIFY'].includes(signals.stage);
}

function isSreAction(signals) {
  return /sre|monitoring|rollout|approval/.test(signals.actionText) || signals.stage === 'SRE_MONITORING' || Boolean(signals.monitoring);
}

function noControls(roles, reason) {
  return {
    action: 'read_only_status',
    controlsAvailable: false,
    primaryHref: null,
    primaryLabel: null,
    reason,
  };
}

function baseAction(role, signals) {
  return {
    action: 'passive_monitoring',
    controlsAvailable: userCanAct([role]),
    evidence: [],
    primaryHref: ROLE_SECTION_LINKS[role] || '#task-detail-history-section',
    primaryLabel: 'Open relevant section',
    reason: 'No immediate user action is required; keep status, ownership, freshness, history, and telemetry visible.',
    role,
    roleLabel: ROLE_LABELS[role] || ROLE_LABELS.reader,
    secondaryLinks: [
      { href: '#task-detail-history-section', label: 'History and telemetry' },
      { href: '#task-detail-discussion-section', label: 'Discussion' },
    ],
    statusFacts: statusFacts(signals),
    title: 'No immediate action',
    tone: signals.isStale ? 'warning' : 'neutral',
  };
}

function statusFacts(signals) {
  const facts = [
    { label: 'State', value: signals.isDone ? 'Done' : signals.isBlocked ? 'Blocked' : signals.waitingState ? 'Waiting' : signals.stage || 'Active' },
    { label: 'Owner', value: signals.currentOwner },
    { label: 'Freshness', value: signals.lastUpdatedAt ? `${signals.freshness} · ${signals.lastUpdatedAt}` : signals.freshness },
  ];
  if (signals.pmRefinementStatus) facts.push(signals.pmRefinementStatus);
  return facts;
}

function pmAction(role, signals) {
  if (signals.isUnassigned) {
    return {
      ...baseAction(role, signals),
      action: 'pm_assignment',
      primaryHref: '#task-detail-assignment-panel',
      primaryLabel: 'Assign owner',
      reason: 'The task has no current owner, so assignment is the fastest way to move it forward.',
      title: 'Assign the next owner',
      tone: 'warning',
    };
  }

  return {
    ...baseAction(role, signals),
    action: 'pm_refinement',
    evidence: ['Business context', 'Acceptance criteria', 'Definition of Done', 'Deferred Considerations decision path'],
    primaryHref: '#task-detail-overview-section',
    primaryLabel: 'Review PM context',
    reason: signals.primaryNextAction || 'Finalize PM context and routing before downstream work continues.',
    title: 'PM refinement required',
    tone: 'warning',
  };
}

function architectAction(role, signals) {
  return {
    ...baseAction(role, signals),
    action: 'architect_handoff',
    evidence: ['Technical summary', 'Scope and constraints', 'Monitoring specification', 'Engineer tier rationale'],
    primaryHref: '#task-detail-delivery-section',
    primaryLabel: 'Open engineering handoff',
    reason: signals.primaryNextAction || 'Convert PM context into a reviewable technical handoff.',
    title: 'Architect handoff required',
    tone: 'info',
  };
}

function engineerAction(role, signals) {
  return {
    ...baseAction(role, signals),
    action: 'engineer_implementation_handoff',
    evidence: ['Commit SHA or GitHub PR URL', 'Progress check-in evidence', 'Open blockers or escalation reason'],
    primaryHref: '#task-detail-delivery-section',
    primaryLabel: 'Submit implementation handoff',
    reason: signals.primaryNextAction || 'Record the implementation reference or check-in that unblocks QA.',
    title: 'Engineer implementation update',
    tone: 'info',
  };
}

function qaAction(role, signals) {
  return {
    ...baseAction(role, signals),
    action: 'qa_verification',
    evidence: ['Outcome', 'QA summary', 'Scenarios', 'Findings', 'Failure context for fail-back routes'],
    primaryHref: '#task-detail-qa-section',
    primaryLabel: 'Submit QA result',
    reason: signals.primaryNextAction || 'QA verification should capture the result and route the task forward or back with evidence.',
    title: 'QA verification required',
    tone: 'warning',
  };
}

function sreAction(role, signals) {
  const monitoring = signals.monitoring || {};
  const reason = monitoring.escalation
    ? 'Monitoring expired or escalated; review the blocking reason before approval.'
    : signals.primaryNextAction || 'SRE should verify rollout state, expiry, approval readiness, and telemetry drilldowns.';

  return {
    ...baseAction(role, signals),
    action: 'sre_monitoring',
    evidence: ['Deployment snapshot', 'Window expiry', 'Telemetry freshness', 'Approval or blocking reason'],
    primaryHref: '#task-detail-sre-section',
    primaryLabel: monitoring.canApprove ? 'Approve monitoring' : monitoring.canStart ? 'Start monitoring window' : 'Review monitoring state',
    reason,
    statusFacts: [
      ...statusFacts(signals),
      { label: 'Monitoring', value: monitoring.state || signals.stage || 'unknown' },
      { label: 'Expiry', value: monitoring.timeRemainingLabel || monitoring.windowEndsAt || 'Not started' },
    ],
    title: 'SRE monitoring action',
    tone: monitoring.escalation || monitoring.expired || signals.isBlocked ? 'danger' : 'warning',
  };
}

function humanAction(role, signals) {
  return {
    ...baseAction(role, signals),
    action: 'human_decision',
    evidence: ['Escalation summary', 'Recommendation', 'Decision readiness', 'Latest PM/Architect recommendation'],
    primaryHref: '#task-detail-close-review-section',
    primaryLabel: 'Review decision',
    reason: signals.closeGovernance?.humanDecision?.summary || signals.primaryNextAction || 'A human decision is required before close review can proceed.',
    title: 'Human decision required',
    tone: 'danger',
  };
}

function blockedAction(role, signals) {
  return {
    ...baseAction(role, signals),
    action: 'blocked_or_waiting',
    controlsAvailable: userCanAct([role]),
    primaryHref: '#task-detail-discussion-section',
    primaryLabel: 'Open blockers and discussion',
    reason: signals.blockedReason || signals.primaryNextAction || 'The task is blocked or waiting on another workflow signal.',
    title: signals.isBlocked ? 'Task is blocked' : 'Task is waiting',
    tone: signals.isBlocked ? 'danger' : 'warning',
  };
}

export function resolveTaskDetailNextAction(screen = {}, principal = {}) {
  const roles = normalizeTaskDetailRoles(principal);
  const signals = taskSignals(screen);
  const role = pickRole(roles, signals);

  if (!userCanAct(roles)) {
    return {
      ...baseAction('reader', signals),
      ...noControls(roles, signals.blockedReason || signals.primaryNextAction || 'This session can inspect status and audit context only.'),
      role: 'reader',
      roleLabel: ROLE_LABELS.reader,
      secondaryLinks: [
        { href: '#task-detail-history-section', label: 'History and telemetry' },
        { href: '#task-detail-discussion-section', label: 'Discussion' },
      ],
      title: signals.isBlocked ? 'Status only: blocked' : 'Status only',
      tone: signals.isBlocked ? 'danger' : signals.isStale ? 'warning' : 'neutral',
    };
  }

  if (signals.isDone) {
    return {
      ...baseAction(role, signals),
      action: 'done_passive_review',
      primaryHref: '#task-detail-history-section',
      primaryLabel: 'Review closeout history',
      reason: 'The task is complete. History, telemetry, and closeout context remain available for audit.',
      title: 'Task is complete',
      tone: 'success',
    };
  }

  if (signals.isBlocked && !['pm', 'qa', 'sre', 'human'].includes(role)) return blockedAction(role, signals);
  if (role === 'pm' && isPmAction(signals)) return pmAction(role, signals);
  if (role === 'qa' && isQaAction(signals)) return qaAction(role, signals);
  if (role === 'sre' && isSreAction(signals)) return sreAction(role, signals);
  if (role === 'human' && (signals.closeGovernance?.humanDecision?.required || /human|stakeholder|escalation/.test(signals.actionText))) {
    return humanAction(role, signals);
  }
  if (role === 'architect' && isArchitectAction(signals)) return architectAction(role, signals);
  if (role === 'engineer' && isEngineerAction(signals)) return engineerAction(role, signals);
  if (signals.isBlocked || signals.waitingState) return blockedAction(role, signals);

  return baseAction(role, signals);
}

export function taskDetailNextActionMetric(action) {
  return {
    action: action.action,
    role: action.role,
    tone: action.tone,
  };
}
