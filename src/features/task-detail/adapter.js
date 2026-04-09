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

function toneForHistoryEvent(eventType = '') {
  if (/failed|error|rejected|blocked/i.test(eventType)) return 'danger';
  if (/warning|stale|degraded/i.test(eventType)) return 'warning';
  if (/created|queued|started|assigned|comment/i.test(eventType)) return 'info';
  if (/completed|resolved|approved|done|closed/i.test(eventType)) return 'success';
  return 'neutral';
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

function deriveTelemetryFreshness(summary = {}) {
  const freshnessStatus = String(summary.freshness?.status || '').toLowerCase() || 'unknown';
  const lastUpdatedAt = summary.last_updated_at || summary.freshness?.last_updated_at || null;
  const isWarning = summary.stale || freshnessStatus === 'stale' || freshnessStatus === 'degraded';

  return {
    value: freshnessStatus,
    hint: lastUpdatedAt || 'No telemetry timestamp available.',
    tone: isWarning ? 'warning' : freshnessStatus === 'fresh' ? 'success' : 'neutral',
    isWarning,
  };
}

function toTelemetryCards(summary) {
  const restrictedHint = summary.access?.omission_applied
    ? `Restricted server-side fields omitted: ${(summary.access.omitted_fields || []).join(', ') || 'none'}`
    : undefined;
  const freshness = deriveTelemetryFreshness(summary);

  return [
    { id: 'telemetry-status', label: 'Status', value: summary.status, hint: summary.degraded ? 'Backend marked the task telemetry as degraded.' : restrictedHint, tone: summary.degraded ? 'warning' : 'info' },
    { id: 'telemetry-freshness', label: 'Freshness', value: freshness.value, hint: freshness.hint, tone: freshness.tone },
    { id: 'telemetry-event-count', label: 'Event count', value: String(summary.event_count ?? 0), hint: 'Telemetry stays on this tab; workflow history remains separate.', tone: 'neutral' },
    { id: 'telemetry-correlation', label: 'Approved correlations', value: String(summary.correlation?.approved_correlation_ids?.length || 0), hint: summary.access?.restricted ? 'Only approved correlation pointers are exposed for this access scope.' : 'Operator scope includes expanded telemetry references.', tone: summary.access?.restricted ? 'info' : 'success' },
  ];
}

function toTaskDetailScreenModel({ summary, history, telemetry, historyFilters, detail }) {
  if (detail) {
    const historyItems = (detail.activity?.auditLog || []).map((item) => ({
      id: item.id,
      title: item.summary,
      timestampLabel: item.occurredAt,
      actorLabel: item.actor?.label,
      statusTone: toneForHistoryEvent(item.type),
      metadata: item.type ? [{ label: 'Event', value: item.type }] : [],
    }));

    return {
      summary: {
        taskId: detail.task.id,
        tenantId: summary?.tenant_id || null,
        title: detail.task.title,
        priority: detail.task.priority,
        currentStage: detail.task.stage,
        currentOwner: detail.summary?.owner?.id || null,
        blocked: detail.task.status === 'blocked',
        waitingState: detail.summary?.blockedState?.waitingOn || null,
        nextRequiredAction: detail.summary?.nextAction?.label || null,
        freshness: detail.meta?.freshness ? { status: detail.meta.freshness.status, last_updated_at: detail.meta.freshness.lastUpdatedAt } : null,
        statusIndicator: detail.task.status,
        closed: detail.task.status === 'done',
        businessContext: detail.context?.businessContext || null,
        acceptanceCriteria: detail.context?.acceptanceCriteria || [],
        definitionOfDone: detail.context?.definitionOfDone || [],
        taskType: null,
      },
      detail,
      shell: {
        selectedTab: 'history',
        filters: historyFilters || {},
        historyState: historyItems.length ? { kind: 'ready' } : { kind: 'empty', message: 'No workflow history has been recorded yet.' },
        telemetryState: detail.telemetry?.availability === 'error'
          ? { kind: 'error', message: detail.telemetry.emptyStateReason || 'Telemetry unavailable.' }
          : detail.telemetry?.availability === 'stale' || deriveTelemetryFreshness({ freshness: { status: detail.meta?.freshness?.status, last_updated_at: detail.meta?.freshness?.lastUpdatedAt }, last_updated_at: detail.telemetry?.lastUpdatedAt }).isWarning
            ? { kind: 'degraded', message: 'Telemetry freshness is degraded.', detail: detail.telemetry?.lastUpdatedAt || detail.meta?.freshness?.lastUpdatedAt || undefined }
            : detail.telemetry?.availability === 'restricted'
              ? { kind: 'restricted', message: 'Telemetry is restricted for this session.' }
              : { kind: 'ready' },
        historyItems,
        telemetryCards: toTelemetryCards({
          status: detail.telemetry?.availability === 'stale' ? 'degraded' : 'ok',
          degraded: detail.telemetry?.availability === 'stale',
          stale: detail.telemetry?.availability === 'stale',
          event_count: historyItems.length,
          last_updated_at: detail.telemetry?.lastUpdatedAt,
          freshness: { status: detail.meta?.freshness?.status || 'unknown', last_updated_at: detail.meta?.freshness?.lastUpdatedAt || null },
          correlation: { approved_correlation_ids: [], approved_links: [] },
          access: detail.telemetry?.access || { restricted: false },
        }),
        historyPageInfo: null,
        telemetryAccess: detail.telemetry?.access || null,
      },
    };
  }

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
      businessContext: summary.business_context,
      acceptanceCriteria: summary.acceptance_criteria,
      definitionOfDone: summary.definition_of_done,
      taskType: summary.task_type,
    },
    detail: null,
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
  const request = async (path, init = {}) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: init.method || 'GET',
      headers: { ...(typeof getHeaders === 'function' ? await getHeaders() : undefined), ...(init.headers || {}) },
      body: init.body,
    });
    return parseJsonResponse(response);
  };

  return {
    fetchTaskSummary(taskId) { return request(`/tasks/${encodeURIComponent(taskId)}`); },
    fetchTaskList() { return request('/tasks'); },
    fetchTaskHistory(taskId, { filters, pagination, range } = {}) {
      const query = buildHistoryQuery(filters, pagination, range).toString();
      return request(`/tasks/${encodeURIComponent(taskId)}/history${query ? `?${query}` : ''}`);
    },
    fetchObservabilitySummary(taskId) { return request(`/tasks/${encodeURIComponent(taskId)}/observability-summary`); },
    askReviewQuestion(taskId, payload) {
      return request(`/tasks/${encodeURIComponent(taskId)}/review-questions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    answerReviewQuestion(taskId, questionId, payload) {
      return request(`/tasks/${encodeURIComponent(taskId)}/review-questions/${encodeURIComponent(questionId)}/answers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    resolveReviewQuestion(taskId, questionId, payload) {
      return request(`/tasks/${encodeURIComponent(taskId)}/review-questions/${encodeURIComponent(questionId)}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    reopenReviewQuestion(taskId, questionId, payload) {
      return request(`/tasks/${encodeURIComponent(taskId)}/review-questions/${encodeURIComponent(questionId)}/reopen`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    submitArchitectHandoff(taskId, payload) {
      return request(`/tasks/${encodeURIComponent(taskId)}/architect-handoff`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    fetchAssignableAgents() { return request('/ai-agents'); },
    assignTaskOwner(taskId, agentId) {
      return request(`/tasks/${encodeURIComponent(taskId)}/assignment`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId }) });
    },
    changeTaskStage(taskId, toStage, payload = {}) {
      return request(`/tasks/${encodeURIComponent(taskId)}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventType: 'task.stage_changed', payload: { to_stage: toStage, ...payload } }) });
    },
    async fetchTaskDetailScreenData(taskId, options = {}) {
      try {
        const detail = await request(`/tasks/${encodeURIComponent(taskId)}/detail`);
        return toTaskDetailScreenModel({ summary: { task_id: detail.task?.id, title: detail.task?.title, priority: detail.task?.priority, current_stage: detail.task?.stage }, history: { items: detail.activity?.auditLog || [], page_info: null }, telemetry: null, historyFilters: options.filters, detail });
      } catch (error) {
        if (error?.status && error.status !== 404) throw error;
      }

      const [summary, history, telemetry] = await Promise.all([
        request(`/tasks/${encodeURIComponent(taskId)}`),
        this.fetchTaskHistory(taskId, options),
        request(`/tasks/${encodeURIComponent(taskId)}/observability-summary`),
      ]);
      return toTaskDetailScreenModel({ summary, history, telemetry, historyFilters: options.filters });
    },
  };
}

module.exports = {
  buildHistoryQuery,
  createTaskDetailApiClient,
  parseJsonResponse,
  toHistoryTimelineItem,
  toTaskDetailScreenModel,
  deriveTelemetryFreshness,
  toTelemetryCards,
  toneForHistoryEvent,
};
