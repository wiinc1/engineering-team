const test = require('node:test');
const assert = require('node:assert/strict');
const {
  aggregateAutonomousDeliveryMetrics,
  buildRetrospectiveSignal,
  classifyOperatorInterventions,
  rebuildAutonomousDeliveryMetrics,
} = require('../../lib/audit/autonomous-delivery-metrics');

function event(event_type, sequence_number, payload = {}, overrides = {}) {
  return {
    event_id: `evt-${sequence_number}`,
    tenant_id: overrides.tenant_id || 'tenant-metrics',
    task_id: overrides.task_id || 'TSK-METRICS-1',
    event_type,
    occurred_at: overrides.occurred_at || new Date(Date.parse('2026-05-01T10:00:00.000Z') + sequence_number * 60000).toISOString(),
    recorded_at: overrides.recorded_at || new Date(Date.parse('2026-05-01T10:00:00.000Z') + sequence_number * 60000).toISOString(),
    actor_id: overrides.actor_id || 'system',
    actor_type: overrides.actor_type || 'system',
    sequence_number,
    correlation_id: overrides.correlation_id || `corr-${sequence_number}`,
    trace_id: overrides.trace_id || null,
    payload,
    source: overrides.source || 'test',
  };
}

function closedAutonomousHistory(taskId = 'TSK-METRICS-1') {
  return [
    event('task.created', 1, { title: 'Metrics task', initial_stage: 'DRAFT', raw_requirements: 'Ship metrics.' }, { task_id: taskId, actor_id: 'pm', actor_type: 'user' }),
    event('task.execution_contract_version_recorded', 2, { contract: { version: 1, template_tier: 'Simple', validation: { status: 'valid' } } }, { task_id: taskId }),
    event('task.execution_contract_approved', 3, { version: 1, auto_approval: { approved_by_policy: true } }, { task_id: taskId, actor_id: 'system:policy', actor_type: 'system' }),
    event('task.engineer_submission_recorded', 4, { version: 1, assignee: 'engineer-sr', commit_sha: 'abc1234' }, { task_id: taskId, actor_id: 'engineer-sr', actor_type: 'agent' }),
    event('task.qa_result_recorded', 5, { outcome: 'pass' }, { task_id: taskId, actor_id: 'qa', actor_type: 'agent' }),
    event('task.sre_approval_recorded', 6, { reason: 'Monitoring clean.' }, { task_id: taskId, actor_id: 'sre', actor_type: 'agent' }),
    event('task.closed', 7, { outcome: 'closed' }, { task_id: taskId, actor_id: 'operator-1', actor_type: 'operator' }),
  ];
}

test('classifier excludes routine approvals and closeout while counting manual reroutes after approval', () => {
  const history = [
    ...closedAutonomousHistory(),
    event('task.execution_contract_approved', 8, { version: 1 }, { actor_id: 'operator-1', actor_type: 'operator' }),
    event('task.reassigned', 9, { reason: 'Manual reroute to recover missing context.', assignee: 'engineer-principal' }, { actor_id: 'operator-1', actor_type: 'operator', correlation_id: 'manual-reroute' }),
    event('task.stage_changed', 10, { from_stage: 'QA_TESTING', to_stage: 'IMPLEMENTATION', reason: 'Manual restart after ambiguous verification.' }, { actor_id: 'operator-1', actor_type: 'operator', correlation_id: 'manual-restart' }),
    event('task.closed', 11, { outcome: 'closed' }, { actor_id: 'operator-1', actor_type: 'operator' }),
  ];

  const result = classifyOperatorInterventions(history, { approvalOccurredAt: history[2].occurred_at });

  assert.equal(result.count, 2);
  assert.deepEqual(result.items.map(item => item.category), ['manual_reroute', 'manual_restart']);
  assert.ok(result.routine_action_count >= 2);
});

test('retrospective signal marks complete autonomous evidence as known and threshold-eligible', () => {
  const input = {
    taskId: 'TSK-METRICS-1',
    tenantId: 'tenant-metrics',
    state: { task_id: 'TSK-METRICS-1', tenant_id: 'tenant-metrics', closed: true, current_stage: 'DONE', execution_contract_template_tier: 'Simple' },
    history: closedAutonomousHistory(),
  };
  const signal = buildRetrospectiveSignal({
    ...input,
    generatedAt: '2026-05-01T12:00:00.000Z',
  });
  const rebuilt = buildRetrospectiveSignal({
    ...input,
    generatedAt: '2026-05-02T12:00:00.000Z',
  });

  assert.equal(signal.schema_version, 'delivery-retrospective-signal.v1');
  assert.equal(signal.signal_id, rebuilt.signal_id);
  assert.equal(signal.classification_status, 'known');
  assert.equal(signal.excluded_from_thresholds, false);
  assert.equal(signal.operator_interventions.count, 0);
  assert.equal(signal.approval_mode, 'policy_auto_approved');
  assert.equal(signal.implementation_agent, 'engineer-sr');
});

test('retrospective signal excludes legacy incomplete evidence from threshold math', () => {
  const signal = buildRetrospectiveSignal({
    taskId: 'TSK-LEGACY',
    tenantId: 'tenant-metrics',
    state: { task_id: 'TSK-LEGACY', tenant_id: 'tenant-metrics', closed: true, current_stage: 'DONE' },
    history: [event('task.closed', 1, {}, { task_id: 'TSK-LEGACY', actor_id: 'operator-1', actor_type: 'operator' })],
    generatedAt: '2026-05-01T12:00:00.000Z',
  });

  assert.equal(signal.classification_status, 'unknown');
  assert.equal(signal.excluded_from_thresholds, true);
  assert.ok(signal.evidence_quality.missing.includes('execution_contract_approval_missing'));
});

test('aggregation filters unknown signals from threshold math and computes rates by class, tier, and agent', () => {
  const clean = buildRetrospectiveSignal({
    taskId: 'TSK-CLEAN',
    tenantId: 'tenant-metrics',
    state: { task_id: 'TSK-CLEAN', tenant_id: 'tenant-metrics', closed: true, current_stage: 'DONE', execution_contract_template_tier: 'Simple' },
    history: closedAutonomousHistory('TSK-CLEAN'),
    generatedAt: '2026-05-01T12:00:00.000Z',
  });
  const reworked = buildRetrospectiveSignal({
    taskId: 'TSK-REWORK',
    tenantId: 'tenant-metrics',
    state: { task_id: 'TSK-REWORK', tenant_id: 'tenant-metrics', closed: true, current_stage: 'DONE', execution_contract_template_tier: 'Simple' },
    history: [
      ...closedAutonomousHistory('TSK-REWORK'),
      event('task.qa_result_recorded', 8, { outcome: 'fail', summary: 'Regression found.' }, { task_id: 'TSK-REWORK', actor_id: 'qa', actor_type: 'agent' }),
    ],
    generatedAt: '2026-05-01T12:00:00.000Z',
  });
  const unknown = buildRetrospectiveSignal({
    taskId: 'TSK-UNKNOWN',
    tenantId: 'tenant-metrics',
    state: { task_id: 'TSK-UNKNOWN', tenant_id: 'tenant-metrics', closed: true, current_stage: 'DONE' },
    history: [event('task.closed', 1, {}, { task_id: 'TSK-UNKNOWN' })],
    generatedAt: '2026-05-01T12:00:00.000Z',
  });

  const aggregate = aggregateAutonomousDeliveryMetrics([clean, reworked, unknown], { tenantId: 'tenant-metrics' });

  assert.equal(aggregate.summary.total_signals, 3);
  assert.equal(aggregate.summary.included_signals, 2);
  assert.equal(aggregate.summary.unknown_signals, 1);
  assert.equal(aggregate.summary.autonomous_deliveries, 1);
  assert.equal(aggregate.summary.autonomous_delivery_rate, 0.5);
  assert.equal(aggregate.breakdowns.by_task_class[0].key, 'Simple');
  assert.equal(aggregate.breakdowns.by_implementation_agent[0].key, 'engineer-sr');
});

test('rebuild is deterministic and persists a file-backed projection snapshot', async () => {
  const metrics = {};
  const histories = {
    'TSK-CLEAN': closedAutonomousHistory('TSK-CLEAN'),
  };
  const store = {
    kind: 'file',
    files: { metrics: '/tmp/engineering-team-autonomous-delivery-test/workflow-audit-metrics.json' },
    listTaskSummaries() {
      return [{ task_id: 'TSK-CLEAN', tenant_id: 'tenant-metrics', closed: true, current_stage: 'DONE' }];
    },
    getTaskCurrentState(taskId) {
      return { task_id: taskId, tenant_id: 'tenant-metrics', closed: true, current_stage: 'DONE', execution_contract_template_tier: 'Simple' };
    },
    getTaskHistory(taskId) {
      return histories[taskId] || [];
    },
    updateMetrics(callback) {
      callback(metrics);
    },
  };

  const first = await rebuildAutonomousDeliveryMetrics({ store, tenantId: 'tenant-metrics', generatedAt: '2026-05-01T12:00:00.000Z' });
  const second = await rebuildAutonomousDeliveryMetrics({ store, tenantId: 'tenant-metrics', generatedAt: '2026-05-02T12:00:00.000Z' });

  assert.deepEqual(first.projection.summary, second.projection.summary);
  assert.equal(first.projection.signals[0].signal_id, second.projection.signals[0].signal_id);
  assert.equal(first.projection.rebuild_id, second.projection.rebuild_id);
  assert.equal(metrics.feature_autonomous_delivery_rate, 1);
  assert.equal(metrics.feature_autonomy_policy_blocks_total, 1);
  assert.equal(first.persistence.persisted, true);
});
