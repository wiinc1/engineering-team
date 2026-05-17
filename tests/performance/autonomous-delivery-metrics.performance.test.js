const test = require('node:test');
const assert = require('node:assert/strict');
const { rebuildAutonomousDeliveryMetrics } = require('../../lib/audit/autonomous-delivery-metrics');

function event(taskId, sequence, event_type, payload = {}) {
  return {
    event_id: `${taskId}-${sequence}`,
    tenant_id: 'tenant-perf',
    task_id: taskId,
    event_type,
    occurred_at: new Date(Date.parse('2026-05-01T00:00:00.000Z') + sequence * 60000).toISOString(),
    sequence_number: sequence,
    actor_id: sequence % 2 ? 'system' : 'engineer-sr',
    actor_type: sequence % 2 ? 'system' : 'agent',
    payload,
  };
}

function history(taskId) {
  return [
    event(taskId, 1, 'task.created', { initial_stage: 'DRAFT', raw_requirements: `Implement ${taskId}.` }),
    event(taskId, 2, 'task.execution_contract_version_recorded', { contract: { version: 1, template_tier: 'Simple', validation: { status: 'valid' } } }),
    event(taskId, 3, 'task.execution_contract_approved', { version: 1, auto_approval: { approved_by_policy: true } }),
    event(taskId, 4, 'task.engineer_submission_recorded', { assignee: 'engineer-sr', commit_sha: 'abc1234' }),
    event(taskId, 5, 'task.qa_result_recorded', { outcome: 'pass' }),
    event(taskId, 6, 'task.closed', { outcome: 'closed' }),
  ];
}

test('autonomous delivery metrics rebuild stays under MVP budget for 30 days of pilot-sized history', async () => {
  const taskIds = Array.from({ length: 180 }, (_, index) => `TSK-PERF-${String(index + 1).padStart(3, '0')}`);
  const histories = Object.fromEntries(taskIds.map(taskId => [taskId, history(taskId)]));
  const store = {
    kind: 'memory',
    listTaskSummaries() {
      return taskIds.map(taskId => ({ task_id: taskId, tenant_id: 'tenant-perf', closed: true, current_stage: 'DONE' }));
    },
    getTaskCurrentState(taskId) {
      return { task_id: taskId, tenant_id: 'tenant-perf', closed: true, current_stage: 'DONE', execution_contract_template_tier: 'Simple' };
    },
    getTaskHistory(taskId) {
      return histories[taskId];
    },
    updateMetrics(callback) {
      callback({});
    },
  };

  const started = performance.now();
  const result = await rebuildAutonomousDeliveryMetrics({ store, tenantId: 'tenant-perf', persist: false });
  const durationMs = performance.now() - started;

  assert.equal(result.projection.summary.total_signals, 180);
  assert.equal(result.projection.summary.autonomous_delivery_rate, 1);
  assert.ok(durationMs < 750, `expected rebuild under 750ms, saw ${durationMs}ms`);
});
