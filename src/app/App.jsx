import React from 'react';
import { createTaskDetailApiClient } from '../features/task-detail/adapter.browser';
import { createTaskDetailPageModule } from '../features/task-detail/route.browser';
import { writeTaskDetailUrlState } from '../features/task-detail/urlState';
import { TaskDetailActivityShell } from '../features/task-detail/TaskDetailActivityShell';
import { StageTransition } from '../features/task-detail/StageTransition';
import { TaskCreationPage } from '../features/task-creation/TaskCreationPage';
import {
  buildAuthHeaders,
  clearBrowserSessionConfig,
  decodeJwtPayload,
  readBrowserSessionConfig,
  resolveApiBaseUrl,
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
} from './task-owner';

const envApiBaseUrl = (import.meta.env.VITE_TASK_API_BASE_URL || '').trim();

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

  const navigate = React.useCallback((pathname, search = '') => {
    const nextUrl = `${pathname}${search}`;
    window.history.pushState({}, '', nextUrl);
    setLocationState({ pathname, search });
  }, []);

  return [locationState, navigate];
}

export function App() {
  const [{ pathname, search }, navigate] = useLocationState();
  const [sessionConfig, setSessionConfig] = React.useState(() => readBrowserSessionConfig());
  const [draftSessionConfig, setDraftSessionConfig] = React.useState(() => readBrowserSessionConfig());
  const [model, setModel] = React.useState(() => {
    if (matchTaskListRoute(pathname) || matchRoleInboxRoute(pathname) || matchPmOverviewRoute(pathname)) return buildListLoadingModel(pathname, search);
    return matchTaskRoute(pathname) ? buildLoadingModel(pathname, search) : buildRouteMissModel(pathname);
  });
  const [agentOptions, setAgentOptions] = React.useState([]);
  const [agentOptionsState, setAgentOptionsState] = React.useState({ kind: 'loading', message: 'Loading canonical role roster.' });
  const [assignmentDraft, setAssignmentDraft] = React.useState('');
  const [assignmentStatus, setAssignmentStatus] = React.useState({ kind: 'idle', message: '' });

  const taskClient = React.useMemo(() => {
    const baseUrl = resolveApiBaseUrl(sessionConfig, envApiBaseUrl);
    return createTaskDetailApiClient({
      baseUrl,
      fetchImpl: (...args) => window.fetch(...args),
      getHeaders: () => buildAuthHeaders(sessionConfig),
    });
  }, [sessionConfig]);

  const pageModule = React.useMemo(() => {
    return createTaskDetailPageModule({
      client: taskClient,
    });
  }, [taskClient]);

  React.useEffect(() => {
    setDraftSessionConfig(sessionConfig);
  }, [sessionConfig]);

  React.useEffect(() => {
    if (model.kind === 'detail') {
      setAssignmentDraft(model.summary?.currentOwner || '');
      setAssignmentStatus({ kind: 'idle', message: '' });
    }
  }, [model]);

  React.useEffect(() => {
    let cancelled = false;

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
  }, [pageModule, pathname, search, taskClient]);

  React.useEffect(() => {
    let cancelled = false;
    const tokenClaims = decodeJwtPayload(sessionConfig.bearerToken || '');

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
  }, [taskClient, sessionConfig.bearerToken]);

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

  const tokenClaims = decodeJwtPayload(sessionConfig.bearerToken || '');
  const resolvedApiBaseUrl = resolveApiBaseUrl(sessionConfig, envApiBaseUrl);
  const assignmentEnabled = model.kind === 'detail' && Boolean(model.route?.taskId) && canManageAssignment(tokenClaims);
  const routeTaskId = model.kind === 'detail' ? (model.route?.taskId || 'TSK-42') : 'TSK-42';
  const activeInboxRole = model.kind === 'list' ? model.list.inboxRole : null;
  const isPmOverview = model.kind === 'list' ? Boolean(model.list.isPmOverview) : false;
  const detailPermissions = model.kind === 'detail' ? (model.detail?.meta?.permissions || {}) : {};

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

  const handleTaskCreated = React.useCallback(() => {
    navigate('/tasks');
  }, [navigate]);

  const agentLookup = React.useMemo(() => new Map(mapAgentOptions(agentOptions).map((agent) => [agent.id, agent])), [agentOptions]);
  const listFilters = model.kind === 'list' ? model.list.filters : { owner: '', view: 'list', bucket: '' };
  const visibleListItems = model.kind === 'list' ? filterTaskList(model.list.items, listFilters.owner) : [];
  const roleInboxItems = model.kind === 'list' && activeInboxRole ? buildRoleInboxItems(model.list.items, activeInboxRole, agentLookup) : [];
  const pmSections = model.kind === 'list' && isPmOverview ? buildPmOverviewSections(model.list.items, agentLookup) : [];
  const activePmBucket = isPmOverview && PM_OVERVIEW_BUCKET_ORDER.includes(listFilters.bucket) ? listFilters.bucket : '';
  const visiblePmSections = isPmOverview
    ? pmSections.filter((section) => (activePmBucket ? section.key === activePmBucket : section.items.length > 0))
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

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Thin browser runtime for issue #26</p>
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

          <form
            className="session-form"
            onSubmit={(event) => {
              event.preventDefault();
              const nextConfig = writeBrowserSessionConfig(draftSessionConfig);
              setSessionConfig(nextConfig);
            }}
          >
            <div className="session-form__header">
              <strong>Session bootstrap</strong>
              <span>Tab-scoped bearer token for internal use.</span>
            </div>

            <label>
              API base URL
              <input
                name="apiBaseUrl"
                value={draftSessionConfig.apiBaseUrl}
                placeholder={envApiBaseUrl || 'same-origin'}
                onChange={(event) => setDraftSessionConfig((current) => ({ ...current, apiBaseUrl: event.target.value }))}
              />
            </label>

            <label>
              Bearer token
              <textarea
                name="bearerToken"
                value={draftSessionConfig.bearerToken}
                placeholder="Paste a JWT for the audit/task-detail APIs"
                onChange={(event) => setDraftSessionConfig((current) => ({ ...current, bearerToken: event.target.value }))}
                rows={4}
              />
            </label>

            <div className="session-form__actions">
              <button type="submit">Apply session</button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  clearBrowserSessionConfig();
                  const cleared = { bearerToken: '', apiBaseUrl: '' };
                  setDraftSessionConfig(cleared);
                  setSessionConfig(cleared);
                }}
              >
                Clear
              </button>
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
          </form>
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
              <h3>Technical spec</h3>
              <p>{model.detail?.context?.technicalSpec || 'Technical spec is missing.'}</p>
              <h3>Monitoring spec</h3>
              <p>{model.detail?.context?.monitoringSpec || 'Monitoring spec is missing.'}</p>
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

            <section className="detail-card">
              <h2>Discussion</h2>
              {detailPermissions.canViewComments === false ? (
                <p>Workflow comments are hidden for this session.</p>
              ) : model.detail?.activity?.comments?.length ? (
                <ul className="detail-feed">
                  {model.detail.activity.comments.map((comment) => (
                    <li key={comment.id}>
                      <strong>{comment.actor?.label || 'Unknown actor'}</strong>
                      <span>{comment.summary}</span>
                    </li>
                  ))}
                </ul>
              ) : <p>No workflow comments yet.</p>}
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
