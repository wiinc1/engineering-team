function buildHistoryQuery(filters = {}, pagination = {}, range = {}) {
  const params = new URLSearchParams();

  if (filters.eventType) params.append('eventType', filters.eventType);
  if (filters.actorId) params.set('actorId', filters.actorId);

  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  if (range.dateFrom) params.set('dateFrom', range.dateFrom);
  if (range.dateTo) params.set('dateTo', range.dateTo);

  if (Number.isFinite(pagination.limit)) params.set('limit', String(pagination.limit));
  if (pagination.cursor != null && pagination.cursor !== '') params.set('cursor', String(pagination.cursor));

  return params;
}

function toHistoryTimelineItem(item) {
  return {
    id: item.item_id,
    title: item.display?.summary || item.summary || item.event_type_label || item.event_type,
    timestampLabel: item.occurred_at,
    actorLabel: item.actor?.display_name || item.actor?.actor_id || item.actor_id,
    detail: item.display?.fallback_used ? `Unmapped event type rendered via backend summary: ${item.event_type}` : undefined,
    statusTone: toneForHistoryEvent(item.event_type),
    metadata: [
      item.event_type_label ? { label: 'Event', value: item.event_type_label } : null,
      Number.isFinite(item.sequence_number) ? { label: 'Sequence', value: String(item.sequence_number) } : null,
      item.source ? { label: 'Source', value: item.source } : null,
    ].filter(Boolean),
  };
}

function toneForHistoryEvent(eventType = '') {
  if (/failed|error|rejected|blocked/i.test(eventType)) return 'danger';
  if (/warning|stale|degraded/i.test(eventType)) return 'warning';
  if (/created|queued|started|assigned|comment/i.test(eventType)) return 'info';
  if (/completed|resolved|approved|done|closed/i.test(eventType)) return 'success';
  return 'neutral';
}

function toTelemetryCards(summary) {
  const restrictedHint = summary.access?.omission_applied
    ? `Restricted server-side fields omitted: ${(summary.access.omitted_fields || []).join(', ') || 'none'}`
    : undefined;

  return [
    {
      id: 'telemetry-status',
      label: 'Status',
      value: summary.status,
      hint: summary.degraded ? 'Backend marked the task telemetry as degraded.' : restrictedHint,
      tone: summary.degraded ? 'warning' : 'info',
    },
    {
      id: 'telemetry-freshness',
      label: 'Freshness',
      value: summary.freshness?.status || 'unknown',
      hint: summary.last_updated_at || summary.freshness?.last_updated_at || 'No telemetry timestamp available.',
      tone: summary.stale ? 'warning' : 'neutral',
    },
    {
      id: 'telemetry-event-count',
      label: 'Event count',
      value: String(summary.event_count ?? 0),
      hint: 'Telemetry stays on this tab; workflow history remains separate.',
      tone: 'neutral',
    },
    {
      id: 'telemetry-correlation',
      label: 'Approved correlations',
      value: String(summary.correlation?.approved_correlation_ids?.length || 0),
      hint: summary.access?.restricted ? 'Only approved correlation pointers are exposed for this access scope.' : 'Operator scope includes expanded telemetry references.',
      tone: summary.access?.restricted ? 'info' : 'success',
    },
  ];
}

function toTaskDetailScreenModel({ summary, history, telemetry, historyFilters }) {
  return {
    summary: {
      taskId: summary.task_id,
      tenantId: summary.tenant_id,
      title: summary.title,
      priority: summary.priority,
      currentStage: summary.current_stage,
      currentOwner: summary.current_owner,
      blocked: summary.blocked,
      waitingState: summary.waiting_state,
      nextRequiredAction: summary.next_required_action,
      freshness: summary.freshness,
      statusIndicator: summary.status_indicator,
      closed: summary.closed,
    },
    shell: {
      selectedTab: 'history',
      filters: historyFilters || {},
      historyState: history.items?.length ? { kind: 'ready' } : { kind: 'empty', message: 'No workflow history has been recorded yet.' },
      telemetryState: { kind: 'ready' },
      historyItems: (history.items || []).map(toHistoryTimelineItem),
      telemetryCards: toTelemetryCards(telemetry),
      historyPageInfo: history.page_info,
      telemetryAccess: telemetry.access,
    },
  };
}

async function parseJsonResponse(response) {
  const payload = await response.json();

  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    error.requestId = payload?.error?.request_id;
    throw error;
  }

  return payload;
}

function createTaskDetailApiClient({ baseUrl = '', fetchImpl = fetch, getHeaders } = {}) {
  const request = async (path) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'GET',
      headers: typeof getHeaders === 'function' ? await getHeaders() : undefined,
    });

    return parseJsonResponse(response);
  };

  return {
    fetchTaskSummary(taskId) {
      return request(`/tasks/${encodeURIComponent(taskId)}`);
    },
    fetchTaskHistory(taskId, { filters, pagination, range } = {}) {
      const query = buildHistoryQuery(filters, pagination, range).toString();
      return request(`/tasks/${encodeURIComponent(taskId)}/history${query ? `?${query}` : ''}`);
    },
    fetchObservabilitySummary(taskId) {
      return request(`/tasks/${encodeURIComponent(taskId)}/observability-summary`);
    },
    async fetchTaskDetailScreenData(taskId, options = {}) {
      const [summary, history, telemetry] = await Promise.all([
        request(`/tasks/${encodeURIComponent(taskId)}`),
        this.fetchTaskHistory(taskId, options),
        request(`/tasks/${encodeURIComponent(taskId)}/observability-summary`),
      ]);

      return toTaskDetailScreenModel({
        summary,
        history,
        telemetry,
        historyFilters: options.filters,
      });
    },
  };
}

module.exports = {
  buildHistoryQuery,
  createTaskDetailApiClient,
  parseJsonResponse,
  toHistoryTimelineItem,
  toTaskDetailScreenModel,
  toTelemetryCards,
  toneForHistoryEvent,
};
