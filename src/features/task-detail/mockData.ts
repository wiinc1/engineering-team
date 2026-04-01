import type { HistoryTimelineItem, TelemetrySummaryCard } from './types';

export const mockHistoryItems: HistoryTimelineItem[] = [
  {
    id: 'history-1',
    title: 'Task moved into implementation',
    timestampLabel: '2026-04-01 09:20 CDT',
    actorLabel: 'Senior Engineer',
    detail: 'UI shell work started while API contract alignment remains in flight.',
    statusTone: 'info',
    metadata: [
      { label: 'Stage', value: 'IMPLEMENT' },
      { label: 'Source', value: 'Mock adapter' },
    ],
  },
  {
    id: 'history-2',
    title: 'Audit projection available',
    timestampLabel: '2026-04-01 09:08 CDT',
    actorLabel: 'Audit foundation',
    detail: 'History data exists in backend projections, but final UI mapping is intentionally not fixed yet.',
    statusTone: 'neutral',
  },
];

export const mockTelemetryCards: TelemetrySummaryCard[] = [
  {
    id: 'telemetry-1',
    label: 'Signals available',
    value: '3 surfaces',
    hint: 'Logs, metrics, traces stay separate from workflow history.',
    tone: 'info',
  },
  {
    id: 'telemetry-2',
    label: 'Contract status',
    value: 'Pending',
    hint: 'Awaiting issue #27 alignment before binding concrete fields.',
    tone: 'warning',
  },
];
