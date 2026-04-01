const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHistoryQuery,
  createTaskDetailApiClient,
  parseJsonResponse,
  toTaskDetailScreenModel,
} = require('../../src/features/task-detail/adapter');

test('buildHistoryQuery only emits canonical history contract params', () => {
  const query = buildHistoryQuery(
    { eventType: 'task.created', actorId: 'pm-1', range: 'today' },
    { limit: 25, cursor: 3 },
    { from: '2026-04-01T00:00:00.000Z', to: '2026-04-02T00:00:00.000Z' },
  );

  assert.equal(query.get('eventType'), 'task.created');
  assert.equal(query.get('actorId'), 'pm-1');
  assert.equal(query.get('limit'), '25');
  assert.equal(query.get('cursor'), '3');
  assert.equal(query.get('from'), '2026-04-01T00:00:00.000Z');
  assert.equal(query.get('to'), '2026-04-02T00:00:00.000Z');
  assert.equal(query.has('historyRange'), false);
});

test('task detail client calls #27 endpoints without mixing telemetry into history', async () => {
  const calls = [];
  const client = createTaskDetailApiClient({
    baseUrl: 'http://audit.local',
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith('/observability-summary')) {
        return { ok: true, json: async () => ({ task_id: 'TSK-1', tenant_id: 'tenant-a', status: 'ok', degraded: false, event_count: 2, last_updated_at: '2026-04-01T12:00:00.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T12:00:00.000Z' }, correlation: { approved_correlation_ids: ['corr-1'], approved_links: [] }, access: { restricted: true, scope: 'summary_only', omission_applied: true, omitted_fields: ['trace_ids'] } }) };
      }
      if (url.includes('/history')) {
        return { ok: true, json: async () => ({ items: [{ item_id: 'evt-2', event_id: 'evt-2', event_type: 'task.stage_changed', event_type_label: 'task.stage_changed', occurred_at: '2026-04-01T11:00:00.000Z', actor: { actor_id: 'eng-1', actor_type: 'user', display_name: 'Engineer 1' }, actor_id: 'eng-1', actor_type: 'user', sequence_number: 2, summary: 'Stage changed', display: { summary: 'Stage changed', event_type_label: 'task.stage_changed', is_known_type: true, fallback_used: false }, source: 'http' }], page_info: { limit: 25, next_cursor: null, has_more: false } }) };
      }
      return { ok: true, json: async () => ({ task_id: 'TSK-1', tenant_id: 'tenant-a', title: 'Wire task detail', priority: 'P1', current_stage: 'IN_PROGRESS', current_owner: 'eng-1', blocked: false, waiting_state: null, next_required_action: null, freshness: { status: 'fresh', last_updated_at: '2026-04-01T12:00:00.000Z' }, status_indicator: 'fresh', closed: false }) };
    },
  });

  const model = await client.fetchTaskDetailScreenData('TSK-1', { filters: { eventType: 'task.stage_changed' } });

  assert.deepEqual(calls, [
    'http://audit.local/tasks/TSK-1',
    'http://audit.local/tasks/TSK-1/history?eventType=task.stage_changed',
    'http://audit.local/tasks/TSK-1/observability-summary',
  ]);
  assert.equal(model.summary.title, 'Wire task detail');
  assert.equal(model.shell.historyState.kind, 'ready');
  assert.equal(model.shell.historyItems[0].title, 'Stage changed');
  assert.equal(model.shell.telemetryCards[2].label, 'Event count');
});

test('screen model preserves restricted telemetry as server-enforced access metadata', () => {
  const model = toTaskDetailScreenModel({
    summary: {
      task_id: 'TSK-2',
      tenant_id: 'tenant-a',
      title: 'Restricted telemetry',
      priority: 'P2',
      current_stage: 'BACKLOG',
      current_owner: 'eng-2',
      blocked: false,
      waiting_state: null,
      next_required_action: null,
      freshness: { status: 'fresh', last_updated_at: '2026-04-01T10:00:00.000Z' },
      status_indicator: 'fresh',
      closed: false,
    },
    history: { items: [], page_info: { limit: 25, next_cursor: null, has_more: false } },
    telemetry: {
      task_id: 'TSK-2',
      tenant_id: 'tenant-a',
      status: 'ok',
      degraded: false,
      event_count: 0,
      last_updated_at: '2026-04-01T10:00:00.000Z',
      freshness: { status: 'fresh', last_updated_at: '2026-04-01T10:00:00.000Z' },
      correlation: { approved_correlation_ids: [], approved_links: [] },
      access: { restricted: true, scope: 'summary_only', omission_applied: true, omitted_fields: ['trace_ids', 'metrics'] },
    },
    historyFilters: {},
  });

  assert.equal(model.shell.historyState.kind, 'empty');
  assert.equal(model.shell.telemetryState.kind, 'ready');
  assert.equal(model.shell.telemetryAccess.restricted, true);
  assert.match(model.shell.telemetryCards[0].hint, /Restricted server-side fields omitted/);
});

test('parseJsonResponse throws standardized API errors', async () => {
  await assert.rejects(
    () => parseJsonResponse({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'forbidden', message: 'missing permission: observability:read', request_id: 'req-1', details: { permission: 'observability:read' } } }),
    }),
    (error) => {
      assert.equal(error.code, 'forbidden');
      assert.equal(error.status, 403);
      assert.equal(error.requestId, 'req-1');
      return true;
    },
  );
});
