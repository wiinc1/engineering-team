import React from 'react';
import { createTaskDetailApiClient, toHistoryTimelineItem } from '../features/task-detail/adapter.browser';
import { createTaskDetailPageModule } from '../features/task-detail/route.browser';
import { writeTaskDetailUrlState } from '../features/task-detail/urlState';
import { TaskDetailActivityShell } from '../features/task-detail/TaskDetailActivityShell';
import { StageTransition } from '../features/task-detail/StageTransition';
import { TaskCreationPage } from '../features/task-creation/TaskCreationPage';
import {
  beginOidcSignIn,
  buildOidcLogoutUrl,
  buildAuthHeaders,
  completeOidcSignIn,
  fetchCurrentSession,
  hasSessionExpired,
  isAuthenticatedSession,
  logoutSession,
  readAuthRuntimeConfig,
  readBrowserSessionConfig,
  readSessionClaims,
  requestMagicLinkSignIn,
  resolveApiBaseUrl,
  sanitizeNextRoute,
  splitRouteTarget,
  writeBrowserSessionConfig,
} from './session.browser';
import {
  buildBoardColumns,
  buildGovernanceReviewItems,
  buildPmOverviewSections,
  buildRoleInboxItems,
  filterTaskList,
  getPmOverviewBucketLabel,
  getRoleInboxLabel,
  mapAgentOptions,
  PM_OVERVIEW_BUCKET_ORDER,
  resolveOwnerPresentation,
  ROLE_INBOXES,
  summarizeListResults,
  summarizePmOverviewResults,
  summarizeRoleInboxResults,
  UNASSIGNED_FILTER_VALUE,
} from './task-owner.mjs';
import {
  buildBoardStageOrder,
  canTransitionLifecycleTask,
  isLifecycleStage,
  isTaskAssignedToCurrentActor,
  matchesTaskSearch,
} from './work-lifecycle.mjs';

const envApiBaseUrl = (import.meta.env.VITE_TASK_API_BASE_URL || '').trim();
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const GITHUB_PR_URL_PATTERN = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+(?:\/?\S*)?$/i;
const WORKFLOW_COMMENT_TYPES = [
  { value: 'question', label: 'Question' },
  { value: 'escalation', label: 'Escalation' },
  { value: 'consultation', label: 'Consultation' },
  { value: 'decision', label: 'Decision' },
  { value: 'note', label: 'Note' },
];
const WORKFLOW_NOTIFICATION_TARGET_LABELS = {
  pm: 'PM',
  architect: 'Architect',
  engineer: 'Engineer',
  qa: 'QA',
  sre: 'SRE',
  followers: 'Followers',
};
const SIGN_IN_PATH = '/sign-in';
const AUTH_CALLBACK_PATH = '/auth/callback';
const ADMIN_USERS_PATH = '/admin/users';
const SIGN_IN_TIMEOUT_MS = 5000;

function matchSignInRoute(pathname = '') {
  return ((pathname || '').replace(/\/+$/, '') || '/') === SIGN_IN_PATH;
}

function matchAuthCallbackRoute(pathname = '') {
  return ((pathname || '').replace(/\/+$/, '') || '/') === AUTH_CALLBACK_PATH;
}

function matchAdminUsersRoute(pathname = '') {
  return ((pathname || '').replace(/\/+$/, '') || '/') === ADMIN_USERS_PATH;
}

function isProtectedRoute(pathname = '') {
  const normalizedPath = ((pathname || '').replace(/\/+$/, '') || '/');
  return normalizedPath === '/'
    || matchTaskListRoute(normalizedPath)
    || matchCreateTaskRoute(normalizedPath)
    || Boolean(matchRoleInboxRoute(normalizedPath))
    || matchAdminUsersRoute(normalizedPath)
    || Boolean(matchPmOverviewRoute(normalizedPath))
    || Boolean(matchGovernanceOverviewRoute(normalizedPath))
    || Boolean(readRouteTask(normalizedPath));
}

function buildSignInSearch(nextPath = '/tasks', reason = '') {
  const params = new URLSearchParams();
  const next = sanitizeNextRoute(nextPath);
  if (next && next !== '/tasks') params.set('next', next);
  if (reason) params.set('reason', reason);
  const query = params.toString();
  return query ? `?${query}` : '';
}

function readSignInState(search = '') {
  const params = new URLSearchParams(search);
  return {
    next: sanitizeNextRoute(params.get('next') || '/tasks'),
    reason: params.get('reason') || '',
  };
}

function defaultSignInDraft(apiBaseUrl = '') {
  return {
    apiBaseUrl,
    authCode: '',
    email: '',
  };
}

function getSignInReasonMessage(reason = '') {
  switch (String(reason || '').trim()) {
    case 'expired':
      return 'Your session expired. Sign in again to continue.';
    case 'signed_out':
      return 'You signed out of the workflow app.';
    case 'expired_magic_link':
    case 'invalid_magic_link':
    case 'replayed_magic_link':
    case 'magic_link_failed':
      return 'That sign-in link could not be used. Request a new link to continue.';
    default:
      return '';
  }
}

function toSessionConfigFromExchange(data, apiBaseUrl) {
  return writeBrowserSessionConfig({
    bearerToken: data?.accessToken || '',
    apiBaseUrl,
    expiresAt: data?.expiresAt || '',
  });
}

async function exchangeSessionForAuthCode({ apiBaseUrl, authCode, fetchImpl = window.fetch.bind(window) }) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), SIGN_IN_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${apiBaseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authCode }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || 'Sign-in failed.');
    }
    return payload?.data || {};
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Sign-in timed out. Try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function readRouteTask(pathname) {
  const match = ((pathname || '').replace(/\/+$/, '') || '/').match(/^\/tasks\/([^/]+)$/);
  return match ? { taskId: decodeURIComponent(match[1]) } : null;
}

function matchTaskListRoute(pathname = '') {
  return ((pathname || '').replace(/\/+$/, '') || '/') === '/tasks';
}

function matchCreateTaskRoute(pathname = '') {
  return ((pathname || '').replace(/\/+$/, '') || '/') === '/tasks/create';
}

function matchRoleInboxRoute(pathname = '') {
  const normalizedPath = ((pathname || '').replace(/\/+$/, '') || '/');
  const match = normalizedPath.match(/^\/inbox\/(pm|architect|engineer|qa|sre|human)$/);
  return match ? { role: match[1] } : null;
}

function matchPmOverviewRoute(pathname = '') {
  const normalizedPath = ((pathname || '').replace(/\/+$/, '') || '/');
  return normalizedPath === '/overview/pm' ? { scope: 'pm' } : null;
}

function matchGovernanceOverviewRoute(pathname = '') {
  const normalizedPath = ((pathname || '').replace(/\/+$/, '') || '/');
  return normalizedPath === '/overview/governance' ? { scope: 'governance' } : null;
}

function readTaskListRouteState(search = '') {
  const params = new URLSearchParams(search);
  const owner = params.get('owner') || '';
  const view = params.get('view') === 'board' ? 'board' : 'list';
  const bucket = params.get('bucket') || '';
  const priority = params.get('priority') || '';
  const status = params.get('status') || '';
  const searchTerm = params.get('search') || '';
  return { owner, view, bucket, priority, status, searchTerm };
}

function writeTaskListUrlState({ owner, view, bucket, priority, status, searchTerm }, search = '') {
  const params = new URLSearchParams(search);
  const nextOwner = owner ?? params.get('owner') ?? '';
  const nextView = view ?? (params.get('view') === 'board' ? 'board' : 'list');
  const nextBucket = bucket ?? params.get('bucket') ?? '';
  const nextPriority = priority ?? params.get('priority') ?? '';
  const nextStatus = status ?? params.get('status') ?? '';
  const nextSearch = searchTerm ?? params.get('search') ?? '';
  if (nextOwner) params.set('owner', nextOwner);
  else params.delete('owner');
  if (nextView === 'board') params.set('view', 'board');
  else params.delete('view');
  if (nextBucket) params.set('bucket', nextBucket);
  else params.delete('bucket');
  if (nextPriority) params.set('priority', nextPriority);
  else params.delete('priority');
  if (nextStatus) params.set('status', nextStatus);
  else params.delete('status');
  if (nextSearch) params.set('search', nextSearch);
  else params.delete('search');
  const next = params.toString();
  return next ? `?${next}` : '';
}

function buildLoadingModel(pathname, search) {
  const route = readRouteTask(pathname);
  return {
    kind: 'detail',
    route: route
      ? { pathname: `/tasks/${encodeURIComponent(route.taskId)}`, taskId: route.taskId }
      : { pathname, taskId: null },
    summary: {
      taskId: route?.taskId ?? null,
      tenantId: null,
      title: 'Loading task detail…',
      priority: null,
      currentStage: null,
      currentOwner: null,
      blocked: false,
      waitingState: null,
      nextRequiredAction: null,
      freshness: null,
      statusIndicator: 'unknown',
      closed: false,
    },
    shell: {
      selectedTab: new URLSearchParams(search).get('tab') === 'telemetry' ? 'telemetry' : 'history',
      filters: {},
      historyState: { kind: 'loading', message: 'Loading task history.' },
      telemetryState: { kind: 'loading', message: 'Loading task telemetry.' },
      historyItems: [],
      telemetryCards: [],
      historyPageInfo: null,
      telemetryAccess: null,
    },
  };
}

function buildListLoadingModel(pathname, search) {
  const roleInbox = matchRoleInboxRoute(pathname);
  const pmOverview = matchPmOverviewRoute(pathname);
  const governanceOverview = matchGovernanceOverviewRoute(pathname);
  return {
    kind: 'list',
    route: { pathname: roleInbox ? `/inbox/${roleInbox.role}` : pmOverview ? '/overview/pm' : governanceOverview ? '/overview/governance' : '/tasks', taskId: null },
    list: {
      filters: readTaskListRouteState(search),
      items: [],
      state: { kind: 'loading', message: roleInbox ? `Loading ${getRoleInboxLabel(roleInbox.role)} inbox.` : pmOverview ? 'Loading PM overview.' : governanceOverview ? 'Loading governance reviews.' : 'Loading task list.' },
      resultSummary: '',
      inboxRole: roleInbox?.role || null,
      isPmOverview: Boolean(pmOverview),
      isGovernanceOverview: Boolean(governanceOverview),
    },
  };
}

function matchTaskRoute(pathname) {
  return Boolean(readRouteTask(pathname));
}

function buildRouteMissModel(pathname) {
  return {
    kind: 'detail',
    route: { pathname, taskId: null },
    summary: {
      taskId: null,
      tenantId: null,
      title: 'Task detail route not found',
      priority: null,
      currentStage: null,
      currentOwner: null,
      blocked: false,
      waitingState: null,
      nextRequiredAction: null,
      freshness: null,
      statusIndicator: 'unknown',
      closed: false,
    },
    shell: {
      selectedTab: 'history',
      filters: {},
      historyState: { kind: 'error', message: 'Open a task detail route like /tasks/TSK-42.' },
      telemetryState: { kind: 'error', message: 'Open a task detail route like /tasks/TSK-42.' },
      historyItems: [],
      telemetryCards: [],
      historyPageInfo: null,
      telemetryAccess: null,
    },
  };
}

function formatFreshness(summary) {
  if (!summary?.freshness?.last_updated_at) return '—';
  return `${summary.freshness.status || 'unknown'} · ${summary.freshness.last_updated_at}`;
}

function formatStatusLabel(status) {
  switch (status) {
    case 'blocked': return 'Blocked';
    case 'waiting': return 'Waiting';
    case 'done': return 'Done';
    default: return 'Active';
  }
}

function formatBlockedStateLabel(blockedState, fallbackStatus) {
  if (blockedState?.label) return blockedState.label;
  if (fallbackStatus === 'blocked') return 'Blocked';
  if (fallbackStatus === 'waiting') return 'Waiting';
  return 'Active';
}

function formatFreezeScopeLabels(freezeScope = []) {
  return freezeScope.map((item) => {
    if (item === 'stage_transitions') return 'Stage changes paused';
    if (item === 'closure') return 'Closure paused';
    return String(item || '').trim();
  }).filter(Boolean);
}

function renderBlockerMeta(blocker = {}) {
  const entries = [
    blocker.source ? `Source: ${blocker.source}` : null,
    blocker.owner?.label ? `Owner: ${blocker.owner.label}` : 'Owner: No owner',
    blocker.ageLabel ? `Age: ${blocker.ageLabel}` : null,
  ].filter(Boolean);

  return entries.join(' · ');
}

function formatReviewQuestionState(state) {
  switch (state) {
    case 'answered':
      return 'Answered, awaiting PM resolution';
    case 'resolved':
      return 'Resolved';
    default:
      return 'Open, awaiting PM response';
  }
}

function formatStatusIcon(status) {
  switch (status) {
    case 'blocked': return '⛔';
    case 'waiting': return '⏳';
    case 'done': return '✅';
    default: return '▶';
  }
}

function isIntakeDraftTask(item = {}) {
  return Boolean(item.intake_draft || item.intakeDraft || item.context?.intakeDraft);
}

function formatCloseGovernanceChecklistLabel(status) {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'blocked':
      return 'Blocked';
    case 'missing':
      return 'Missing';
    default:
      return 'Pending';
  }
}

function formatCloseGovernanceHeadline(state) {
  switch (state) {
    case 'ready':
      return 'Close readiness satisfied';
    case 'blocked':
      return 'Close readiness blocked';
    case 'missing_inputs':
      return 'Close readiness missing inputs';
    default:
      return 'Close readiness pending';
  }
}

function formatCloseGovernanceDecisionStatus(status) {
  switch (status) {
    case 'approved':
      return 'Human decision approved';
    case 'rejected':
      return 'Human decision rejected';
    case 'requested_more_context':
      return 'Human decision requested more context';
    case 'awaiting_decision':
      return 'Awaiting human decision';
    default:
      return 'Human decision not required';
  }
}

function formatOrchestrationItemStateLabel(state) {
  switch (state) {
    case 'ready':
      return 'Ready';
    case 'running':
      return 'Running';
    case 'blocked':
      return 'Blocked';
    case 'failed':
      return 'Fallback';
    case 'completed':
      return 'Completed';
    default:
      return 'Unknown';
  }
}

function formatDependencyStateLabel(state) {
  switch (state) {
    case 'ready':
      return 'Ready to dispatch';
    case 'in_progress':
      return 'Already in progress';
    case 'blocked':
      return 'Blocked by dependency';
    case 'done':
      return 'Done';
    default:
      return 'Unknown';
  }
}

function normalizeArchitectHandoffDraft(handoff = {}) {
  return {
    readyForEngineering: Boolean(handoff.readyForEngineering),
    engineerTier: handoff.engineerTier || 'Sr',
    tierRationale: handoff.tierRationale || '',
    technicalSpec: {
      summary: handoff.technicalSpec?.summary || '',
      scope: handoff.technicalSpec?.scope || '',
      design: handoff.technicalSpec?.design || '',
      rolloutPlan: handoff.technicalSpec?.rolloutPlan || '',
    },
    monitoringSpec: {
      service: handoff.monitoringSpec?.service || '',
      dashboardUrls: Array.isArray(handoff.monitoringSpec?.dashboardUrls) ? handoff.monitoringSpec.dashboardUrls.join('\n') : '',
      alertPolicies: Array.isArray(handoff.monitoringSpec?.alertPolicies) ? handoff.monitoringSpec.alertPolicies.join('\n') : '',
      runbook: handoff.monitoringSpec?.runbook || '',
      successMetrics: Array.isArray(handoff.monitoringSpec?.successMetrics) ? handoff.monitoringSpec.successMetrics.join('\n') : '',
    },
  };
}

function engineerTierDescription(tier) {
  switch (tier) {
    case 'Principal':
      return 'Complex cross-team implementation with high-risk technical ownership.';
    case 'Jr':
      return 'Well-bounded implementation with close guidance and review.';
    default:
      return 'Standard implementation scope with experienced engineer ownership.';
  }
}

function normalizeEngineerSubmissionDraft(submission = {}) {
  return {
    commitSha: submission.commitSha || '',
    prUrl: submission.prUrl || '',
  };
}

function normalizeSkillEscalationDraft(escalation = {}) {
  return {
    reason: escalation.reason || '',
  };
}

function normalizeCheckInDraft(activity = {}) {
  return {
    summary: activity.lastActivity?.summary || '',
    evidence: Array.isArray(activity.lastActivity?.evidence) ? activity.lastActivity.evidence.join('\n') : '',
  };
}

function normalizeRetierDraft(context = {}) {
  return {
    engineerTier: context.retiering?.engineerTier || context.architectHandoff?.engineerTier || 'Sr',
    tierRationale: context.retiering?.tierRationale || '',
    reason: context.retiering?.reason || '',
  };
}

function normalizeReassignmentDraft(context = {}) {
  return {
    mode: context.reassignment?.mode || 'inactivity',
    reason: context.reassignment?.reason || '',
    assignee: context.reassignment?.assignee || '',
    engineerTier: context.reassignment?.engineerTier || context.retiering?.engineerTier || context.architectHandoff?.engineerTier || '',
  };
}

function validateEngineerSubmissionDraft(draft = {}) {
  const commitSha = String(draft.commitSha || '').trim();
  const prUrl = String(draft.prUrl || '').trim();
  const invalidFields = [];

  if (commitSha && !COMMIT_SHA_PATTERN.test(commitSha)) invalidFields.push('commitSha');
  if (prUrl && !GITHUB_PR_URL_PATTERN.test(prUrl)) invalidFields.push('prUrl');

  return {
    commitSha,
    prUrl,
    missingAll: !commitSha && !prUrl,
    invalidFields,
    isValid: invalidFields.length === 0 && (Boolean(commitSha) || Boolean(prUrl)),
    primaryReference: prUrl || commitSha || null,
  };
}

function normalizeWorkflowThreadDraft(thread = {}) {
  return {
    commentType: thread.commentType || 'question',
    title: thread.title || '',
    body: thread.body || '',
    blocking: Boolean(thread.blocking),
    linkedEventId: thread.linkedEventId || '',
  };
}

function normalizeQaResultDraft(result = {}) {
  return {
    outcome: result.outcome || 'fail',
    summary: result.summary || '',
    scenarios: Array.isArray(result.scenarios) ? result.scenarios.join('\n') : '',
    findings: Array.isArray(result.findings) ? result.findings.join('\n') : '',
    reproductionSteps: Array.isArray(result.reproductionSteps) ? result.reproductionSteps.join('\n') : '',
    stackTraces: Array.isArray(result.stackTraces) ? result.stackTraces.join('\n') : '',
    envLogs: Array.isArray(result.envLogs) ? result.envLogs.join('\n') : '',
    retestScope: Array.isArray(result.reTestScope) ? result.reTestScope.join('\n') : '',
  };
}

function normalizeSreMonitoringStartDraft(monitoring = {}) {
  return {
    deploymentEnvironment: monitoring.deployment?.environment || 'production',
    deploymentUrl: monitoring.deployment?.url || '',
    deploymentVersion: monitoring.deployment?.version || '',
    evidence: Array.isArray(monitoring.deployment?.evidence) ? monitoring.deployment.evidence.join('\n') : '',
  };
}

function normalizeSreApprovalDraft(monitoring = {}) {
  return {
    reason: monitoring.approval?.reason || '',
    evidence: Array.isArray(monitoring.approval?.evidence) ? monitoring.approval.evidence.join('\n') : '',
  };
}

function normalizeMonitoringAnomalyChildDraft(detail = {}) {
  const monitoring = detail?.context?.sreMonitoring || {};
  const telemetrySummary = detail?.telemetry?.summary || {};
  const anomalyContext = detail?.context?.anomalyChildTask || {};
  const prefill = anomalyContext.prefill || {};
  const firstSignal = Object.entries(telemetrySummary).find(([, value]) => value != null && value !== '');
  const defaultMetric = firstSignal ? `${firstSignal[0]}: ${String(firstSignal[1])}` : '';
  const logsLink = monitoring.telemetry?.drilldowns?.logs || '';
  const metricsLink = monitoring.telemetry?.drilldowns?.metrics || '';
  const tracesLink = monitoring.telemetry?.drilldowns?.traces || '';
  return {
    title: anomalyContext.summary
      ? `Investigate ${anomalyContext.service || 'production'} anomaly for ${detail?.task?.id || 'task'}`
      : `Investigate ${monitoring.architectMonitoringSpec?.service || 'production'} anomaly for ${detail?.task?.id || 'task'}`,
    service: anomalyContext.service || prefill.service || monitoring.architectMonitoringSpec?.service || '',
    anomalySummary: anomalyContext.summary || prefill.anomalySummary || (detail?.summary?.nextAction?.label ? `Follow up on ${detail.summary.nextAction.label.toLowerCase()}.` : ''),
    metrics: anomalyContext.metrics?.length ? anomalyContext.metrics.join('\n') : Array.isArray(prefill.metrics) && prefill.metrics.length ? prefill.metrics.join('\n') : defaultMetric,
    logs: anomalyContext.logs?.length ? anomalyContext.logs.join('\n') : Array.isArray(prefill.logs) && prefill.logs.length ? prefill.logs.join('\n') : logsLink,
    errorSamples: anomalyContext.errorSamples?.length ? anomalyContext.errorSamples.join('\n') : Array.isArray(prefill.errorSamples) && prefill.errorSamples.length ? prefill.errorSamples.join('\n') : [metricsLink, tracesLink].filter(Boolean).join('\n'),
  };
}

function normalizePmBusinessContextDraft(detail = {}) {
  return {
    businessContext: detail?.context?.businessContext || '',
  };
}

function normalizeCloseCancellationDraft(detail = {}) {
  const recommendation = detail?.context?.closeGovernance?.cancellation?.recommendations?.pm
    || detail?.context?.closeGovernance?.cancellation?.recommendations?.architect
    || null;
  return {
    summary: recommendation?.summary || '',
    rationale: recommendation?.rationale || '',
  };
}

function normalizeExceptionalDisputeDraft(detail = {}) {
  const escalation = detail?.context?.closeGovernance?.escalation || null;
  return {
    summary: escalation?.summary || '',
    rationale: escalation?.rationale || '',
    recommendation: escalation?.recommendation || '',
    severity: escalation?.severity || 'high',
  };
}

function normalizeHumanCloseDecisionDraft(detail = {}) {
  const latestDecision = detail?.context?.closeGovernance?.humanDecision?.latestDecision || null;
  return {
    outcome: latestDecision?.outcome || 'approve',
    summary: latestDecision?.summary || '',
    rationale: latestDecision?.rationale || '',
  };
}

function normalizeHumanInboxDecisionDraft(item = {}) {
  const latestDecision = item?.close_governance?.humanDecision?.latestDecision || null;
  return {
    outcome: latestDecision?.outcome || 'approve',
    summary: latestDecision?.summary || '',
    rationale: latestDecision?.rationale || '',
  };
}

function normalizeCloseBacktrackDraft(detail = {}) {
  const backtrack = detail?.context?.closeGovernance?.backtrack || {};
  return {
    reasonCode: backtrack?.latestReasonCode || 'criteria_gap',
    rationale: backtrack?.latestReason || '',
    agreementArtifact: '',
    summary: '',
  };
}

function splitTextareaLines(value) {
  return String(value || '')
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatWorkflowCommentType(type) {
  const match = WORKFLOW_COMMENT_TYPES.find((entry) => entry.value === type);
  return match ? match.label : 'Note';
}

function defaultWorkflowNotificationTargets(commentType, blocking) {
  switch (commentType) {
    case 'question':
      return blocking ? ['pm', 'architect'] : ['architect'];
    case 'escalation':
      return ['pm', 'engineer', 'sre'];
    case 'consultation':
      return ['architect', 'engineer'];
    case 'decision':
      return ['pm', 'architect', 'engineer', 'qa'];
    default:
      return blocking ? ['pm', 'architect'] : ['followers'];
  }
}

function formatWorkflowNotificationTarget(target) {
  return WORKFLOW_NOTIFICATION_TARGET_LABELS[target] || String(target || '').trim() || 'Unknown';
}

function deriveQaDraftMissingFields(draft = {}) {
  if (draft.outcome !== 'fail') return [];
  const checks = [
    ['scenarios', splitTextareaLines(draft.scenarios)],
    ['findings', splitTextareaLines(draft.findings)],
    ['reproduction steps', splitTextareaLines(draft.reproductionSteps)],
    ['stack traces', splitTextareaLines(draft.stackTraces)],
    ['environment logs', splitTextareaLines(draft.envLogs)],
  ];
  return checks.filter(([, entries]) => entries.length === 0).map(([label]) => label);
}

function isImplementationStage(stage) {
  return ['IMPLEMENT', 'IMPLEMENTATION', 'IN_PROGRESS'].includes(String(stage || '').toUpperCase());
}

function renderList(items, emptyLabel) {
  if (!items || !items.length) {
    return <p className="empty-copy">{emptyLabel}</p>;
  }

  return (
    <ul className="detail-bullets">
      {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
    </ul>
  );
}

function canManageAssignment(tokenClaims) {
  const roles = Array.isArray(tokenClaims?.roles) ? tokenClaims.roles : [];
  return roles.includes('pm') || roles.includes('admin');
}

function hasAnyRole(tokenClaims, expectedRoles) {
  const roles = (Array.isArray(tokenClaims?.roles) ? tokenClaims.roles : [])
    .map((role) => String(role || '').trim().toLowerCase())
    .filter(Boolean)
    .map((role) => role === 'stakeholder' ? 'human' : role);
  const normalizedExpected = expectedRoles
    .map((role) => String(role || '').trim().toLowerCase())
    .filter(Boolean)
    .map((role) => role === 'stakeholder' ? 'human' : role);
  return normalizedExpected.some((role) => roles.includes(role));
}

function normalizeAdminRoles(value) {
  const roles = Array.isArray(value) ? value : String(value || '').split(',');
  return roles.map((role) => String(role || '').trim()).filter(Boolean);
}

function toAdminUserDraft(user = {}) {
  return {
    tenantId: user.tenantId || '',
    actorId: user.actorId || '',
    roles: normalizeAdminRoles(user.roles).join(', '),
    status: String(user.status || 'active').trim().toLowerCase() === 'disabled' ? 'disabled' : 'active',
  };
}

function toAdminUserDrafts(users = []) {
  return users.reduce((drafts, user) => {
    if (user?.userId) drafts[user.userId] = toAdminUserDraft(user);
    return drafts;
  }, {});
}

function canAskReviewQuestion(tokenClaims) {
  return hasAnyRole(tokenClaims, ['architect', 'admin']);
}

function canManageArchitectHandoff(tokenClaims) {
  return hasAnyRole(tokenClaims, ['architect', 'admin']);
}

function canManageEngineerSubmission(tokenClaims) {
  return hasAnyRole(tokenClaims, ['engineer', 'admin']);
}

function canRequestSkillEscalation(tokenClaims) {
  return hasAnyRole(tokenClaims, ['engineer', 'admin']);
}

function canManageReassignmentGhosting(tokenClaims) {
  return hasAnyRole(tokenClaims, ['architect', 'admin']);
}

function canManageSreMonitoring(tokenClaims) {
  return hasAnyRole(tokenClaims, ['sre', 'admin']);
}

function canCompletePmBusinessContext(tokenClaims) {
  return hasAnyRole(tokenClaims, ['pm', 'admin']);
}

function canAnswerReviewQuestion(tokenClaims) {
  return hasAnyRole(tokenClaims, ['pm', 'admin']);
}

function canResolveReviewQuestion(tokenClaims) {
  return hasAnyRole(tokenClaims, ['pm', 'admin']);
}

function canReopenReviewQuestion(tokenClaims) {
  return hasAnyRole(tokenClaims, ['architect', 'pm', 'admin']);
}

function canRecordCloseCancellationRecommendation(tokenClaims) {
  return hasAnyRole(tokenClaims, ['pm', 'architect', 'admin']);
}

function canRecordHumanCloseDecision(tokenClaims) {
  return hasAnyRole(tokenClaims, ['human', 'stakeholder', 'admin']);
}

function canRequestCloseReviewBacktrack(tokenClaims) {
  return hasAnyRole(tokenClaims, ['pm', 'architect', 'admin']);
}

function getEffectiveEngineerTierFromDetail(detail) {
  return detail?.context?.retiering?.engineerTier
    || detail?.context?.architectHandoff?.engineerTier
    || null;
}

function formatReviewQuestionActionLabel(eventType) {
  switch (eventType) {
    case 'task.review_question_asked':
      return 'Question asked';
    case 'task.review_question_answered':
      return 'Answer recorded';
    case 'task.review_question_resolved':
      return 'Resolved';
    case 'task.review_question_reopened':
      return 'Reopened';
    default:
      return 'Update recorded';
  }
}

function useLocationState() {
  const [locationState, setLocationState] = React.useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));

  React.useEffect(() => {
    const onPopState = () => {
      setLocationState({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = React.useCallback((pathname, search = '', options = {}) => {
    const nextUrl = `${pathname}${search}`;
    if (options.replace) window.history.replaceState({}, '', nextUrl);
    else window.history.pushState({}, '', nextUrl);
    setLocationState({ pathname, search });
  }, []);

  return [locationState, navigate];
}

export function App() {
  const [{ pathname, search }, navigate] = useLocationState();
  const [sessionConfig, setSessionConfig] = React.useState(() => readBrowserSessionConfig());
  const [, setSessionProbeDone] = React.useState(() => Boolean(readBrowserSessionConfig().bearerToken || readBrowserSessionConfig().actorId));
  const [signInDraft, setSignInDraft] = React.useState(() => defaultSignInDraft(readBrowserSessionConfig().apiBaseUrl || envApiBaseUrl));
  const [signInStatus, setSignInStatus] = React.useState({ kind: 'idle', message: '' });
  const [authNotice, setAuthNotice] = React.useState('');
  const [model, setModel] = React.useState(() => {
    if (matchTaskListRoute(pathname) || matchRoleInboxRoute(pathname) || matchPmOverviewRoute(pathname) || matchGovernanceOverviewRoute(pathname)) return buildListLoadingModel(pathname, search);
    return matchTaskRoute(pathname) ? buildLoadingModel(pathname, search) : buildRouteMissModel(pathname);
  });
  const [agentOptions, setAgentOptions] = React.useState([]);
  const [agentOptionsState, setAgentOptionsState] = React.useState({ kind: 'loading', message: 'Loading canonical role roster.' });
  const [assignmentDraft, setAssignmentDraft] = React.useState('');
  const [assignmentStatus, setAssignmentStatus] = React.useState({ kind: 'idle', message: '' });
  const [historyLoadMoreState, setHistoryLoadMoreState] = React.useState({ kind: 'idle', message: '' });
  const [newReviewQuestionDraft, setNewReviewQuestionDraft] = React.useState('');
  const [newReviewQuestionBlocking, setNewReviewQuestionBlocking] = React.useState(true);
  const [reviewQuestionDrafts, setReviewQuestionDrafts] = React.useState({});
  const [reviewQuestionStatus, setReviewQuestionStatus] = React.useState({ kind: 'idle', message: '', questionId: null, action: null });
  const [architectHandoffDraft, setArchitectHandoffDraft] = React.useState(() => normalizeArchitectHandoffDraft());
  const [architectHandoffStatus, setArchitectHandoffStatus] = React.useState({ kind: 'idle', message: '' });
  const [engineerSubmissionDraft, setEngineerSubmissionDraft] = React.useState(() => normalizeEngineerSubmissionDraft());
  const [engineerSubmissionStatus, setEngineerSubmissionStatus] = React.useState({ kind: 'idle', message: '' });
  const [skillEscalationDraft, setSkillEscalationDraft] = React.useState(() => normalizeSkillEscalationDraft());
  const [skillEscalationStatus, setSkillEscalationStatus] = React.useState({ kind: 'idle', message: '' });
  const [checkInDraft, setCheckInDraft] = React.useState(() => normalizeCheckInDraft());
  const [checkInStatus, setCheckInStatus] = React.useState({ kind: 'idle', message: '' });
  const [retierDraft, setRetierDraft] = React.useState(() => normalizeRetierDraft());
  const [retierStatus, setRetierStatus] = React.useState({ kind: 'idle', message: '' });
  const [reassignmentDraft, setReassignmentDraft] = React.useState(() => normalizeReassignmentDraft());
  const [reassignmentStatus, setReassignmentStatus] = React.useState({ kind: 'idle', message: '' });
  const [taskLockStatus, setTaskLockStatus] = React.useState({ kind: 'idle', message: '' });
  const [workflowThreadDraft, setWorkflowThreadDraft] = React.useState(() => normalizeWorkflowThreadDraft());
  const [workflowThreadDrafts, setWorkflowThreadDrafts] = React.useState({});
  const [workflowThreadStatus, setWorkflowThreadStatus] = React.useState({ kind: 'idle', message: '', threadId: null, action: null });
  const [expandedWorkflowThreads, setExpandedWorkflowThreads] = React.useState({});
  const [expandedQaPackages, setExpandedQaPackages] = React.useState({});
  const [qaResultDraft, setQaResultDraft] = React.useState(() => normalizeQaResultDraft());
  const [qaResultStatus, setQaResultStatus] = React.useState({ kind: 'idle', message: '' });
  const [sreMonitoringStartDraft, setSreMonitoringStartDraft] = React.useState(() => normalizeSreMonitoringStartDraft());
  const [sreMonitoringStartStatus, setSreMonitoringStartStatus] = React.useState({ kind: 'idle', message: '' });
  const [sreApprovalDraft, setSreApprovalDraft] = React.useState(() => normalizeSreApprovalDraft());
  const [sreApprovalStatus, setSreApprovalStatus] = React.useState({ kind: 'idle', message: '' });
  const [monitoringAnomalyChildDraft, setMonitoringAnomalyChildDraft] = React.useState(() => normalizeMonitoringAnomalyChildDraft());
  const [monitoringAnomalyChildStatus, setMonitoringAnomalyChildStatus] = React.useState({ kind: 'idle', message: '' });
  const [pmBusinessContextDraft, setPmBusinessContextDraft] = React.useState(() => normalizePmBusinessContextDraft());
  const [pmBusinessContextStatus, setPmBusinessContextStatus] = React.useState({ kind: 'idle', message: '' });
  const [closeCancellationDraft, setCloseCancellationDraft] = React.useState(() => normalizeCloseCancellationDraft());
  const [closeCancellationStatus, setCloseCancellationStatus] = React.useState({ kind: 'idle', message: '' });
  const [exceptionalDisputeDraft, setExceptionalDisputeDraft] = React.useState(() => normalizeExceptionalDisputeDraft());
  const [exceptionalDisputeStatus, setExceptionalDisputeStatus] = React.useState({ kind: 'idle', message: '' });
  const [humanCloseDecisionDraft, setHumanCloseDecisionDraft] = React.useState(() => normalizeHumanCloseDecisionDraft());
  const [humanCloseDecisionStatus, setHumanCloseDecisionStatus] = React.useState({ kind: 'idle', message: '' });
  const [humanInboxDecisionDrafts, setHumanInboxDecisionDrafts] = React.useState({});
  const [humanInboxDecisionStatuses, setHumanInboxDecisionStatuses] = React.useState({});
  const [closeBacktrackDraft, setCloseBacktrackDraft] = React.useState(() => normalizeCloseBacktrackDraft());
  const [closeBacktrackStatus, setCloseBacktrackStatus] = React.useState({ kind: 'idle', message: '' });
  const [lifecycleStatus, setLifecycleStatus] = React.useState({ kind: 'idle', message: '', taskId: null });
  const [sreFindingDraft, setSreFindingDraft] = React.useState('');
  const [dragState, setDragState] = React.useState({ taskId: null, overStage: '' });
  const [adminUsers, setAdminUsers] = React.useState([]);
  const [adminUsersState, setAdminUsersState] = React.useState({ kind: 'idle', message: '' });
  const [adminUserDraft, setAdminUserDraft] = React.useState({ email: '', tenantId: 'engineering-team', actorId: '', roles: 'reader', status: 'active' });
  const [adminUserDrafts, setAdminUserDrafts] = React.useState({});
  const signInState = React.useMemo(() => readSignInState(search), [search]);
  const authRuntimeConfig = React.useMemo(() => readAuthRuntimeConfig(), []);
  const tokenClaims = React.useMemo(() => readSessionClaims(sessionConfig), [sessionConfig]);
  const resolvedApiBaseUrl = resolveApiBaseUrl(sessionConfig, envApiBaseUrl);
  const isAuthenticated = isAuthenticatedSession(sessionConfig);
  const lastDetailTaskIdRef = React.useRef(null);
  const authCallbackHandledRef = React.useRef(false);
  const authCallbackPromiseRef = React.useRef(null);
  const visibleAuthNotice = authNotice || getSignInReasonMessage(signInState.reason);
  const isMagicLinkMode = authRuntimeConfig.productionAuthStrategy === 'magic-link';
  const isOidcMode = !isMagicLinkMode;
  const canUseInternalBootstrap = authRuntimeConfig.internalAuthBootstrapEnabled && authRuntimeConfig.productionAuthStrategy !== 'magic-link';

  const clearSessionForSignIn = React.useCallback((message, reason = 'expired') => {
    const preserved = writeBrowserSessionConfig({
      apiBaseUrl: resolvedApiBaseUrl,
    });
    setSessionConfig(preserved);
    setSignInDraft((current) => ({ ...current, apiBaseUrl: preserved.apiBaseUrl || current.apiBaseUrl }));
    setAuthNotice(message);
    navigate(SIGN_IN_PATH, buildSignInSearch(`${pathname}${search}`, reason), { replace: true });
  }, [navigate, pathname, resolvedApiBaseUrl, search]);

  const taskClient = React.useMemo(() => {
    const baseUrl = resolveApiBaseUrl(sessionConfig, envApiBaseUrl);
    return createTaskDetailApiClient({
      baseUrl,
      fetchImpl: (...args) => window.fetch(...args),
      getHeaders: () => buildAuthHeaders(sessionConfig),
      onAuthFailure: () => clearSessionForSignIn('Your session expired. Sign in again to continue.'),
    });
  }, [clearSessionForSignIn, sessionConfig]);

  const pageModule = React.useMemo(() => {
    return createTaskDetailPageModule({
      client: taskClient,
    });
  }, [taskClient]);

  React.useEffect(() => {
    setSignInDraft((current) => ({
      ...current,
      apiBaseUrl: resolvedApiBaseUrl || current.apiBaseUrl,
    }));
  }, [resolvedApiBaseUrl]);

  React.useEffect(() => {
    if (String(sessionConfig.bearerToken || '').trim() || sessionConfig.authType === 'cookie-session') {
      setSessionProbeDone(true);
      return undefined;
    }

    let cancelled = false;
    fetchCurrentSession({
      apiBaseUrl: resolvedApiBaseUrl,
      fetchImpl: (...args) => window.fetch(...args),
    }).then((nextConfig) => {
      if (cancelled) return;
      if (nextConfig) setSessionConfig(nextConfig);
      setSessionProbeDone(true);
    }).catch(() => {
      if (!cancelled) setSessionProbeDone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedApiBaseUrl, sessionConfig.authType, sessionConfig.bearerToken]);

  React.useEffect(() => {
    if (hasSessionExpired(sessionConfig) && String(sessionConfig.bearerToken || '').trim()) {
      clearSessionForSignIn('Your session expired. Sign in again to continue.');
      return;
    }

    if (!isAuthenticated) {
      if (matchSignInRoute(pathname) || matchAuthCallbackRoute(pathname)) return;
      if (!isProtectedRoute(pathname)) {
        navigate(SIGN_IN_PATH, buildSignInSearch('/tasks'), { replace: true });
        return;
      }
      navigate(SIGN_IN_PATH, buildSignInSearch(`${pathname}${search}`), { replace: true });
      return;
    }

    if (pathname === '/') {
      navigate('/tasks', '', { replace: true });
      return;
    }

    if (matchSignInRoute(pathname)) {
      const nextRoute = splitRouteTarget(signInState.next);
      navigate(nextRoute.pathname, nextRoute.search, { replace: true });
    }
  }, [clearSessionForSignIn, isAuthenticated, navigate, pathname, search, sessionConfig, signInState.next]);

  React.useEffect(() => {
    if (!matchAuthCallbackRoute(pathname) || isAuthenticated) {
      authCallbackHandledRef.current = false;
      authCallbackPromiseRef.current = null;
      return;
    }
    if (!authCallbackHandledRef.current) {
      authCallbackHandledRef.current = true;
      setSignInStatus({ kind: 'loading', message: 'Completing enterprise sign-in…' });
    }
    if (!authCallbackPromiseRef.current) {
      authCallbackPromiseRef.current = completeOidcSignIn({
        config: authRuntimeConfig,
        search,
        fetchImpl: (...args) => window.fetch(...args),
      });
    }

    let cancelled = false;
    authCallbackPromiseRef.current.then((result) => {
      if (cancelled) return;
      authCallbackPromiseRef.current = null;
      setSessionConfig(result.sessionConfig);
      setAuthNotice('');
      setSignInStatus({ kind: 'success', message: 'Signed in.' });
      const nextRoute = splitRouteTarget(result.next);
      navigate(nextRoute.pathname, nextRoute.search, { replace: true });
    }).catch((error) => {
      if (cancelled) return;
      authCallbackPromiseRef.current = null;
      setAuthNotice(error?.message || 'Enterprise sign-in failed.');
      setSignInStatus({ kind: 'error', message: error?.message || 'Enterprise sign-in failed.' });
      navigate(SIGN_IN_PATH, buildSignInSearch('/tasks', 'oidc_error'), { replace: true });
    });

    return () => {
      cancelled = true;
    };
  }, [authRuntimeConfig, isAuthenticated, navigate, pathname, search]);

  React.useEffect(() => {
    if (model.kind === 'detail') {
      const currentTaskId = model.route?.taskId || null;
      const routeChanged = lastDetailTaskIdRef.current !== currentTaskId;
      lastDetailTaskIdRef.current = currentTaskId;

      setAssignmentDraft(model.summary?.currentOwner || '');
      setNewReviewQuestionDraft('');
      setNewReviewQuestionBlocking(true);
      setReviewQuestionDrafts({});
      setArchitectHandoffDraft(normalizeArchitectHandoffDraft(model.detail?.context?.architectHandoff));
      setEngineerSubmissionDraft(normalizeEngineerSubmissionDraft(model.detail?.context?.engineerSubmission));
      setSkillEscalationDraft(normalizeSkillEscalationDraft(model.detail?.context?.skillEscalation));
      setCheckInDraft(normalizeCheckInDraft(model.detail?.context?.activityMonitoring));
      setRetierDraft(normalizeRetierDraft(model.detail?.context));
      setReassignmentDraft(normalizeReassignmentDraft(model.detail?.context));
      setWorkflowThreadDraft(normalizeWorkflowThreadDraft());
      setWorkflowThreadDrafts({});
      setExpandedWorkflowThreads({});
      setExpandedQaPackages({});
      setQaResultDraft(normalizeQaResultDraft(model.detail?.context?.qaResults?.latest));
      setSreMonitoringStartDraft(normalizeSreMonitoringStartDraft(model.detail?.context?.sreMonitoring));
      setSreApprovalDraft(normalizeSreApprovalDraft(model.detail?.context?.sreMonitoring));
      setMonitoringAnomalyChildDraft(normalizeMonitoringAnomalyChildDraft(model.detail));
      setPmBusinessContextDraft(normalizePmBusinessContextDraft(model.detail));
      setCloseCancellationDraft(normalizeCloseCancellationDraft(model.detail));
      setExceptionalDisputeDraft(normalizeExceptionalDisputeDraft(model.detail));
      setHumanCloseDecisionDraft(normalizeHumanCloseDecisionDraft(model.detail));
      setCloseBacktrackDraft(normalizeCloseBacktrackDraft(model.detail));
      setSreFindingDraft('');
      setHistoryLoadMoreState({ kind: 'idle', message: '' });

      // Keep action success/error feedback visible across same-task refreshes.
      if (routeChanged) {
        setAssignmentStatus({ kind: 'idle', message: '' });
        setReviewQuestionStatus({ kind: 'idle', message: '', questionId: null, action: null });
        setArchitectHandoffStatus({ kind: 'idle', message: '' });
        setEngineerSubmissionStatus({ kind: 'idle', message: '' });
        setSkillEscalationStatus({ kind: 'idle', message: '' });
        setCheckInStatus({ kind: 'idle', message: '' });
        setRetierStatus({ kind: 'idle', message: '' });
        setReassignmentStatus({ kind: 'idle', message: '' });
        setTaskLockStatus({ kind: 'idle', message: '' });
        setWorkflowThreadStatus({ kind: 'idle', message: '', threadId: null, action: null });
        setQaResultStatus({ kind: 'idle', message: '' });
        setSreMonitoringStartStatus({ kind: 'idle', message: '' });
        setSreApprovalStatus({ kind: 'idle', message: '' });
        setMonitoringAnomalyChildStatus({ kind: 'idle', message: '' });
        setPmBusinessContextStatus({ kind: 'idle', message: '' });
        setCloseCancellationStatus({ kind: 'idle', message: '' });
        setExceptionalDisputeStatus({ kind: 'idle', message: '' });
        setHumanCloseDecisionStatus({ kind: 'idle', message: '' });
        setHumanInboxDecisionDrafts({});
        setHumanInboxDecisionStatuses({});
        setCloseBacktrackStatus({ kind: 'idle', message: '' });
        setLifecycleStatus({ kind: 'idle', message: '', taskId: null });
      }
    }
  }, [model]);

  React.useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated) {
      return () => {
        cancelled = true;
      };
    }

    if (matchAdminUsersRoute(pathname)) {
      setModel(buildRouteMissModel(pathname));
      return () => {
        cancelled = true;
      };
    }

    if (matchTaskListRoute(pathname) || matchRoleInboxRoute(pathname) || matchPmOverviewRoute(pathname) || matchGovernanceOverviewRoute(pathname)) {
      setModel(buildListLoadingModel(pathname, search));
      taskClient.fetchTaskList()
        .then((payload) => {
          if (cancelled) return;
          const filters = readTaskListRouteState(search);
          const roleInbox = matchRoleInboxRoute(pathname);
          const pmOverview = matchPmOverviewRoute(pathname);
          const governanceOverview = matchGovernanceOverviewRoute(pathname);
          setModel({
            kind: 'list',
            route: { pathname: roleInbox ? `/inbox/${roleInbox.role}` : pmOverview ? '/overview/pm' : governanceOverview ? '/overview/governance' : '/tasks', taskId: null },
            list: {
              filters,
              items: payload.items || [],
              state: { kind: 'ready' },
              resultSummary: '',
              inboxRole: roleInbox?.role || null,
              isPmOverview: Boolean(pmOverview),
              isGovernanceOverview: Boolean(governanceOverview),
            },
          });
        })
        .catch((error) => {
          if (!cancelled) {
            const roleInbox = matchRoleInboxRoute(pathname);
            const pmOverview = matchPmOverviewRoute(pathname);
            const governanceOverview = matchGovernanceOverviewRoute(pathname);
            setModel({
              kind: 'list',
              route: { pathname: roleInbox ? pathname : pmOverview ? '/overview/pm' : governanceOverview ? '/overview/governance' : '/tasks', taskId: null },
              list: {
                filters: readTaskListRouteState(search),
                items: [],
                state: { kind: 'error', message: error.message || 'Task list load failed.' },
                resultSummary: '',
                inboxRole: roleInbox?.role || null,
                isPmOverview: Boolean(pmOverview),
                isGovernanceOverview: Boolean(governanceOverview),
              },
            });
          }
        });
      return () => {
        cancelled = true;
      };
    }

    if (!pageModule.match(pathname)) {
      setModel(buildRouteMissModel(pathname));
      return () => {
        cancelled = true;
      };
    }

    setModel(buildLoadingModel(pathname, search));

    pageModule
      .load({ pathname, search })
      .then((nextModel) => {
        if (!cancelled) setModel({ ...nextModel, kind: 'detail' });
      })
      .catch((error) => {
        if (!cancelled) {
          setModel({
            ...buildRouteMissModel(pathname),
            shell: {
              ...buildRouteMissModel(pathname).shell,
              historyState: { kind: 'error', message: error.message || 'Task detail load failed.' },
              telemetryState: { kind: 'error', message: error.message || 'Task detail load failed.' },
            },
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, pageModule, pathname, search, taskClient]);

  React.useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) {
      setAgentOptions([]);
      setAgentOptionsState({ kind: 'idle', message: '' });
      return () => {
        cancelled = true;
      };
    }

    setAgentOptionsState({ kind: 'loading', message: 'Loading canonical role roster.' });
    taskClient.fetchAssignableAgents()
      .then((payload) => {
        if (cancelled) return;
        setAgentOptions(payload.items || []);
        setAgentOptionsState({ kind: 'ready', message: '' });
      })
      .catch((error) => {
        if (cancelled) return;
        setAgentOptions([]);
        setAgentOptionsState({
          kind: 'error',
          message: error?.message || 'Canonical role roster unavailable. Role inbox routing cannot be confirmed right now.',
        });
      });

    if (!canManageAssignment(tokenClaims)) {
      return () => {
        cancelled = true;
      };
    }

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, taskClient, tokenClaims]);

  const setTab = React.useCallback(
    (tab) => {
      navigate(pathname, writeTaskDetailUrlState({ tab }, search));
    },
    [navigate, pathname, search],
  );

  const setFilters = React.useCallback(
    (filters) => {
      navigate(pathname, writeTaskDetailUrlState({ filters }, search));
    },
    [navigate, pathname, search],
  );

  const setListOwnerFilter = React.useCallback((owner) => {
    navigate('/tasks', writeTaskListUrlState({ owner }, search));
  }, [navigate, search]);

  const setListView = React.useCallback((view) => {
    navigate('/tasks', writeTaskListUrlState({ view }, search));
  }, [navigate, search]);

  const setTaskListFilters = React.useCallback((updates) => {
    navigate('/tasks', writeTaskListUrlState(updates, search));
  }, [navigate, search]);

  const agentLookup = React.useMemo(() => new Map(mapAgentOptions(agentOptions).map((agent) => [agent.id, agent])), [agentOptions]);

  const assignmentEnabled = model.kind === 'detail' && Boolean(model.route?.taskId) && canManageAssignment(tokenClaims);
  const architectHandoffEnabled = model.kind === 'detail' && Boolean(model.route?.taskId) && canManageArchitectHandoff(tokenClaims);
  const engineerSubmissionEnabled = model.kind === 'detail' && Boolean(model.route?.taskId) && canManageEngineerSubmission(tokenClaims);
  const skillEscalationEnabled = model.kind === 'detail' && Boolean(model.route?.taskId) && canRequestSkillEscalation(tokenClaims);
  const reassignmentGhostingEnabled = model.kind === 'detail' && Boolean(model.route?.taskId) && canManageReassignmentGhosting(tokenClaims);
  const routeTaskId = model.kind === 'detail' ? (model.route?.taskId || 'TSK-42') : 'TSK-42';
  const activeInboxRole = model.kind === 'list' ? model.list.inboxRole : null;
  const isPmOverview = model.kind === 'list' ? Boolean(model.list.isPmOverview) : false;
  const isGovernanceOverview = model.kind === 'list' ? Boolean(model.list.isGovernanceOverview) : false;
  const detailPermissions = model.kind === 'detail' ? (model.detail?.meta?.permissions || {}) : {};
  const executionContractAutoApproval = model.kind === 'detail'
    ? (model.detail?.context?.executionContract?.approval?.autoApproval || model.detail?.context?.executionContract?.latest?.auto_approval || null)
    : null;
  const contractCoverageAudit = model.kind === 'detail'
    ? (model.detail?.context?.executionContract?.contractCoverageAudit || null)
    : null;
  const architectReviewEnabled = model.kind === 'detail' && Boolean(model.detail?.reviewQuestions);
  const canAskQuestions = architectReviewEnabled && canAskReviewQuestion(tokenClaims) && model.detail?.task?.stage === 'ARCHITECT_REVIEW';
  const canAnswerQuestions = architectReviewEnabled && canAnswerReviewQuestion(tokenClaims);
  const canResolveQuestions = architectReviewEnabled && canResolveReviewQuestion(tokenClaims);
  const canReopenQuestions = architectReviewEnabled && canReopenReviewQuestion(tokenClaims);
  const engineerSubmissionValidation = validateEngineerSubmissionDraft(engineerSubmissionDraft);
  const engineerSubmissionAllowedForStage = model.kind === 'detail' && isImplementationStage(model.detail?.task?.stage || model.summary.currentStage);
  const effectiveEngineerTier = model.kind === 'detail' ? getEffectiveEngineerTierFromDetail(model.detail) : null;
  const skillEscalationAllowed = skillEscalationEnabled && effectiveEngineerTier === 'Jr' && !engineerSubmissionAllowedForStage && !model.detail?.context?.engineerSubmission;
  const activityMonitoring = model.kind === 'detail' ? (model.detail?.context?.activityMonitoring || null) : null;
  const transferredContext = model.kind === 'detail' ? (model.detail?.context?.transferredContext || null) : null;
  const canManageTaskLock = model.kind === 'detail' && Boolean(model.route?.taskId) && (canManageAssignment(tokenClaims) || canManageEngineerSubmission(tokenClaims) || canManageArchitectHandoff(tokenClaims) || hasAnyRole(tokenClaims, ['qa', 'contributor', 'admin']));
  const activeTaskLock = model.kind === 'detail' ? (model.detail?.meta?.lock || null) : null;
  const workflowThreads = model.kind === 'detail' ? (model.detail?.activity?.workflowThreads?.items || []) : [];
  const workflowThreadSummary = model.kind === 'detail' ? (model.detail?.activity?.workflowThreads?.summary || { total: 0, unresolvedCount: 0, unresolvedBlockingCount: 0, resolvedCount: 0 }) : { total: 0, unresolvedCount: 0, unresolvedBlockingCount: 0, resolvedCount: 0 };
  const canManageWorkflowThreads = model.kind === 'detail' && hasAnyRole(tokenClaims, ['architect', 'engineer', 'qa', 'pm', 'contributor', 'admin']);
  const qaStageEnabled = model.kind === 'detail' && model.detail?.task?.stage === 'QA_TESTING';
  const canSubmitQaResult = qaStageEnabled && hasAnyRole(tokenClaims, ['qa', 'admin', 'contributor']);
  const sreMonitoring = model.kind === 'detail' ? (model.detail?.context?.sreMonitoring || null) : null;
  const sreMonitoringEnabled = model.kind === 'detail' && model.detail?.task?.stage === 'SRE_MONITORING' && canManageSreMonitoring(tokenClaims);
  const canCreateMonitoringAnomalyChildTask = sreMonitoringEnabled;
  const closeGovernance = model.kind === 'detail' ? (model.detail?.context?.closeGovernance || null) : null;
  const closeReviewActive = model.kind === 'detail' && Boolean(closeGovernance?.active);
  const pmBusinessContextRequired = model.kind === 'detail'
    && model.detail?.task?.stage === 'BACKLOG'
    && model.detail?.context?.pmBusinessContextReview?.finalized === false
    && Boolean(model.detail?.context?.anomalyChildTask)
    && Boolean(model.detail?.relations?.parentTask);
  const canSubmitPmBusinessContext = model.kind === 'detail' && canCompletePmBusinessContext(tokenClaims) && model.detail?.task?.stage === 'BACKLOG' && pmBusinessContextRequired;
  const canSubmitCloseCancellationRecommendation = closeReviewActive && canRecordCloseCancellationRecommendation(tokenClaims);
  const canSubmitExceptionalDispute = closeReviewActive && canRecordCloseCancellationRecommendation(tokenClaims);
  const canSubmitHumanCloseDecision = closeReviewActive
    && canRecordHumanCloseDecision(tokenClaims)
    && closeGovernance?.humanDecision?.decisionReady !== false;
  const canSubmitHumanInboxDecision = activeInboxRole === 'human' && canRecordHumanCloseDecision(tokenClaims);
  const canSubmitCloseBacktrack = closeReviewActive && closeGovernance?.backtrack?.available && canRequestCloseReviewBacktrack(tokenClaims);
  const workflowThreadNotificationTargets = defaultWorkflowNotificationTargets(workflowThreadDraft.commentType, workflowThreadDraft.blocking);
  const latestQaResult = model.kind === 'detail' ? (model.detail?.context?.qaResults?.latest || null) : null;
  const latestFailedQa = model.kind === 'detail' ? (model.detail?.context?.qaResults?.items || []).find((item) => item.outcome === 'fail') || null : null;
  const currentImplementationVersion = model.kind === 'detail' ? (model.detail?.context?.implementationHistory?.[0]?.version || 0) : 0;
  const qaRetestContext = latestFailedQa && currentImplementationVersion > (latestFailedQa.implementationVersion || 0)
    ? {
        priorRunId: latestFailedQa.runId,
        priorQaActorId: latestFailedQa.submittedBy || null,
        scope: latestFailedQa.reTestScope || [],
      }
    : null;
  const qaDraftMissingFields = deriveQaDraftMissingFields(qaResultDraft);
  const qaRoutePreview = qaResultDraft.outcome === 'pass'
    ? 'SRE monitoring'
    : 'implementation fix loop';
  const detailLifecycleItem = model.kind === 'detail'
    ? {
        task_id: model.route?.taskId || model.detail?.task?.id || model.summary.taskId,
        current_stage: model.detail?.task?.stage || model.summary.currentStage,
        current_owner: model.detail?.summary?.owner?.id || model.summary.currentOwner || null,
        owner: model.detail?.summary?.owner ? { actor_id: model.detail.summary.owner.id, display_name: model.detail.summary.owner.label } : null,
      }
    : null;
  const detailIsIntakeDraft = model.kind === 'detail' && isIntakeDraftTask(model.detail || model.summary);
  const detailAssignedToActor = detailLifecycleItem ? isTaskAssignedToCurrentActor(detailLifecycleItem, tokenClaims, agentLookup) : false;

  const reloadTask = React.useCallback(async () => {
    if (model.kind === 'list') {
      setModel(buildListLoadingModel(pathname, search));
      const payload = await taskClient.fetchTaskList();
      const roleInbox = matchRoleInboxRoute(pathname);
      const pmOverview = matchPmOverviewRoute(pathname);
      const governanceOverview = matchGovernanceOverviewRoute(pathname);
      setModel({ kind: 'list', route: { pathname: roleInbox ? `/inbox/${roleInbox.role}` : pmOverview ? '/overview/pm' : governanceOverview ? '/overview/governance' : '/tasks', taskId: null }, list: { filters: readTaskListRouteState(search), items: payload.items || [], state: { kind: 'ready' }, resultSummary: '', inboxRole: roleInbox?.role || null, isPmOverview: Boolean(pmOverview), isGovernanceOverview: Boolean(governanceOverview) } });
      return;
    }
    setModel(buildLoadingModel(pathname, search));
    const nextModel = await pageModule.load({ pathname, search });
    setModel({ ...nextModel, kind: 'detail' });
  }, [model.kind, pageModule, pathname, search, taskClient]);

  const runLifecycleTransition = React.useCallback(async ({ item, toStage, note = '', source = 'board' }) => {
    if (!item?.task_id) return;

    const permission = canTransitionLifecycleTask(item, toStage, tokenClaims, agentLookup);
    if (!permission.allowed) {
      setLifecycleStatus({ kind: 'error', message: permission.reason, taskId: item.task_id });
      return;
    }

    const trimmedNote = String(note || '').trim();
    if (String(toStage || '').toUpperCase() === 'REOPEN' && !trimmedNote) {
      setLifecycleStatus({ kind: 'error', message: 'A finding note is required before reopening a task.', taskId: item.task_id });
      return;
    }

    setLifecycleStatus({
      kind: 'loading',
      message: `Moving ${item.task_id} to ${toStage}…`,
      taskId: item.task_id,
    });

    try {
      await taskClient.changeTaskStage(item.task_id, toStage, {
        from_stage: item.current_stage,
        ...(trimmedNote ? { note: trimmedNote, rationale: trimmedNote } : {}),
        source,
      });
      await reloadTask();
      setLifecycleStatus({
        kind: 'success',
        message: `${item.task_id} moved to ${toStage}.`,
        taskId: item.task_id,
      });
      if (String(toStage || '').toUpperCase() === 'REOPEN') setSreFindingDraft('');
    } catch (error) {
      setLifecycleStatus({
        kind: 'error',
        message: error?.message || `Task transition to ${toStage} failed.`,
        taskId: item.task_id,
      });
    }
  }, [agentLookup, reloadTask, taskClient, tokenClaims]);

  const handleBoardDrop = React.useCallback(async (item, toStage) => {
    setDragState({ taskId: null, overStage: '' });
    if (!item || !isLifecycleStage(toStage) || !isLifecycleStage(item.current_stage) || item.current_stage === toStage) return;

    let note = '';
    if (toStage === 'REOPEN') {
      note = window.prompt(`Add a finding note for ${item.task_id}`, '') || '';
    }

    await runLifecycleTransition({ item, toStage, note, source: 'board-dnd' });
  }, [runLifecycleTransition]);

  const loadMoreHistory = React.useCallback(async () => {
    if (model.kind !== 'detail' || !routeTaskId) return;
    const pageInfo = model.shell.historyPageInfo;
    const nextCursor = pageInfo?.next_cursor;
    if (!pageInfo?.has_more || !nextCursor) return;

    setHistoryLoadMoreState({ kind: 'loading', message: '' });

    try {
      const payload = await taskClient.fetchTaskHistory(routeTaskId, {
        filters: model.shell.filters,
        pagination: {
          limit: Number.isFinite(pageInfo.limit) ? pageInfo.limit : 25,
          cursor: nextCursor,
        },
        range: {
          dateFrom: model.shell.filters?.dateFrom,
          dateTo: model.shell.filters?.dateTo,
        },
      });

      setModel((current) => {
        if (current.kind !== 'detail') return current;
        const nextItems = (payload.items || []).map(toHistoryTimelineItem);
        return {
          ...current,
          shell: {
            ...current.shell,
            historyItems: [...current.shell.historyItems, ...nextItems],
            historyPageInfo: payload.page_info || { next_cursor: null, has_more: false },
          },
        };
      });
      setHistoryLoadMoreState({ kind: 'success', message: '' });
    } catch (error) {
      setHistoryLoadMoreState({ kind: 'error', message: error?.message || 'Loading more history failed.' });
    }
  }, [model, routeTaskId, taskClient]);

  const updateReviewQuestionDraft = React.useCallback((questionId, value) => {
    setReviewQuestionDrafts((current) => ({ ...current, [questionId]: value }));
  }, []);

  const runReviewQuestionAction = React.useCallback(async ({ action, questionId = null, payload, successMessage }) => {
    if (!routeTaskId) return;
    setReviewQuestionStatus({ kind: 'loading', message: 'Saving review question update…', questionId, action });

    try {
      if (action === 'ask') {
        await taskClient.askReviewQuestion(routeTaskId, payload);
      } else if (action === 'answer') {
        await taskClient.answerReviewQuestion(routeTaskId, questionId, payload);
      } else if (action === 'resolve') {
        await taskClient.resolveReviewQuestion(routeTaskId, questionId, payload);
      } else if (action === 'reopen') {
        await taskClient.reopenReviewQuestion(routeTaskId, questionId, payload);
      }

      await reloadTask();
      setReviewQuestionStatus({ kind: 'success', message: successMessage, questionId, action });
    } catch (error) {
      setReviewQuestionStatus({
        kind: 'error',
        message: error?.message || 'Review question update failed.',
        questionId,
        action,
      });
    }
  }, [reloadTask, routeTaskId, taskClient]);

  const updateWorkflowThreadDraft = React.useCallback((threadId, value) => {
    setWorkflowThreadDrafts((current) => ({ ...current, [threadId]: value }));
  }, []);

  const toggleWorkflowThreadExpanded = React.useCallback((threadId) => {
    setExpandedWorkflowThreads((current) => ({ ...current, [threadId]: !current[threadId] }));
  }, []);

  const toggleQaPackageExpanded = React.useCallback((runId) => {
    setExpandedQaPackages((current) => ({ ...current, [runId]: !current[runId] }));
  }, []);

  const runWorkflowThreadAction = React.useCallback(async ({ action, threadId = null, payload, successMessage }) => {
    if (!routeTaskId) return;
    setWorkflowThreadStatus({ kind: 'loading', message: 'Saving workflow thread update…', threadId, action });
    try {
      if (action === 'create') {
        await taskClient.createWorkflowThread(routeTaskId, payload);
      } else if (action === 'reply') {
        await taskClient.replyToWorkflowThread(routeTaskId, threadId, payload);
      } else if (action === 'resolve') {
        await taskClient.resolveWorkflowThread(routeTaskId, threadId, payload);
      } else if (action === 'reopen') {
        await taskClient.reopenWorkflowThread(routeTaskId, threadId, payload);
      }
      await reloadTask();
      setWorkflowThreadStatus({ kind: 'success', message: successMessage, threadId, action });
    } catch (error) {
      setWorkflowThreadStatus({ kind: 'error', message: error?.message || 'Workflow thread update failed.', threadId, action });
    }
  }, [reloadTask, routeTaskId, taskClient]);

  const acquireTaskLock = React.useCallback(async () => {
    if (!routeTaskId) return;
    setTaskLockStatus({ kind: 'loading', message: 'Acquiring task lock…' });
    try {
      await taskClient.acquireTaskLock(routeTaskId, { reason: 'Manual task detail editing session', action: 'task_detail_edit' });
      await reloadTask();
      setTaskLockStatus({ kind: 'success', message: 'Task lock acquired.' });
    } catch (error) {
      setTaskLockStatus({ kind: 'error', message: error?.message || 'Task lock acquisition failed.' });
    }
  }, [reloadTask, routeTaskId, taskClient]);

  const releaseTaskLock = React.useCallback(async () => {
    if (!routeTaskId) return;
    setTaskLockStatus({ kind: 'loading', message: 'Releasing task lock…' });
    try {
      await taskClient.releaseTaskLock(routeTaskId);
      await reloadTask();
      setTaskLockStatus({ kind: 'success', message: 'Task lock released.' });
    } catch (error) {
      setTaskLockStatus({ kind: 'error', message: error?.message || 'Task lock release failed.' });
    }
  }, [reloadTask, routeTaskId, taskClient]);

  const submitQaResult = React.useCallback(async (event) => {
    event.preventDefault();
    if (!routeTaskId) return;
    setQaResultStatus({ kind: 'loading', message: 'Submitting QA result…' });
    try {
      await taskClient.submitQaResult(routeTaskId, {
        outcome: qaResultDraft.outcome,
        summary: qaResultDraft.summary,
        scenarios: splitTextareaLines(qaResultDraft.scenarios),
        findings: splitTextareaLines(qaResultDraft.findings),
        reproductionSteps: splitTextareaLines(qaResultDraft.reproductionSteps),
        stackTraces: splitTextareaLines(qaResultDraft.stackTraces),
        envLogs: splitTextareaLines(qaResultDraft.envLogs),
        retestScope: splitTextareaLines(qaResultDraft.retestScope),
      });
      await reloadTask();
      setQaResultStatus({ kind: 'success', message: qaResultDraft.outcome === 'pass' ? 'QA approved the task and routed it to SRE monitoring.' : 'QA failure routed the task back to implementation.' });
    } catch (error) {
      setQaResultStatus({ kind: 'error', message: error?.message || 'QA result submission failed.' });
    }
  }, [qaResultDraft, reloadTask, routeTaskId, taskClient]);

  const submitSreMonitoringStart = React.useCallback(async (event) => {
    event.preventDefault();
    if (!routeTaskId) return;
    setSreMonitoringStartStatus({ kind: 'loading', message: 'Starting monitoring window…' });
    try {
      await taskClient.startSreMonitoring(routeTaskId, {
        deploymentEnvironment: sreMonitoringStartDraft.deploymentEnvironment,
        deploymentUrl: sreMonitoringStartDraft.deploymentUrl,
        deploymentVersion: sreMonitoringStartDraft.deploymentVersion,
        evidence: splitTextareaLines(sreMonitoringStartDraft.evidence),
      });
      await reloadTask();
      setSreMonitoringStartStatus({ kind: 'success', message: 'SRE monitoring window started.' });
    } catch (error) {
      setSreMonitoringStartStatus({ kind: 'error', message: error?.message || 'SRE monitoring could not be started.' });
    }
  }, [reloadTask, routeTaskId, sreMonitoringStartDraft, taskClient]);

  const submitSreApproval = React.useCallback(async (event) => {
    event.preventDefault();
    if (!routeTaskId) return;
    setSreApprovalStatus({ kind: 'loading', message: 'Recording early approval…' });
    try {
      await taskClient.approveSreMonitoring(routeTaskId, {
        reason: sreApprovalDraft.reason,
        evidence: splitTextareaLines(sreApprovalDraft.evidence),
      });
      await reloadTask();
      setSreApprovalStatus({ kind: 'success', message: 'SRE early approval recorded.' });
    } catch (error) {
      setSreApprovalStatus({ kind: 'error', message: error?.message || 'SRE approval failed.' });
    }
  }, [reloadTask, routeTaskId, sreApprovalDraft, taskClient]);

  const submitMonitoringAnomalyChildTask = React.useCallback(async (event) => {
    event.preventDefault();
    if (!routeTaskId) return;
    setMonitoringAnomalyChildStatus({ kind: 'loading', message: 'Creating anomaly child task…' });
    try {
      const result = await taskClient.createMonitoringAnomalyChildTask(routeTaskId, {
        title: monitoringAnomalyChildDraft.title,
        service: monitoringAnomalyChildDraft.service,
        anomalySummary: monitoringAnomalyChildDraft.anomalySummary,
        metrics: splitTextareaLines(monitoringAnomalyChildDraft.metrics),
        logs: splitTextareaLines(monitoringAnomalyChildDraft.logs),
        errorSamples: splitTextareaLines(monitoringAnomalyChildDraft.errorSamples),
      });
      await reloadTask();
      setMonitoringAnomalyChildStatus({
        kind: 'success',
        message: `Anomaly child task ${result?.data?.childTaskId || 'created'} linked to the parent and routed back to PM context review.`,
      });
    } catch (error) {
      setMonitoringAnomalyChildStatus({ kind: 'error', message: error?.message || 'Monitoring anomaly child task creation failed.' });
    }
  }, [monitoringAnomalyChildDraft, reloadTask, routeTaskId, taskClient]);

  const submitPmBusinessContext = React.useCallback(async (event) => {
    event.preventDefault();
    if (!routeTaskId) return;
    setPmBusinessContextStatus({ kind: 'loading', message: 'Finalizing PM business context…' });
    try {
      await taskClient.completePmBusinessContext(routeTaskId, {
        businessContext: pmBusinessContextDraft.businessContext,
      });
      await reloadTask();
      setPmBusinessContextStatus({ kind: 'success', message: 'PM business context review completed. Architect work can now begin.' });
    } catch (error) {
      setPmBusinessContextStatus({ kind: 'error', message: error?.message || 'PM business context review failed.' });
    }
  }, [pmBusinessContextDraft.businessContext, reloadTask, routeTaskId, taskClient]);

  const submitCloseCancellationRecommendation = React.useCallback(async (event) => {
    event.preventDefault();
    if (!routeTaskId) return;
    setCloseCancellationStatus({ kind: 'loading', message: 'Recording cancellation recommendation…' });
    try {
      await taskClient.submitCloseCancellationRecommendation(routeTaskId, {
        summary: closeCancellationDraft.summary,
        rationale: closeCancellationDraft.rationale,
      });
      await reloadTask();
      setCloseCancellationStatus({ kind: 'success', message: 'Cancellation recommendation recorded.' });
    } catch (error) {
      setCloseCancellationStatus({ kind: 'error', message: error?.message || 'Cancellation recommendation failed.' });
    }
  }, [closeCancellationDraft, reloadTask, routeTaskId, taskClient]);

  const submitExceptionalDispute = React.useCallback(async (event) => {
    event.preventDefault();
    if (!routeTaskId) return;
    setExceptionalDisputeStatus({ kind: 'loading', message: 'Escalating exceptional dispute…' });
    try {
      await taskClient.submitExceptionalDispute(routeTaskId, {
        summary: exceptionalDisputeDraft.summary,
        rationale: exceptionalDisputeDraft.rationale,
        recommendation: exceptionalDisputeDraft.recommendation,
        severity: exceptionalDisputeDraft.severity,
      });
      await reloadTask();
      setExceptionalDisputeStatus({ kind: 'success', message: 'Exceptional dispute escalated for human review.' });
    } catch (error) {
      setExceptionalDisputeStatus({ kind: 'error', message: error?.message || 'Exceptional dispute escalation failed.' });
    }
  }, [exceptionalDisputeDraft, reloadTask, routeTaskId, taskClient]);

  const submitHumanCloseDecision = React.useCallback(async (event) => {
    event.preventDefault();
    if (!routeTaskId) return;
    setHumanCloseDecisionStatus({ kind: 'loading', message: 'Recording human close decision…' });
    try {
      await taskClient.submitHumanCloseDecision(routeTaskId, {
        outcome: humanCloseDecisionDraft.outcome,
        summary: humanCloseDecisionDraft.summary,
        rationale: humanCloseDecisionDraft.rationale,
        confirmationRequired: humanCloseDecisionDraft.outcome !== 'approve',
      });
      await reloadTask();
      setHumanCloseDecisionStatus({ kind: 'success', message: 'Human close decision recorded.' });
    } catch (error) {
      setHumanCloseDecisionStatus({ kind: 'error', message: error?.message || 'Human close decision failed.' });
    }
  }, [humanCloseDecisionDraft, reloadTask, routeTaskId, taskClient]);

  const submitHumanInboxDecision = React.useCallback(async (event, item) => {
    event.preventDefault();
    const taskId = item?.task_id;
    if (!taskId) return;
    const draft = humanInboxDecisionDrafts[taskId] || normalizeHumanInboxDecisionDraft(item);
    setHumanInboxDecisionStatuses((current) => ({
      ...current,
      [taskId]: { kind: 'loading', message: 'Recording human close decision…' },
    }));
    try {
      await taskClient.submitHumanCloseDecision(taskId, {
        outcome: draft.outcome,
        summary: draft.summary,
        rationale: draft.rationale,
        confirmationRequired: draft.outcome !== 'approve',
      });
      setHumanInboxDecisionDrafts((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
      await reloadTask();
      setHumanInboxDecisionStatuses((current) => ({
        ...current,
        [taskId]: { kind: 'success', message: 'Human close decision recorded.' },
      }));
    } catch (error) {
      setHumanInboxDecisionStatuses((current) => ({
        ...current,
        [taskId]: { kind: 'error', message: error?.message || 'Human close decision failed.' },
      }));
    }
  }, [humanInboxDecisionDrafts, reloadTask, taskClient]);

  const submitCloseBacktrack = React.useCallback(async (event) => {
    event.preventDefault();
    if (!routeTaskId) return;
    setCloseBacktrackStatus({ kind: 'loading', message: 'Backtracking close review to implementation…' });
    try {
      const result = await taskClient.submitCloseReviewBacktrack(routeTaskId, {
        reasonCode: closeBacktrackDraft.reasonCode,
        rationale: closeBacktrackDraft.rationale,
        agreementArtifact: closeBacktrackDraft.agreementArtifact,
        summary: closeBacktrackDraft.summary,
      });
      await reloadTask();
      const awaitingRole = result?.data?.awaitingRole;
      setCloseBacktrackStatus({
        kind: 'success',
        message: awaitingRole
          ? `Backtrack recommendation recorded. ${awaitingRole === 'pm' ? 'PM' : 'Architect'} approval is still required.`
          : 'Close review backtracked to implementation.',
      });
    } catch (error) {
      setCloseBacktrackStatus({ kind: 'error', message: error?.message || 'Close review backtrack failed.' });
    }
  }, [closeBacktrackDraft, reloadTask, routeTaskId, taskClient]);

  const handleSignIn = React.useCallback(async (event) => {
    event.preventDefault();
    const apiBaseUrl = String(signInDraft.apiBaseUrl || '').trim().replace(/\/+$/, '');
    const authCode = String(signInDraft.authCode || '').trim();

    setSignInStatus({ kind: 'loading', message: 'Signing in…' });

    try {
      const sessionData = await exchangeSessionForAuthCode({
        apiBaseUrl,
        authCode,
      });
      const nextConfig = toSessionConfigFromExchange(sessionData, apiBaseUrl);
      setSessionConfig(nextConfig);
      setAuthNotice('');
      setSignInStatus({ kind: 'success', message: 'Signed in.' });
      const nextRoute = splitRouteTarget(signInState.next);
      navigate(nextRoute.pathname, nextRoute.search, { replace: true });
    } catch (error) {
      setSignInStatus({ kind: 'error', message: error?.message || 'Sign-in failed.' });
    }
  }, [navigate, signInDraft, signInState.next]);

  const handleEnterpriseSignIn = React.useCallback(async () => {
    setSignInStatus({ kind: 'loading', message: 'Redirecting to enterprise sign-in…' });
    try {
      await beginOidcSignIn({
        config: authRuntimeConfig,
        next: signInState.next,
        apiBaseUrl: String(signInDraft.apiBaseUrl || resolvedApiBaseUrl || '').trim().replace(/\/+$/, ''),
        fetchImpl: (...args) => window.fetch(...args),
      });
    } catch (error) {
      setSignInStatus({ kind: 'error', message: error?.message || 'Enterprise sign-in failed.' });
    }
  }, [authRuntimeConfig, resolvedApiBaseUrl, signInDraft.apiBaseUrl, signInState.next]);

  const handleMagicLinkSignIn = React.useCallback(async (event) => {
    event.preventDefault();
    setSignInStatus({ kind: 'loading', message: 'Sending sign-in link...' });
    try {
      const apiBaseUrl = String(signInDraft.apiBaseUrl || resolvedApiBaseUrl || '').trim().replace(/\/+$/, '');
      const result = await requestMagicLinkSignIn({
        apiBaseUrl,
        email: signInDraft.email,
        next: signInState.next,
        fetchImpl: (...args) => window.fetch(...args),
      });
      setSignInStatus({ kind: 'success', message: result.message || 'If the email is eligible, a sign-in link has been sent.' });
    } catch (error) {
      setSignInStatus({ kind: 'error', message: error?.message || 'Magic-link sign-in failed.' });
    }
  }, [resolvedApiBaseUrl, signInDraft.apiBaseUrl, signInDraft.email, signInState.next]);

  const handleSignOut = React.useCallback(async () => {
    const logoutUrl = buildOidcLogoutUrl(authRuntimeConfig);
    if (sessionConfig.authType === 'cookie-session') {
      try {
        await logoutSession({
          apiBaseUrl: resolvedApiBaseUrl,
          fetchImpl: (...args) => window.fetch(...args),
        });
      } catch (error) {
        setAuthNotice(error?.message || 'Sign-out failed.');
        setSignInStatus({ kind: 'error', message: error?.message || 'Sign-out failed.' });
        return;
      }
    }
    const preserved = writeBrowserSessionConfig({
      apiBaseUrl: resolvedApiBaseUrl,
    });
    setSessionConfig(preserved);
    setSignInDraft((current) => ({
      ...current,
      apiBaseUrl: preserved.apiBaseUrl || current.apiBaseUrl,
      authCode: '',
    }));
    setAuthNotice('');
    setSignInStatus({ kind: 'idle', message: '' });

    if (logoutUrl) {
      window.location.assign(logoutUrl);
      return;
    }

    navigate(SIGN_IN_PATH, buildSignInSearch('/tasks', 'signed_out'), { replace: true });
  }, [authRuntimeConfig, navigate, resolvedApiBaseUrl, sessionConfig.authType]);

  const handleTaskCreated = React.useCallback((created) => {
    const taskId = created?.taskId || created?.data?.taskId || null;
    navigate(taskId ? `/tasks/${encodeURIComponent(taskId)}` : '/tasks');
  }, [navigate]);

  const loadAdminUsers = React.useCallback(async () => {
    setAdminUsersState({ kind: 'loading', message: 'Loading users.' });
    try {
      const response = await window.fetch(`${resolvedApiBaseUrl}/auth/users`, {
        credentials: 'same-origin',
        headers: buildAuthHeaders(sessionConfig),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || 'User load failed.');
      const users = payload.data || [];
      setAdminUsers(users);
      setAdminUserDrafts(toAdminUserDrafts(users));
      setAdminUsersState({ kind: 'ready', message: '' });
    } catch (error) {
      setAdminUsers([]);
      setAdminUserDrafts({});
      setAdminUsersState({ kind: 'error', message: error?.message || 'User load failed.' });
    }
  }, [resolvedApiBaseUrl, sessionConfig]);

  const submitAdminUser = React.useCallback(async (event) => {
    event.preventDefault();
    setAdminUsersState({ kind: 'loading', message: 'Saving user.' });
    try {
      const response = await window.fetch(`${resolvedApiBaseUrl}/auth/users`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { ...buildAuthHeaders(sessionConfig), 'content-type': 'application/json' },
        body: JSON.stringify({
          email: adminUserDraft.email,
          tenantId: adminUserDraft.tenantId,
          actorId: adminUserDraft.actorId,
          roles: normalizeAdminRoles(adminUserDraft.roles),
          status: adminUserDraft.status,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || 'User save failed.');
      setAdminUserDraft({ email: '', tenantId: adminUserDraft.tenantId || 'engineering-team', actorId: '', roles: 'reader', status: 'active' });
      await loadAdminUsers();
    } catch (error) {
      setAdminUsersState({ kind: 'error', message: error?.message || 'User save failed.' });
    }
  }, [adminUserDraft, loadAdminUsers, resolvedApiBaseUrl, sessionConfig]);

  const updateAdminUserDraft = React.useCallback((userId, updates) => {
    setAdminUserDrafts((current) => ({
      ...current,
      [userId]: {
        ...current[userId],
        ...updates,
      },
    }));
  }, []);

  const patchAdminUser = React.useCallback(async (user, updates = {}, successMessage = 'User updated.') => {
    if (!user?.userId) return;
    const draft = {
      ...toAdminUserDraft(user),
      ...(adminUserDrafts[user.userId] || {}),
      ...updates,
    };
    setAdminUsersState({ kind: 'loading', message: 'Saving user.' });
    try {
      const response = await window.fetch(`${resolvedApiBaseUrl}/auth/users/${encodeURIComponent(user.userId)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { ...buildAuthHeaders(sessionConfig), 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: draft.tenantId,
          actorId: draft.actorId,
          roles: normalizeAdminRoles(draft.roles),
          status: draft.status,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || 'User update failed.');
      await loadAdminUsers();
      setAdminUsersState({ kind: 'success', message: successMessage });
    } catch (error) {
      setAdminUsersState({ kind: 'error', message: error?.message || 'User update failed.' });
    }
  }, [adminUserDrafts, loadAdminUsers, resolvedApiBaseUrl, sessionConfig]);

  const submitAdminUserEdit = React.useCallback(async (event, user) => {
    event.preventDefault();
    await patchAdminUser(user, {}, 'User updated.');
  }, [patchAdminUser]);

  React.useEffect(() => {
    if (isAuthenticated && matchAdminUsersRoute(pathname) && hasAnyRole(tokenClaims, ['admin'])) {
      loadAdminUsers();
    }
  }, [isAuthenticated, loadAdminUsers, pathname, tokenClaims]);

  const listFilters = model.kind === 'list' ? model.list.filters : {
    owner: '',
    view: 'list',
    bucket: '',
    priority: '',
    status: '',
    searchTerm: '',
  };
  const visibleListItems = model.kind === 'list'
    ? filterTaskList(model.list.items, {
        owner: listFilters.owner,
        priority: listFilters.priority,
        status: listFilters.status,
        searchTerm: listFilters.searchTerm,
      })
    : [];
  const listPriorityOptions = React.useMemo(() => (
    model.kind === 'list'
      ? Array.from(new Set(model.list.items.map((item) => String(item.priority || '').trim()).filter(Boolean))).sort()
      : []
  ), [model]);
  const listStatusOptions = React.useMemo(() => (
    model.kind === 'list' ? buildBoardStageOrder(model.list.items) : []
  ), [model]);
  const hasActiveListFilters = Boolean(listFilters.owner || listFilters.priority || listFilters.status || listFilters.searchTerm);
  const roleInboxItems = model.kind === 'list' && activeInboxRole ? buildRoleInboxItems(model.list.items, activeInboxRole, agentLookup) : [];
  const pmSections = model.kind === 'list' && isPmOverview ? buildPmOverviewSections(model.list.items, agentLookup) : [];
  const governanceItems = model.kind === 'list' && isGovernanceOverview ? buildGovernanceReviewItems(model.list.items, agentLookup) : [];
  const activePmBucket = isPmOverview && PM_OVERVIEW_BUCKET_ORDER.includes(listFilters.bucket) ? listFilters.bucket : '';
  const selectedPmSection = activePmBucket ? pmSections.find((section) => section.key === activePmBucket) || null : null;
  const visiblePmSections = isPmOverview
    ? activePmBucket
      ? selectedPmSection?.items.length ? [selectedPmSection] : []
      : pmSections.filter((section) => section.items.length > 0)
    : [];
  const boardColumns = model.kind === 'list' ? buildBoardColumns(model.list.items, visibleListItems, agentLookup) : [];
  const listState = model.kind === 'list' ? model.list.state : { kind: 'idle' };
  const roleInboxState = !activeInboxRole
    ? { kind: 'idle', message: '' }
    : listState.kind !== 'ready'
      ? { kind: listState.kind, message: listState.message || '' }
      : agentOptionsState.kind === 'loading'
        ? { kind: 'loading', message: `Loading ${getRoleInboxLabel(activeInboxRole)} inbox routing.` }
        : agentOptionsState.kind === 'error'
          ? {
              kind: 'error',
              message: `${agentOptionsState.message} ${getRoleInboxLabel(activeInboxRole)} inbox counts stay hidden until canonical owner-to-role mapping is available.`,
            }
          : { kind: 'ready', message: '' };
  const resultSummary = model.kind === 'list'
    ? isPmOverview
      ? summarizePmOverviewResults(visiblePmSections, activePmBucket)
      : isGovernanceOverview
        ? `${governanceItems.length} governance review${governanceItems.length === 1 ? '' : 's'} shown.`
      : activeInboxRole
        ? roleInboxState.kind === 'ready'
          ? summarizeRoleInboxResults(roleInboxItems.length, activeInboxRole)
          : roleInboxState.message
        : summarizeListResults(visibleListItems.length, listFilters.owner, agentLookup, listFilters.view)
      : '';

  if (!isAuthenticated) {
    return (
      <main className="app-shell app-shell--auth">
        <section className="auth-card" aria-label="Sign-in screen">
          <div className="auth-card__intro">
            <p className="eyebrow">Authenticated browser shell for US-002</p>
            <h1>Sign in to the workflow app</h1>
            <p className="lede">
              {matchAuthCallbackRoute(pathname)
                ? 'Completing the enterprise sign-in callback for the task list, board, PM overview, inboxes, and task detail routes.'
                : isMagicLinkMode
                  ? 'Enter your invited email address to receive a secure sign-in link for the workflow app.'
                  : 'Use the configured enterprise identity provider to start a browser session for the task list, board, PM overview, inboxes, and task detail routes.'}
            </p>
          </div>

          {visibleAuthNotice ? (
            <p className="auth-status auth-status--notice" role="status">
              {visibleAuthNotice}
            </p>
          ) : null}

          {matchAuthCallbackRoute(pathname) ? (
            <p className="auth-status auth-status--notice" role="status">
              {signInStatus.kind === 'loading' ? signInStatus.message : 'Completing enterprise sign-in…'}
            </p>
          ) : (
            <>
              {isMagicLinkMode ? (
                <form className="session-form auth-form" onSubmit={handleMagicLinkSignIn}>
                  <label>
                    Email address
                    <input
                      name="email"
                      type="email"
                      value={signInDraft.email}
                      onChange={(event) => setSignInDraft((current) => ({ ...current, email: event.target.value }))}
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </label>

                  <div className="session-form__actions">
                    <button type="submit" disabled={signInStatus.kind === 'loading'}>
                      {signInStatus.kind === 'loading' ? signInStatus.message : 'Send sign-in link'}
                    </button>
                  </div>
                </form>
              ) : null}

              {isOidcMode ? (
                <div className="session-form__actions">
                  <button type="button" onClick={handleEnterpriseSignIn} disabled={signInStatus.kind === 'loading' || !authRuntimeConfig.isOidcConfigured}>
                    {signInStatus.kind === 'loading' ? signInStatus.message : 'Continue with enterprise sign-in'}
                  </button>
                </div>
              ) : null}

              {!isMagicLinkMode && !authRuntimeConfig.isOidcConfigured ? (
                <p className="auth-status auth-status--error" role="alert">
                  This deployment is missing enterprise auth configuration. Contact the operator responsible for production identity-provider settings.
                </p>
              ) : null}

              {canUseInternalBootstrap ? (
                <form className="session-form auth-form" onSubmit={handleSignIn}>
                  <label>
                    Trusted auth code
                    <input
                      name="authCode"
                      value={signInDraft.authCode}
                      onChange={(event) => setSignInDraft((current) => ({ ...current, authCode: event.target.value }))}
                      placeholder="Paste the signed browser auth code"
                    />
                  </label>

                  <label>
                    API base URL
                    <input
                      name="apiBaseUrl"
                      value={signInDraft.apiBaseUrl}
                      onChange={(event) => setSignInDraft((current) => ({ ...current, apiBaseUrl: event.target.value }))}
                      placeholder={envApiBaseUrl || 'same-origin'}
                    />
                  </label>

                  <div className="session-form__actions">
                    <button type="submit" className="button-secondary" disabled={signInStatus.kind === 'loading'}>
                      Use internal bootstrap fallback
                    </button>
                  </div>
                </form>
              ) : null}

              {signInStatus.kind === 'error' ? (
                <p className="auth-status auth-status--error" role="alert">{signInStatus.message}</p>
              ) : null}
              {signInStatus.kind === 'success' ? (
                <p className="auth-status auth-status--notice" role="status">{signInStatus.message}</p>
              ) : null}
            </>
          )}
        </section>
      </main>
    );
  }

  if (matchCreateTaskRoute(pathname)) {
    return (
      <main className="app-shell">
        <nav className="app-nav" aria-label="Primary navigation">
          <div className="app-nav__links">
            <button type="button" className="button-secondary" onClick={() => navigate('/tasks')}>Task list</button>
            <button type="button" className="button-secondary" onClick={() => navigate('/tasks', writeTaskListUrlState({ view: 'board' }, ''))}>Board</button>
            <button type="button" className="button-secondary" onClick={() => navigate('/overview/pm')}>PM overview</button>
          </div>
          <div className="app-nav__session">
            <span>{tokenClaims?.sub || 'unknown actor'} · {tokenClaims?.tenant_id || 'unknown tenant'}</span>
            <button type="button" className="button-secondary" onClick={handleSignOut}>Sign out</button>
          </div>
        </nav>
        <TaskCreationPage
          sessionConfig={sessionConfig}
          envApiBaseUrl={envApiBaseUrl}
          onTaskCreated={handleTaskCreated}
        />
      </main>
    );
  }

  if (matchAdminUsersRoute(pathname)) {
    const isAdmin = hasAnyRole(tokenClaims, ['admin']);
    return (
      <main className="app-shell">
        <nav className="app-nav" aria-label="Primary navigation">
          <div className="app-nav__links">
            <button type="button" className="button-secondary" onClick={() => navigate('/tasks')}>Task list</button>
            <button type="button" className={isAdmin ? '' : 'button-secondary'} onClick={() => navigate('/admin/users')}>User admin</button>
          </div>
          <div className="app-nav__session">
            <span>{tokenClaims?.sub || 'unknown actor'} · {tokenClaims?.tenant_id || 'unknown tenant'}</span>
            <button type="button" className="button-secondary" onClick={handleSignOut}>Sign out</button>
          </div>
        </nav>
        {authNotice ? <p className="auth-status auth-status--error" role="alert">{authNotice}</p> : null}
        <header className="page-header">
          <div>
            <p className="eyebrow">Authentication administration</p>
            <h1>User admin</h1>
            <p className="lede">Manage invited users for magic-link sign-in.</p>
          </div>
        </header>
        {!isAdmin ? (
          <section className="empty-state" role="alert">
            <h2>Access denied</h2>
            <p>Admin role is required to manage users.</p>
          </section>
        ) : (
          <section className="detail-panel">
            <form className="session-form auth-form" onSubmit={submitAdminUser}>
              <label>
                Email
                <input value={adminUserDraft.email} onChange={(event) => setAdminUserDraft((current) => ({ ...current, email: event.target.value }))} type="email" />
              </label>
              <label>
                Tenant ID
                <input value={adminUserDraft.tenantId} onChange={(event) => setAdminUserDraft((current) => ({ ...current, tenantId: event.target.value }))} />
              </label>
              <label>
                Actor ID
                <input value={adminUserDraft.actorId} onChange={(event) => setAdminUserDraft((current) => ({ ...current, actorId: event.target.value }))} />
              </label>
              <label>
                Roles
                <input value={adminUserDraft.roles} onChange={(event) => setAdminUserDraft((current) => ({ ...current, roles: event.target.value }))} placeholder="reader,pm,admin" />
              </label>
              <label>
                Status
                <select value={adminUserDraft.status} onChange={(event) => setAdminUserDraft((current) => ({ ...current, status: event.target.value }))}>
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                </select>
              </label>
              <div className="session-form__actions">
                <button type="submit" disabled={adminUsersState.kind === 'loading'}>Save user</button>
                <button type="button" className="button-secondary" onClick={loadAdminUsers}>Refresh</button>
              </div>
            </form>
            {adminUsersState.kind === 'error' ? <p className="auth-status auth-status--error" role="alert">{adminUsersState.message}</p> : null}
            {adminUsersState.kind === 'success' || adminUsersState.kind === 'loading' ? <p className="auth-status auth-status--notice" role="status">{adminUsersState.message}</p> : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Email</th><th>Actor</th><th>Tenant</th><th>Roles</th><th>Status</th><th>Last sign-in</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {adminUsers.map((user) => {
                    const draft = adminUserDrafts[user.userId] || toAdminUserDraft(user);
                    const nextStatus = user.status === 'disabled' ? 'active' : 'disabled';
                    return (
                      <tr key={user.userId}>
                        <td>{user.email}</td>
                        <td>
                          <input
                            value={draft.actorId}
                            onChange={(event) => updateAdminUserDraft(user.userId, { actorId: event.target.value })}
                            aria-label={`Actor ID for ${user.email}`}
                          />
                        </td>
                        <td>
                          <input
                            value={draft.tenantId}
                            onChange={(event) => updateAdminUserDraft(user.userId, { tenantId: event.target.value })}
                            aria-label={`Tenant ID for ${user.email}`}
                          />
                        </td>
                        <td>
                          <input
                            value={draft.roles}
                            onChange={(event) => updateAdminUserDraft(user.userId, { roles: event.target.value })}
                            aria-label={`Roles for ${user.email}`}
                            placeholder="reader,pm,admin"
                          />
                        </td>
                        <td>
                          <select
                            value={draft.status}
                            onChange={(event) => updateAdminUserDraft(user.userId, { status: event.target.value })}
                            aria-label={`Status for ${user.email}`}
                          >
                            <option value="active">active</option>
                            <option value="disabled">disabled</option>
                          </select>
                        </td>
                        <td>{user.lastSignInAt || 'Never'}</td>
                        <td>
                          <form className="session-form__actions" onSubmit={(event) => submitAdminUserEdit(event, user)}>
                            <button type="submit" disabled={adminUsersState.kind === 'loading'}>Save</button>
                            <button
                              type="button"
                              className="button-secondary"
                              disabled={adminUsersState.kind === 'loading'}
                              onClick={() => patchAdminUser(user, { status: nextStatus }, nextStatus === 'active' ? 'User reactivated.' : 'User disabled.')}
                            >
                              {nextStatus === 'active' ? 'Reactivate' : 'Disable'}
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <nav className="app-nav" aria-label="Primary navigation">
        <div className="app-nav__links">
          <button type="button" className={model.kind === 'list' && !isPmOverview && !isGovernanceOverview && !activeInboxRole && listFilters.view !== 'board' ? '' : 'button-secondary'} onClick={() => navigate('/tasks')}>Task list</button>
          <button type="button" className={model.kind === 'list' && !isPmOverview && !isGovernanceOverview && !activeInboxRole && listFilters.view === 'board' ? '' : 'button-secondary'} onClick={() => navigate('/tasks', writeTaskListUrlState({ view: 'board' }, ''))}>Board</button>
          <button type="button" className="button-secondary" onClick={() => navigate('/tasks/create')}>Create intake</button>
          <button type="button" className={isPmOverview ? '' : 'button-secondary'} onClick={() => navigate('/overview/pm')}>PM overview</button>
          <button type="button" className={isGovernanceOverview ? '' : 'button-secondary'} onClick={() => navigate('/overview/governance')}>Governance reviews</button>
          {hasAnyRole(tokenClaims, ['admin']) ? (
            <button type="button" className="button-secondary" onClick={() => navigate('/admin/users')}>User admin</button>
          ) : null}
          {ROLE_INBOXES.map((role) => (
            <button key={role} type="button" className={activeInboxRole === role ? '' : 'button-secondary'} onClick={() => navigate(`/inbox/${role}`)}>
              {getRoleInboxLabel(role)} inbox
            </button>
          ))}
        </div>
        <div className="app-nav__session">
          <span>{tokenClaims?.sub || 'unknown actor'} · {tokenClaims?.tenant_id || 'unknown tenant'}</span>
          <button type="button" className="button-secondary" onClick={handleSignOut}>Sign out</button>
        </div>
      </nav>
      {authNotice ? <p className="auth-status auth-status--error" role="alert">{authNotice}</p> : null}
      <header className="page-header">
        <div>
          <p className="eyebrow">Authenticated browser shell for US-002</p>
          <h1>{model.kind === 'list' ? (isPmOverview ? 'PM Overview' : isGovernanceOverview ? 'Governance Reviews' : activeInboxRole ? `${getRoleInboxLabel(activeInboxRole)} Inbox` : 'Task list') : model.detail?.task?.title || model.summary.title || 'Task detail'}</h1>
          <p className="lede">
	            {model.kind === 'list'
	              ? isPmOverview
	                ? 'Read-only grouped overview showing routed, unassigned, and attention-needed work from the canonical owner-role mapping.'
	                : isGovernanceOverview
	                  ? 'Dedicated operational surface for inactivity and governance review tasks that should stay out of delivery queues.'
	                : activeInboxRole
	                  ? activeInboxRole === 'sre'
	                    ? 'Read-only monitoring inbox showing tasks routed here because they are in the SRE monitoring stage or explicitly assigned to SRE-owned work.'
	                    : `Read-only inbox surface showing tasks routed here because the current assigned owner maps to the ${getRoleInboxLabel(activeInboxRole)} role.`
	                  : 'Overview list wired to the projected owner read model with single-select owner filtering.'
	              : 'Route-mounted task detail screen using the existing adapter and page module contract.'}
          </p>
        </div>

        <div className="header-tools">
          <form
            className="route-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const nextTaskId = String(form.get('taskId') || '').trim();
              if (nextTaskId) {
                navigate(`/tasks/${encodeURIComponent(nextTaskId)}`);
              }
            }}
          >
            <label>
              Task ID
              <input name="taskId" defaultValue={routeTaskId} placeholder="TSK-42" />
            </label>
            <div className="route-form__actions">
              <button type="submit">Open</button>
              <button type="button" className="button-secondary" onClick={() => navigate('/tasks')}>Task list</button>
              <button type="button" className="button-secondary" onClick={() => navigate('/tasks/create')}>Create intake</button>
              <button type="button" className={isPmOverview ? '' : 'button-secondary'} onClick={() => navigate('/overview/pm')}>PM overview</button>
              <button type="button" className={isGovernanceOverview ? '' : 'button-secondary'} onClick={() => navigate('/overview/governance')}>Governance reviews</button>
              {ROLE_INBOXES.map((role) => (
                <button key={role} type="button" className={activeInboxRole === role ? '' : 'button-secondary'} onClick={() => navigate(`/inbox/${role}`)}>
                  {getRoleInboxLabel(role)} inbox
                </button>
              ))}
            </div>
          </form>

          <section className="session-form session-form--summary" aria-label="Current session">
            <div className="session-form__header">
              <strong>Current session</strong>
              <span>Signed-in browser access for internal use.</span>
            </div>

            <dl className="session-meta">
              <div>
                <dt>API</dt>
                <dd>{resolvedApiBaseUrl || 'same-origin'}</dd>
              </div>
              <div>
                <dt>Actor</dt>
                <dd>{tokenClaims?.sub || 'none'}</dd>
              </div>
              <div>
                <dt>Tenant</dt>
                <dd>{tokenClaims?.tenant_id || 'none'}</dd>
              </div>
              <div>
                <dt>Roles</dt>
                <dd>{Array.isArray(tokenClaims?.roles) && tokenClaims.roles.length ? tokenClaims.roles.join(', ') : 'none'}</dd>
              </div>
            </dl>
          </section>
        </div>
      </header>

      {model.kind === 'list' ? (
        <section className="task-list-panel" aria-label={isPmOverview ? 'PM overview view' : isGovernanceOverview ? 'Governance reviews view' : activeInboxRole ? `${getRoleInboxLabel(activeInboxRole)} inbox view` : 'Task list view'}>
          <div className="task-list-toolbar">
            {isPmOverview ? (
              <div className="role-inbox-toolbar">
                <div>
                  <p className="eyebrow">Cross-role overview</p>
                  <h2>PM grouped list overview</h2>
                  <p className="role-inbox-toolbar__cue">Tasks are grouped into routing buckets in one read-only list. Use the single bucket filter to focus on one section and clear it to restore the grouped overview.</p>
                </div>
                <div className="task-list-toolbar__actions">
                  <label>
                    Bucket filter
                    <select aria-label="Bucket filter" value={activePmBucket} onChange={(event) => navigate('/overview/pm', writeTaskListUrlState({ bucket: event.target.value }, search))}>
                      <option value="">All buckets</option>
                      {PM_OVERVIEW_BUCKET_ORDER.map((bucket) => (
                        <option key={bucket} value={bucket}>{getPmOverviewBucketLabel(bucket)}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="button-secondary" onClick={() => navigate('/overview/pm', writeTaskListUrlState({ bucket: '' }, search))} disabled={!activePmBucket}>Clear filter</button>
                  <button type="button" onClick={() => void reloadTask()}>Refresh</button>
                </div>
              </div>
            ) : isGovernanceOverview ? (
              <div className="role-inbox-toolbar">
                <div>
                  <p className="eyebrow">Operational governance</p>
                  <h2>Governance review queue</h2>
                  <p className="role-inbox-toolbar__cue">Inactivity review and governance follow-up tasks live here so they remain visible without mixing into normal delivery views.</p>
                </div>
                <div className="task-list-toolbar__actions">
                  <button type="button" className="button-secondary" onClick={() => navigate('/tasks')}>Open full task list</button>
                  <button type="button" onClick={() => void reloadTask()}>Refresh</button>
                </div>
              </div>
	            ) : activeInboxRole ? (
	              <div className="role-inbox-toolbar">
	                <div>
	                  <p className="eyebrow">Role inbox</p>
	                  <h2>{getRoleInboxLabel(activeInboxRole)} inbox routing</h2>
	                  <p className="role-inbox-toolbar__cue">
	                    {activeInboxRole === 'sre'
	                      ? 'Tasks appear here when they are actively in the SRE monitoring stage or when routing metadata explicitly points to SRE ownership.'
	                      : activeInboxRole === 'human'
                          ? 'Decision-ready items appear here only when governed close review or escalation handling is explicitly waiting on a human stakeholder decision.'
	                      : `Tasks appear here only when their current assigned owner resolves to the ${getRoleInboxLabel(activeInboxRole)} canonical role. Unassigned tasks appear in no role inbox.`}
	                  </p>
	                </div>
                <div className="task-list-toolbar__actions">
                  <button type="button" className="button-secondary" onClick={() => navigate('/tasks')}>Open full task list</button>
                  <button type="button" onClick={() => void reloadTask()}>Refresh</button>
                </div>
              </div>
            ) : (
              <>
                <label>
                  Owner filter
                  <select
                    aria-label="Owner filter"
                    value={listFilters.owner}
                    onChange={(event) => setListOwnerFilter(event.target.value)}
                  >
                    <option value="">All owners</option>
                    <option value={UNASSIGNED_FILTER_VALUE}>Unassigned</option>
                    {mapAgentOptions(agentOptions).map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority filter
                  <select
                    aria-label="Priority filter"
                    value={listFilters.priority}
                    onChange={(event) => setTaskListFilters({ priority: event.target.value })}
                  >
                    <option value="">All priorities</option>
                    {listPriorityOptions.map((priority) => (
                      <option key={priority} value={priority}>{priority}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Status filter
                  <select
                    aria-label="Status filter"
                    value={listFilters.status}
                    onChange={(event) => setTaskListFilters({ status: event.target.value })}
                  >
                    <option value="">All statuses</option>
                    {listStatusOptions.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Search tasks
                  <input
                    aria-label="Search tasks"
                    value={listFilters.searchTerm}
                    onChange={(event) => setTaskListFilters({ searchTerm: event.target.value })}
                    placeholder="Task ID or title"
                  />
                </label>
                <div className="task-list-toolbar__actions">
                  <div className="view-toggle" role="tablist" aria-label="Task overview mode">
                    <button type="button" role="tab" aria-selected={listFilters.view === 'list'} className={listFilters.view === 'list' ? '' : 'button-secondary'} onClick={() => setListView('list')}>List</button>
                    <button type="button" role="tab" aria-selected={listFilters.view === 'board'} className={listFilters.view === 'board' ? '' : 'button-secondary'} onClick={() => setListView('board')}>Board</button>
                  </div>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setTaskListFilters({ owner: '', priority: '', status: '', searchTerm: '' })}
                    disabled={!hasActiveListFilters}
                  >
                    Clear all filters
                  </button>
                  <button type="button" onClick={() => void reloadTask()}>Refresh</button>
                </div>
              </>
            )}
          </div>

          <p className="task-list-results" role="status" aria-live="polite">{resultSummary}</p>

          {(isPmOverview && listState.kind === 'loading') || (isGovernanceOverview && listState.kind === 'loading') || (!activeInboxRole && !isPmOverview && !isGovernanceOverview && listState.kind === 'loading') || (activeInboxRole && roleInboxState.kind === 'loading') ? <p role="status">{activeInboxRole ? roleInboxState.message : isPmOverview ? 'Loading PM overview.' : isGovernanceOverview ? 'Loading governance reviews.' : 'Loading task list.'}</p> : null}
          {((!activeInboxRole && !isPmOverview && !isGovernanceOverview && listState.kind === 'error') || (isPmOverview && listState.kind === 'error') || (isGovernanceOverview && listState.kind === 'error')) ? <p role="alert">{listState.message}</p> : null}
          {isPmOverview && agentOptionsState.kind === 'error' && listState.kind === 'ready' ? (
            <div className="empty-state" role="alert">
              <h2>Some routing metadata is unavailable</h2>
              <p>{agentOptionsState.message}</p>
              <p className="task-list-meta">Tasks remain visible using safe fallback labels, but canonical bucket routing may place affected rows in Needs routing attention.</p>
            </div>
          ) : null}
          {activeInboxRole && roleInboxState.kind === 'error' ? (
            <div className="empty-state" role="alert">
              <h2>{getRoleInboxLabel(activeInboxRole)} inbox temporarily degraded</h2>
              <p>{roleInboxState.message}</p>
              <p className="task-list-meta">This inbox waits for both `/tasks` and `/ai-agents` before confirming empty or routed results.</p>
            </div>
          ) : null}

          {isPmOverview && listState.kind === 'ready' && visiblePmSections.length ? (
            <div className="task-list-table-wrap">
              {visiblePmSections.map((section) => (
                <section key={section.key} aria-labelledby={`pm-bucket-${section.key}`} className="pm-overview-section">
                  <div className="task-board__column-header">
                    <h2 id={`pm-bucket-${section.key}`}>{section.label}</h2>
                    <span>{section.items.length}</span>
                  </div>
                  <table className="task-list-table">
                    <thead>
                      <tr>
                        <th scope="col">Task</th>
                        <th scope="col">Stage</th>
                        <th scope="col">Owner</th>
                        <th scope="col">Routing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.items.map((item) => (
                        <tr key={item.task_id}>
                          <td>
                            <a href={`/tasks/${encodeURIComponent(item.task_id)}`} onClick={(event) => { event.preventDefault(); navigate(`/tasks/${encodeURIComponent(item.task_id)}`); }}>
                              <strong>{item.title || item.task_id}</strong>
                            </a>
                            <div className="task-list-meta">{item.task_id}</div>
                          </td>
                          <td>{item.current_stage || '—'}</td>
                          <td>
                            <span className={`owner-badge owner-badge--${item.ownerPresentation.tone}`}>{item.ownerPresentation.label}</span>
                            <div className="task-list-meta">{item.pmBucket.degradedLabel || 'Read-only owner metadata'}</div>
                          </td>
                          <td>
                            <span className="routing-badge">{item.pmBucket.routingCue}</span>
                            <div className="task-list-meta">{item.pmBucket.routingReason}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
          ) : null}

          {roleInboxState.kind === 'ready' && activeInboxRole === 'sre' && roleInboxItems.length ? (
            <div className="task-list-table-wrap">
              <table className="task-list-table" aria-label="SRE monitoring dashboard">
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Risk</th>
                    <th scope="col">Time remaining</th>
                    <th scope="col">Deployment</th>
                    <th scope="col">PR / Commit</th>
                    <th scope="col">Telemetry</th>
                    <th scope="col">Drilldowns</th>
                  </tr>
                </thead>
                <tbody>
                  {roleInboxItems.map((item) => (
                    <tr key={item.task_id}>
                      <td>
                        <a href={`/tasks/${encodeURIComponent(item.task_id)}`} onClick={(event) => { event.preventDefault(); navigate(`/tasks/${encodeURIComponent(item.task_id)}`); }}>
                          <strong>{item.title || item.task_id}</strong>
                        </a>
                        <div className="task-list-meta">{item.task_id} · {item.current_stage || '—'}</div>
                      </td>
                      <td>
                        <span className="routing-badge">{String(item.monitoring?.riskLevel || 'unknown').toUpperCase()}</span>
                        <div className="task-list-meta">{item.queueReason.label}</div>
                      </td>
                      <td>
                        <strong>{item.monitoring?.timeRemainingLabel || 'Not started'}</strong>
                        <div className="task-list-meta">{item.monitoring?.windowEndsAt || 'No deadline yet'}</div>
                      </td>
                      <td>
                        <div>{item.monitoring?.deployment?.environment || 'No deploy recorded'}</div>
                        <div className="task-list-meta">
                          {item.monitoring?.deployment?.version || 'No version'}
                          {item.monitoring?.deployment?.url ? ` · ${item.monitoring.deployment.url}` : ''}
                        </div>
                      </td>
                      <td>
                        <div>{item.monitoring?.linkedPrs?.[0]?.number ? `PR #${item.monitoring.linkedPrs[0].number}` : 'No merged PR'}</div>
                        <div className="task-list-meta">{item.monitoring?.commitSha || 'No commit snapshot'}</div>
                      </td>
                      <td>
                        <div>Freshness: {item.monitoring?.telemetry?.freshness || 'unknown'}</div>
                        <div className="task-list-meta">Events: {item.monitoring?.telemetry?.eventCount ?? 0}</div>
                      </td>
                      <td>
                        <div className="task-list-meta">
                          {item.monitoring?.telemetry?.drilldowns?.metrics ? <a href={item.monitoring.telemetry.drilldowns.metrics} target="_blank" rel="noreferrer">Metrics</a> : 'Metrics unavailable'}
                          {' · '}
                          {item.monitoring?.telemetry?.drilldowns?.logs ? <a href={item.monitoring.telemetry.drilldowns.logs} target="_blank" rel="noreferrer">Logs</a> : 'Logs unavailable'}
                          {' · '}
                          {item.monitoring?.telemetry?.drilldowns?.traces ? <a href={item.monitoring.telemetry.drilldowns.traces} target="_blank" rel="noreferrer">Traces</a> : 'Traces unavailable'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {roleInboxState.kind === 'ready' && activeInboxRole === 'human' && roleInboxItems.length ? (
            <div className="decision-inbox-list" aria-label="Human decision queue">
              {roleInboxItems.map((item) => {
                const closeGovernanceItem = item.close_governance || {};
                const cancellationRecommendations = closeGovernanceItem.cancellation?.recommendations || {};
                const escalation = closeGovernanceItem.escalation || null;
                const latestDecision = closeGovernanceItem.humanDecision?.latestDecision || null;
                const draft = humanInboxDecisionDrafts[item.task_id] || normalizeHumanInboxDecisionDraft(item);
                const status = humanInboxDecisionStatuses[item.task_id] || { kind: 'idle', message: '' };
                return (
                  <article key={item.task_id} className="detail-card detail-card--full decision-inbox-card">
                    <div className="decision-inbox-card__header">
                      <div>
                        <p className="eyebrow">Human decision required</p>
                        <h3>
                          <a href={`/tasks/${encodeURIComponent(item.task_id)}`} onClick={(event) => { event.preventDefault(); navigate(`/tasks/${encodeURIComponent(item.task_id)}`); }}>
                            {item.title || item.task_id}
                          </a>
                        </h3>
                        <p className="task-list-meta">{item.task_id} · {item.current_stage || '—'} · {item.priority || '—'} priority</p>
                      </div>
                      <div className="decision-inbox-card__meta">
                        <span className="routing-badge">{item.queueReason.label}</span>
                        <span className={`owner-badge owner-badge--${item.ownerPresentation.tone}`}>{item.ownerPresentation.label}</span>
                      </div>
                    </div>

                    <div className="review-question-note">
                      <span>Decision summary</span>
                      <p>{closeGovernanceItem.humanDecision?.summary || escalation?.summary || item.next_required_action || 'Governed close review is waiting on a human decision.'}</p>
                      <p className="task-list-meta">{item.queueReason.detail}</p>
                    </div>

                    {cancellationRecommendations.pm || cancellationRecommendations.architect ? (
                      <div className="review-question-note">
                        <span>Recommendation snapshot</span>
                        {cancellationRecommendations.pm ? (
                          <div className="review-question-note__recommendation" key="pm-recommendation">
                            <p><strong>PM:</strong> {cancellationRecommendations.pm.summary || 'Recommendation recorded.'}</p>
                            {cancellationRecommendations.pm.rationale ? <p className="task-list-meta">{cancellationRecommendations.pm.rationale}</p> : null}
                          </div>
                        ) : null}
                        {cancellationRecommendations.architect ? (
                          <div className="review-question-note__recommendation" key="architect-recommendation">
                            <p><strong>Architect:</strong> {cancellationRecommendations.architect.summary || 'Recommendation recorded.'}</p>
                            {cancellationRecommendations.architect.rationale ? <p className="task-list-meta">{cancellationRecommendations.architect.rationale}</p> : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {escalation ? (
                      <div className="review-question-note">
                        <span>{escalation.source === 'monitoring_expiry' ? 'Monitoring expiry escalation' : 'Exceptional dispute escalation'}</span>
                        <p><strong>Recommendation:</strong> {escalation.recommendation || 'Human review required.'}</p>
                        {escalation.rationale ? <p className="task-list-meta">{escalation.rationale}</p> : null}
                        <p className="task-list-meta">{String(escalation.severity || 'warning').toUpperCase()} · {escalation.occurredAt || 'No timestamp recorded'}</p>
                      </div>
                    ) : null}

                    {latestDecision ? (
                      <div className="review-question-note">
                        <span>Latest decision</span>
                        <p><strong>{formatCloseGovernanceDecisionStatus(closeGovernanceItem.humanDecision?.status)}</strong></p>
                        {latestDecision.summary ? <p>{latestDecision.summary}</p> : null}
                        {latestDecision.rationale ? <p className="task-list-meta">{latestDecision.rationale}</p> : null}
                      </div>
                    ) : null}

                    {canSubmitHumanInboxDecision ? (
                      <form className="architect-handoff-form" onSubmit={(event) => void submitHumanInboxDecision(event, item)}>
                        <label>
                          {`Human decision for ${item.task_id}`}
                          <select
                            aria-label={`Human decision for ${item.task_id}`}
                            value={draft.outcome}
                            onChange={(event) => setHumanInboxDecisionDrafts((current) => ({
                              ...current,
                              [item.task_id]: { ...draft, outcome: event.target.value },
                            }))}
                          >
                            <option value="approve">Approve</option>
                            <option value="reject">Reject</option>
                            <option value="request_more_context">Request more context</option>
                          </select>
                        </label>
                        <label>
                          Decision summary
                          <textarea
                            aria-label={`Decision summary for ${item.task_id}`}
                            value={draft.summary}
                            onChange={(event) => setHumanInboxDecisionDrafts((current) => ({
                              ...current,
                              [item.task_id]: { ...draft, summary: event.target.value },
                            }))}
                            placeholder="Short, mobile-scannable decision summary."
                          />
                        </label>
                        <label>
                          Rationale
                          <textarea
                            aria-label={`Decision rationale for ${item.task_id}`}
                            value={draft.rationale}
                            onChange={(event) => setHumanInboxDecisionDrafts((current) => ({
                              ...current,
                              [item.task_id]: { ...draft, rationale: event.target.value },
                            }))}
                            placeholder="Required when rejecting or requesting more context."
                          />
                        </label>
                        <div className="assignment-form__actions">
                          <button type="submit" disabled={status.kind === 'loading'}>
                            {status.kind === 'loading' ? 'Recording…' : 'Record human decision'}
                          </button>
                          <button type="button" className="button-secondary" onClick={() => navigate(`/tasks/${encodeURIComponent(item.task_id)}`)}>
                            Open task detail
                          </button>
                        </div>
                        {status.kind !== 'idle' ? (
                          <p className={`assignment-status assignment-status--${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
                            {status.message}
                          </p>
                        ) : null}
                      </form>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}

          {roleInboxState.kind === 'ready' && activeInboxRole && activeInboxRole !== 'sre' && activeInboxRole !== 'human' && roleInboxItems.length ? (
            <div className="task-list-table-wrap">
              <table className="task-list-table">
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Queue reason</th>
                    <th scope="col">Routing</th>
                  </tr>
                </thead>
                <tbody>
                  {roleInboxItems.map((item) => (
                    <tr key={item.task_id}>
                      <td>
                        <a href={`/tasks/${encodeURIComponent(item.task_id)}`} onClick={(event) => { event.preventDefault(); navigate(`/tasks/${encodeURIComponent(item.task_id)}`); }}>
                          <strong>{item.title || item.task_id}</strong>
                        </a>
                        <div className="task-list-meta">{item.task_id}</div>
                        {isIntakeDraftTask(item) ? <div className="task-list-meta"><span className="routing-badge">Intake Draft</span></div> : null}
                      </td>
                      <td>{item.current_stage || '—'}</td>
                      <td>{item.priority || '—'}</td>
                      <td>
                        <span className={`owner-badge owner-badge--${item.ownerPresentation.tone}`}>{item.ownerPresentation.label}</span>
                        <div className="task-list-meta">Read-only owner metadata</div>
                      </td>
                      <td>
                        <span className="routing-badge">{item.queueReason.label}</span>
                        <div className="task-list-meta">{item.queueReason.detail}</div>
                      </td>
                      <td>
                        <span className="routing-badge">{getRoleInboxLabel(activeInboxRole)} route</span>
                        <div className="task-list-meta">{item.routing.routingLabel}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {isGovernanceOverview && listState.kind === 'ready' && governanceItems.length ? (
            <div className="task-list-table-wrap">
              <table className="task-list-table">
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {governanceItems.map((item) => (
                    <tr key={item.task_id}>
                      <td>
                        <a href={`/tasks/${encodeURIComponent(item.task_id)}`} onClick={(event) => { event.preventDefault(); navigate(`/tasks/${encodeURIComponent(item.task_id)}`); }}>
                          <strong>{item.title || item.task_id}</strong>
                        </a>
                        <div className="task-list-meta">{item.task_id}</div>
                        {isIntakeDraftTask(item) ? <div className="task-list-meta"><span className="routing-badge">Intake Draft</span></div> : null}
                      </td>
                      <td>{item.current_stage || '—'}</td>
                      <td>{item.priority || '—'}</td>
                      <td>
                        <span className={`owner-badge owner-badge--${item.ownerPresentation.tone}`}>{item.ownerPresentation.label}</span>
                        <div className="task-list-meta">Governance-only owner metadata</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {listState.kind === 'ready' && !activeInboxRole && !isPmOverview && !isGovernanceOverview && visibleListItems.length && listFilters.view === 'list' ? (
            <div className="task-list-table-wrap">
              <table className="task-list-table">
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleListItems.map((item) => {
                    const owner = resolveOwnerPresentation(item, agentLookup);
                    const isMatch = matchesTaskSearch(item, listFilters.searchTerm);
                    const assignedToActor = isTaskAssignedToCurrentActor(item, tokenClaims, agentLookup);
                    return (
                      <tr key={item.task_id} className={isMatch ? 'task-list-row--match' : ''}>
                        <td>
                          <a href={`/tasks/${encodeURIComponent(item.task_id)}`} onClick={(event) => { event.preventDefault(); navigate(`/tasks/${encodeURIComponent(item.task_id)}`); }}>
                            <strong>{item.title || item.task_id}</strong>
                          </a>
                          <div className="task-list-meta">{item.task_id}</div>
                          {isIntakeDraftTask(item) ? <div className="task-list-meta"><span className="routing-badge">Intake Draft</span> {item.next_required_action || 'PM refinement required'}</div> : null}
                          {assignedToActor ? <div className="task-list-meta"><span className="routing-badge">Assigned to me</span></div> : null}
                        </td>
                        <td>{item.current_stage || '—'}</td>
                        <td>{item.priority || '—'}</td>
                        <td>
                          <span className={`owner-badge owner-badge--${owner.tone}`}>{owner.label}</span>
                          <div className="task-list-meta">Read-only owner metadata</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {listState.kind === 'ready' && !activeInboxRole && !isPmOverview && !isGovernanceOverview && visibleListItems.length && listFilters.view === 'board' ? (
            <div className="task-board" aria-label="Task board">
              {lifecycleStatus.kind !== 'idle' ? (
                <p className={`assignment-status assignment-status--${lifecycleStatus.kind}`} role={lifecycleStatus.kind === 'error' ? 'alert' : 'status'}>
                  {lifecycleStatus.message}
                </p>
              ) : null}
              <div className="task-board__scroll">
                <div className="task-board__columns">
                  {boardColumns.map((column) => (
                    <section
                      key={column.stage}
                      className={`task-board__column${dragState.overStage === column.stage ? ' task-board__column--drop-target' : ''}`}
                      aria-label={`${column.stage} column`}
                      onDragOver={(event) => {
                        if (!isLifecycleStage(column.stage)) return;
                        event.preventDefault();
                        if (dragState.overStage !== column.stage) {
                          setDragState((current) => ({ ...current, overStage: column.stage }));
                        }
                      }}
                      onDragLeave={() => {
                        if (dragState.overStage === column.stage) {
                          setDragState((current) => ({ ...current, overStage: '' }));
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const taskId = event.dataTransfer.getData('text/task-id');
                        const item = visibleListItems.find((entry) => entry.task_id === taskId);
                        void handleBoardDrop(item, column.stage);
                      }}
                    >
                      <div className="task-board__column-header">
                        <h2>{column.stage}</h2>
                        <span>{column.items.length}</span>
                      </div>
                      <div className="task-board__column-body">
                        {column.items.length ? column.items.map((item) => {
                          const isMatch = matchesTaskSearch(item, listFilters.searchTerm);
                          const assignedToActor = isTaskAssignedToCurrentActor(item, tokenClaims, agentLookup);
                          return (
                          <article
                            key={item.task_id}
                            className={`task-board__card${isMatch ? ' task-board__card--match' : ''}${dragState.taskId === item.task_id ? ' task-board__card--dragging' : ''}`}
                            draggable={isLifecycleStage(item.current_stage)}
                            onDragStart={(event) => {
                              event.dataTransfer.setData('text/task-id', item.task_id);
                              event.dataTransfer.effectAllowed = 'move';
                              setDragState({ taskId: item.task_id, overStage: '' });
                            }}
                            onDragEnd={() => setDragState({ taskId: null, overStage: '' })}
                          >
                            <a href={`/tasks/${encodeURIComponent(item.task_id)}`} onClick={(event) => { event.preventDefault(); navigate(`/tasks/${encodeURIComponent(item.task_id)}`); }}>
                              <strong>{item.title || item.task_id}</strong>
                            </a>
                            <div className="task-list-meta">{item.task_id}</div>
                            {isIntakeDraftTask(item) ? <div className="task-list-meta"><span className="routing-badge">Intake Draft</span> {item.next_required_action || 'PM refinement required'}</div> : null}
                            {column.stage === 'VERIFY' ? <div className="task-list-meta"><span className="routing-badge">SRE review pending</span></div> : null}
                            {assignedToActor ? <div className="task-list-meta"><span className="routing-badge">Assigned to me</span></div> : null}
                            <div className="task-board__card-meta">
                              <span className="task-board__label">Priority</span>
                              <span>{item.priority || '—'}</span>
                            </div>
                            <div className="task-board__card-meta task-board__card-meta--owner">
                              <span className="task-board__label">Owner</span>
                              <span
                                className={`owner-badge owner-badge--${item.ownerPresentation.tone} owner-badge--board`}
                                title={item.ownerPresentation.label}
                                aria-label={item.ownerPresentation.detail}
                              >
                                {item.ownerPresentation.label}
                              </span>
                            </div>
                            <div className="task-list-meta">{isLifecycleStage(item.current_stage) ? 'Drag to another lifecycle column to move this task.' : 'Read-only owner metadata'}</div>
                          </article>
                        );
                        }) : <p className="task-board__empty">No matching tasks in this column.</p>}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {roleInboxState.kind === 'ready' && activeInboxRole && !roleInboxItems.length ? (
            <div className="empty-state" role="status">
              <h2>No tasks routed to {getRoleInboxLabel(activeInboxRole)}</h2>
              <p>No assigned tasks currently resolve to the {getRoleInboxLabel(activeInboxRole)} role. This is not a loading state.</p>
              <p className="task-list-meta">If owner-to-role mapping is stale or hidden, affected tasks remain stable in the general task list with safe fallback owner metadata instead of appearing in the wrong inbox.</p>
            </div>
          ) : null}

          {isPmOverview && listState.kind === 'ready' && !visiblePmSections.length ? (
            <div className="empty-state" role="status">
              <h2>{activePmBucket ? `No tasks in ${getPmOverviewBucketLabel(activePmBucket)}` : 'No tasks available'}</h2>
              <p>{activePmBucket ? 'No tasks currently match the selected PM overview bucket.' : 'No tasks are available in the PM overview yet.'}</p>
              {activePmBucket ? <button type="button" onClick={() => navigate('/overview/pm', writeTaskListUrlState({ bucket: '' }, search))}>Clear filter</button> : null}
            </div>
          ) : null}

          {isGovernanceOverview && listState.kind === 'ready' && !governanceItems.length ? (
            <div className="empty-state" role="status">
              <h2>No governance reviews available</h2>
              <p>No governance review tasks are currently open.</p>
            </div>
          ) : null}

          {listState.kind === 'ready' && !activeInboxRole && !isPmOverview && !isGovernanceOverview && !visibleListItems.length ? (
            <div className="empty-state" role="status">
              <h2>No matching tasks</h2>
              <p>{hasActiveListFilters ? 'No tasks match the active task filters.' : 'No tasks are available yet.'}</p>
              {hasActiveListFilters ? <button type="button" onClick={() => setTaskListFilters({ owner: '', priority: '', status: '', searchTerm: '' })}>Clear all filters</button> : null}
            </div>
          ) : null}
        </section>
      ) : (
        <>
          {model.detail?.reviewQuestions?.pinned?.length ? (
            <section className="review-question-banner" aria-label="Architect review blockers" role="alert" aria-live="assertive">
              <div>
                <p className="eyebrow">Architect review blockers</p>
                <h2>Pending PM answers are blocking architect review</h2>
                <p className="review-question-banner__lede">These workflow threads stay pinned until PM resolves every blocking architect review question.</p>
              </div>
              <ul className="review-question-list">
                {model.detail.reviewQuestions.pinned.map((question) => (
                  <li key={question.id}>
                    <strong>{question.prompt}</strong>
                    <span>{formatReviewQuestionState(question.state)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {workflowThreads.filter((thread) => thread.blocking && thread.state !== 'resolved').length ? (
            <section className="review-question-banner" aria-label="Workflow thread blockers" role="alert" aria-live="assertive">
              <div>
                <p className="eyebrow">Workflow blockers</p>
                <h2>Blocking workflow threads need resolution</h2>
                <p className="review-question-banner__lede">Blocking questions, escalations, decisions, and consultations stay pinned here until the thread owner resolves them.</p>
              </div>
              <ul className="review-question-list">
                {workflowThreads.filter((thread) => thread.blocking && thread.state !== 'resolved').map((thread) => (
                  <li key={thread.id}>
                    <strong>{thread.title}</strong>
                    <span>{formatWorkflowCommentType(thread.commentType)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {model.detail?.blockers?.length ? (
            <section className="blocker-banner" aria-label="Task blockers" role="alert" aria-live="assertive">
              <div>
                <p className="eyebrow">Blockers</p>
                <h2>Work is currently blocked</h2>
              </div>
              <ul className="blocker-list">
                {model.detail.blockers.map((blocker) => (
                  <li key={blocker.id}>
                    <strong>{blocker.label}</strong>
                    <span>{renderBlockerMeta(blocker)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="task-detail-hero" aria-label="Task summary">
            <div className="task-detail-hero__title">
              <div className="task-status-pill" data-status={model.detail?.task?.status || 'active'}>
                <span aria-hidden="true">{formatStatusIcon(model.detail?.task?.status)}</span>
                <span>{formatStatusLabel(model.detail?.task?.status)}</span>
              </div>
              <div className="priority-pill">{model.summary.priority || 'No priority'}</div>
              {detailIsIntakeDraft ? <div className="routing-badge">Intake Draft</div> : null}
              {detailAssignedToActor ? <div className="routing-badge">Assigned to me</div> : null}
            </div>
            <div className="summary-grid summary-grid--hero">
              <article>
                <span>Owner</span>
                <strong>{model.detail?.summary?.owner?.label || model.summary.currentOwner || 'Unassigned'}</strong>
              </article>
              <article>
                <span>Workflow stage</span>
                <strong>{model.detail?.summary?.workflowStage?.label || model.summary.currentStage || '—'}</strong>
              </article>
              <article>
                <span>Status</span>
                <strong>{formatBlockedStateLabel(model.detail?.summary?.blockedState, model.detail?.task?.status)}</strong>
                {model.detail?.summary?.blockedState?.waitingOn ? <small>Waiting on {model.detail.summary.blockedState.waitingOn}</small> : null}
              </article>
              <article>
                <span>Next action</span>
                <strong>{model.detail?.summary?.nextAction?.label || model.summary.nextRequiredAction || 'No next step defined'}</strong>
                {model.detail?.summary?.nextAction?.source ? <small>Source: {model.detail.summary.nextAction.source}</small> : null}
              </article>
              <article>
                <span>PR status</span>
                <strong>{model.detail?.summary?.prStatus?.label || 'No linked PRs'}</strong>
              </article>
              <article>
                <span>Child tasks</span>
                <strong>{model.detail?.summary?.childStatus?.label || 'No child tasks'}</strong>
              </article>
              <article>
                <span>Timers and freshness</span>
                <strong>{model.detail?.summary?.timers?.queueAgeLabel || formatFreshness(model.summary)}</strong>
              </article>
            </div>
          </section>

          {model.detail?.meta?.permissions?.canViewOrchestration === false ? (
            <section className="detail-card detail-card--full" aria-label="Orchestration visibility">
              <h2>Orchestration visibility</h2>
              <p className="empty-copy">Dependency planning and orchestration details are hidden for this session.</p>
            </section>
          ) : model.detail?.orchestration ? (
            <section className="detail-card detail-card--full" aria-label="Orchestration visibility">
              <div className="detail-card__header">
                <div>
                  <h2>Orchestration visibility</h2>
                  <p className="task-list-meta">
                    {model.detail.orchestration.run.state === 'not_started'
                      ? 'Dependency planning is available, but no coordinator run has been started yet.'
                      : model.detail.orchestration.run.state === 'empty'
                        ? 'No child work items are linked to this task yet.'
                        : `Current run state: ${model.detail.orchestration.run.state.replace(/_/g, ' ')}.`}
                  </p>
                </div>
              </div>
              <div className="summary-grid orchestration-summary-grid">
                <article>
                  <span>Ready</span>
                  <strong>{model.detail.orchestration.run.summary.readyCount}</strong>
                </article>
                <article>
                  <span>Running</span>
                  <strong>{model.detail.orchestration.run.summary.runningCount}</strong>
                </article>
                <article>
                  <span>Blocked</span>
                  <strong>{model.detail.orchestration.run.summary.blockedCount}</strong>
                </article>
                <article>
                  <span>Fallback</span>
                  <strong>{model.detail.orchestration.run.summary.failedCount}</strong>
                </article>
                <article>
                  <span>Completed</span>
                  <strong>{model.detail.orchestration.run.summary.completedCount}</strong>
                </article>
              </div>
              {model.detail.orchestration.run.items?.length ? (
                <div className="orchestration-table" role="table" aria-label="Orchestrated child work items">
                  <div className="orchestration-table__head" role="rowgroup">
                    <div role="row">
                      <span role="columnheader">Work item</span>
                      <span role="columnheader">State</span>
                      <span role="columnheader">Dependency status</span>
                      <span role="columnheader">Why</span>
                    </div>
                  </div>
                  <div className="orchestration-table__body" role="rowgroup">
                    {model.detail.orchestration.run.items.map((item) => (
                      <div className="orchestration-table__row" role="row" key={item.id}>
                        <div role="cell">
                          <strong>{item.title}</strong>
                          <span>{item.id}{item.taskType ? ` · ${item.taskType}` : ''}</span>
                        </div>
                        <div role="cell">
                          <strong>{formatOrchestrationItemStateLabel(item.state)}</strong>
                          {item.specialist ? <span>{item.specialist}{item.actualAgent ? ` → ${item.actualAgent}` : ''}</span> : null}
                        </div>
                        <div role="cell">
                          <strong>{formatDependencyStateLabel(item.dependencyState)}</strong>
                          {item.dependsOn?.length ? <span>Depends on {item.dependsOn.map((dependency) => dependency.id).join(', ')}</span> : <span>No unmet dependencies</span>}
                        </div>
                        <div role="cell">
                          {item.blockers?.length ? (
                            <span>{item.blockers.map((blocker) => blocker.reason).join(' · ')}</span>
                          ) : item.lastMessage ? (
                            <span>{item.lastMessage}</span>
                          ) : (
                            <span>No blocker or fallback details.</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="empty-copy">No orchestrated child work items yet.</p>
              )}
            </section>
          ) : null}

          {(model.detail?.relations?.parentTask || model.detail?.relations?.childTasks?.length || model.detail?.context?.anomalyChildTask || model.detail?.blockers?.some((blocker) => blocker.childTaskId)) ? (
            <section className="detail-card detail-card--full" aria-label="Anomaly lineage and blocking">
              <h2>Anomaly lineage</h2>
              {model.detail?.relations?.parentTask ? (
                <div className="review-question-note">
                  <span>Created from parent monitoring anomaly</span>
                  <p><strong>{model.detail.relations.parentTask.title}</strong></p>
                  <p className="task-list-meta">
                    {model.detail.relations.parentTask.id} · {model.detail.relations.parentTask.stage || 'No stage'} · {formatStatusLabel(model.detail.relations.parentTask.status)}
                    {model.detail.relations.parentTask.blocked ? ' · parent currently blocked' : ''}
                  </p>
                  {model.detail.context?.pmBusinessContextReview?.finalized ? (
                    <p className="task-list-meta">PM finalized business context at {model.detail.context.pmBusinessContextReview.completedAt || 'unknown time'} by {model.detail.context.pmBusinessContextReview.completedBy || 'unknown actor'}.</p>
                  ) : (
                    <p className="task-list-meta">PM review is still required before architect detail work can begin.</p>
                  )}
                </div>
              ) : null}
              {model.detail?.blockers?.filter((blocker) => blocker.childTaskId).map((blocker) => (
                <div className="review-question-note" key={blocker.id}>
                  <span>Blocked by anomaly child task</span>
                  <p><strong>{blocker.childTask?.title || blocker.label}</strong></p>
                  {blocker.childTask ? (
                    <p className="task-list-meta">
                      {blocker.childTask.id} · {blocker.childTask.stage || 'No stage'} · {formatStatusLabel(blocker.childTask.status)} · {blocker.childTask.owner?.label || 'Unassigned'}
                      {blocker.childTask.waitingState ? ` · ${blocker.childTask.waitingState}` : ''}
                    </p>
                  ) : null}
                  {blocker.reason ? <p>{blocker.reason}</p> : null}
                  {blocker.nextRequiredAction ? <p className="task-list-meta">{blocker.nextRequiredAction}</p> : null}
                  {formatFreezeScopeLabels(blocker.freezeScope).length ? (
                    <p className="task-list-meta">
                      {formatFreezeScopeLabels(blocker.freezeScope).join(' · ')} · {blocker.viewable ? 'Viewable' : 'Not viewable'} · {blocker.commentable ? 'Commentable' : 'Comments paused'}
                    </p>
                  ) : null}
                </div>
              ))}
              {model.detail?.relations?.childTasks?.length ? (
                <div className="review-question-note">
                  <span>Linked anomaly child tasks</span>
                  <ul className="detail-bullets">
                    {model.detail.relations.childTasks.map((childTask) => (
                      <li key={childTask.id}>
                        <strong>{childTask.title}</strong>
                        <span>{childTask.id} · {childTask.stage || 'No stage'} · {formatStatusLabel(childTask.status)} · {childTask.owner?.label || 'Unassigned'}{childTask.waitingState ? ` · ${childTask.waitingState}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {model.detail?.context?.anomalyChildTask ? (
                <div className="review-question-note">
                  <span>Machine-generated anomaly context</span>
                  <p>{model.detail.context.anomalyChildTask.summary || 'No anomaly summary captured.'}</p>
                  <p className="task-list-meta">
                    {model.detail.context.anomalyChildTask.service || 'Unknown service'} · Source parent: {model.detail.context.anomalyChildTask.sourceTaskId || 'Unavailable'} · {model.detail.context.anomalyChildTask.finalizedByPm ? 'Finalized by PM' : 'Machine-generated defaults pending PM review'}
                  </p>
                  {model.detail.context.anomalyChildTask.finalizedByPm ? (
                    <p className="task-list-meta">
                      Finalized at {model.detail.context.anomalyChildTask.finalizedAt || 'unknown time'} by {model.detail.context.anomalyChildTask.finalizedBy || 'unknown actor'}.
                    </p>
                  ) : null}
                  <h3>Metrics</h3>
                  {renderList(model.detail.context.anomalyChildTask.metrics, 'No metrics captured.')}
                  <h3>Logs</h3>
                  {renderList(model.detail.context.anomalyChildTask.logs, 'No logs captured.')}
                  <h3>Error samples</h3>
                  {renderList(model.detail.context.anomalyChildTask.errorSamples, 'No error samples captured.')}
                </div>
              ) : null}
            </section>
          ) : null}

          {model.detail?.context?.closeGovernance?.active ? (
            <section className="detail-card detail-card--full" aria-label="Close review governance">
              <h2>Close review governance</h2>
              <div className="review-question-note">
                <span>{formatCloseGovernanceHeadline(model.detail.context.closeGovernance.readiness?.state)}</span>
                <p>{model.detail.context.closeGovernance.humanDecision?.summary || model.detail.context.closeGovernance.escalation?.summary || model.detail.summary?.nextAction?.label || 'Governed close review is active.'}</p>
                <p className="task-list-meta">
                  {formatCloseGovernanceDecisionStatus(model.detail.context.closeGovernance.humanDecision?.status)}
                  {model.detail.context.closeGovernance.backtrack?.available ? ' · Backtrack to implementation is available if the close gate fails.' : ''}
                </p>
              </div>

              <div className="review-question-note">
                <span>Readiness checklist</span>
                <ul className="detail-bullets">
                  {(model.detail.context.closeGovernance.readiness?.checklist || []).map((item) => (
                    <li key={item.key || item.id || item.label}>
                      <strong>{item.label}</strong>
                      <span>{formatCloseGovernanceChecklistLabel(item.status)} · {item.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {(model.detail.context.closeGovernance.cancellation?.recommendations?.pm || model.detail.context.closeGovernance.cancellation?.recommendations?.architect) ? (
                <div className="review-question-note">
                  <span>Cancellation recommendations</span>
                  {model.detail.context.closeGovernance.cancellation.recommendations.pm ? (
                    <div className="review-question-note__recommendation">
                      <p><strong>PM:</strong> {model.detail.context.closeGovernance.cancellation.recommendations.pm.summary || 'Recommendation recorded.'}</p>
                      {model.detail.context.closeGovernance.cancellation.recommendations.pm.rationale ? <p className="task-list-meta">{model.detail.context.closeGovernance.cancellation.recommendations.pm.rationale}</p> : null}
                    </div>
                  ) : null}
                  {model.detail.context.closeGovernance.cancellation.recommendations.architect ? (
                    <div className="review-question-note__recommendation">
                      <p><strong>Architect:</strong> {model.detail.context.closeGovernance.cancellation.recommendations.architect.summary || 'Recommendation recorded.'}</p>
                      {model.detail.context.closeGovernance.cancellation.recommendations.architect.rationale ? <p className="task-list-meta">{model.detail.context.closeGovernance.cancellation.recommendations.architect.rationale}</p> : null}
                    </div>
                  ) : null}
                  {model.detail.context.closeGovernance.cancellation.awaitingHumanDecision ? (
                    <p className="task-list-meta">Human stakeholder decision is still required before the cancellation path can conclude.</p>
                  ) : null}
                </div>
              ) : null}

              {model.detail.context.closeGovernance.escalation ? (
                <div className="review-question-note">
                  <span>{model.detail.context.closeGovernance.escalation.source === 'monitoring_expiry' ? 'Monitoring expiry escalation' : 'Exceptional dispute escalation'}</span>
                  <p>{model.detail.context.closeGovernance.escalation.summary}</p>
                  <p><strong>Recommendation:</strong> {model.detail.context.closeGovernance.escalation.recommendation || 'Human review required.'}</p>
                  {model.detail.context.closeGovernance.escalation.rationale ? <p className="task-list-meta">{model.detail.context.closeGovernance.escalation.rationale}</p> : null}
                </div>
              ) : null}

              {model.detail.context.closeGovernance.humanDecision?.latestDecision ? (
                <div className="review-question-note">
                  <span>Latest human decision</span>
                  <p><strong>{formatCloseGovernanceDecisionStatus(model.detail.context.closeGovernance.humanDecision.status)}</strong></p>
                  {model.detail.context.closeGovernance.humanDecision.latestDecision.summary ? <p>{model.detail.context.closeGovernance.humanDecision.latestDecision.summary}</p> : null}
                  {model.detail.context.closeGovernance.humanDecision.latestDecision.rationale ? <p className="task-list-meta">{model.detail.context.closeGovernance.humanDecision.latestDecision.rationale}</p> : null}
                </div>
              ) : null}

              {model.detail.context.closeGovernance.backtrack?.latestReason ? (
                <div className="review-question-note">
                  <span>Backtrack signal</span>
                  <p>{model.detail.context.closeGovernance.backtrack.latestReason}</p>
                </div>
              ) : null}

              {canSubmitCloseCancellationRecommendation ? (
                <form className="architect-handoff-form" onSubmit={submitCloseCancellationRecommendation}>
                  <label>
                    Cancellation recommendation summary
                    <textarea
                      value={closeCancellationDraft.summary}
                      onChange={(event) => setCloseCancellationDraft((current) => ({ ...current, summary: event.target.value }))}
                      placeholder="Short recommendation summary for PM or Architect review."
                    />
                  </label>
                  <label>
                    Cancellation rationale
                    <textarea
                      value={closeCancellationDraft.rationale}
                      onChange={(event) => setCloseCancellationDraft((current) => ({ ...current, rationale: event.target.value }))}
                      placeholder="Why cancellation is the governed outcome."
                    />
                  </label>
                  <div className="assignment-form__actions">
                    <button type="submit" disabled={closeCancellationStatus.kind === 'loading'}>
                      {closeCancellationStatus.kind === 'loading' ? 'Recording…' : 'Record cancellation recommendation'}
                    </button>
                  </div>
                  {closeCancellationStatus.kind !== 'idle' ? (
                    <p className={`assignment-status assignment-status--${closeCancellationStatus.kind}`} role={closeCancellationStatus.kind === 'error' ? 'alert' : 'status'}>
                      {closeCancellationStatus.message}
                    </p>
                  ) : null}
                </form>
              ) : null}

              {canSubmitExceptionalDispute ? (
                <form className="architect-handoff-form" onSubmit={submitExceptionalDispute}>
                  <label>
                    Exceptional dispute summary
                    <textarea
                      value={exceptionalDisputeDraft.summary}
                      onChange={(event) => setExceptionalDisputeDraft((current) => ({ ...current, summary: event.target.value }))}
                      placeholder="Short summary of the disputed close-review outcome."
                    />
                  </label>
                  <label>
                    Recommendation for human decision
                    <textarea
                      value={exceptionalDisputeDraft.recommendation}
                      onChange={(event) => setExceptionalDisputeDraft((current) => ({ ...current, recommendation: event.target.value }))}
                      placeholder="Recommendation shown on the human decision card."
                    />
                  </label>
                  <label>
                    Dispute rationale
                    <textarea
                      value={exceptionalDisputeDraft.rationale}
                      onChange={(event) => setExceptionalDisputeDraft((current) => ({ ...current, rationale: event.target.value }))}
                      placeholder="Explain why the close path is disputed and needs explicit human resolution."
                    />
                  </label>
                  <label>
                    Escalation severity
                    <select
                      aria-label="Escalation severity"
                      value={exceptionalDisputeDraft.severity}
                      onChange={(event) => setExceptionalDisputeDraft((current) => ({ ...current, severity: event.target.value }))}
                    >
                      <option value="warning">Warning</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>
                  <div className="assignment-form__actions">
                    <button type="submit" disabled={exceptionalDisputeStatus.kind === 'loading'}>
                      {exceptionalDisputeStatus.kind === 'loading' ? 'Escalating…' : 'Escalate exceptional dispute'}
                    </button>
                  </div>
                  {exceptionalDisputeStatus.kind !== 'idle' ? (
                    <p className={`assignment-status assignment-status--${exceptionalDisputeStatus.kind}`} role={exceptionalDisputeStatus.kind === 'error' ? 'alert' : 'status'}>
                      {exceptionalDisputeStatus.message}
                    </p>
                  ) : null}
                </form>
              ) : null}

              {canSubmitHumanCloseDecision ? (
                <form className="architect-handoff-form" onSubmit={submitHumanCloseDecision}>
                  <label>
                    Human decision
                    <select
                      aria-label="Human decision"
                      value={humanCloseDecisionDraft.outcome}
                      onChange={(event) => setHumanCloseDecisionDraft((current) => ({ ...current, outcome: event.target.value }))}
                    >
                      <option value="approve">Approve</option>
                      <option value="reject">Reject</option>
                      <option value="request_more_context">Request more context</option>
                    </select>
                  </label>
                  <label>
                    Decision summary
                    <textarea
                      value={humanCloseDecisionDraft.summary}
                      onChange={(event) => setHumanCloseDecisionDraft((current) => ({ ...current, summary: event.target.value }))}
                      placeholder="Short, mobile-scannable decision summary."
                    />
                  </label>
                  <label>
                    Rationale
                    <textarea
                      value={humanCloseDecisionDraft.rationale}
                      onChange={(event) => setHumanCloseDecisionDraft((current) => ({ ...current, rationale: event.target.value }))}
                      placeholder="Required when rejecting or requesting more context."
                    />
                  </label>
                  <div className="assignment-form__actions">
                    <button type="submit" disabled={humanCloseDecisionStatus.kind === 'loading'}>
                      {humanCloseDecisionStatus.kind === 'loading' ? 'Recording…' : 'Record human decision'}
                    </button>
                  </div>
                  {humanCloseDecisionStatus.kind !== 'idle' ? (
                    <p className={`assignment-status assignment-status--${humanCloseDecisionStatus.kind}`} role={humanCloseDecisionStatus.kind === 'error' ? 'alert' : 'status'}>
                      {humanCloseDecisionStatus.message}
                    </p>
                  ) : null}
                </form>
              ) : null}

              {canSubmitCloseBacktrack ? (
                <form className="architect-handoff-form" onSubmit={submitCloseBacktrack}>
                  <label>
                    Backtrack reason
                    <select
                      aria-label="Backtrack reason"
                      value={closeBacktrackDraft.reasonCode}
                      onChange={(event) => setCloseBacktrackDraft((current) => ({ ...current, reasonCode: event.target.value }))}
                    >
                      <option value="criteria_gap">Criteria gap</option>
                      <option value="open_child_tasks">Open child tasks</option>
                      <option value="open_pull_requests">Open pull requests</option>
                      <option value="monitoring_degraded">Monitoring degraded</option>
                      <option value="cancellation_rejected">Cancellation rejected</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label>
                    Agreement artifact
                    <input
                      value={closeBacktrackDraft.agreementArtifact}
                      onChange={(event) => setCloseBacktrackDraft((current) => ({ ...current, agreementArtifact: event.target.value }))}
                      placeholder="pm+architect-close-review-2026-04-15"
                    />
                  </label>
                  <label>
                    Backtrack rationale
                    <textarea
                      value={closeBacktrackDraft.rationale}
                      onChange={(event) => setCloseBacktrackDraft((current) => ({ ...current, rationale: event.target.value }))}
                      placeholder="Why the close gate failed and implementation must resume."
                    />
                  </label>
                  <label>
                    Backtrack summary
                    <textarea
                      value={closeBacktrackDraft.summary}
                      onChange={(event) => setCloseBacktrackDraft((current) => ({ ...current, summary: event.target.value }))}
                      placeholder="Optional short summary for the audit trail."
                    />
                  </label>
                  <div className="assignment-form__actions">
                    <button type="submit" disabled={closeBacktrackStatus.kind === 'loading'}>
                      {closeBacktrackStatus.kind === 'loading' ? 'Backtracking…' : 'Backtrack to implementation'}
                    </button>
                  </div>
                  {closeBacktrackStatus.kind !== 'idle' ? (
                    <p className={`assignment-status assignment-status--${closeBacktrackStatus.kind}`} role={closeBacktrackStatus.kind === 'error' ? 'alert' : 'status'}>
                      {closeBacktrackStatus.message}
                    </p>
                  ) : null}
                </form>
              ) : null}
            </section>
          ) : null}

          {detailLifecycleItem && !detailIsIntakeDraft && isLifecycleStage(detailLifecycleItem.current_stage) ? (
            <section className="detail-card detail-card--full" aria-label="Lifecycle controls">
              <h2>Lifecycle controls</h2>
              <p>Valid transitions follow the US-004 lifecycle state machine. Invalid moves are blocked before the stage event is sent.</p>
              {detailLifecycleItem.current_stage === 'VERIFY' ? (
                <>
                  <label>
                    SRE finding note
                    <textarea
                      value={sreFindingDraft}
                      onChange={(event) => setSreFindingDraft(event.target.value)}
                      placeholder="Required when reopening from VERIFY."
                    />
                  </label>
                  <div className="assignment-form__actions">
                    <button
                      type="button"
                      onClick={() => void runLifecycleTransition({ item: detailLifecycleItem, toStage: 'DONE', source: 'detail-sre-approve' })}
                      disabled={lifecycleStatus.kind === 'loading'}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void runLifecycleTransition({ item: detailLifecycleItem, toStage: 'REOPEN', note: sreFindingDraft, source: 'detail-sre-reopen' })}
                      disabled={lifecycleStatus.kind === 'loading'}
                    >
                      Find Issues
                    </button>
                  </div>
                </>
              ) : (
                <div className="assignment-form__actions">
                  {(detailLifecycleItem.current_stage === 'BACKLOG' || detailLifecycleItem.current_stage === 'TODO' || detailLifecycleItem.current_stage === 'IN_PROGRESS' || detailLifecycleItem.current_stage === 'REOPEN') ? (
                    ['BACKLOG', 'TODO', 'IN_PROGRESS', 'VERIFY'].filter((stage) => stage !== detailLifecycleItem.current_stage).map((stage) => (
                      <button
                        key={stage}
                        type="button"
                        className="button-secondary"
                        onClick={() => void runLifecycleTransition({ item: detailLifecycleItem, toStage: stage, source: 'detail-lifecycle' })}
                        disabled={lifecycleStatus.kind === 'loading' || !canTransitionLifecycleTask(detailLifecycleItem, stage, tokenClaims, agentLookup).allowed}
                      >
                        Move to {stage}
                      </button>
                    ))
                  ) : null}
                </div>
              )}
              {lifecycleStatus.kind !== 'idle' ? (
                <p className={`assignment-status assignment-status--${lifecycleStatus.kind}`} role={lifecycleStatus.kind === 'error' ? 'alert' : 'status'}>
                  {lifecycleStatus.message}
                </p>
              ) : null}
            </section>
          ) : null}

          {activeTaskLock ? (
            <section className="detail-card detail-card--full" aria-label="Task lock status">
              <h2>Task lock</h2>
              <p>This task is locked by <strong>{activeTaskLock.ownerId}</strong>{activeTaskLock.reason ? ` for ${activeTaskLock.reason}` : ''}.</p>
              <p className="task-list-meta">Expires at {activeTaskLock.expiresAt || 'unknown'}{activeTaskLock.action ? ` · Action: ${activeTaskLock.action}` : ''}. Refresh or retry after the lock expires if you are not the lock holder.</p>
              {canManageTaskLock ? (
                <div className="assignment-form__actions">
                  {activeTaskLock.ownerId === tokenClaims?.sub ? (
                    <>
                      <button type="button" onClick={acquireTaskLock} disabled={taskLockStatus.kind === 'loading'}>
                        {taskLockStatus.kind === 'loading' ? 'Renewing…' : 'Renew lock'}
                      </button>
                      <button type="button" className="button-secondary" onClick={releaseTaskLock} disabled={taskLockStatus.kind === 'loading'}>
                        Release lock
                      </button>
                      <button type="button" className="button-secondary" onClick={() => void reloadTask()} disabled={taskLockStatus.kind === 'loading'}>
                        Refresh task state
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={acquireTaskLock} disabled={taskLockStatus.kind === 'loading'}>
                        {taskLockStatus.kind === 'loading' ? 'Refreshing…' : 'Retry acquire after refresh'}
                      </button>
                      <button type="button" className="button-secondary" onClick={() => void reloadTask()} disabled={taskLockStatus.kind === 'loading'}>
                        Refresh task state
                      </button>
                    </>
                  )}
                </div>
              ) : null}
              {taskLockStatus.kind !== 'idle' ? (
                <p className={`assignment-status assignment-status--${taskLockStatus.kind}`} role={taskLockStatus.kind === 'error' ? 'alert' : 'status'}>
                  {taskLockStatus.message}
                </p>
              ) : null}
            </section>
          ) : canManageTaskLock ? (
            <section className="detail-card detail-card--full" aria-label="Task lock controls">
              <h2>Task lock</h2>
              <p>No active lock. Acquire one before making a larger workflow change if you need to keep the task stable while editing.</p>
              <div className="assignment-form__actions">
                <button type="button" onClick={acquireTaskLock} disabled={taskLockStatus.kind === 'loading'}>
                  {taskLockStatus.kind === 'loading' ? 'Acquiring…' : 'Acquire lock'}
                </button>
                <button type="button" className="button-secondary" onClick={() => void reloadTask()} disabled={taskLockStatus.kind === 'loading'}>
                  Refresh task state
                </button>
              </div>
              {taskLockStatus.kind !== 'idle' ? (
                <p className={`assignment-status assignment-status--${taskLockStatus.kind}`} role={taskLockStatus.kind === 'error' ? 'alert' : 'status'}>
                  {taskLockStatus.message}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="detail-sections" aria-label="Task detail sections">
            <section className="detail-card">
              <h2>Overview</h2>
              {model.detail?.context?.operatorIntakeRequirements ? (
                <>
                  <h3>Operator intake requirements</h3>
                  <p>{model.detail.context.operatorIntakeRequirements}</p>
                </>
              ) : null}
              <p>{model.detail?.context?.businessContext || model.summary.businessContext || 'Business context is missing.'}</p>
              {pmBusinessContextRequired ? (
                <form className="architect-handoff-form" onSubmit={submitPmBusinessContext}>
                  <div className="review-question-note">
                    <span>PM business-context re-entry</span>
                    <p>Finalize the machine-generated business context before architect detail work can begin.</p>
                  </div>
                  <label>
                    Finalized business context
                    <textarea
                      value={pmBusinessContextDraft.businessContext}
                      onChange={(event) => setPmBusinessContextDraft({ businessContext: event.target.value })}
                      placeholder="Refine the business impact, customer risk, and delivery expectations for this anomaly child task."
                    />
                  </label>
                  <div className="assignment-form__actions">
                    <button type="submit" disabled={pmBusinessContextStatus.kind === 'loading' || !canSubmitPmBusinessContext}>
                      {pmBusinessContextStatus.kind === 'loading' ? 'Finalizing…' : 'Complete PM context review'}
                    </button>
                  </div>
                  {pmBusinessContextStatus.kind !== 'idle' ? (
                    <p className={`assignment-status assignment-status--${pmBusinessContextStatus.kind}`} role={pmBusinessContextStatus.kind === 'error' ? 'alert' : 'status'}>
                      {pmBusinessContextStatus.message}
                    </p>
                  ) : null}
                </form>
              ) : null}
              <h3>Acceptance criteria</h3>
              {renderList(model.detail?.context?.acceptanceCriteria || model.summary.acceptanceCriteria, 'Acceptance criteria are missing.')}
              <h3>Definition of Done</h3>
              {renderList(model.detail?.context?.definitionOfDone || model.summary.definitionOfDone, 'Definition of Done is missing.')}
            </section>

            <section className="detail-card">
              <h2>Delivery</h2>
              {model.detail?.context?.architectHandoff ? (
                <div className="architect-handoff-summary">
                  <div className="summary-grid review-question-summary-grid">
                    <article>
                      <span>Engineer tier</span>
                      <strong>{model.detail.context.architectHandoff.engineerTier}</strong>
                    </article>
                    <article>
                      <span>Handoff version</span>
                      <strong>v{model.detail.context.architectHandoff.version}</strong>
                    </article>
                    <article>
                      <span>Readiness</span>
                      <strong>{model.detail.context.architectHandoff.readyForEngineering ? 'Ready for engineering' : 'Draft'}</strong>
                    </article>
                    <article>
                      <span>Submitted by</span>
                      <strong>{model.detail.context.architectHandoff.submittedBy || 'Unknown'}</strong>
                    </article>
                  </div>
                  <p className="task-list-meta">{engineerTierDescription(model.detail.context.architectHandoff.engineerTier)}</p>
                  <h3>Tier rationale</h3>
                  <p>{model.detail.context.architectHandoff.tierRationale || 'Tier rationale is missing.'}</p>
                </div>
              ) : null}
              <h3>Technical spec</h3>
              <p>{model.detail?.context?.technicalSpec || 'Technical spec is missing.'}</p>
              <h3>Monitoring spec</h3>
              <p>{model.detail?.context?.monitoringSpec || 'Monitoring spec is missing.'}</p>
              <h3>Responsible escalation</h3>
              {skillEscalationEnabled ? (
                <form
                  className="architect-handoff-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const reason = skillEscalationDraft.reason.trim();
                    if (!skillEscalationAllowed) {
                      setSkillEscalationStatus({ kind: 'error', message: 'Responsible escalation is only available for Jr-tier work before implementation starts.' });
                      return;
                    }
                    if (!reason) {
                      setSkillEscalationStatus({ kind: 'error', message: 'Explain why this task needs higher-tier support.' });
                      return;
                    }
                    try {
                      setSkillEscalationStatus({ kind: 'loading', message: 'Requesting higher-tier support…' });
                      await taskClient.requestSkillEscalation(routeTaskId, { reason });
                      await reloadTask();
                      setSkillEscalationStatus({ kind: 'success', message: 'Responsible escalation recorded and surfaced for architect review.' });
                    } catch (error) {
                      setSkillEscalationStatus({ kind: 'error', message: error.message || 'Responsible escalation failed.' });
                    }
                  }}
                >
                  <label>
                    Why does this need higher-tier support?
                    <textarea
                      value={skillEscalationDraft.reason}
                      onChange={(event) => setSkillEscalationDraft({ reason: event.target.value })}
                      placeholder="Describe the scope, risk, or architectural complexity driving the escalation."
                    />
                  </label>
                  {!skillEscalationAllowed ? (
                    <p className="assignment-status" role="status">
                      Responsible escalation is available only for Jr-tier work before implementation starts.
                    </p>
                  ) : null}
                  <div className="assignment-form__actions">
                    <button type="submit" disabled={skillEscalationStatus.kind === 'loading' || !skillEscalationAllowed}>
                      {skillEscalationStatus.kind === 'loading' ? 'Submitting…' : 'Request higher-tier support'}
                    </button>
                  </div>
                  {skillEscalationStatus.kind !== 'idle' ? (
                    <p className={`assignment-status assignment-status--${skillEscalationStatus.kind}`} role={skillEscalationStatus.kind === 'error' ? 'alert' : 'status'}>
                      {skillEscalationStatus.message}
                    </p>
                  ) : null}
                </form>
              ) : (
                <p className="assignment-status" role="status">
                  Responsible escalation controls are available to engineer/admin bearer tokens.
                </p>
              )}
              <h3>Engineering handoff</h3>
              {architectHandoffEnabled ? (
                <form
                  className="architect-handoff-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    try {
                      setArchitectHandoffStatus({ kind: 'loading', message: 'Submitting engineering handoff…' });
                      await taskClient.submitArchitectHandoff(routeTaskId, {
                        readyForEngineering: architectHandoffDraft.readyForEngineering,
                        engineerTier: architectHandoffDraft.engineerTier,
                        tierRationale: architectHandoffDraft.tierRationale,
                        technicalSpec: architectHandoffDraft.technicalSpec,
                        monitoringSpec: architectHandoffDraft.monitoringSpec,
                      });
                      await reloadTask();
                      setArchitectHandoffStatus({ kind: 'success', message: 'Engineering handoff submitted.' });
                    } catch (error) {
                      setArchitectHandoffStatus({ kind: 'error', message: error.message || 'Engineering handoff failed.' });
                    }
                  }}
                >
                  <div className="summary-grid architect-handoff-grid">
                    <label>
                      Technical summary
                      <textarea
                        value={architectHandoffDraft.technicalSpec.summary}
                        onChange={(event) => setArchitectHandoffDraft((current) => ({ ...current, technicalSpec: { ...current.technicalSpec, summary: event.target.value } }))}
                        placeholder="Summarize the implementation contract and boundaries."
                      />
                    </label>
                    <label>
                      Scope and constraints
                      <textarea
                        value={architectHandoffDraft.technicalSpec.scope}
                        onChange={(event) => setArchitectHandoffDraft((current) => ({ ...current, technicalSpec: { ...current.technicalSpec, scope: event.target.value } }))}
                        placeholder="Call out scope, constraints, and assumptions."
                      />
                    </label>
                    <label>
                      Design and interfaces
                      <textarea
                        value={architectHandoffDraft.technicalSpec.design}
                        onChange={(event) => setArchitectHandoffDraft((current) => ({ ...current, technicalSpec: { ...current.technicalSpec, design: event.target.value } }))}
                        placeholder="Describe components, APIs, data contracts, and dependencies."
                      />
                    </label>
                    <label>
                      Rollout plan
                      <textarea
                        value={architectHandoffDraft.technicalSpec.rolloutPlan}
                        onChange={(event) => setArchitectHandoffDraft((current) => ({ ...current, technicalSpec: { ...current.technicalSpec, rolloutPlan: event.target.value } }))}
                        placeholder="Explain rollout sequencing, migrations, and fallback."
                      />
                    </label>
                    <label>
                      Monitored service
                      <input
                        value={architectHandoffDraft.monitoringSpec.service}
                        onChange={(event) => setArchitectHandoffDraft((current) => ({ ...current, monitoringSpec: { ...current.monitoringSpec, service: event.target.value } }))}
                        placeholder="workflow-audit-api"
                      />
                    </label>
                    <label>
                      Dashboard URLs
                      <textarea
                        value={architectHandoffDraft.monitoringSpec.dashboardUrls}
                        onChange={(event) => setArchitectHandoffDraft((current) => ({ ...current, monitoringSpec: { ...current.monitoringSpec, dashboardUrls: event.target.value } }))}
                        placeholder="One URL per line"
                      />
                    </label>
                    <label>
                      Alert policies
                      <textarea
                        value={architectHandoffDraft.monitoringSpec.alertPolicies}
                        onChange={(event) => setArchitectHandoffDraft((current) => ({ ...current, monitoringSpec: { ...current.monitoringSpec, alertPolicies: event.target.value } }))}
                        placeholder="One alert policy per line"
                      />
                    </label>
                    <label>
                      Runbook
                      <input
                        value={architectHandoffDraft.monitoringSpec.runbook}
                        onChange={(event) => setArchitectHandoffDraft((current) => ({ ...current, monitoringSpec: { ...current.monitoringSpec, runbook: event.target.value } }))}
                        placeholder="docs/runbooks/example.md"
                      />
                    </label>
                    <label>
                      Success metrics
                      <textarea
                        value={architectHandoffDraft.monitoringSpec.successMetrics}
                        onChange={(event) => setArchitectHandoffDraft((current) => ({ ...current, monitoringSpec: { ...current.monitoringSpec, successMetrics: event.target.value } }))}
                        placeholder="One metric per line"
                      />
                    </label>
                    <label>
                      Engineer tier
                      <select
                        value={architectHandoffDraft.engineerTier}
                        onChange={(event) => setArchitectHandoffDraft((current) => ({ ...current, engineerTier: event.target.value }))}
                      >
                        <option value="Principal">Principal</option>
                        <option value="Sr">Sr</option>
                        <option value="Jr">Jr</option>
                      </select>
                      <small>{engineerTierDescription(architectHandoffDraft.engineerTier)}</small>
                    </label>
                    <label className="architect-handoff-grid__full">
                      Tier rationale
                      <textarea
                        value={architectHandoffDraft.tierRationale}
                        onChange={(event) => setArchitectHandoffDraft((current) => ({ ...current, tierRationale: event.target.value }))}
                        placeholder="Explain why this level of engineering ownership is required."
                      />
                    </label>
                  </div>
                  <label className="review-question-checkbox">
                    <input
                      type="checkbox"
                      checked={architectHandoffDraft.readyForEngineering}
                      onChange={(event) => setArchitectHandoffDraft((current) => ({ ...current, readyForEngineering: event.target.checked }))}
                    />
                    Ready for engineering. This formal handoff is required before implementation begins.
                  </label>
                  <div className="assignment-form__actions">
                    <button type="submit" disabled={architectHandoffStatus.kind === 'loading'}>
                      {architectHandoffStatus.kind === 'loading' ? 'Submitting…' : 'Submit engineering handoff'}
                    </button>
                  </div>
                  {architectHandoffStatus.kind !== 'idle' ? (
                    <p className={`assignment-status assignment-status--${architectHandoffStatus.kind}`} role={architectHandoffStatus.kind === 'error' ? 'alert' : 'status'}>
                      {architectHandoffStatus.message}
                    </p>
                  ) : null}
                </form>
              ) : (
                <p className="assignment-status" role="status">
                  Engineering handoff controls are available to architect/admin bearer tokens.
                </p>
              )}
              <h3>Implementation handoff</h3>
              {model.detail?.context?.engineerSubmission ? (
                <div className="architect-handoff-summary">
                  <div className="summary-grid review-question-summary-grid">
                    <article>
                      <span>Primary reference</span>
                      <strong>{model.detail.context.engineerSubmission.primaryReference?.label || 'Pending submission'}</strong>
                    </article>
                    <article>
                      <span>Submission version</span>
                      <strong>v{model.detail.context.engineerSubmission.version}</strong>
                    </article>
                    <article>
                      <span>Submitted by</span>
                      <strong>{model.detail.context.engineerSubmission.submittedBy || 'Unknown'}</strong>
                    </article>
                    <article>
                      <span>QA readiness</span>
                      <strong>{model.detail.context.engineerSubmission.primaryReference ? 'Ready for QA handoff' : 'Metadata missing'}</strong>
                    </article>
                  </div>
                  {model.detail.context.engineerSubmission.commitSha ? (
                    <>
                      <h3>Commit SHA</h3>
                      <p className="implementation-reference implementation-reference--mono">{model.detail.context.engineerSubmission.commitSha}</p>
                    </>
                  ) : null}
                  {model.detail.context.engineerSubmission.prUrl ? (
                    <>
                      <h3>Pull request</h3>
                      <p className="implementation-reference implementation-reference--mono">{model.detail.context.engineerSubmission.prUrl}</p>
                    </>
                  ) : null}
                </div>
              ) : null}
              {model.detail?.context?.implementationHistory?.length > 1 ? (
                <>
                  <h3>Previous fix history</h3>
                  <ul className="detail-feed">
                    {model.detail.context.implementationHistory.map((entry) => (
                      <li key={`${entry.version}-${entry.eventId || entry.submittedAt}`}>
                        <strong>v{entry.version} · {entry.primaryReference?.label || entry.commitSha || entry.prUrl || 'Implementation reference missing'}</strong>
                        <span>{entry.submittedBy || 'Unknown engineer'} · {entry.submittedAt || 'No timestamp'}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <h3>Engineer activity monitoring</h3>
              {activityMonitoring ? (
                <div className="architect-handoff-summary">
                  <div className="summary-grid review-question-summary-grid">
                    <article>
                      <span>Required check-in interval</span>
                      <strong>{activityMonitoring.requiredCheckInIntervalMinutes || 15} min</strong>
                    </article>
                    <article>
                      <span>Missed check-ins</span>
                      <strong>{activityMonitoring.missedCheckIns ?? 0}</strong>
                    </article>
                    <article>
                      <span>Threshold</span>
                      <strong>{activityMonitoring.threshold || 2}</strong>
                    </article>
                    <article>
                      <span>Inactivity review</span>
                      <strong>{activityMonitoring.thresholdReached ? 'Threshold reached' : 'Within window'}</strong>
                    </article>
                  </div>
                  {activityMonitoring.lastActivity ? (
                    <p className="task-list-meta">
                      Latest qualifying engineer activity: {activityMonitoring.lastActivity.summary || activityMonitoring.lastActivity.type} · {activityMonitoring.lastActivity.occurredAt || 'No timestamp'}
                    </p>
                  ) : (
                    <p className="task-list-meta">No qualifying engineer activity signal has been recorded yet.</p>
                  )}
                </div>
              ) : null}
              {engineerSubmissionEnabled ? (
                <form
                  className="architect-handoff-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const summary = checkInDraft.summary.trim();
                    if (!engineerSubmissionAllowedForStage) {
                      setCheckInStatus({ kind: 'error', message: 'Check-ins can only be recorded while the task is in implementation.' });
                      return;
                    }
                    if (!summary) {
                      setCheckInStatus({ kind: 'error', message: 'A concrete progress summary is required.' });
                      return;
                    }
                    try {
                      setCheckInStatus({ kind: 'loading', message: 'Recording check-in…' });
                      await taskClient.recordEngineerCheckIn(routeTaskId, {
                        summary,
                        evidence: splitTextareaLines(checkInDraft.evidence),
                      });
                      await reloadTask();
                      setCheckInStatus({ kind: 'success', message: 'Check-in recorded.' });
                    } catch (error) {
                      setCheckInStatus({ kind: 'error', message: error.message || 'Check-in failed.' });
                    }
                  }}
                >
                  <label>
                    Progress summary
                    <textarea
                      value={checkInDraft.summary}
                      onChange={(event) => setCheckInDraft((current) => ({ ...current, summary: event.target.value }))}
                      placeholder="Describe concrete progress since the last qualifying engineer signal."
                    />
                  </label>
                  <label>
                    Evidence
                    <textarea
                      value={checkInDraft.evidence}
                      onChange={(event) => setCheckInDraft((current) => ({ ...current, evidence: event.target.value }))}
                      placeholder="Optional references, one per line."
                    />
                  </label>
                  {!engineerSubmissionAllowedForStage ? (
                    <p className="assignment-status" role="status">
                      Check-ins can only be recorded while the task is in implementation.
                    </p>
                  ) : null}
                  <div className="assignment-form__actions">
                    <button type="submit" disabled={checkInStatus.kind === 'loading' || !engineerSubmissionAllowedForStage}>
                      {checkInStatus.kind === 'loading' ? 'Submitting…' : 'Record engineer check-in'}
                    </button>
                  </div>
                  {checkInStatus.kind !== 'idle' ? (
                    <p className={`assignment-status assignment-status--${checkInStatus.kind}`} role={checkInStatus.kind === 'error' ? 'alert' : 'status'}>
                      {checkInStatus.message}
                    </p>
                  ) : null}
                </form>
              ) : null}
              {model.detail?.context?.transferredContext ? (
                <>
                  <h3>Transferred context</h3>
                  <div className="architect-handoff-summary">
                    <div className="summary-grid review-question-summary-grid">
                      <article>
                        <span>Previous owner</span>
                        <strong>{model.detail.context.transferredContext.prior_assignee || 'Unknown'}</strong>
                      </article>
                      <article>
                        <span>New owner</span>
                        <strong>{model.detail.context.transferredContext.new_assignee || 'Unassigned'}</strong>
                      </article>
                      <article>
                        <span>Tier change</span>
                        <strong>{model.detail.context.transferredContext.previous_engineer_tier || '—'}{' -> '}{model.detail.context.transferredContext.new_engineer_tier || '—'}</strong>
                      </article>
                      <article>
                        <span>Transfer mode</span>
                        <strong>{model.detail.context.transferredContext.mode || 'manual'}</strong>
                      </article>
                    </div>
                    <p>{model.detail.context.transferredContext.reason || 'No transfer rationale recorded.'}</p>
                    {model.detail.context.transferredContext.latest_activity ? (
                      <p className="task-list-meta">
                        Latest qualifying engineer activity: {model.detail.context.transferredContext.latest_activity.summary || model.detail.context.transferredContext.latest_activity.type} · {model.detail.context.transferredContext.latest_activity.occurredAt || 'No timestamp'}
                      </p>
                    ) : null}
                    {model.detail.context.transferredContext.latest_implementation_reference ? (
                      <p className="implementation-reference implementation-reference--mono">{typeof model.detail.context.transferredContext.latest_implementation_reference === 'string'
                        ? model.detail.context.transferredContext.latest_implementation_reference
                        : model.detail.context.transferredContext.latest_implementation_reference.label || 'Implementation reference attached'}</p>
                    ) : null}
                    {model.detail.context.transferredContext.unresolved_threads?.length ? (
                      <>
                        <h3>Open workflow context</h3>
                        <ul className="detail-bullets">
                          {model.detail.context.transferredContext.unresolved_threads.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {model.detail.context.transferredContext.blockers?.length ? (
                      <>
                        <h3>Current blockers</h3>
                        <ul className="detail-bullets">
                          {model.detail.context.transferredContext.blockers.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </div>
                </>
              ) : null}
              {model.detail?.context?.ghostingReview?.reviewTaskId ? (
                <>
                  <h3>Linked inactivity review</h3>
                  <div className="architect-handoff-summary">
                    <p>
                      <a href={`/tasks/${encodeURIComponent(model.detail.context.ghostingReview.reviewTaskId)}`} onClick={(event) => { event.preventDefault(); navigate(`/tasks/${encodeURIComponent(model.detail.context.ghostingReview.reviewTaskId)}`); }}>
                        {model.detail.context.ghostingReview.title || model.detail.context.ghostingReview.reviewTaskId}
                      </a>
                    </p>
                    <p className="task-list-meta">
                      Governance review task created at {model.detail.context.ghostingReview.createdAt || 'unknown time'} to track the inactivity-based reassignment outcome.
                    </p>
                  </div>
                </>
              ) : null}
              <h3>Architect tiering and reassignment</h3>
              {reassignmentGhostingEnabled ? (
                <>
                  <form
                    className="architect-handoff-form"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const engineerTier = retierDraft.engineerTier.trim();
                      const tierRationale = retierDraft.tierRationale.trim();
                      if (!engineerTier || !tierRationale) {
                        setRetierStatus({ kind: 'error', message: 'Engineer tier and tier rationale are required.' });
                        return;
                      }
                      try {
                        setRetierStatus({ kind: 'loading', message: 'Updating engineer tier…' });
                        await taskClient.retierTask(routeTaskId, {
                          engineerTier,
                          tierRationale,
                          reason: retierDraft.reason.trim(),
                        });
                        await reloadTask();
                        setRetierStatus({ kind: 'success', message: 'Engineer tier updated.' });
                      } catch (error) {
                        setRetierStatus({ kind: 'error', message: error.message || 'Re-tier failed.' });
                      }
                    }}
                  >
                    <div className="summary-grid architect-handoff-grid">
                      <label>
                        Target engineer tier
                        <select
                          value={retierDraft.engineerTier}
                          onChange={(event) => setRetierDraft((current) => ({ ...current, engineerTier: event.target.value }))}
                        >
                          <option value="Principal">Principal</option>
                          <option value="Sr">Sr</option>
                          <option value="Jr">Jr</option>
                        </select>
                      </label>
                      <label className="architect-handoff-grid__full">
                        Re-tier rationale
                        <textarea
                          value={retierDraft.tierRationale}
                          onChange={(event) => setRetierDraft((current) => ({ ...current, tierRationale: event.target.value }))}
                          placeholder="Explain why this level of engineering ownership is required now."
                        />
                      </label>
                    </div>
                    <div className="assignment-form__actions">
                      <button type="submit" disabled={retierStatus.kind === 'loading'}>
                        {retierStatus.kind === 'loading' ? 'Submitting…' : 'Update engineer tier'}
                      </button>
                    </div>
                    {retierStatus.kind !== 'idle' ? (
                      <p className={`assignment-status assignment-status--${retierStatus.kind}`} role={retierStatus.kind === 'error' ? 'alert' : 'status'}>
                        {retierStatus.message}
                      </p>
                    ) : null}
                  </form>
                  <form
                    className="architect-handoff-form"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const reason = reassignmentDraft.reason.trim();
                      if (!reason) {
                        setReassignmentStatus({ kind: 'error', message: 'A reassignment reason is required.' });
                        return;
                      }
                      try {
                        setReassignmentStatus({ kind: 'loading', message: 'Reassigning task…' });
                        await taskClient.reassignTask(routeTaskId, {
                          mode: reassignmentDraft.mode,
                          reason,
                          assignee: reassignmentDraft.assignee.trim() || undefined,
                          engineerTier: reassignmentDraft.engineerTier.trim() || undefined,
                        });
                        await reloadTask();
                        setReassignmentStatus({ kind: 'success', message: reassignmentDraft.mode === 'inactivity' ? 'Task reassigned and inactivity review created.' : 'Task reassigned.' });
                      } catch (error) {
                        setReassignmentStatus({ kind: 'error', message: error.message || 'Reassignment failed.' });
                      }
                    }}
                  >
                    <div className="summary-grid architect-handoff-grid">
                      <label>
                        Reassignment mode
                        <select
                          value={reassignmentDraft.mode}
                          onChange={(event) => setReassignmentDraft((current) => ({ ...current, mode: event.target.value }))}
                        >
                          <option value="inactivity">Inactivity review</option>
                          <option value="above_skill">Responsible escalation</option>
                          <option value="manual">Manual</option>
                        </select>
                      </label>
                      <label>
                        New assignee
                        <input
                          value={reassignmentDraft.assignee}
                          onChange={(event) => setReassignmentDraft((current) => ({ ...current, assignee: event.target.value }))}
                          placeholder="engineer"
                        />
                      </label>
                      <label>
                        Target engineer tier
                        <input
                          value={reassignmentDraft.engineerTier}
                          onChange={(event) => setReassignmentDraft((current) => ({ ...current, engineerTier: event.target.value }))}
                          placeholder="Sr"
                        />
                      </label>
                      <label className="architect-handoff-grid__full">
                        Reassignment reason
                        <textarea
                          value={reassignmentDraft.reason}
                          onChange={(event) => setReassignmentDraft((current) => ({ ...current, reason: event.target.value }))}
                          placeholder="Explain why ownership is moving and what the new assignee should know."
                        />
                      </label>
                    </div>
                    <div className="assignment-form__actions">
                      <button type="submit" disabled={reassignmentStatus.kind === 'loading'}>
                        {reassignmentStatus.kind === 'loading' ? 'Submitting…' : 'Reassign task'}
                      </button>
                    </div>
                    {reassignmentStatus.kind !== 'idle' ? (
                      <p className={`assignment-status assignment-status--${reassignmentStatus.kind}`} role={reassignmentStatus.kind === 'error' ? 'alert' : 'status'}>
                        {reassignmentStatus.message}
                      </p>
                    ) : null}
                  </form>
                </>
              ) : (
                <p className="assignment-status" role="status">
                  Re-tiering and reassignment controls are available to architect/admin bearer tokens.
                </p>
              )}
              {engineerSubmissionEnabled ? (
                <form
                  className="architect-handoff-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!engineerSubmissionAllowedForStage) {
                      setEngineerSubmissionStatus({ kind: 'error', message: 'Implementation metadata can only be submitted while the task is in implementation.' });
                      return;
                    }
                    if (!engineerSubmissionValidation.isValid) {
                      setEngineerSubmissionStatus({ kind: 'error', message: engineerSubmissionValidation.missingAll
                        ? 'Provide a commit SHA, a GitHub PR URL, or both before handing off to QA.'
                        : 'Fix the invalid implementation reference format before submitting.' });
                      return;
                    }
                    try {
                      setEngineerSubmissionStatus({ kind: 'loading', message: 'Submitting implementation metadata…' });
                      await taskClient.submitEngineerSubmission(routeTaskId, {
                        commitSha: engineerSubmissionValidation.commitSha,
                        prUrl: engineerSubmissionValidation.prUrl,
                      });
                      await reloadTask();
                      setEngineerSubmissionStatus({ kind: 'success', message: 'Implementation metadata submitted.' });
                    } catch (error) {
                      setEngineerSubmissionStatus({ kind: 'error', message: error.message || 'Implementation metadata submission failed.' });
                    }
                  }}
                >
                  <div className="summary-grid architect-handoff-grid">
                    <label>
                      Commit SHA
                      <input
                        value={engineerSubmissionDraft.commitSha}
                        onChange={(event) => setEngineerSubmissionDraft((current) => ({ ...current, commitSha: event.target.value }))}
                        placeholder="7-40 hex characters"
                        aria-describedby="engineer-submission-commit-help"
                      />
                      <small id="engineer-submission-commit-help">Accepted format: 7-40 hexadecimal characters from local git.</small>
                    </label>
                    <label>
                      GitHub PR URL
                      <input
                        value={engineerSubmissionDraft.prUrl}
                        onChange={(event) => setEngineerSubmissionDraft((current) => ({ ...current, prUrl: event.target.value }))}
                        placeholder="https://github.com/owner/repo/pull/123"
                        aria-describedby="engineer-submission-pr-help"
                      />
                      <small id="engineer-submission-pr-help">Accepted format: full GitHub pull request URL. Optional if a commit SHA is provided.</small>
                    </label>
                    <div className="architect-handoff-grid__full implementation-preview" aria-live="polite">
                      <span className="implementation-preview__label">QA handoff preview</span>
                      <strong>{engineerSubmissionValidation.primaryReference || 'A primary implementation reference is required before QA handoff.'}</strong>
                      <p>
                        {engineerSubmissionValidation.missingAll
                          ? 'Provide a commit SHA, a GitHub PR URL, or both. The first available reference becomes the auditable primary implementation reference.'
                          : engineerSubmissionValidation.invalidFields.length
                            ? 'Fix the highlighted format issue before submission. Accepted formats are shown below each field.'
                            : 'This reference will be recorded in audit history and used as the implementation handoff to QA.'}
                      </p>
                    </div>
                  </div>
                  {!engineerSubmissionAllowedForStage ? (
                    <p className="assignment-status" role="status">
                      Implementation metadata can only be submitted while the task is in implementation.
                    </p>
                  ) : null}
                  {engineerSubmissionValidation.invalidFields.includes('commitSha') ? (
                    <p className="assignment-status assignment-status--error" role="alert">
                      Commit SHA must be 7-40 hexadecimal characters.
                    </p>
                  ) : null}
                  {engineerSubmissionValidation.invalidFields.includes('prUrl') ? (
                    <p className="assignment-status assignment-status--error" role="alert">
                      GitHub PR URL must look like `https://github.com/&lt;owner&gt;/&lt;repo&gt;/pull/&lt;number&gt;`.
                    </p>
                  ) : null}
                  <div className="assignment-form__actions">
                    <button type="submit" disabled={engineerSubmissionStatus.kind === 'loading' || !engineerSubmissionAllowedForStage}>
                      {engineerSubmissionStatus.kind === 'loading' ? 'Submitting…' : 'Submit implementation handoff'}
                    </button>
                  </div>
                  {engineerSubmissionStatus.kind !== 'idle' ? (
                    <p className={`assignment-status assignment-status--${engineerSubmissionStatus.kind}`} role={engineerSubmissionStatus.kind === 'error' ? 'alert' : 'status'}>
                      {engineerSubmissionStatus.message}
                    </p>
                  ) : null}
                </form>
              ) : (
                <p className="assignment-status" role="status">
                  Implementation handoff controls are available to engineer/admin bearer tokens.
                </p>
              )}
              <h3>Linked delivery artifacts</h3>
              {detailPermissions.canViewLinkedPrMetadata === false ? (
                <p>Linked PR metadata is hidden for this session.</p>
              ) : model.detail?.relations?.linkedPrs?.length ? (
                <ul className="detail-bullets">
                  {model.detail.relations.linkedPrs.map((pr) => (
                    <li key={pr.id}>
                      <strong>{pr.title}</strong>
                      <span>{pr.number ? ` · #${pr.number}` : ''}{pr.repository ? ` · ${pr.repository}` : ''}{pr.state ? ` · ${pr.state}` : ''}{pr.merged ? ' · merged' : ''}{pr.draft ? ' · draft' : ''}</span>
                    </li>
                  ))}
                </ul>
              ) : <p>No linked PRs yet.</p>}
              {model.detail?.context?.executionContract?.artifacts?.links?.length ? (
                <ul className="detail-bullets">
                  {model.detail.context.executionContract.artifacts.links.map((artifactLink) => (
                    <li key={artifactLink.rel || artifactLink.path}>
                      <strong>{artifactLink.label}</strong>
                      <a href={`/${artifactLink.path}`}>{artifactLink.path}</a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {model.detail?.context?.executionContract?.verificationReport?.links?.length ? (
                <ul className="detail-bullets">
                  {model.detail.context.executionContract.verificationReport.links.map((reportLink) => (
                    <li key={reportLink.rel || reportLink.path}>
                      <strong>{reportLink.label}</strong>
                      <a href={`/${reportLink.path}`}>{reportLink.path}</a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {contractCoverageAudit?.active ? (
                <div className="review-question-note">
                  <span>Contract Coverage Audit</span>
                  <p>{contractCoverageAudit.validation?.status || contractCoverageAudit.latest?.status || 'submitted'}</p>
                  <p>{contractCoverageAudit.readiness?.summary || contractCoverageAudit.validation?.summary}</p>
                  {contractCoverageAudit.validation?.markdown?.path ? (
                    <a href={`/${contractCoverageAudit.validation.markdown.path}`}>{contractCoverageAudit.validation.markdown.path}</a>
                  ) : null}
                </div>
              ) : null}
              {model.detail?.context?.executionContract?.artifacts?.pr_guidance ? (
                <div className="review-question-note">
                  <span>PR guidance</span>
                  <p>{model.detail.context.executionContract.artifacts.pr_guidance.title}</p>
                </div>
              ) : null}
              {executionContractAutoApproval?.approved_by_policy ? (
                <div className="review-question-note">
                  <span>Auto-approval policy</span>
                  <p>{executionContractAutoApproval.policy_version}</p>
                  <p>{executionContractAutoApproval.rationale}</p>
                  <p>{executionContractAutoApproval.approved_at || executionContractAutoApproval.approvedAt}</p>
                </div>
              ) : null}
              {model.detail?.relations?.parentTask ? (
                <>
                  <h3>Linked parent task</h3>
                  <ul className="detail-bullets">
                    <li key={model.detail.relations.parentTask.id}>
                      <strong>{model.detail.relations.parentTask.title}</strong>
                      <span>{model.detail.relations.parentTask.stage || 'No stage'} · {formatStatusLabel(model.detail.relations.parentTask.status)} · {model.detail.relations.parentTask.owner?.label || 'Unassigned'}</span>
                    </li>
                  </ul>
                </>
              ) : null}
              {detailPermissions.canViewChildTasks === false ? (
                <p>Child task relationships are hidden for this session.</p>
              ) : model.detail?.relations?.childTasks?.length ? (
                <ul className="detail-bullets">
                  {model.detail.relations.childTasks.map((childTask) => (
                    <li key={childTask.id}>
                      <strong>{childTask.title}</strong>
                      <span>{childTask.stage || 'No stage'} · {formatStatusLabel(childTask.status)} · {childTask.owner?.label || 'Unassigned'}</span>
                    </li>
                  ))}
                </ul>
              ) : <p>No child tasks linked yet.</p>}
              {model.detail?.context?.anomalyChildTask ? (
                <div className="review-question-note">
                  <span>Machine-generated anomaly context</span>
                  <p>{model.detail.context.anomalyChildTask.summary || 'No anomaly summary captured.'}</p>
                  <p className="task-list-meta">{model.detail.context.anomalyChildTask.service || 'Unknown service'} · Source parent: {model.detail.context.anomalyChildTask.sourceTaskId || 'Unavailable'}</p>
                </div>
              ) : null}
            </section>

            <section className="detail-card detail-card--full">
              <h2>Architect review questions</h2>
              <div className="summary-grid review-question-summary-grid">
                <article>
                  <span>Total threads</span>
                  <strong>{model.detail?.reviewQuestions?.summary?.total ?? 0}</strong>
                </article>
                <article>
                  <span>Open</span>
                  <strong>{model.detail?.reviewQuestions?.summary?.unresolvedCount ?? 0}</strong>
                </article>
                <article>
                  <span>Blocking</span>
                  <strong>{model.detail?.reviewQuestions?.summary?.unresolvedBlockingCount ?? 0}</strong>
                </article>
                <article>
                  <span>Resolved</span>
                  <strong>{model.detail?.reviewQuestions?.summary?.resolvedCount ?? 0}</strong>
                </article>
              </div>

              {canAskQuestions ? (
                <form
                  className="review-question-composer"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const prompt = newReviewQuestionDraft.trim();
                    if (!prompt) {
                      setReviewQuestionStatus({ kind: 'error', message: 'Review question prompt is required.', questionId: null, action: 'ask' });
                      return;
                    }
                    await runReviewQuestionAction({
                      action: 'ask',
                      payload: { prompt, blocking: newReviewQuestionBlocking },
                      successMessage: 'Architect review question created.',
                    });
                  }}
                >
                  <label>
                    New architect review question
                    <textarea
                      value={newReviewQuestionDraft}
                      onChange={(event) => setNewReviewQuestionDraft(event.target.value)}
                      placeholder="What decision or PM clarification is needed before architect review can proceed?"
                    />
                  </label>
                  <label className="review-question-checkbox">
                    <input
                      type="checkbox"
                      checked={newReviewQuestionBlocking}
                      onChange={(event) => setNewReviewQuestionBlocking(event.target.checked)}
                    />
                    Blocks architect handoff until PM resolves it
                  </label>
                  <div className="review-question-composer__actions">
                    <button type="submit" disabled={reviewQuestionStatus.kind === 'loading' && reviewQuestionStatus.action === 'ask'}>
                      {reviewQuestionStatus.kind === 'loading' && reviewQuestionStatus.action === 'ask' ? 'Saving…' : 'Ask question'}
                    </button>
                  </div>
                </form>
              ) : null}

              {reviewQuestionStatus.kind !== 'idle' ? (
                <p
                  className={`review-question-status review-question-status--${reviewQuestionStatus.kind}`}
                  role={reviewQuestionStatus.kind === 'error' ? 'alert' : 'status'}
                >
                  {reviewQuestionStatus.message}
                </p>
              ) : null}

              {model.detail?.reviewQuestions?.items?.length ? (
                <div className="review-question-thread-list">
                  {model.detail.reviewQuestions.items.map((question) => {
                    const draftValue = reviewQuestionDrafts[question.id] || '';
                    const isPending = reviewQuestionStatus.kind === 'loading' && reviewQuestionStatus.questionId === question.id;

                    return (
                      <article key={question.id} className="review-question-thread">
                        <div className="review-question-thread__header">
                          <div>
                            <div className="review-question-thread__badges">
                              <span className={`review-question-badge review-question-badge--${question.state}`}>{formatReviewQuestionState(question.state)}</span>
                              {question.blocking ? <span className="review-question-badge review-question-badge--blocking">Blocking</span> : <span className="review-question-badge review-question-badge--nonblocking">Non-blocking</span>}
                            </div>
                            <h3>{question.prompt}</h3>
                          </div>
                          <dl className="review-question-meta">
                            <div>
                              <dt>Created</dt>
                              <dd>{question.createdAt || '—'}</dd>
                            </div>
                            <div>
                              <dt>Updated</dt>
                              <dd>{question.lastUpdatedAt || '—'}</dd>
                            </div>
                            <div>
                              <dt>Owner</dt>
                              <dd>{question.createdBy || 'Unknown'}</dd>
                            </div>
                          </dl>
                        </div>

                        {question.answer ? (
                          <div className="review-question-note">
                            <span>PM answer</span>
                            <p>{question.answer}</p>
                          </div>
                        ) : null}

                        {question.resolution ? (
                          <div className="review-question-note review-question-note--resolution">
                            <span>Resolution</span>
                            <p>{question.resolution}</p>
                          </div>
                        ) : null}

                        {question.messages?.length ? (
                          <ul className="review-question-history">
                            {question.messages.map((message) => (
                              <li key={message.id}>
                                <strong>{formatReviewQuestionActionLabel(message.eventType)}</strong>
                                <span>{message.actorId || 'Unknown actor'} · {message.occurredAt || 'No timestamp'}</span>
                                {message.body ? <p>{message.body}</p> : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}

                        {(canAnswerQuestions || canResolveQuestions || (canReopenQuestions && question.state === 'resolved')) ? (
                          <form
                            className="review-question-thread__actions"
                            onSubmit={(event) => event.preventDefault()}
                          >
                            <label>
                              {question.state === 'resolved' ? 'Reopen note' : 'PM response / resolution note'}
                              <textarea
                                value={draftValue}
                                onChange={(event) => updateReviewQuestionDraft(question.id, event.target.value)}
                                placeholder={question.state === 'resolved' ? 'Explain why architect review needs another pass.' : 'Capture the PM answer or resolution note.'}
                              />
                            </label>
                            <div className="review-question-thread__buttons">
                              {canAnswerQuestions && question.state !== 'resolved' ? (
                                <button
                                  type="button"
                                  disabled={isPending}
                                  onClick={() => {
                                    const body = draftValue.trim();
                                    if (!body) {
                                      setReviewQuestionStatus({ kind: 'error', message: 'Review question answer is required.', questionId: question.id, action: 'answer' });
                                      return;
                                    }
                                    runReviewQuestionAction({
                                      action: 'answer',
                                      questionId: question.id,
                                      payload: { body },
                                      successMessage: 'Review question answered.',
                                    });
                                  }}
                                >
                                  Answer
                                </button>
                              ) : null}
                              {canResolveQuestions && question.state !== 'resolved' ? (
                                <button
                                  type="button"
                                  className="button-secondary"
                                  disabled={isPending}
                                  onClick={() => runReviewQuestionAction({
                                    action: 'resolve',
                                    questionId: question.id,
                                    payload: { resolution: draftValue.trim() || 'Resolved from task detail UI.' },
                                    successMessage: 'Review question resolved.',
                                  })}
                                >
                                  Resolve
                                </button>
                              ) : null}
                              {canReopenQuestions && question.state === 'resolved' ? (
                                <button
                                  type="button"
                                  className="button-secondary"
                                  disabled={isPending}
                                  onClick={() => runReviewQuestionAction({
                                    action: 'reopen',
                                    questionId: question.id,
                                    payload: { reason: draftValue.trim() || 'Reopened from task detail UI.' },
                                    successMessage: 'Review question reopened.',
                                  })}
                                >
                                  Reopen
                                </button>
                              ) : null}
                            </div>
                          </form>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p>No architect review questions recorded yet.</p>
              )}
            </section>

            <section className="detail-card">
              <h2>Discussion</h2>
              <div className="summary-grid review-question-summary-grid">
                <article>
                  <span>Total threads</span>
                  <strong>{workflowThreadSummary.total}</strong>
                </article>
                <article>
                  <span>Open</span>
                  <strong>{workflowThreadSummary.unresolvedCount}</strong>
                </article>
                <article>
                  <span>Blocking</span>
                  <strong>{workflowThreadSummary.unresolvedBlockingCount}</strong>
                </article>
                <article>
                  <span>Resolved</span>
                  <strong>{workflowThreadSummary.resolvedCount}</strong>
                </article>
              </div>
              {canManageWorkflowThreads ? (
                <form
                  className="review-question-composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    runWorkflowThreadAction({
                      action: 'create',
                      payload: workflowThreadDraft,
                      successMessage: 'Workflow thread created.',
                    });
                  }}
                >
                  <div className="summary-grid architect-handoff-grid">
                    <label>
                      Thread type
                      <select
                        value={workflowThreadDraft.commentType}
                        onChange={(event) => setWorkflowThreadDraft((current) => ({ ...current, commentType: event.target.value }))}
                      >
                        {WORKFLOW_COMMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                      </select>
                    </label>
                    <label>
                      Linked workflow event ID
                      <input
                        value={workflowThreadDraft.linkedEventId}
                        onChange={(event) => setWorkflowThreadDraft((current) => ({ ...current, linkedEventId: event.target.value }))}
                        placeholder="Optional audit event id"
                      />
                    </label>
                    <label className="architect-handoff-grid__full">
                      Thread title
                      <input
                        value={workflowThreadDraft.title}
                        onChange={(event) => setWorkflowThreadDraft((current) => ({ ...current, title: event.target.value }))}
                        placeholder="Short summary of the question, escalation, or decision"
                      />
                    </label>
                    <label className="architect-handoff-grid__full">
                      Thread body
                      <textarea
                        value={workflowThreadDraft.body}
                        onChange={(event) => setWorkflowThreadDraft((current) => ({ ...current, body: event.target.value }))}
                        placeholder="Capture the typed workflow context in a structured, auditable way."
                      />
                    </label>
                  </div>
                  <label className="review-question-checkbox">
                    <input
                      type="checkbox"
                      checked={workflowThreadDraft.blocking}
                      onChange={(event) => setWorkflowThreadDraft((current) => ({ ...current, blocking: event.target.checked }))}
                    />
                    Pin this thread near the top of task detail until it is resolved
                  </label>
                  <div className="review-question-note">
                    <span>Notification routing</span>
                    <p>{workflowThreadDraft.blocking ? 'Blocking threads notify the people who can unblock the work first.' : 'Advisory threads keep the most relevant workflow roles in the loop.'}</p>
                    <p className="task-list-meta">Targets: {workflowThreadNotificationTargets.map(formatWorkflowNotificationTarget).join(' · ')}</p>
                  </div>
                  <div className="review-question-composer__actions">
                    <button type="submit" disabled={workflowThreadStatus.kind === 'loading' && workflowThreadStatus.action === 'create'}>
                      {workflowThreadStatus.kind === 'loading' && workflowThreadStatus.action === 'create' ? 'Saving…' : 'Create thread'}
                    </button>
                  </div>
                </form>
              ) : null}
              {workflowThreadStatus.kind !== 'idle' ? (
                <p className={`review-question-status review-question-status--${workflowThreadStatus.kind}`} role={workflowThreadStatus.kind === 'error' ? 'alert' : 'status'}>
                  {workflowThreadStatus.message}
                </p>
              ) : null}
              {workflowThreads.length ? (
                <div className="review-question-thread-list">
                  {workflowThreads.map((thread) => {
                    const draftValue = workflowThreadDrafts[thread.id] || '';
                    const isPending = workflowThreadStatus.kind === 'loading' && workflowThreadStatus.threadId === thread.id;
                    const isExpanded = Boolean(expandedWorkflowThreads[thread.id]);
                    const visibleMessages = isExpanded ? (thread.messages || []) : (thread.messages || []).slice(0, 2);
                    return (
                      <article key={thread.id} className="review-question-thread">
                        <div className="review-question-thread__header">
                          <div>
                            <div className="review-question-thread__badges">
                              <span className={`review-question-badge review-question-badge--${thread.state}`}>{thread.state === 'resolved' ? 'Resolved' : 'Open'}</span>
                              <span className={`review-question-badge review-question-badge--type-${thread.commentType}`}>{formatWorkflowCommentType(thread.commentType)}</span>
                              {thread.blocking ? <span className="review-question-badge review-question-badge--blocking">Blocking</span> : null}
                            </div>
                            <h3>{thread.title}</h3>
                          </div>
                          <dl className="review-question-meta">
                            <div>
                              <dt>Created</dt>
                              <dd>{thread.createdAt || '—'}</dd>
                            </div>
                            <div>
                              <dt>Updated</dt>
                              <dd>{thread.lastUpdatedAt || '—'}</dd>
                            </div>
                            <div>
                              <dt>Owner</dt>
                              <dd>{thread.createdBy || 'Unknown'}</dd>
                            </div>
                          </dl>
                        </div>
                        <div className="review-question-note">
                          <span>Thread context</span>
                          <p>{thread.body}</p>
                          {thread.linkedEventId ? <p className="task-list-meta">Linked workflow event: {thread.linkedEventId}</p> : null}
                          <p className="task-list-meta">Notification targets: {(thread.notificationTargets?.length ? thread.notificationTargets : defaultWorkflowNotificationTargets(thread.commentType, thread.blocking)).map(formatWorkflowNotificationTarget).join(' · ')}</p>
                        </div>
                        {thread.messages?.length ? (
                          <ul className="review-question-history">
                            {visibleMessages.map((message) => (
                              <li key={message.id}>
                                <strong>{message.actorId || 'Unknown actor'}</strong>
                                <span>{message.occurredAt || 'No timestamp'}</span>
                                {message.body ? <p>{message.body}</p> : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {thread.messages?.length > 2 ? (
                          <button type="button" className="thread-toggle" onClick={() => toggleWorkflowThreadExpanded(thread.id)}>
                            {isExpanded ? 'Collapse thread history' : `Show ${thread.messages.length - 2} older thread updates`}
                          </button>
                        ) : null}
                        {canManageWorkflowThreads ? (
                          <form className="review-question-thread__actions" onSubmit={(event) => event.preventDefault()}>
                            <label>
                              {thread.state === 'resolved' ? 'Reopen note' : 'Reply / resolution note'}
                              <textarea
                                value={draftValue}
                                onChange={(event) => updateWorkflowThreadDraft(thread.id, event.target.value)}
                                placeholder={thread.state === 'resolved' ? 'Explain why the thread needs another pass.' : 'Add a reply or capture the resolution note.'}
                              />
                            </label>
                            <div className="review-question-thread__buttons">
                              {thread.state !== 'resolved' ? (
                                <>
                                  <button type="button" disabled={isPending} onClick={() => runWorkflowThreadAction({ action: 'reply', threadId: thread.id, payload: { body: draftValue.trim() }, successMessage: 'Workflow thread updated.' })}>
                                    Reply
                                  </button>
                                  <button type="button" className="button-secondary" disabled={isPending} onClick={() => runWorkflowThreadAction({ action: 'resolve', threadId: thread.id, payload: { resolution: draftValue.trim() || 'Resolved from task detail UI.' }, successMessage: 'Workflow thread resolved.' })}>
                                    Resolve
                                  </button>
                                </>
                              ) : (
                                <button type="button" className="button-secondary" disabled={isPending} onClick={() => runWorkflowThreadAction({ action: 'reopen', threadId: thread.id, payload: { body: draftValue.trim() || 'Reopened from task detail UI.' }, successMessage: 'Workflow thread reopened.' })}>
                                  Reopen
                                </button>
                              )}
                            </div>
                          </form>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : detailPermissions.canViewComments === false ? (
                <p>Workflow comments are hidden for this session.</p>
              ) : (
                <p>No structured workflow threads yet.</p>
              )}
            </section>

            <section className="detail-card">
              <h2>QA</h2>
              <div className="summary-grid review-question-summary-grid">
                <article>
                  <span>Total runs</span>
                  <strong>{model.detail?.context?.qaResults?.summary?.total ?? 0}</strong>
                </article>
                <article>
                  <span>Passed</span>
                  <strong>{model.detail?.context?.qaResults?.summary?.passedCount ?? 0}</strong>
                </article>
                <article>
                  <span>Failed</span>
                  <strong>{model.detail?.context?.qaResults?.summary?.failedCount ?? 0}</strong>
                </article>
                <article>
                  <span>Re-tests</span>
                  <strong>{model.detail?.context?.qaResults?.summary?.retestCount ?? 0}</strong>
                </article>
              </div>
              {latestQaResult ? (
                <div className="review-question-note">
                  <span>Latest QA result</span>
                  <p>{latestQaResult.summary}</p>
                  <p className="task-list-meta">
                    {latestQaResult.outcome === 'pass' ? 'Passed' : 'Failed'}
                    {latestQaResult.runKind === 'retest' ? ' · Re-test' : ' · Initial run'}
                    {latestQaResult.implementationReference?.label ? ` · ${latestQaResult.implementationReference.label}` : ''}
                  </p>
                </div>
              ) : <p>No QA result has been recorded yet.</p>}
              {canSubmitQaResult ? (
                <form className="architect-handoff-form" onSubmit={submitQaResult}>
                  <div className="summary-grid architect-handoff-grid">
                    <label>
                      Outcome
                      <select value={qaResultDraft.outcome} onChange={(event) => setQaResultDraft((current) => ({ ...current, outcome: event.target.value }))}>
                        <option value="fail">Fail back to implementation</option>
                        <option value="pass">Pass to SRE monitoring</option>
                      </select>
                    </label>
                    <label className="architect-handoff-grid__full">
                      QA summary
                      <textarea value={qaResultDraft.summary} onChange={(event) => setQaResultDraft((current) => ({ ...current, summary: event.target.value }))} placeholder="Summarize the test outcome and the most important signal." />
                    </label>
                    <label>
                      Scenarios
                      <textarea value={qaResultDraft.scenarios} onChange={(event) => setQaResultDraft((current) => ({ ...current, scenarios: event.target.value }))} placeholder="One scenario per line" />
                    </label>
                    <label>
                      Findings
                      <textarea value={qaResultDraft.findings} onChange={(event) => setQaResultDraft((current) => ({ ...current, findings: event.target.value }))} placeholder="One finding per line" />
                    </label>
                    <label>
                      Reproduction steps
                      <textarea value={qaResultDraft.reproductionSteps} onChange={(event) => setQaResultDraft((current) => ({ ...current, reproductionSteps: event.target.value }))} placeholder="One reproduction step per line" />
                    </label>
                    <label>
                      Re-test scope
                      <textarea value={qaResultDraft.retestScope} onChange={(event) => setQaResultDraft((current) => ({ ...current, retestScope: event.target.value }))} placeholder="Optional scoped re-test plan" />
                    </label>
                    <label>
                      Stack traces
                      <textarea value={qaResultDraft.stackTraces} onChange={(event) => setQaResultDraft((current) => ({ ...current, stackTraces: event.target.value }))} placeholder="One stack trace summary per line" />
                    </label>
                    <label>
                      Environment logs
                      <textarea value={qaResultDraft.envLogs} onChange={(event) => setQaResultDraft((current) => ({ ...current, envLogs: event.target.value }))} placeholder="One log summary per line" />
                    </label>
                  </div>
                  <div className="review-question-note">
                    <span>Route preview</span>
                    <p>{qaResultDraft.outcome === 'pass' ? 'A passing result routes this task forward to SRE monitoring.' : 'A failing result routes this task back to the implementation fix loop with a packaged escalation.'}</p>
                    <p className="task-list-meta">Next stage: {qaRoutePreview}</p>
                    {qaRetestContext ? (
                      <p className="task-list-meta">Scoped re-test for run {qaRetestContext.priorRunId} stays with {qaRetestContext.priorQaActorId || 'the previous QA owner'} and should cover {qaRetestContext.scope.join(', ') || 'the prior failing scenarios'}.</p>
                    ) : null}
                  </div>
                  {qaDraftMissingFields.length ? (
                    <p className="assignment-status assignment-status--error" role="alert">
                      Missing failure context: {qaDraftMissingFields.join(', ')}.
                    </p>
                  ) : null}
                  <div className="assignment-form__actions">
                    <button type="submit" disabled={qaResultStatus.kind === 'loading' || qaDraftMissingFields.length > 0}>
                      {qaResultStatus.kind === 'loading' ? 'Submitting…' : 'Submit QA result'}
                    </button>
                  </div>
                  {qaResultStatus.kind !== 'idle' ? (
                    <p className={`assignment-status assignment-status--${qaResultStatus.kind}`} role={qaResultStatus.kind === 'error' ? 'alert' : 'status'}>
                      {qaResultStatus.message}
                    </p>
                  ) : null}
                </form>
              ) : null}
              {model.detail?.context?.qaResults?.items?.length ? (
                <ul className="detail-feed">
                  {model.detail.context.qaResults.items.map((run) => (
                    <li key={run.runId}>
                      <strong>{run.outcome === 'pass' ? 'Pass' : 'Fail'}{run.runKind === 'retest' ? ' · Re-test' : ''}</strong>
                      <span>{run.submittedBy || 'Unknown QA'} · {run.submittedAt || 'No timestamp'}</span>
                      <p>{run.summary}</p>
                      {run.escalationPackage ? (
                        <>
                          <p className="task-list-meta">Escalation target: {run.escalationPackage.routing?.recipient_agent_id || run.escalationPackage.routing?.recipient_role || 'engineer'} · Required tier: {run.escalationPackage.routing?.required_engineer_tier || '—'}</p>
                          <div className="qa-package">
                            <strong>Escalation package</strong>
                            <p className="task-list-meta">Reproduction steps come first, then failing scenarios, findings, and condensed logs/traces.</p>
                            {run.escalationPackage.notification_preview ? (
                              <div className="qa-package__section">
                                <span>Notification preview</span>
                                <p>{run.escalationPackage.notification_preview.headline}</p>
                                <p className="task-list-meta">
                                  Route: {run.escalationPackage.notification_preview.recipient_agent_id || run.escalationPackage.notification_preview.recipient_role || 'engineer'}
                                  {run.escalationPackage.notification_preview.required_engineer_tier ? ` · Required tier: ${run.escalationPackage.notification_preview.required_engineer_tier}` : ''}
                                </p>
                                {renderList(run.escalationPackage.notification_preview.highlights, 'No notification highlights captured.')}
                              </div>
                            ) : null}
                            <div className="qa-package__section">
                              <span>Reproduction steps</span>
                              {renderList(run.escalationPackage.reproduction_steps, 'No reproduction steps captured.')}
                            </div>
                            <div className="qa-package__section">
                              <span>Failing scenarios</span>
                              {renderList(run.escalationPackage.failing_scenarios, 'No failing scenarios captured.')}
                            </div>
                            <div className="qa-package__section">
                              <span>Findings</span>
                              {renderList(run.escalationPackage.findings, 'No findings captured.')}
                            </div>
                            <button type="button" className="thread-toggle" onClick={() => toggleQaPackageExpanded(run.runId)}>
                              {expandedQaPackages[run.runId] ? 'Hide logs and traces' : 'Show logs and traces'}
                            </button>
                            {expandedQaPackages[run.runId] ? (
                              <div className="qa-package__expanded">
                                <div className="qa-package__section">
                                  <span>Stack traces</span>
                                  {renderList(run.escalationPackage.stack_traces, 'No stack traces captured.')}
                                </div>
                                <div className="qa-package__section">
                                  <span>Environment logs</span>
                                  {renderList(run.escalationPackage.env_logs, 'No environment logs captured.')}
                                </div>
                                <div className="qa-package__section">
                                  <span>Escalation chain</span>
                                  <p>{(run.escalationPackage.routing?.escalation_chain || []).join(' -> ') || 'No escalation chain captured.'}</p>
                                </div>
                                <div className="qa-package__section">
                                  <span>Previous fix history</span>
                                  {run.escalationPackage.previous_fix_history?.length ? (
                                    <ul className="detail-feed">
                                      {run.escalationPackage.previous_fix_history.map((entry) => (
                                        <li key={`${run.runId}-${entry.version}`}>
                                          <strong>v{entry.version} · {entry.primary_reference?.label || entry.commit_sha || entry.pr_url || 'Reference missing'}</strong>
                                          <span>{entry.submitted_by || 'Unknown engineer'} · {entry.submitted_at || 'No timestamp'}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : <p className="empty-copy">No previous fix history captured.</p>}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className="detail-card">
              <h2>SRE Monitoring</h2>
              {sreMonitoring ? (
                <>
                  <div className="summary-grid review-question-summary-grid">
                    <article>
                      <span>State</span>
                      <strong>{sreMonitoring.state}</strong>
                    </article>
                    <article>
                      <span>Risk</span>
                      <strong>{sreMonitoring.riskLevel || 'unknown'}</strong>
                    </article>
                    <article>
                      <span>Time remaining</span>
                      <strong>{sreMonitoring.timeRemainingLabel || 'Not started'}</strong>
                    </article>
                    <article>
                      <span>Telemetry freshness</span>
                      <strong>{sreMonitoring.telemetry?.freshness || 'unknown'}</strong>
                    </article>
                  </div>

                  <div className="review-question-note">
                    <span>Deployment snapshot</span>
                    <p>{sreMonitoring.deployment?.environment ? `${sreMonitoring.deployment.environment} · ${sreMonitoring.deployment.version || 'version unknown'}` : 'Monitoring has not started yet.'}</p>
                    <p className="task-list-meta">
                      PR: {sreMonitoring.linkedPrs?.[0]?.number ? `#${sreMonitoring.linkedPrs[0].number}` : 'None'}
                      {` · Commit: ${sreMonitoring.commitSha || 'None'}`}
                      {sreMonitoring.windowEndsAt ? ` · Window ends: ${sreMonitoring.windowEndsAt}` : ''}
                    </p>
                    <p className="task-list-meta">
                      {sreMonitoring.telemetry?.drilldowns?.metrics ? <a href={sreMonitoring.telemetry.drilldowns.metrics} target="_blank" rel="noreferrer">Metrics</a> : 'Metrics unavailable'}
                      {' · '}
                      {sreMonitoring.telemetry?.drilldowns?.logs ? <a href={sreMonitoring.telemetry.drilldowns.logs} target="_blank" rel="noreferrer">Logs</a> : 'Logs unavailable'}
                      {' · '}
                      {sreMonitoring.telemetry?.drilldowns?.traces ? <a href={sreMonitoring.telemetry.drilldowns.traces} target="_blank" rel="noreferrer">Traces</a> : 'Traces unavailable'}
                    </p>
                  </div>

                  {sreMonitoring.approval ? (
                    <div className="review-question-note">
                      <span>Recorded approval</span>
                      <p>{sreMonitoring.approval.reason}</p>
                      <p className="task-list-meta">{sreMonitoring.approval.approvedBy || 'Unknown approver'} · {sreMonitoring.approval.approvedAt || 'No timestamp'}</p>
                      {renderList(sreMonitoring.approval.evidence, 'No evidence notes captured.')}
                    </div>
                  ) : null}

                  {sreMonitoring.escalation ? (
                    <div className="review-question-note">
                      <span>Expiry escalation</span>
                      <p>Human stakeholder escalation was created because the monitoring window expired without approval.</p>
                      <p className="task-list-meta">{sreMonitoring.escalation.escalatedAt || 'No timestamp'}</p>
                    </div>
                  ) : null}

                  {canCreateMonitoringAnomalyChildTask ? (
                    <form className="architect-handoff-form" onSubmit={submitMonitoringAnomalyChildTask}>
                      <div className="review-question-note">
                        <span>Create child task from anomaly</span>
                        <p>These fields are prefilled from monitoring context and remain editable before the child task is created.</p>
                        <p className="task-list-meta">This defaults the child to P0, links it to the parent, blocks the parent, and routes the child back to PM business-context review.</p>
                      </div>
                      <div className="summary-grid architect-handoff-grid">
                        <label>
                          Child task title
                          <input value={monitoringAnomalyChildDraft.title} onChange={(event) => setMonitoringAnomalyChildDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Investigate checkout-api anomaly for TSK-123" />
                        </label>
                        <label>
                          Affected service
                          <input value={monitoringAnomalyChildDraft.service} onChange={(event) => setMonitoringAnomalyChildDraft((current) => ({ ...current, service: event.target.value }))} placeholder="checkout-api" />
                        </label>
                        <label className="architect-handoff-grid__full">
                          Anomaly summary
                          <textarea value={monitoringAnomalyChildDraft.anomalySummary} onChange={(event) => setMonitoringAnomalyChildDraft((current) => ({ ...current, anomalySummary: event.target.value }))} placeholder="Describe the production anomaly that should become tracked work." />
                        </label>
                        <label>
                          Metrics
                          <textarea value={monitoringAnomalyChildDraft.metrics} onChange={(event) => setMonitoringAnomalyChildDraft((current) => ({ ...current, metrics: event.target.value }))} placeholder="One metric signal per line" />
                        </label>
                        <label>
                          Logs
                          <textarea value={monitoringAnomalyChildDraft.logs} onChange={(event) => setMonitoringAnomalyChildDraft((current) => ({ ...current, logs: event.target.value }))} placeholder="One log sample or drilldown per line" />
                        </label>
                        <label>
                          Error samples
                          <textarea value={monitoringAnomalyChildDraft.errorSamples} onChange={(event) => setMonitoringAnomalyChildDraft((current) => ({ ...current, errorSamples: event.target.value }))} placeholder="One error sample or trace per line" />
                        </label>
                      </div>
                      <div className="assignment-form__actions">
                        <button type="submit" disabled={monitoringAnomalyChildStatus.kind === 'loading'}>
                          {monitoringAnomalyChildStatus.kind === 'loading' ? 'Creating…' : 'Create anomaly child task'}
                        </button>
                      </div>
                      {monitoringAnomalyChildStatus.kind !== 'idle' ? (
                        <p className={`assignment-status assignment-status--${monitoringAnomalyChildStatus.kind}`} role={monitoringAnomalyChildStatus.kind === 'error' ? 'alert' : 'status'}>
                          {monitoringAnomalyChildStatus.message}
                        </p>
                      ) : null}
                    </form>
                  ) : null}

                  {sreMonitoringEnabled && sreMonitoring.canStart ? (
                    <form className="architect-handoff-form" onSubmit={submitSreMonitoringStart}>
                      <div className="summary-grid architect-handoff-grid">
                        <label>
                          Deployment environment
                          <input value={sreMonitoringStartDraft.deploymentEnvironment} onChange={(event) => setSreMonitoringStartDraft((current) => ({ ...current, deploymentEnvironment: event.target.value }))} />
                        </label>
                        <label>
                          Deployment URL
                          <input value={sreMonitoringStartDraft.deploymentUrl} onChange={(event) => setSreMonitoringStartDraft((current) => ({ ...current, deploymentUrl: event.target.value }))} placeholder="https://deploy.example/releases/123" />
                        </label>
                        <label>
                          Deployment version
                          <input value={sreMonitoringStartDraft.deploymentVersion} onChange={(event) => setSreMonitoringStartDraft((current) => ({ ...current, deploymentVersion: event.target.value }))} placeholder="2026.04.14-1" />
                        </label>
                        <label className="architect-handoff-grid__full">
                          Deployment evidence
                          <textarea value={sreMonitoringStartDraft.evidence} onChange={(event) => setSreMonitoringStartDraft((current) => ({ ...current, evidence: event.target.value }))} placeholder="One confirmation per line" />
                        </label>
                      </div>
                      <div className="assignment-form__actions">
                        <button type="submit" disabled={sreMonitoringStartStatus.kind === 'loading'}>
                          {sreMonitoringStartStatus.kind === 'loading' ? 'Starting…' : 'Start monitoring window'}
                        </button>
                      </div>
                      {sreMonitoringStartStatus.kind !== 'idle' ? (
                        <p className={`assignment-status assignment-status--${sreMonitoringStartStatus.kind}`} role={sreMonitoringStartStatus.kind === 'error' ? 'alert' : 'status'}>
                          {sreMonitoringStartStatus.message}
                        </p>
                      ) : null}
                    </form>
                  ) : null}

                  {sreMonitoringEnabled && sreMonitoring.canApprove ? (
                    <form className="architect-handoff-form" onSubmit={submitSreApproval}>
                      <div className="summary-grid architect-handoff-grid">
                        <label className="architect-handoff-grid__full">
                          Approval reason
                          <textarea value={sreApprovalDraft.reason} onChange={(event) => setSreApprovalDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Explain why the rollout is stable enough to leave SRE monitoring early." />
                        </label>
                        <label className="architect-handoff-grid__full">
                          Evidence notes
                          <textarea value={sreApprovalDraft.evidence} onChange={(event) => setSreApprovalDraft((current) => ({ ...current, evidence: event.target.value }))} placeholder="One evidence note per line" />
                        </label>
                      </div>
                      <div className="assignment-form__actions">
                        <button type="submit" disabled={sreApprovalStatus.kind === 'loading'}>
                          {sreApprovalStatus.kind === 'loading' ? 'Approving…' : 'Approve early'}
                        </button>
                      </div>
                      {sreApprovalStatus.kind !== 'idle' ? (
                        <p className={`assignment-status assignment-status--${sreApprovalStatus.kind}`} role={sreApprovalStatus.kind === 'error' ? 'alert' : 'status'}>
                          {sreApprovalStatus.message}
                        </p>
                      ) : null}
                    </form>
                  ) : null}
                  {sreMonitoringEnabled && !sreMonitoring.canApprove && model.detail?.summary?.blockedState?.isBlocked ? (
                    <div className="review-question-note">
                      <span>Approval paused</span>
                      <p>The parent task is blocked by linked anomaly investigation work.</p>
                      <p className="task-list-meta">Comments and review remain available, but stage progression stays paused until the child task is resolved or unblocked.</p>
                    </div>
                  ) : null}
                </>
              ) : (
                <p>No SRE monitoring context yet.</p>
              )}
            </section>

            <section className="detail-card">
              <h2>History</h2>
              <p className="task-list-meta">
                Telemetry: {model.detail?.telemetry?.availability || 'unknown'}{model.detail?.telemetry?.lastUpdatedAt ? ` · ${model.detail.telemetry.lastUpdatedAt}` : ''}
              </p>
              <TaskDetailActivityShell
                selectedTab={model.shell.selectedTab}
                onTabChange={setTab}
                historyState={model.shell.historyState}
                telemetryState={model.shell.telemetryState}
                historyItems={model.shell.historyItems}
                telemetryCards={model.shell.telemetryCards}
                filters={model.shell.filters}
                onFiltersChange={setFilters}
                historyPageInfo={model.shell.historyPageInfo}
                onLoadMoreHistory={loadMoreHistory}
                isLoadingMoreHistory={historyLoadMoreState.kind === 'loading'}
                historyLoadMoreError={historyLoadMoreState.kind === 'error' ? historyLoadMoreState.message : ''}
              />
            </section>
          </section>

          {!detailIsIntakeDraft ? (
            <StageTransition
              currentStage={model.summary.currentStage || 'BACKLOG'}
              taskId={routeTaskId}
              onTransition={async (toStage, payload) => {
                try {
                  await taskClient.changeTaskStage(routeTaskId, toStage, payload);
                  await reloadTask();
                } catch (error) {
                  throw error;
                }
              }}
            />
          ) : null}
          {!detailIsIntakeDraft ? (
            <section className="assignment-panel" aria-label="Task assignment">
              <div className="assignment-panel__header">
                <div>
                  <p className="eyebrow">Assignment</p>
                  <h2>Assign AI agent owner</h2>
                  <p className="lede">Writes to the task assignment endpoint and refreshes the projected owner after success.</p>
                </div>
              </div>

              {assignmentEnabled ? (
                <form
                  className="assignment-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!model.route?.taskId) return;
                    try {
                      setAssignmentStatus({ kind: 'loading', message: 'Saving assignment…' });
                      await taskClient.assignTaskOwner(model.route.taskId, assignmentDraft || null);
                      await reloadTask();
                      setAssignmentStatus({ kind: 'success', message: assignmentDraft ? `Assigned to ${assignmentDraft}.` : 'Assignment cleared.' });
                    } catch (error) {
                      setAssignmentStatus({ kind: 'error', message: error.message || 'Assignment update failed.' });
                    }
                  }}
                >
                  <label>
                    Owner
                    <select value={assignmentDraft} onChange={(event) => setAssignmentDraft(event.target.value)}>
                      <option value="">Unassigned</option>
                      {agentOptions.map((agent) => (
                        <option key={agent.id} value={agent.id}>{agent.display_name}{agent.role ? ` · ${agent.role}` : ''}</option>
                      ))}
                    </select>
                  </label>
                  <div className="assignment-form__actions">
                    <button type="submit" disabled={assignmentStatus.kind === 'loading'}>
                      {assignmentStatus.kind === 'loading' ? 'Saving…' : 'Save owner'}
                    </button>
                  </div>
                  {assignmentStatus.kind !== 'idle' ? (
                    <p className={`assignment-status assignment-status--${assignmentStatus.kind}`} role={assignmentStatus.kind === 'error' ? 'alert' : 'status'}>
                      {assignmentStatus.message}
                    </p>
                  ) : null}
                </form>
              ) : (
                <p className="assignment-status" role="status">
                  {model.route?.taskId ? 'Assignment controls are available to PM/admin bearer tokens.' : 'Open a task route to manage assignment.'}
                </p>
              )}
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
