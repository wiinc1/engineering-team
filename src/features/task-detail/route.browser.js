import { createTaskDetailApiClient } from './adapter.browser';

export const DEFAULT_TASK_DETAIL_TAB = 'history';

function isTaskDetailTab(value) {
  return value === 'history' || value === 'telemetry';
}

function readTaskDetailRouteState(search = '') {
  const params = new URLSearchParams(search);
  return {
    tab: isTaskDetailTab(params.get('tab')) ? params.get('tab') : DEFAULT_TASK_DETAIL_TAB,
    filters: {
      eventType: params.get('historyEventType') || undefined,
      actorId: params.get('historyActor') || undefined,
      dateFrom: params.get('dateFrom') || undefined,
      dateTo: params.get('dateTo') || undefined,
    },
  };
}

function matchTaskDetailRoute(pathname = '') {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const match = normalizedPath.match(/^\/tasks\/([^/]+)$/);
  if (!match) return null;
  return { taskId: decodeURIComponent(match[1]) };
}

function toRouteLoadErrorState(error, selectedTab) {
  const message = error?.message || 'Task activity could not be loaded.';
  const status = Number(error?.status);
  const isRestricted = status === 401 || status === 403 || error?.code === 'forbidden';
  const kind = isRestricted ? 'restricted' : 'error';
  const detail = isRestricted
    ? error?.details?.permission
      ? `Missing permission: ${error.details.permission}`
      : 'Telemetry access is controlled by the server-side access scope.'
    : undefined;

  return {
    summary: {
      taskId: null,
      tenantId: null,
      title: 'Task detail unavailable',
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
      selectedTab,
      filters: {},
      historyState: { kind, message, detail },
      telemetryState: { kind, message, detail },
      historyItems: [],
      telemetryCards: [],
      historyPageInfo: null,
      telemetryAccess: null,
    },
  };
}

export function createTaskDetailPageModule({ client = createTaskDetailApiClient() } = {}) {
  return {
    match(pathname) {
      return matchTaskDetailRoute(pathname);
    },
    async load({ pathname, search = '' }) {
      const route = matchTaskDetailRoute(pathname);
      if (!route) {
        const error = new Error(`No task detail route matched: ${pathname}`);
        error.code = 'route_not_found';
        throw error;
      }
      const routeState = readTaskDetailRouteState(search);
      try {
        const model = await client.fetchTaskDetailScreenData(route.taskId, { filters: routeState.filters });
        return {
          ...model,
          route: { pathname: `/tasks/${encodeURIComponent(route.taskId)}`, taskId: route.taskId },
          shell: { ...model.shell, selectedTab: routeState.tab, filters: routeState.filters },
        };
      } catch (error) {
        return {
          ...toRouteLoadErrorState(error, routeState.tab),
          route: { pathname: `/tasks/${encodeURIComponent(route.taskId)}`, taskId: route.taskId },
        };
      }
    },
  };
}

export {
  isTaskDetailTab,
  matchTaskDetailRoute,
  readTaskDetailRouteState,
  toRouteLoadErrorState,
};
