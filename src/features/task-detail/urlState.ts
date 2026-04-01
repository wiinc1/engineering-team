import type { HistoryFilterState, TaskDetailTab } from './types';

export const DEFAULT_TASK_DETAIL_TAB: TaskDetailTab = 'history';

export interface TaskDetailUrlState {
  tab: TaskDetailTab;
  filters: HistoryFilterState;
}

function isTaskDetailTab(value: string | null): value is TaskDetailTab {
  return value === 'history' || value === 'telemetry';
}

export function readTaskDetailUrlState(search: string): TaskDetailUrlState {
  const params = new URLSearchParams(search);
  const tab = isTaskDetailTab(params.get('tab')) ? (params.get('tab') as TaskDetailTab) : DEFAULT_TASK_DETAIL_TAB;

  const filters: HistoryFilterState = {
    eventType: params.get('historyEventType') || undefined,
    actorId: params.get('historyActor') || undefined,
    range: params.get('historyRange') || undefined,
  };

  return { tab, filters };
}

export function writeTaskDetailUrlState(state: Partial<TaskDetailUrlState>, currentSearch = ''): string {
  const current = readTaskDetailUrlState(currentSearch);
  const next: TaskDetailUrlState = {
    tab: state.tab ?? current.tab,
    filters: {
      ...current.filters,
      ...state.filters,
    },
  };

  const params = new URLSearchParams();

  if (next.tab !== DEFAULT_TASK_DETAIL_TAB) {
    params.set('tab', next.tab);
  }

  if (next.filters.eventType) {
    params.set('historyEventType', next.filters.eventType);
  }

  if (next.filters.actorId) {
    params.set('historyActor', next.filters.actorId);
  }

  if (next.filters.range) {
    params.set('historyRange', next.filters.range);
  }

  const output = params.toString();
  return output ? `?${output}` : '';
}
