const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHistoryQuery,
  createTaskDetailApiClient,
  deriveTelemetryFreshness,
  deriveTelemetryState,
  parseJsonResponse,
  toTaskDetailScreenModel,
} = require('../../src/features/task-detail/adapter');

test('buildHistoryQuery only emits canonical history contract params', () => {
  const query = buildHistoryQuery(
    { eventType: 'task.created', actorId: 'pm-1', dateFrom: '2026-04-01', dateTo: '2026-04-02' },
    { limit: 25, cursor: 3 },
    { dateFrom: '2026-04-01', dateTo: '2026-04-02' },
  );

  assert.equal(query.get('eventType'), 'task.created');
  assert.equal(query.get('actorId'), 'pm-1');
  assert.equal(query.get('limit'), '25');
  assert.equal(query.get('cursor'), '3');
  assert.equal(query.get('dateFrom'), '2026-04-01');
  assert.equal(query.get('dateTo'), '2026-04-02');
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

  assert.deepEqual(calls, ['http://audit.local/tasks/TSK-1/detail?eventType=task.stage_changed']);
  assert.equal(model.summary.title, 'Wire task detail');
  assert.equal(model.detail.task.id, 'TSK-1');
  assert.equal(model.shell.historyItems[0].title, 'Stage changed');
});

test('task detail client surfaces auth failures through the shared auth callback', async () => {
  let authFailure = null;
  const client = createTaskDetailApiClient({
    baseUrl: 'http://audit.local',
    onAuthFailure: (error) => {
      authFailure = error;
    },
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: {
          code: 'invalid_token',
          message: 'jwt expired',
        },
      }),
    }),
  });

  await assert.rejects(() => client.fetchTaskList(), /jwt expired/);
  assert.equal(authFailure.status, 401);
  assert.equal(authFailure.code, 'invalid_token');
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
      if (url.includes('/detail')) {
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
    'http://audit.local/tasks/TSK-1/detail?eventType=task.stage_changed',
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

test('task detail client preserves orchestration read-model payloads from the dedicated endpoint', async () => {
  const client = createTaskDetailApiClient({
    baseUrl: 'http://audit.local',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        task: { id: 'TSK-77', title: 'Orchestrated parent', priority: 'P1', stage: 'IMPLEMENT', status: 'active' },
        summary: {
          owner: { id: 'pm-1', label: 'PM 1' },
          workflowStage: { value: 'IMPLEMENT', label: 'Implement' },
          nextAction: { label: 'Start ready child work', source: 'system', overdue: false, waitingOn: null },
          prStatus: { label: '0 linked PRs', state: 'empty', total: 0 },
          childStatus: { label: '3 linked child tasks', state: 'mixed', total: 3, blockedCount: 1 },
          timers: { queueEnteredAt: null, queueAgeLabel: '5m', lastUpdatedAt: '2026-04-19T10:00:00.000Z', freshness: 'fresh' },
          blockedState: { isBlocked: false, label: 'Active', waitingOn: null },
        },
        blockers: [],
        context: { businessContext: 'Context', acceptanceCriteria: ['A'], definitionOfDone: ['B'], technicalSpec: null, monitoringSpec: null, pmBusinessContextReview: { completedAt: null, completedBy: null, finalized: false } },
        relations: { linkedPrs: [], childTasks: [], parentTask: null },
        activity: { comments: [], auditLog: [] },
        telemetry: { availability: 'available', lastUpdatedAt: '2026-04-19T10:00:00.000Z', summary: {}, emptyStateReason: null, access: { restricted: false } },
        orchestration: {
          planner: {
            summary: { total: 3, readyCount: 1, blockedCount: 1, inProgressCount: 0, doneCount: 1, invalidCount: 0 },
            readyWork: [{ id: 'TSK-CHILD-2', title: 'Ready work item', taskType: 'qa', dependsOn: [] }],
            items: [],
          },
          run: {
            runId: 'run-77',
            state: 'active',
            startedAt: '2026-04-19T10:00:00.000Z',
            updatedAt: '2026-04-19T10:01:00.000Z',
            coordinatorAgent: 'pm-1',
            summary: { total: 3, readyCount: 1, runningCount: 1, blockedCount: 1, failedCount: 0, completedCount: 0 },
            items: [
              { id: 'TSK-CHILD-2', title: 'Ready work item', state: 'running', dependencyState: 'ready', dependsOn: [], blockers: [] },
            ],
          },
        },
        meta: {
          permissions: {
            canViewComments: true,
            canViewAuditLog: true,
            canViewTelemetry: true,
            canViewChildTasks: true,
            canViewLinkedPrMetadata: true,
            canViewOrchestration: true,
          },
          freshness: { status: 'fresh', lastUpdatedAt: '2026-04-19T10:01:00.000Z', liveUpdates: false, refreshBehavior: 'manual' },
        },
      }),
    }),
  });

  const model = await client.fetchTaskDetailScreenData('TSK-77');

  assert.equal(model.detail.orchestration.run.runId, 'run-77');
  assert.equal(model.detail.orchestration.planner.summary.readyCount, 1);
  assert.equal(model.detail.meta.permissions.canViewOrchestration, true);
});

test('detail endpoint non-404 failures do not fan out into legacy fallback requests', async () => {
  const calls = [];
  const client = createTaskDetailApiClient({
    baseUrl: 'http://audit.local',
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('/detail')) {
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

test('task detail client submits engineer metadata to the dedicated endpoint', async () => {
  const calls = [];
  const client = createTaskDetailApiClient({
    baseUrl: 'http://audit.local',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ success: true }) };
    },
  });

  await client.submitEngineerSubmission('TSK-89', {
    commitSha: 'abc1234',
    prUrl: 'https://github.com/acme/platform/pull/42',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://audit.local/tasks/TSK-89/engineer-submission');
  assert.equal(calls[0].init.method, 'PUT');
});

test('task detail client submits reassignment workflow actions to dedicated endpoints', async () => {
  const calls = [];
  const client = createTaskDetailApiClient({
    baseUrl: 'http://audit.local',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ success: true }) };
    },
  });

  await client.requestSkillEscalation('TSK-90', { reason: 'Needs higher-tier support.' });
  await client.recordEngineerCheckIn('TSK-90', { summary: 'Progress update', evidence: ['note-1'] });
  await client.retierTask('TSK-90', { engineerTier: 'Sr', tierRationale: 'Cross-service change.' });
  await client.reassignTask('TSK-90', { mode: 'inactivity', reason: 'Missed two check-ins.' });

  assert.deepEqual(calls.map((entry) => entry.url), [
    'http://audit.local/tasks/TSK-90/skill-escalation',
    'http://audit.local/tasks/TSK-90/check-ins',
    'http://audit.local/tasks/TSK-90/retier',
    'http://audit.local/tasks/TSK-90/reassignment',
  ]);
  assert.ok(calls.every((entry) => entry.init.method === 'POST'));
});

test('task detail client submits SRE monitoring workflow actions to dedicated endpoints', async () => {
  const calls = [];
  const client = createTaskDetailApiClient({
    baseUrl: 'http://audit.local',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ success: true }) };
    },
  });

  await client.startSreMonitoring('TSK-91', {
    deploymentEnvironment: 'production',
    deploymentUrl: 'https://deploy.example/releases/42',
    deploymentVersion: '2026.04.14-1',
  });
  await client.approveSreMonitoring('TSK-91', {
    reason: 'Telemetry stayed stable across the first hour.',
    evidence: ['metrics steady', 'error budget unchanged'],
  });
  await client.createMonitoringAnomalyChildTask('TSK-91', {
    title: 'Investigate checkout-api anomaly for TSK-91',
    service: 'checkout-api',
    anomalySummary: 'Error rate spiked after deployment.',
    metrics: ['5xx_rate: 8%'],
    logs: ['checkout-api pod restart loop'],
    errorSamples: ['TimeoutError at /checkout'],
  });
  await client.completePmBusinessContext('TSK-91', {
    businessContext: 'PM reviewed the anomaly and confirmed customer impact.',
  });

  assert.deepEqual(calls.map((entry) => entry.url), [
    'http://audit.local/tasks/TSK-91/sre-monitoring/start',
    'http://audit.local/tasks/TSK-91/sre-monitoring/approve',
    'http://audit.local/tasks/TSK-91/sre-monitoring/anomaly-child-task',
    'http://audit.local/tasks/TSK-91/pm-business-context',
  ]);
  assert.ok(calls.every((entry) => entry.init.method === 'POST'));
});

test('task detail client submits close-review workflow actions to dedicated endpoints', async () => {
  const calls = [];
  const client = createTaskDetailApiClient({
    baseUrl: 'http://audit.local',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ success: true }) };
    },
  });

  await client.submitCloseCancellationRecommendation('TSK-92', {
    summary: 'PM recommends cancellation because the release window closed.',
    rationale: 'Business timing no longer supports release.',
  });
  await client.submitExceptionalDispute('TSK-92', {
    summary: 'PM disputes whether cancellation is safer than reopening implementation.',
    recommendation: 'Review the dispute and decide whether to cancel or reopen implementation.',
    rationale: 'The tradeoff remains contested after close-review discussion.',
    severity: 'high',
  });
  await client.submitHumanCloseDecision('TSK-92', {
    outcome: 'request_more_context',
    summary: 'Need the remediation timeline before deciding.',
    rationale: 'Decision deferred pending more delivery context.',
    confirmationRequired: true,
  });
  await client.submitCloseReviewBacktrack('TSK-92', {
    reasonCode: 'criteria_gap',
    rationale: 'The close gate failed and implementation must resume.',
    agreementArtifact: 'pm+architect-close-review-2026-04-15',
  });

  assert.deepEqual(calls.map((entry) => entry.url), [
    'http://audit.local/tasks/TSK-92/close-review/cancellation-recommendation',
    'http://audit.local/tasks/TSK-92/close-review/exceptional-dispute',
    'http://audit.local/tasks/TSK-92/close-review/human-decision',
    'http://audit.local/tasks/TSK-92/close-review/backtrack',
  ]);
  assert.ok(calls.every((entry) => entry.init.method === 'POST'));
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
  assert.equal(model.shell.telemetryState.kind, 'restricted');
  assert.equal(model.shell.telemetryAccess.restricted, true);
  assert.match(model.shell.telemetryCards[0].hint, /Restricted server-side fields omitted/);
});

test('deriveTelemetryState returns restricted for summary-only telemetry access', () => {
  const state = deriveTelemetryState({
    event_count: 0,
    access: { restricted: true, omission_applied: true, omitted_fields: ['trace_ids'] },
  });

  assert.equal(state.kind, 'restricted');
  assert.match(state.detail, /trace_ids/);
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
