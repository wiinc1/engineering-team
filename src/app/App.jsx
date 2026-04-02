import React from 'react';
import { createTaskDetailApiClient } from '../features/task-detail/adapter';
import { createTaskDetailPageModule } from '../features/task-detail/route';
import { writeTaskDetailUrlState } from '../features/task-detail/urlState';
import { TaskDetailActivityShell } from '../features/task-detail/TaskDetailActivityShell';
import {
  buildAuthHeaders,
  clearBrowserSessionConfig,
  decodeJwtPayload,
  readBrowserSessionConfig,
  resolveApiBaseUrl,
  writeBrowserSessionConfig,
} from './session';

const envApiBaseUrl = (import.meta.env.VITE_TASK_API_BASE_URL || '').trim();
const UNASSIGNED_FILTER_VALUE = '__unassigned__';

function readRouteTask(pathname) {
  const match = ((pathname || '').replace(/\/+$/, '') || '/').match(/^\/tasks\/([^/]+)$/);
  return match ? { taskId: decodeURIComponent(match[1]) } : null;
}

function matchTaskListRoute(pathname = '') {
  return ((pathname || '').replace(/\/+$/, '') || '/') === '/tasks';
}

function readTaskListRouteState(search = '') {
  const params = new URLSearchParams(search);
  const owner = params.get('owner') || '';
  return { owner };
}

function writeTaskListUrlState({ owner }, search = '') {
  const params = new URLSearchParams(search);
  if (owner) params.set('owner', owner);
  else params.delete('owner');
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
  return {
    kind: 'list',
    route: { pathname: '/tasks', taskId: null },
    list: {
      filters: readTaskListRouteState(search),
      items: [],
      state: { kind: 'loading', message: 'Loading task list.' },
      resultSummary: '',
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

function canManageAssignment(tokenClaims) {
  const roles = Array.isArray(tokenClaims?.roles) ? tokenClaims.roles : [];
  return roles.includes('pm') || roles.includes('admin');
}

function mapAgentOptions(items = []) {
  return items.map((agent) => ({
    id: agent.id,
    label: `${agent.display_name}${agent.role ? ` · ${agent.role}` : ''}`,
  }));
}

function resolveOwnerPresentation(item, agentLookup) {
  if (!item.current_owner) {
    return { label: 'Unassigned', detail: 'No owner assigned', tone: 'unassigned', filterValue: UNASSIGNED_FILTER_VALUE };
  }

  const agent = agentLookup.get(item.current_owner);
  if (agent) {
    return { label: agent.label, detail: `Owner: ${agent.label}`, tone: 'assigned', filterValue: item.current_owner };
  }

  return { label: `Unknown owner (${item.current_owner})`, detail: `Owner record unavailable for ${item.current_owner}`, tone: 'fallback', filterValue: item.current_owner };
}

function filterTaskList(items, ownerFilter) {
  if (!ownerFilter) return items;
  if (ownerFilter === UNASSIGNED_FILTER_VALUE) return items.filter((item) => !item.current_owner);
  return items.filter((item) => item.current_owner === ownerFilter);
}

function summarizeListResults(count, ownerFilter, agentLookup) {
  if (!ownerFilter) return `${count} tasks shown.`;
  if (ownerFilter === UNASSIGNED_FILTER_VALUE) return `${count} unassigned tasks shown.`;
  return `${count} tasks shown for ${agentLookup.get(ownerFilter)?.label || ownerFilter}.`;
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
    if (matchTaskListRoute(pathname)) return buildListLoadingModel(pathname, search);
    return matchTaskRoute(pathname) ? buildLoadingModel(pathname, search) : buildRouteMissModel(pathname);
  });
  const [agentOptions, setAgentOptions] = React.useState([]);
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

    if (matchTaskListRoute(pathname)) {
      setModel(buildListLoadingModel(pathname, search));
      taskClient.fetchTaskList()
        .then((payload) => {
          if (cancelled) return;
          const filters = readTaskListRouteState(search);
          setModel({
            kind: 'list',
            route: { pathname: '/tasks', taskId: null },
            list: {
              filters,
              items: payload.items || [],
              state: { kind: 'ready' },
              resultSummary: '',
            },
          });
        })
        .catch((error) => {
          if (!cancelled) {
            setModel({
              kind: 'list',
              route: { pathname: '/tasks', taskId: null },
              list: {
                filters: readTaskListRouteState(search),
                items: [],
                state: { kind: 'error', message: error.message || 'Task list load failed.' },
                resultSummary: '',
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

    taskClient.fetchAssignableAgents()
      .then((payload) => {
        if (!cancelled) setAgentOptions(payload.items || []);
      })
      .catch(() => {
        if (!cancelled) setAgentOptions([]);
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

  const tokenClaims = decodeJwtPayload(sessionConfig.bearerToken || '');
  const resolvedApiBaseUrl = resolveApiBaseUrl(sessionConfig, envApiBaseUrl);
  const assignmentEnabled = model.kind === 'detail' && Boolean(model.route?.taskId) && canManageAssignment(tokenClaims);
  const routeTaskId = model.kind === 'detail' ? (model.route?.taskId || 'TSK-42') : 'TSK-42';

  const reloadTask = React.useCallback(async () => {
    if (model.kind === 'list') {
      setModel(buildListLoadingModel('/tasks', search));
      const payload = await taskClient.fetchTaskList();
      setModel({ kind: 'list', route: { pathname: '/tasks', taskId: null }, list: { filters: readTaskListRouteState(search), items: payload.items || [], state: { kind: 'ready' }, resultSummary: '' } });
      return;
    }
    setModel(buildLoadingModel(pathname, search));
    const nextModel = await pageModule.load({ pathname, search });
    setModel({ ...nextModel, kind: 'detail' });
  }, [model.kind, pageModule, pathname, search, taskClient]);

  const agentLookup = React.useMemo(() => new Map(mapAgentOptions(agentOptions).map((agent) => [agent.id, agent])), [agentOptions]);
  const listFilters = model.kind === 'list' ? model.list.filters : { owner: '' };
  const visibleListItems = model.kind === 'list' ? filterTaskList(model.list.items, listFilters.owner) : [];
  const resultSummary = model.kind === 'list' ? summarizeListResults(visibleListItems.length, listFilters.owner, agentLookup) : '';
  const listState = model.kind === 'list' ? model.list.state : { kind: 'idle' };

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Thin browser runtime for issue #26</p>
          <h1>{model.kind === 'list' ? 'Task list' : model.summary.title || 'Task detail'}</h1>
          <p className="lede">
            {model.kind === 'list'
              ? 'Overview list wired to the projected owner read model with single-select owner filtering.'
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
        <section className="task-list-panel" aria-label="Task list view">
          <div className="task-list-toolbar">
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
              <button type="button" className="button-secondary" onClick={() => setListOwnerFilter('')} disabled={!listFilters.owner}>Clear filter</button>
              <button type="button" onClick={() => void reloadTask()}>Refresh</button>
            </div>
          </div>

          <p className="task-list-results" role="status" aria-live="polite">{resultSummary}</p>

          {listState.kind === 'loading' ? <p role="status">Loading task list.</p> : null}
          {listState.kind === 'error' ? <p role="alert">{listState.message}</p> : null}

          {listState.kind === 'ready' && visibleListItems.length ? (
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

          {listState.kind === 'ready' && !visibleListItems.length ? (
            <div className="empty-state" role="status">
              <h2>No matching tasks</h2>
              <p>{listFilters.owner ? 'No tasks match the active owner filter.' : 'No tasks are available yet.'}</p>
              {listFilters.owner ? <button type="button" onClick={() => setListOwnerFilter('')}>Clear filter</button> : null}
            </div>
          ) : null}
        </section>
      ) : (
        <>
          <section className="summary-grid" aria-label="Task summary">
            <article>
              <span>Task</span>
              <strong>{model.summary.taskId || '—'}</strong>
            </article>
            <article>
              <span>Tenant</span>
              <strong>{model.summary.tenantId || '—'}</strong>
            </article>
            <article>
              <span>Stage</span>
              <strong>{model.summary.currentStage || '—'}</strong>
            </article>
            <article>
              <span>Owner</span>
              <strong>{model.summary.currentOwner || '—'}</strong>
            </article>
            <article>
              <span>Priority</span>
              <strong>{model.summary.priority || '—'}</strong>
            </article>
            <article>
              <span>Freshness</span>
              <strong>{formatFreshness(model.summary)}</strong>
            </article>
          </section>

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
        </>
      )}
    </main>
  );
}
