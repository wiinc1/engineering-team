const test = require('node:test');
const assert = require('node:assert/strict');
const { toTaskDetailScreenModel } = require('../../src/features/task-detail/adapter');

const modulePromise = import('../../src/features/task-detail/next-action.mjs');

function detailPayload(overrides = {}) {
  return {
    task: {
      id: 'TSK-153',
      title: 'Task detail next action',
      priority: 'P1',
      stage: overrides.stage || 'QA_TESTING',
      status: overrides.status || 'active',
    },
    summary: {
      owner: overrides.owner || { id: 'qa', label: 'QA Engineer', kind: 'assigned' },
      workflowStage: { value: overrides.stage || 'QA_TESTING', label: overrides.stage || 'QA Testing' },
      nextAction: overrides.nextAction || { label: 'QA verification required', source: 'system' },
      blockedState: { isBlocked: Boolean(overrides.blocked), waitingOn: overrides.waitingOn || null },
      timers: { queueAgeLabel: '5m', freshness: overrides.freshness || 'fresh', lastUpdatedAt: '2026-05-15T10:00:00.000Z' },
    },
    context: overrides.context || { businessContext: 'Context', acceptanceCriteria: ['A'], definitionOfDone: ['B'] },
    activity: { auditLog: [], auditLogPageInfo: { limit: 25, next_cursor: null, has_more: false } },
    telemetry: { availability: 'available', lastUpdatedAt: '2026-05-15T10:00:00.000Z', access: { restricted: false } },
    meta: { freshness: { status: overrides.freshness || 'fresh', lastUpdatedAt: '2026-05-15T10:00:00.000Z' }, permissions: {} },
  };
}

function modelFromDetail(detail) {
  return toTaskDetailScreenModel({
    summary: { task_id: detail.task.id, title: detail.task.title, priority: detail.task.priority, current_stage: detail.task.stage },
    history: { items: [], page_info: null },
    telemetry: null,
    historyFilters: {},
    detail,
  });
}

test('integration: derives QA next action from the existing task detail read model', async () => {
  const { resolveTaskDetailNextAction } = await modulePromise;
  const model = modelFromDetail(detailPayload());
  const result = resolveTaskDetailNextAction(model, { roles: ['qa', 'reader'] });
  assert.equal(result.action, 'qa_verification');
  assert.equal(result.statusFacts.find((fact) => fact.label === 'Owner').value, 'QA Engineer');
});

test('integration: derives SRE action from embedded monitoring context without a new API field', async () => {
  const { resolveTaskDetailNextAction } = await modulePromise;
  const detail = detailPayload({
    stage: 'SRE_MONITORING',
    nextAction: { label: 'SRE monitoring validation is required.', source: 'system' },
    context: { sreMonitoring: { state: 'active', canStart: false, canApprove: true, timeRemainingLabel: '47h remaining' } },
  });
  const result = resolveTaskDetailNextAction(modelFromDetail(detail), { roles: ['sre'] });
  assert.equal(result.action, 'sre_monitoring');
  assert.equal(result.primaryHref, '#task-detail-sre-section');
});

test('integration: preserves restricted reader behavior when permissions omit sections', async () => {
  const { resolveTaskDetailNextAction } = await modulePromise;
  const detail = detailPayload({
    blocked: true,
    waitingOn: 'Child task TSK-200',
    nextAction: { label: 'Child task must close first.', source: 'relationship' },
  });
  detail.meta.permissions = { canViewTelemetry: false, canViewChildTasks: false };
  const result = resolveTaskDetailNextAction(modelFromDetail(detail), { roles: ['reader'] });
  assert.equal(result.action, 'read_only_status');
  assert.equal(result.controlsAvailable, false);
  assert.match(result.reason, /Child task/);
});
