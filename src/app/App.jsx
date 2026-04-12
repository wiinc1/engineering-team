import React from 'react';
import { createTaskDetailApiClient } from '../features/task-detail/adapter.browser';
import { createTaskDetailPageModule } from '../features/task-detail/route.browser';
import { writeTaskDetailUrlState } from '../features/task-detail/urlState';
import { TaskDetailActivityShell } from '../features/task-detail/TaskDetailActivityShell';
import { StageTransition } from '../features/task-detail/StageTransition';
import { TaskCreationPage } from '../features/task-creation/TaskCreationPage';
import {
  buildAuthHeaders,
  hasSessionExpired,
  isAuthenticatedSession,
  readBrowserSessionConfig,
  readSessionClaims,
  resolveApiBaseUrl,
  sanitizeNextRoute,
  splitRouteTarget,
  writeBrowserSessionConfig,
} from './session.browser';
import {
  buildBoardColumns,
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
const SIGN_IN_TIMEOUT_MS = 5000;

function matchSignInRoute(pathname = '') {
  return ((pathname || '').replace(/\/+$/, '') || '/') === SIGN_IN_PATH;
}

function isProtectedRoute(pathname = '') {
  const normalizedPath = ((pathname || '').replace(/\/+$/, '') || '/');
  return normalizedPath === '/'
    || matchTaskListRoute(normalizedPath)
    || matchCreateTaskRoute(normalizedPath)
    || Boolean(matchRoleInboxRoute(normalizedPath))
    || Boolean(matchPmOverviewRoute(normalizedPath))
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
  };
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

function readTaskListRouteState(search = '') {
  const params = new URLSearchParams(search);
  const owner = params.get('owner') || '';
  const view = params.get('view') === 'board' ? 'board' : 'list';
  const bucket = params.get('bucket') || '';
  return { owner, view, bucket };
}

function writeTaskListUrlState({ owner, view, bucket }, search = '') {
  const params = new URLSearchParams(search);
  const nextOwner = owner ?? params.get('owner') ?? '';
  const nextView = view ?? (params.get('view') === 'board' ? 'board' : 'list');
  const nextBucket = bucket ?? params.get('bucket') ?? '';
  if (nextOwner) params.set('owner', nextOwner);
  else params.delete('owner');
  if (nextView === 'board') params.set('view', 'board');
  else params.delete('view');
  if (nextBucket) params.set('bucket', nextBucket);
  else params.delete('bucket');
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
  return {
    kind: 'list',
    route: { pathname: roleInbox ? `/inbox/${roleInbox.role}` : pmOverview ? '/overview/pm' : '/tasks', taskId: null },
    list: {
      filters: readTaskListRouteState(search),
      items: [],
      state: { kind: 'loading', message: roleInbox ? `Loading ${getRoleInboxLabel(roleInbox.role)} inbox.` : pmOverview ? 'Loading PM overview.' : 'Loading task list.' },
      resultSummary: '',
      inboxRole: roleInbox?.role || null,
      isPmOverview: Boolean(pmOverview),
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
  const roles = Array.isArray(tokenClaims?.roles) ? tokenClaims.roles : [];
  return expectedRoles.some((role) => roles.includes(role));
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

function canAnswerReviewQuestion(tokenClaims) {
  return hasAnyRole(tokenClaims, ['pm', 'admin']);
}

function canResolveReviewQuestion(tokenClaims) {
  return hasAnyRole(tokenClaims, ['pm', 'admin']);
}

function canReopenReviewQuestion(tokenClaims) {
  return hasAnyRole(tokenClaims, ['architect', 'pm', 'admin']);
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
  const [signInDraft, setSignInDraft] = React.useState(() => defaultSignInDraft(readBrowserSessionConfig().apiBaseUrl || envApiBaseUrl));
  const [signInStatus, setSignInStatus] = React.useState({ kind: 'idle', message: '' });
  const [authNotice, setAuthNotice] = React.useState('');
  const [model, setModel] = React.useState(() => {
    if (matchTaskListRoute(pathname) || matchRoleInboxRoute(pathname) || matchPmOverviewRoute(pathname)) return buildListLoadingModel(pathname, search);
    return matchTaskRoute(pathname) ? buildLoadingModel(pathname, search) : buildRouteMissModel(pathname);
  });
  const [agentOptions, setAgentOptions] = React.useState([]);
  const [agentOptionsState, setAgentOptionsState] = React.useState({ kind: 'loading', message: 'Loading canonical role roster.' });
  const [assignmentDraft, setAssignmentDraft] = React.useState('');
  const [assignmentStatus, setAssignmentStatus] = React.useState({ kind: 'idle', message: '' });
  const [newReviewQuestionDraft, setNewReviewQuestionDraft] = React.useState('');
  const [newReviewQuestionBlocking, setNewReviewQuestionBlocking] = React.useState(true);
  const [reviewQuestionDrafts, setReviewQuestionDrafts] = React.useState({});
  const [reviewQuestionStatus, setReviewQuestionStatus] = React.useState({ kind: 'idle', message: '', questionId: null, action: null });
  const [architectHandoffDraft, setArchitectHandoffDraft] = React.useState(() => normalizeArchitectHandoffDraft());
  const [architectHandoffStatus, setArchitectHandoffStatus] = React.useState({ kind: 'idle', message: '' });
  const [engineerSubmissionDraft, setEngineerSubmissionDraft] = React.useState(() => normalizeEngineerSubmissionDraft());
  const [engineerSubmissionStatus, setEngineerSubmissionStatus] = React.useState({ kind: 'idle', message: '' });
  const [taskLockStatus, setTaskLockStatus] = React.useState({ kind: 'idle', message: '' });
  const [workflowThreadDraft, setWorkflowThreadDraft] = React.useState(() => normalizeWorkflowThreadDraft());
  const [workflowThreadDrafts, setWorkflowThreadDrafts] = React.useState({});
  const [workflowThreadStatus, setWorkflowThreadStatus] = React.useState({ kind: 'idle', message: '', threadId: null, action: null });
  const [expandedWorkflowThreads, setExpandedWorkflowThreads] = React.useState({});
  const [expandedQaPackages, setExpandedQaPackages] = React.useState({});
  const [qaResultDraft, setQaResultDraft] = React.useState(() => normalizeQaResultDraft());
  const [qaResultStatus, setQaResultStatus] = React.useState({ kind: 'idle', message: '' });
  const signInState = React.useMemo(() => readSignInState(search), [search]);
  const tokenClaims = React.useMemo(() => readSessionClaims(sessionConfig), [sessionConfig]);
  const resolvedApiBaseUrl = resolveApiBaseUrl(sessionConfig, envApiBaseUrl);
  const isAuthenticated = isAuthenticatedSession(sessionConfig);

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
    if (hasSessionExpired(sessionConfig) && String(sessionConfig.bearerToken || '').trim()) {
      clearSessionForSignIn('Your session expired. Sign in again to continue.');
      return;
    }

    if (!isAuthenticated) {
      if (matchSignInRoute(pathname)) return;
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
    if (model.kind === 'detail') {
      setAssignmentDraft(model.summary?.currentOwner || '');
      setAssignmentStatus({ kind: 'idle', message: '' });
      setNewReviewQuestionDraft('');
      setNewReviewQuestionBlocking(true);
      setReviewQuestionDrafts({});
      setReviewQuestionStatus({ kind: 'idle', message: '', questionId: null, action: null });
      setArchitectHandoffDraft(normalizeArchitectHandoffDraft(model.detail?.context?.architectHandoff));
      setArchitectHandoffStatus({ kind: 'idle', message: '' });
      setEngineerSubmissionDraft(normalizeEngineerSubmissionDraft(model.detail?.context?.engineerSubmission));
      setEngineerSubmissionStatus({ kind: 'idle', message: '' });
      setTaskLockStatus({ kind: 'idle', message: '' });
      setWorkflowThreadDraft(normalizeWorkflowThreadDraft());
      setWorkflowThreadDrafts({});
      setWorkflowThreadStatus({ kind: 'idle', message: '', threadId: null, action: null });
      setExpandedWorkflowThreads({});
      setExpandedQaPackages({});
      setQaResultDraft(normalizeQaResultDraft(model.detail?.context?.qaResults?.latest));
      setQaResultStatus({ kind: 'idle', message: '' });
    }
  }, [model]);

  React.useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated) {
      return () => {
        cancelled = true;
      };
    }

    if (matchTaskListRoute(pathname) || matchRoleInboxRoute(pathname) || matchPmOverviewRoute(pathname)) {
      setModel(buildListLoadingModel(pathname, search));
      taskClient.fetchTaskList()
        .then((payload) => {
          if (cancelled) return;
          const filters = readTaskListRouteState(search);
          const roleInbox = matchRoleInboxRoute(pathname);
          const pmOverview = matchPmOverviewRoute(pathname);
          setModel({
            kind: 'list',
            route: { pathname: roleInbox ? `/inbox/${roleInbox.role}` : pmOverview ? '/overview/pm' : '/tasks', taskId: null },
            list: {
              filters,
              items: payload.items || [],
              state: { kind: 'ready' },
              resultSummary: '',
              inboxRole: roleInbox?.role || null,
              isPmOverview: Boolean(pmOverview),
            },
          });
        })
        .catch((error) => {
          if (!cancelled) {
            setModel({
              kind: 'list',
              route: { pathname: matchRoleInboxRoute(pathname) ? pathname : '/tasks', taskId: null },
              list: {
                filters: readTaskListRouteState(search),
                items: [],
                state: { kind: 'error', message: error.message || 'Task list load failed.' },
                resultSummary: '',
                inboxRole: matchRoleInboxRoute(pathname)?.role || null,
                isPmOverview: Boolean(matchPmOverviewRoute(pathname)),
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

  const assignmentEnabled = model.kind === 'detail' && Boolean(model.route?.taskId) && canManageAssignment(tokenClaims);
  const architectHandoffEnabled = model.kind === 'detail' && Boolean(model.route?.taskId) && canManageArchitectHandoff(tokenClaims);
  const engineerSubmissionEnabled = model.kind === 'detail' && Boolean(model.route?.taskId) && canManageEngineerSubmission(tokenClaims);
  const routeTaskId = model.kind === 'detail' ? (model.route?.taskId || 'TSK-42') : 'TSK-42';
  const activeInboxRole = model.kind === 'list' ? model.list.inboxRole : null;
  const isPmOverview = model.kind === 'list' ? Boolean(model.list.isPmOverview) : false;
  const detailPermissions = model.kind === 'detail' ? (model.detail?.meta?.permissions || {}) : {};
  const architectReviewEnabled = model.kind === 'detail' && Boolean(model.detail?.reviewQuestions);
  const canAskQuestions = architectReviewEnabled && canAskReviewQuestion(tokenClaims) && model.detail?.task?.stage === 'ARCHITECT_REVIEW';
  const canAnswerQuestions = architectReviewEnabled && canAnswerReviewQuestion(tokenClaims);
  const canResolveQuestions = architectReviewEnabled && canResolveReviewQuestion(tokenClaims);
  const canReopenQuestions = architectReviewEnabled && canReopenReviewQuestion(tokenClaims);
  const engineerSubmissionValidation = validateEngineerSubmissionDraft(engineerSubmissionDraft);
  const engineerSubmissionAllowedForStage = model.kind === 'detail' && isImplementationStage(model.detail?.task?.stage || model.summary.currentStage);
  const canManageTaskLock = model.kind === 'detail' && Boolean(model.route?.taskId) && (canManageAssignment(tokenClaims) || canManageEngineerSubmission(tokenClaims) || canManageArchitectHandoff(tokenClaims) || hasAnyRole(tokenClaims, ['qa', 'contributor', 'admin']));
  const activeTaskLock = model.kind === 'detail' ? (model.detail?.meta?.lock || null) : null;
  const workflowThreads = model.kind === 'detail' ? (model.detail?.activity?.workflowThreads?.items || []) : [];
  const workflowThreadSummary = model.kind === 'detail' ? (model.detail?.activity?.workflowThreads?.summary || { total: 0, unresolvedCount: 0, unresolvedBlockingCount: 0, resolvedCount: 0 }) : { total: 0, unresolvedCount: 0, unresolvedBlockingCount: 0, resolvedCount: 0 };
  const canManageWorkflowThreads = model.kind === 'detail' && hasAnyRole(tokenClaims, ['architect', 'engineer', 'qa', 'pm', 'contributor', 'admin']);
  const qaStageEnabled = model.kind === 'detail' && model.detail?.task?.stage === 'QA_TESTING';
  const canSubmitQaResult = qaStageEnabled && hasAnyRole(tokenClaims, ['qa', 'admin', 'contributor']);
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

  const reloadTask = React.useCallback(async () => {
    if (model.kind === 'list') {
      setModel(buildListLoadingModel(pathname, search));
      const payload = await taskClient.fetchTaskList();
      const roleInbox = matchRoleInboxRoute(pathname);
      const pmOverview = matchPmOverviewRoute(pathname);
      setModel({ kind: 'list', route: { pathname: roleInbox ? `/inbox/${roleInbox.role}` : pmOverview ? '/overview/pm' : '/tasks', taskId: null }, list: { filters: readTaskListRouteState(search), items: payload.items || [], state: { kind: 'ready' }, resultSummary: '', inboxRole: roleInbox?.role || null, isPmOverview: Boolean(pmOverview) } });
      return;
    }
    setModel(buildLoadingModel(pathname, search));
    const nextModel = await pageModule.load({ pathname, search });
    setModel({ ...nextModel, kind: 'detail' });
  }, [model.kind, pageModule, pathname, search, taskClient]);

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

  const handleSignOut = React.useCallback(() => {
    clearSessionForSignIn('You signed out of the workflow app.', 'signed_out');
  }, [clearSessionForSignIn]);

  const handleTaskCreated = React.useCallback(() => {
    navigate('/tasks');
  }, [navigate]);

  const agentLookup = React.useMemo(() => new Map(mapAgentOptions(agentOptions).map((agent) => [agent.id, agent])), [agentOptions]);
  const listFilters = model.kind === 'list' ? model.list.filters : { owner: '', view: 'list', bucket: '' };
  const visibleListItems = model.kind === 'list' ? filterTaskList(model.list.items, listFilters.owner) : [];
  const roleInboxItems = model.kind === 'list' && activeInboxRole ? buildRoleInboxItems(model.list.items, activeInboxRole, agentLookup) : [];
  const pmSections = model.kind === 'list' && isPmOverview ? buildPmOverviewSections(model.list.items, agentLookup) : [];
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
            <p className="lede">Submit a trusted internal browser auth code to start a tab-scoped session for the task list, board, PM overview, inboxes, and task detail routes.</p>
          </div>

          {authNotice ? (
            <p className="auth-status auth-status--notice" role="status">
              {authNotice}
            </p>
          ) : null}

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
              <button type="submit" disabled={signInStatus.kind === 'loading'}>
                {signInStatus.kind === 'loading' ? 'Signing in…' : 'Sign in'}
              </button>
            </div>

            {signInStatus.kind === 'error' ? (
              <p className="auth-status auth-status--error" role="alert">{signInStatus.message}</p>
            ) : null}
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <nav className="app-nav" aria-label="Primary navigation">
        <div className="app-nav__links">
          <button type="button" className={model.kind === 'list' && !isPmOverview && !activeInboxRole && listFilters.view !== 'board' ? '' : 'button-secondary'} onClick={() => navigate('/tasks')}>Task list</button>
          <button type="button" className={model.kind === 'list' && !isPmOverview && !activeInboxRole && listFilters.view === 'board' ? '' : 'button-secondary'} onClick={() => navigate('/tasks', writeTaskListUrlState({ view: 'board' }, ''))}>Board</button>
          <button type="button" className={isPmOverview ? '' : 'button-secondary'} onClick={() => navigate('/overview/pm')}>PM overview</button>
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
      <header className="page-header">
        <div>
          <p className="eyebrow">Authenticated browser shell for US-002</p>
          <h1>{model.kind === 'list' ? (isPmOverview ? 'PM Overview' : activeInboxRole ? `${getRoleInboxLabel(activeInboxRole)} Inbox` : 'Task list') : model.detail?.task?.title || model.summary.title || 'Task detail'}</h1>
          <p className="lede">
            {model.kind === 'list'
              ? isPmOverview
                ? 'Read-only grouped overview showing routed, unassigned, and attention-needed work from the canonical owner-role mapping.'
                : activeInboxRole
                  ? `Read-only inbox surface showing tasks routed here because the current assigned owner maps to the ${getRoleInboxLabel(activeInboxRole)} role.`
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
              <button type="button" className={isPmOverview ? '' : 'button-secondary'} onClick={() => navigate('/overview/pm')}>PM overview</button>
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
        <section className="task-list-panel" aria-label={isPmOverview ? 'PM overview view' : activeInboxRole ? `${getRoleInboxLabel(activeInboxRole)} inbox view` : 'Task list view'}>
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
            ) : activeInboxRole ? (
              <div className="role-inbox-toolbar">
                <div>
                  <p className="eyebrow">Role inbox</p>
                  <h2>{getRoleInboxLabel(activeInboxRole)} inbox routing</h2>
                  <p className="role-inbox-toolbar__cue">Tasks appear here only when their current assigned owner resolves to the {getRoleInboxLabel(activeInboxRole)} canonical role. Unassigned tasks appear in no role inbox.</p>
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
                <div className="task-list-toolbar__actions">
                  <div className="view-toggle" role="tablist" aria-label="Task overview mode">
                    <button type="button" role="tab" aria-selected={listFilters.view === 'list'} className={listFilters.view === 'list' ? '' : 'button-secondary'} onClick={() => setListView('list')}>List</button>
                    <button type="button" role="tab" aria-selected={listFilters.view === 'board'} className={listFilters.view === 'board' ? '' : 'button-secondary'} onClick={() => setListView('board')}>Board</button>
                  </div>
                  <button type="button" className="button-secondary" onClick={() => setListOwnerFilter('')} disabled={!listFilters.owner}>Clear filter</button>
                  <button type="button" onClick={() => void reloadTask()}>Refresh</button>
                </div>
              </>
            )}
          </div>

          <p className="task-list-results" role="status" aria-live="polite">{resultSummary}</p>

          {(isPmOverview && listState.kind === 'loading') || (!activeInboxRole && !isPmOverview && listState.kind === 'loading') || (activeInboxRole && roleInboxState.kind === 'loading') ? <p role="status">{activeInboxRole ? roleInboxState.message : isPmOverview ? 'Loading PM overview.' : 'Loading task list.'}</p> : null}
          {((!activeInboxRole && !isPmOverview && listState.kind === 'error') || (isPmOverview && listState.kind === 'error')) ? <p role="alert">{listState.message}</p> : null}
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

          {roleInboxState.kind === 'ready' && activeInboxRole && roleInboxItems.length ? (
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

          {listState.kind === 'ready' && !activeInboxRole && !isPmOverview && visibleListItems.length && listFilters.view === 'list' ? (
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
                    return (
                      <tr key={item.task_id}>
                        <td>
                          <a href={`/tasks/${encodeURIComponent(item.task_id)}`} onClick={(event) => { event.preventDefault(); navigate(`/tasks/${encodeURIComponent(item.task_id)}`); }}>
                            <strong>{item.title || item.task_id}</strong>
                          </a>
                          <div className="task-list-meta">{item.task_id}</div>
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

          {listState.kind === 'ready' && !activeInboxRole && !isPmOverview && visibleListItems.length && listFilters.view === 'board' ? (
            <div className="task-board" aria-label="Task board">
              <div className="task-board__scroll">
                <div className="task-board__columns">
                  {boardColumns.map((column) => (
                    <section key={column.stage} className="task-board__column" aria-label={`${column.stage} column`}>
                      <div className="task-board__column-header">
                        <h2>{column.stage}</h2>
                        <span>{column.items.length}</span>
                      </div>
                      <div className="task-board__column-body">
                        {column.items.length ? column.items.map((item) => (
                          <article key={item.task_id} className="task-board__card">
                            <a href={`/tasks/${encodeURIComponent(item.task_id)}`} onClick={(event) => { event.preventDefault(); navigate(`/tasks/${encodeURIComponent(item.task_id)}`); }}>
                              <strong>{item.title || item.task_id}</strong>
                            </a>
                            <div className="task-list-meta">{item.task_id}</div>
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
                            <div className="task-list-meta">Read-only owner metadata</div>
                          </article>
                        )) : <p className="task-board__empty">No matching tasks in this column.</p>}
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

          {listState.kind === 'ready' && !activeInboxRole && !isPmOverview && !visibleListItems.length ? (
            <div className="empty-state" role="status">
              <h2>No matching tasks</h2>
              <p>{listFilters.owner ? 'No tasks match the active owner filter.' : 'No tasks are available yet.'}</p>
              {listFilters.owner ? <button type="button" onClick={() => setListOwnerFilter('')}>Clear filter</button> : null}
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
              <p>{model.detail?.context?.businessContext || model.summary.businessContext || 'Business context is missing.'}</p>
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
              />
            </section>
          </section>

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
        </>
      )}
    </main>
  );
}
