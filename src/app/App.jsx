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

function readRouteTask(pathname) {
  const match = ((pathname || '').replace(/\/+$/, '') || '/').match(/^\/tasks\/([^/]+)$/);
  return match ? { taskId: decodeURIComponent(match[1]) } : null;
}

function buildLoadingModel(pathname, search) {
  const route = readRouteTask(pathname);
  return {
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

function matchTaskRoute(pathname) {
  return Boolean(readRouteTask(pathname));
}

function buildRouteMissModel(pathname) {
  return {
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
  const [model, setModel] = React.useState(() =>
    matchTaskRoute(pathname) ? buildLoadingModel(pathname, search) : buildRouteMissModel(pathname),
  );
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
    setAssignmentDraft(model.summary?.currentOwner || '');
    setAssignmentStatus({ kind: 'idle', message: '' });
  }, [model.summary?.taskId, model.summary?.currentOwner]);

  React.useEffect(() => {
    let cancelled = false;

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
        if (!cancelled) setModel(nextModel);
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
  }, [pageModule, pathname, search]);

  React.useEffect(() => {
    let cancelled = false;
    const tokenClaims = decodeJwtPayload(sessionConfig.bearerToken || '');

    if (!canManageAssignment(tokenClaims)) {
      setAgentOptions([]);
      return () => {
        cancelled = true;
      };
    }

    taskClient.fetchAssignableAgents()
      .then((payload) => {
        if (!cancelled) setAgentOptions(payload.items || []);
      })
      .catch(() => {
        if (!cancelled) setAgentOptions([]);
      });

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

  const routeTaskId = model.route?.taskId || 'TSK-42';
  const tokenClaims = decodeJwtPayload(sessionConfig.bearerToken || '');
  const resolvedApiBaseUrl = resolveApiBaseUrl(sessionConfig, envApiBaseUrl);
  const assignmentEnabled = Boolean(model.route?.taskId) && canManageAssignment(tokenClaims);

  const reloadTask = React.useCallback(async () => {
    setModel(buildLoadingModel(pathname, search));
    const nextModel = await pageModule.load({ pathname, search });
    setModel(nextModel);
  }, [pageModule, pathname, search]);

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Thin browser runtime for issue #26</p>
          <h1>{model.summary.title || 'Task detail'}</h1>
          <p className="lede">Route-mounted task detail screen using the existing adapter and page module contract.</p>
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
            <button type="submit">Open</button>
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
    </main>
  );
}
