const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHistoryQuery,
  createTaskDetailApiClient,
  deriveTelemetryFreshness,
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

test('task detail client prefers dedicated detail view model endpoint when available', async () => {
  const calls = [];
  const client = createTaskDetailApiClient({
    baseUrl: 'http://audit.local',
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({
          task: { id: 'TSK-1', title: 'Wire task detail', priority: 'P1', stage: 'IN_PROGRESS', status: 'active' },
          summary: {
            owner: { id: 'eng-1', label: 'eng-1' },
            workflowStage: { value: 'IN_PROGRESS', label: 'In progress' },
            nextAction: { label: 'Keep shipping', source: 'system' },
          },
          context: { businessContext: 'Context', acceptanceCriteria: ['A'], definitionOfDone: ['B'] },
          activity: { auditLog: [{ id: 'evt-2', type: 'task.stage_changed', summary: 'Stage changed', actor: { label: 'Engineer 1' }, occurredAt: '2026-04-01T11:00:00.000Z' }] },
          telemetry: { availability: 'available', lastUpdatedAt: '2026-04-01T12:00:00.000Z', access: { restricted: false } },
          meta: { freshness: { status: 'fresh', lastUpdatedAt: '2026-04-01T12:00:00.000Z' } },
        }),
      };
    },
  });

  const model = await client.fetchTaskDetailScreenData('TSK-1', { filters: { eventType: 'task.stage_changed' } });

  assert.deepEqual(calls, ['http://audit.local/tasks/TSK-1/detail']);
  assert.equal(model.summary.title, 'Wire task detail');
  assert.equal(model.detail.task.id, 'TSK-1');
  assert.equal(model.shell.historyItems[0].title, 'Stage changed');
});


test('dedicated detail payload avoids extra linked-resource fetches and caps request count at one', async () => {
  let requestCount = 0;
  const client = createTaskDetailApiClient({
    baseUrl: 'http://audit.local',
    fetchImpl: async (url) => {
      requestCount += 1;
      assert.equal(url, 'http://audit.local/tasks/TSK-99/detail');
      return {
        ok: true,
        json: async () => ({
          task: { id: 'TSK-99', title: 'Avoid N+1 detail fetches', priority: 'P1', stage: 'VERIFY', status: 'active' },
          summary: {
            owner: { id: 'qa-1', label: 'QA 1' },
            workflowStage: { value: 'VERIFY', label: 'Verify' },
            nextAction: { label: 'Review the linked artifacts', source: 'system' },
            prStatus: { label: '2 linked PRs', state: 'active', total: 2 },
            childStatus: { label: '3 linked child tasks', state: 'waiting', total: 3 },
          },
          context: { technicalSpec: 'Spec', monitoringSpec: 'Monitoring' },
          relations: {
            linkedPrs: [
              { id: 'pr-1', number: 1, title: 'feat: one' },
              { id: 'pr-2', number: 2, title: 'feat: two' },
            ],
            childTasks: [
              { id: 'TSK-1', title: 'Child 1' },
              { id: 'TSK-2', title: 'Child 2' },
              { id: 'TSK-3', title: 'Child 3' },
            ],
          },
          activity: { auditLog: [] },
          telemetry: { availability: 'available', lastUpdatedAt: '2026-04-01T12:00:00.000Z', access: { restricted: false } },
          meta: { freshness: { status: 'fresh', lastUpdatedAt: '2026-04-01T12:00:00.000Z' } },
        }),
      };
    },
  });

  const model = await client.fetchTaskDetailScreenData('TSK-99');

  assert.equal(requestCount, 1);
  assert.equal(model.detail.relations.linkedPrs.length, 2);
  assert.equal(model.detail.relations.childTasks.length, 3);
});

test('task detail client falls back to legacy endpoints when dedicated detail endpoint is unavailable', async () => {
  const calls = [];
  const client = createTaskDetailApiClient({
    baseUrl: 'http://audit.local',
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith('/detail')) {
        return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
      }
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
    'http://audit.local/tasks/TSK-1/detail',
    'http://audit.local/tasks/TSK-1',
    'http://audit.local/tasks/TSK-1/history?eventType=task.stage_changed',
    'http://audit.local/tasks/TSK-1/observability-summary',
  ]);
  assert.equal(model.summary.title, 'Wire task detail');
  assert.equal(model.shell.historyState.kind, 'ready');
  assert.equal(model.shell.historyItems[0].title, 'Stage changed');
  assert.equal(model.shell.telemetryCards[2].label, 'Event count');
});

test('task detail screen model keeps linked PR and spec detail from dedicated endpoint payload', async () => {
  const client = createTaskDetailApiClient({
    baseUrl: 'http://audit.local',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        task: { id: 'TSK-7', title: 'Projection task', priority: 'P1', stage: 'IMPLEMENT', status: 'active' },
        summary: {
          owner: { id: 'eng-1', label: 'eng-1' },
          workflowStage: { value: 'IMPLEMENT', label: 'Implement' },
          nextAction: { label: 'Merge linked PR', source: 'system' },
          prStatus: { label: '1 open PR linked', state: 'active', total: 1 },
          childStatus: { label: '2 linked child tasks', state: 'waiting', total: 2, blockedCount: 0 },
        },
        context: { technicalSpec: 'Spec is present', monitoringSpec: 'Dashboards + alerts' },
        relations: { linkedPrs: [{ id: 'pr-12', number: 12, title: 'feat: task detail', state: 'open', merged: false, draft: false }], childTasks: [] },
        activity: { auditLog: [] },
        telemetry: { availability: 'available', lastUpdatedAt: '2026-04-01T12:00:00.000Z', access: { restricted: false } },
        meta: {
          permissions: { canViewLinkedPrMetadata: true },
          freshness: { status: 'fresh', lastUpdatedAt: '2026-04-01T12:00:00.000Z' },
        },
      }),
    }),
  });

  const model = await client.fetchTaskDetailScreenData('TSK-7');

  assert.equal(model.detail.context.technicalSpec, 'Spec is present');
  assert.equal(model.detail.context.monitoringSpec, 'Dashboards + alerts');
  assert.equal(model.detail.meta.permissions.canViewLinkedPrMetadata, true);
  assert.equal(model.detail.relations.linkedPrs[0].number, 12);
  assert.equal(model.detail.summary.prStatus.label, '1 open PR linked');
});

test('detail endpoint non-404 failures do not fan out into legacy fallback requests', async () => {
  const calls = [];
  const client = createTaskDetailApiClient({
    baseUrl: 'http://audit.local',
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith('/detail')) {
        return { ok: false, status: 503, json: async () => ({ error: { message: 'projection unavailable' } }) };
      }
      throw new Error(`unexpected fallback call: ${url}`);
    },
  });

  await assert.rejects(() => client.fetchTaskDetailScreenData('TSK-503'), /projection unavailable/);
  assert.deepEqual(calls, ['http://audit.local/tasks/TSK-503/detail']);
});

test('task detail client submits architect handoff payloads to the dedicated endpoint', async () => {
  const calls = [];
  const client = createTaskDetailApiClient({
    baseUrl: 'http://audit.local',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ success: true }) };
    },
  });

  await client.submitArchitectHandoff('TSK-88', {
    readyForEngineering: true,
    engineerTier: 'Sr',
    tierRationale: 'Standard scope.',
    technicalSpec: { summary: 'a', scope: 'b', design: 'c', rolloutPlan: 'd' },
    monitoringSpec: { service: 'svc', dashboardUrls: 'x', alertPolicies: 'y', runbook: 'z', successMetrics: 'm' },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://audit.local/tasks/TSK-88/architect-handoff');
  assert.equal(calls[0].init.method, 'PUT');
});

test('deriveTelemetryFreshness promotes fresh and stale signals from freshness metadata', () => {
  assert.deepEqual(
    deriveTelemetryFreshness({ freshness: { status: 'fresh', last_updated_at: '2026-04-01T12:00:00.000Z' } }),
    {
      value: 'fresh',
      hint: '2026-04-01T12:00:00.000Z',
      tone: 'success',
      isWarning: false,
    },
  );

  assert.deepEqual(
    deriveTelemetryFreshness({ freshness: { status: 'stale', last_updated_at: '2026-04-01T11:00:00.000Z' } }),
    {
      value: 'stale',
      hint: '2026-04-01T11:00:00.000Z',
      tone: 'warning',
      isWarning: true,
    },
  );
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

test('detail screen degrades telemetry state from freshness metadata even when availability stays available', () => {
  const model = toTaskDetailScreenModel({
    summary: { task_id: 'TSK-3', tenant_id: 'tenant-a', title: 'Freshness lag', priority: 'P2', current_stage: 'IMPLEMENT', current_owner: 'eng-1', blocked: false, waiting_state: null, next_required_action: null, freshness: { status: 'stale', last_updated_at: '2026-04-01T10:00:00.000Z' }, status_indicator: 'active', closed: false },
    history: { items: [], page_info: null },
    telemetry: null,
    historyFilters: {},
    detail: {
      task: { id: 'TSK-3', title: 'Freshness lag', priority: 'P2', stage: 'IMPLEMENT', status: 'active' },
      summary: {},
      context: {},
      activity: { auditLog: [] },
      telemetry: { availability: 'available', lastUpdatedAt: '2026-04-01T10:00:00.000Z', access: { restricted: false } },
      meta: { freshness: { status: 'stale', lastUpdatedAt: '2026-04-01T10:00:00.000Z' } },
    },
  });

  assert.equal(model.shell.telemetryState.kind, 'degraded');
  assert.equal(model.shell.telemetryState.message, 'Telemetry freshness is degraded.');
  assert.equal(model.shell.telemetryCards[1].value, 'stale');
  assert.equal(model.shell.telemetryCards[1].tone, 'warning');
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
