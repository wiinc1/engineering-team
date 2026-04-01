export type TaskDetailTab = 'history' | 'telemetry';

export type HistoryFilterState = {
  eventType?: string;
  actorId?: string;
  range?: string;
};

export type HistoryViewState =
  | { kind: 'loading'; message?: string }
  | { kind: 'ready' }
  | { kind: 'empty'; message?: string }
  | { kind: 'error'; message: string; retryLabel?: string }
  | { kind: 'degraded'; message: string; detail?: string }
  | { kind: 'restricted'; message: string; detail?: string };

export type TelemetryViewState =
  | { kind: 'loading'; message?: string }
  | { kind: 'ready' }
  | { kind: 'empty'; message?: string }
  | { kind: 'error'; message: string; retryLabel?: string }
  | { kind: 'degraded'; message: string; detail?: string }
  | { kind: 'restricted'; message: string; detail?: string };

/**
 * Intentionally UI-shaped, not API-shaped.
 * Backend contract alignment with issue #27 is still pending.
 */
export interface HistoryTimelineItem {
  id: string;
  title: string;
  timestampLabel: string;
  actorLabel?: string;
  detail?: string;
  statusTone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  metadata?: Array<{ label: string; value: string }>;
}

/**
 * Intentionally summary-shaped, not contract-shaped.
 * Avoids locking metrics field names before issue #27.
 */
export interface TelemetrySummaryCard {
  id: string;
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}

export interface TaskDetailActivityShellProps {
  selectedTab?: TaskDetailTab;
  onTabChange?: (tab: TaskDetailTab) => void;
  historyState: HistoryViewState;
  telemetryState: TelemetryViewState;
  historyItems?: HistoryTimelineItem[];
  telemetryCards?: TelemetrySummaryCard[];
  filters?: HistoryFilterState;
  onFiltersChange?: (filters: HistoryFilterState) => void;
}
