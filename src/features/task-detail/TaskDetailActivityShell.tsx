import React, { useRef } from 'react';
import styles from './TaskDetailActivityShell.module.css';
import { TaskHistoryTimeline } from './TaskHistoryTimeline';
import { TelemetrySummary } from './TelemetrySummary';
import type {
  HistoryFilterState,
  HistoryViewState,
  TaskDetailActivityShellProps,
  TaskDetailTab,
  TelemetryViewState,
} from './types';

function Notice({
  title,
  body,
  detail,
  tone = 'neutral',
}: {
  title: string;
  body?: string;
  detail?: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'restricted';
}) {
  const toneClassName =
    tone === 'warning'
      ? styles.noticeWarning
      : tone === 'danger'
        ? styles.noticeDanger
        : tone === 'restricted'
          ? styles.noticeRestricted
          : '';

  return (
    <section className={`${styles.notice} ${toneClassName}`.trim()} role={tone === 'danger' ? 'alert' : 'status'}>
      <h3 className={styles.noticeTitle}>{title}</h3>
      {body ? <p className={styles.noticeBody}>{body}</p> : null}
      {detail ? <p className={styles.noticeDetail}>{detail}</p> : null}
    </section>
  );
}

function renderState(state: HistoryViewState | TelemetryViewState) {
  switch (state.kind) {
    case 'loading':
      return <Notice title="Loading…" body={state.message ?? 'Pulling the latest task activity.'} />;
    case 'empty':
      return <Notice title="Nothing here yet" body={state.message ?? 'No activity has been recorded for this view.'} />;
    case 'error':
      return <Notice title="Could not load activity" body={state.message} detail={state.retryLabel} tone="danger" />;
    case 'degraded':
      return <Notice title="Partial data" body={state.message} detail={state.detail} tone="warning" />;
    case 'restricted':
      return <Notice title="Restricted" body={state.message} detail={state.detail} tone="restricted" />;
    case 'ready':
      return null;
    default:
      return null;
  }
}

function HistoryFilters({
  filters,
  onFiltersChange,
}: {
  filters?: HistoryFilterState;
  onFiltersChange?: (filters: HistoryFilterState) => void;
}) {
  const safeFilters = filters ?? {};

  const bindField = (field: keyof HistoryFilterState) => ({
    value: safeFilters[field] ?? '',
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      onFiltersChange?.({
        ...safeFilters,
        [field]: event.target.value || undefined,
      });
    },
  });

  return (
    <section className={styles.filters} aria-label="History filters">
      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Event type</span>
        <input className={styles.filterInput} type="text" placeholder="Filter event type" {...bindField('eventType')} />
      </label>
      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Actor</span>
        <input className={styles.filterInput} type="text" placeholder="Filter actor" {...bindField('actorId')} />
      </label>
      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Date from</span>
        <input className={styles.filterInput} type="date" {...bindField('dateFrom')} />
      </label>
      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Date to</span>
        <input className={styles.filterInput} type="date" {...bindField('dateTo')} />
      </label>
    </section>
  );
}

export function TaskDetailActivityShell({
  selectedTab = 'history',
  onTabChange,
  historyState,
  telemetryState,
  historyItems = [],
  telemetryCards = [],
  filters,
  onFiltersChange,
  historyPageInfo,
  onLoadMoreHistory,
  isLoadingMoreHistory = false,
  historyLoadMoreError,
}: TaskDetailActivityShellProps) {
  const activeState = selectedTab === 'history' ? historyState : telemetryState;
  const tabOrder: TaskDetailTab[] = ['history', 'telemetry'];
  const tabRefs = useRef<Record<TaskDetailTab, HTMLButtonElement | null>>({
    history: null,
    telemetry: null,
  });

  const selectTab = (tab: TaskDetailTab, focusTab = false) => {
    onTabChange?.(tab);

    if (focusTab) {
      tabRefs.current[tab]?.focus();
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tab: TaskDetailTab) => {
    const currentIndex = tabOrder.indexOf(tab);

    if (currentIndex === -1) return;

    let nextTab: TaskDetailTab | null = null;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextTab = tabOrder[(currentIndex + 1) % tabOrder.length];
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextTab = tabOrder[(currentIndex - 1 + tabOrder.length) % tabOrder.length];
        break;
      case 'Home':
        nextTab = tabOrder[0];
        break;
      case 'End':
        nextTab = tabOrder[tabOrder.length - 1];
        break;
      default:
        return;
    }

    event.preventDefault();
    selectTab(nextTab, true);
  };

  return (
    <section className={styles.shell} aria-label="Task activity">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.eyebrow}>Task activity</span>
          <h2 className={styles.title}>History and telemetry</h2>
          <p className={styles.subtitle}>History is the default view. Telemetry stays adjacent, not mixed into the audit stream.</p>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="Task activity views" aria-orientation="horizontal">
          {tabOrder.map((tab) => {
            const isActive = selectedTab === tab;

            return (
              <button
                key={tab}
                id={`task-activity-tab-${tab}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`task-activity-panel-${tab}`}
                className={`${styles.tab} ${isActive ? styles.tabActive : ''}`.trim()}
                tabIndex={isActive ? 0 : -1}
                ref={(node) => {
                  tabRefs.current[tab] = node;
                }}
                onClick={() => selectTab(tab)}
                onKeyDown={(event) => handleTabKeyDown(event, tab)}
              >
                {tab === 'history' ? 'History' : 'Telemetry'}
              </button>
            );
          })}
        </div>
      </header>

      <div
        id={`task-activity-panel-${selectedTab}`}
        role="tabpanel"
        aria-labelledby={`task-activity-tab-${selectedTab}`}
        className={styles.panel}
      >
        {selectedTab === 'history' ? <HistoryFilters filters={filters} onFiltersChange={onFiltersChange} /> : null}

        {renderState(activeState)}

        {selectedTab === 'history' && historyState.kind === 'ready' ? <TaskHistoryTimeline items={historyItems} /> : null}
        {selectedTab === 'history' && historyState.kind === 'ready' && historyLoadMoreError ? (
          <Notice title="Could not load more history" body={historyLoadMoreError} tone="danger" />
        ) : null}
        {selectedTab === 'history' && historyState.kind === 'ready' && historyPageInfo?.has_more ? (
          <div className={styles.loadMoreRow}>
            <button type="button" className={styles.loadMoreButton} onClick={onLoadMoreHistory} disabled={isLoadingMoreHistory}>
              {isLoadingMoreHistory ? 'Loading…' : 'Load more'}
            </button>
          </div>
        ) : null}
        {selectedTab === 'telemetry' && telemetryState.kind === 'ready' ? <TelemetrySummary cards={telemetryCards} /> : null}
      </div>
    </section>
  );
}

export default TaskDetailActivityShell;
