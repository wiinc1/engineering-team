const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuditStore } = require('../../lib/audit');

function makeStore() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-store-'));
  return { baseDir, store: createAuditStore({ baseDir }) };
}

test('appends canonical events and updates projections', async () => {
  const { baseDir, store } = makeStore();

  const created = await store.appendEvent({
    taskId: 'TSK-100',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'create:TSK-100',
    payload: {
      title: 'Test task',
      priority: 'P1',
      initial_stage: 'BACKLOG',
      assignee: 'dev',
    },
    occurredAt: '2026-03-31T18:00:00.000Z',
  });

  const moved = await store.appendEvent({
    taskId: 'TSK-100',
    eventType: 'task.stage_changed',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'move:TSK-100:IN_PROGRESS',
    payload: {
      from_stage: 'BACKLOG',
      to_stage: 'IN_PROGRESS',
    },
    occurredAt: '2026-03-31T18:01:00.000Z',
  });

  assert.equal(created.duplicate, false);
  assert.equal(moved.duplicate, false);
  assert.equal(created.event.sequence_number, 1);
  assert.equal(moved.event.sequence_number, 2);

  const history = store.getTaskHistory('TSK-100');
  assert.equal(history.length, 2);
  assert.equal(history[0].event_type, 'task.stage_changed');
  assert.equal(history[1].event_type, 'task.created');

  const currentState = JSON.parse(fs.readFileSync(path.join(baseDir, 'data', 'task-current-state-projection.json'), 'utf8'));
  assert.equal(currentState['engineering-team::TSK-100'].current_stage, 'IN_PROGRESS');
  assert.equal(currentState['engineering-team::TSK-100'].priority, 'P1');

  const rawEvents = fs.readFileSync(path.join(baseDir, 'data', 'workflow-audit-events.jsonl'), 'utf8').trim().split('\n');
  assert.equal(rawEvents.length, 2);
});

test('deduplicates by idempotency key', async () => {
  const { store } = makeStore();
  const first = await store.appendEvent({
    taskId: 'TSK-101',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'create:TSK-101',
    payload: { title: 'Test task', initial_stage: 'BACKLOG' },
  });

  const duplicate = await store.appendEvent({
    taskId: 'TSK-101',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'create:TSK-101',
    payload: { title: 'Test task', initial_stage: 'BACKLOG' },
  });

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.event.event_id, first.event.event_id);
  assert.equal(store.getTaskHistory('TSK-101').length, 1);
});

test('scopes idempotency and file projections by tenant for the same task id', async () => {
  const { baseDir, store } = makeStore();

  const firstTenant = await store.appendEvent({
    taskId: 'TSK-SHARED',
    tenantId: 'tenant-a',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'create:TSK-SHARED',
    payload: { title: 'Tenant A', initial_stage: 'BACKLOG' },
  });
  const secondTenant = await store.appendEvent({
    taskId: 'TSK-SHARED',
    tenantId: 'tenant-b',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'create:TSK-SHARED',
    payload: { title: 'Tenant B', initial_stage: 'TODO' },
  });

  assert.equal(firstTenant.duplicate, false);
  assert.equal(secondTenant.duplicate, false);
  assert.notEqual(firstTenant.event.event_id, secondTenant.event.event_id);
  assert.equal(store.getTaskHistory('TSK-SHARED', { tenantId: 'tenant-a' }).length, 1);
  assert.equal(store.getTaskHistory('TSK-SHARED', { tenantId: 'tenant-b' }).length, 1);
  assert.equal(store.getTaskCurrentState('TSK-SHARED', { tenantId: 'tenant-a' }).current_stage, 'BACKLOG');
  assert.equal(store.getTaskCurrentState('TSK-SHARED', { tenantId: 'tenant-b' }).current_stage, 'TODO');

  const currentState = JSON.parse(fs.readFileSync(path.join(baseDir, 'data', 'task-current-state-projection.json'), 'utf8'));
  assert.deepEqual(Object.keys(currentState).sort(), ['tenant-a::TSK-SHARED', 'tenant-b::TSK-SHARED']);
});

test('records explicit audit write failures and history latency regressions in metrics', async () => {
  const { store } = makeStore();
  await assert.rejects(() => store.appendEvent({
    taskId: 'TSK-BAD',
    tenantId: 'tenant-a',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'principal-engineer',
  }), /idempotencyKey is required/);

  const metricsAfterWriteFailure = store.readMetrics();
  assert.equal(metricsAfterWriteFailure.workflow_audit_write_failures_total, 1);

  const thresholdBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-store-threshold-'));
  const thresholdStore = createAuditStore({ baseDir: thresholdBaseDir, historyLatencyRegressionThresholdMs: -1 });
  await thresholdStore.appendEvent({
    taskId: 'TSK-LAT',
    tenantId: 'tenant-a',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'create:TSK-LAT',
    payload: { title: 'Slow history', initial_stage: 'BACKLOG' },
  });
  const delayed = thresholdStore.getTaskHistory('TSK-LAT', { tenantId: 'tenant-a' });
  assert.equal(delayed.length, 1);
  const slowMetrics = thresholdStore.readMetrics();
  assert.equal(typeof slowMetrics.last_history_query_duration_ms, 'number');
  assert.equal(slowMetrics.workflow_history_query_latency_regressions_total >= 1, true);
});

test('supports history pagination via cursor + limit', async () => {
  const { store } = makeStore();
  for (let sequence = 1; sequence <= 3; sequence += 1) {
    await store.appendEvent({
      taskId: 'TSK-PAGE',
      tenantId: 'tenant-a',
      eventType: sequence === 1 ? 'task.created' : 'task.comment_workflow_recorded',
      actorType: 'agent',
      actorId: 'principal-engineer',
      idempotencyKey: `page:${sequence}`,
      payload: sequence === 1 ? { title: 'Paged task', initial_stage: 'BACKLOG' } : { comment_type: `note-${sequence}` },
    });
  }

  const firstPage = store.getTaskHistory('TSK-PAGE', { tenantId: 'tenant-a', limit: 2 });
  const secondPage = store.getTaskHistory('TSK-PAGE', { tenantId: 'tenant-a', cursor: firstPage.at(-1).sequence_number, limit: 2 });
  assert.deepEqual(firstPage.map(event => event.sequence_number), [3, 2]);
  assert.deepEqual(secondPage.map(event => event.sequence_number), [1]);
});

test('blocks architect handoff while blocking review questions remain unresolved', async () => {
  const { store } = makeStore();
  await store.appendEvent({
    taskId: 'TSK-RQ-BLOCK',
    tenantId: 'tenant-a',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'create:TSK-RQ-BLOCK',
    payload: { title: 'Architect review task', initial_stage: 'BACKLOG' },
  });
  await store.appendEvent({
    taskId: 'TSK-RQ-BLOCK',
    tenantId: 'tenant-a',
    eventType: 'task.stage_changed',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'move:TSK-RQ-BLOCK:ARCHITECT_REVIEW',
    payload: { from_stage: 'BACKLOG', to_stage: 'ARCHITECT_REVIEW' },
  });
  await store.appendEvent({
    taskId: 'TSK-RQ-BLOCK',
    tenantId: 'tenant-a',
    eventType: 'task.review_question_asked',
    actorType: 'user',
    actorId: 'architect-user',
    idempotencyKey: 'rq:TSK-RQ-BLOCK:1',
    payload: {
      question_id: 'rq-1',
      prompt: 'Clarify acceptance criteria',
      blocking: true,
      state: 'open',
      blocked: true,
      waiting_state: 'pm_review_question_resolution',
      next_required_action: 'Resolve blocking architect review questions',
    },
  });

  await assert.rejects(() => store.appendEvent({
    taskId: 'TSK-RQ-BLOCK',
    tenantId: 'tenant-a',
    eventType: 'task.stage_changed',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'move:TSK-RQ-BLOCK:TECHNICAL_SPEC',
    payload: { from_stage: 'ARCHITECT_REVIEW', to_stage: 'TECHNICAL_SPEC' },
  }), /blocking review questions remain unresolved/);

  await store.appendEvent({
    taskId: 'TSK-RQ-BLOCK',
    tenantId: 'tenant-a',
    eventType: 'task.review_question_resolved',
    actorType: 'user',
    actorId: 'pm-user',
    idempotencyKey: 'rq:TSK-RQ-BLOCK:1:resolved',
    payload: {
      question_id: 'rq-1',
      resolution: 'Approved',
      blocking: true,
      state: 'resolved',
      blocked: false,
      waiting_state: null,
      next_required_action: null,
    },
  });

  const result = await store.appendEvent({
    taskId: 'TSK-RQ-BLOCK',
    tenantId: 'tenant-a',
    eventType: 'task.stage_changed',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'move:TSK-RQ-BLOCK:TECHNICAL_SPEC:after',
    payload: { from_stage: 'ARCHITECT_REVIEW', to_stage: 'TECHNICAL_SPEC' },
  });
  assert.equal(result.duplicate, false);
});

test('filters history without mixing telemetry records', async () => {
  const { store } = makeStore();
  await store.appendEvent({
    taskId: 'TSK-102',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'create:TSK-102',
    payload: { title: 'Task', initial_stage: 'BACKLOG' },
    occurredAt: '2026-03-31T18:00:00.000Z',
  });
  await store.appendEvent({
    taskId: 'TSK-102',
    eventType: 'task.assigned',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'assign:TSK-102',
    payload: { assignee: 'qa' },
    occurredAt: '2026-03-31T18:01:00.000Z',
  });
  await store.appendEvent({
    taskId: 'TSK-102',
    eventType: 'task.stage_changed',
    actorType: 'agent',
    actorId: 'principal-engineer',
    idempotencyKey: 'move:TSK-102',
    payload: { from_stage: 'BACKLOG', to_stage: 'TODO' },
    occurredAt: '2026-03-31T18:02:00.000Z',
  });

  const assigned = store.getTaskHistory('TSK-102', { eventType: 'task.assigned' });
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].payload.assignee, 'qa');

  const byActor = store.getTaskHistory('TSK-102', { actorId: 'principal-engineer' });
  assert.equal(byActor.length, 3);
});

test('records control-plane decision and observe-only WIP metadata in projections and metrics', async () => {
  const { store } = makeStore();
  await store.appendEvent({
    taskId: 'TSK-CP-STORE',
    eventType: 'task.created',
    actorType: 'agent',
    actorId: 'pm',
    idempotencyKey: 'create:TSK-CP-STORE',
    payload: { title: 'Control-plane store', initial_stage: 'BACKLOG' },
  });

  await store.appendEvent({
    taskId: 'TSK-CP-STORE',
    eventType: 'task.control_plane_decision_recorded',
    actorType: 'system',
    actorId: 'system:control-plane',
    idempotencyKey: 'decision:TSK-CP-STORE',
    payload: {
      policy_name: 'prioritization',
      policy_version: 'control-plane-work-prioritization.v1',
      input_facts: { priority: 'P1' },
      decision: 'ranked_first',
      rationale: 'Operator override and production risk outrank normal priority.',
    },
  });

  await store.appendEvent({
    taskId: 'TSK-CP-STORE',
    eventType: 'task.stage_changed',
    actorType: 'agent',
    actorId: 'pm',
    idempotencyKey: 'stage:TSK-CP-STORE:IN_PROGRESS',
    payload: {
      from_stage: 'BACKLOG',
      to_stage: 'IN_PROGRESS',
      control_plane: {
        wip_limits: {
          mode: 'observe_only',
          current_count: 2,
          limit: 1,
          scope_type: 'stage',
          scope_id: 'IN_PROGRESS',
        },
      },
    },
  });

  const state = store.getTaskCurrentState('TSK-CP-STORE');
  assert.equal(state.latest_control_plane_decision_policy, 'prioritization');
  assert.equal(state.current_stage, 'IN_PROGRESS');

  const history = store.getTaskHistory('TSK-CP-STORE');
  const stageEvent = history.find((event) => event.event_type === 'task.stage_changed');
  assert.equal(stageEvent.payload.control_plane_wip_decision.evaluations[0].decision, 'observe_would_block');

  const metrics = store.readMetrics();
  assert.equal(metrics.feature_control_plane_decisions_total, 1);
  assert.equal(metrics.feature_control_plane_wip_would_block_total, 1);
});
