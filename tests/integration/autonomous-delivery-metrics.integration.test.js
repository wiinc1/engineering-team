const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createAuditApiServer } = require('../../lib/audit');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, roles = ['admin'], overrides = {}) {
  return {
    authorization: `Bearer ${sign({
      sub: 'autonomous-metrics-test',
      tenant_id: 'tenant-metrics',
      roles,
      exp: Math.floor(Date.now() / 1000) + 60,
      ...overrides,
    }, secret)}`,
  };
}

function event(event_type, sequence_number, payload = {}, overrides = {}) {
  return {
    event_id: `evt-${sequence_number}`,
    tenant_id: overrides.tenant_id || 'tenant-metrics',
    task_id: overrides.task_id || 'TSK-AUTO-1',
    event_type,
    occurred_at: overrides.occurred_at || new Date(Date.parse('2026-05-01T10:00:00.000Z') + sequence_number * 60000).toISOString(),
    recorded_at: overrides.recorded_at || new Date(Date.parse('2026-05-01T10:00:00.000Z') + sequence_number * 60000).toISOString(),
    actor_id: overrides.actor_id || 'system',
    actor_type: overrides.actor_type || 'system',
    sequence_number,
    correlation_id: overrides.correlation_id || `corr-${sequence_number}`,
    trace_id: null,
    payload,
    source: 'test',
  };
}

function cleanHistory(taskId = 'TSK-AUTO-1') {
  return [
    event('task.created', 1, { title: taskId, initial_stage: 'DRAFT', raw_requirements: 'Metrics route test.' }, { task_id: taskId, actor_id: 'pm', actor_type: 'user' }),
    event('task.execution_contract_version_recorded', 2, { contract: { version: 1, template_tier: 'Simple', validation: { status: 'valid' } } }, { task_id: taskId }),
    event('task.execution_contract_approved', 3, { version: 1, auto_approval: { approved_by_policy: true } }, { task_id: taskId, actor_id: 'system:policy' }),
    event('task.engineer_submission_recorded', 4, { version: 1, assignee: 'engineer-sr', commit_sha: 'abc1234' }, { task_id: taskId, actor_id: 'engineer-sr', actor_type: 'agent' }),
    event('task.qa_result_recorded', 5, { outcome: 'pass' }, { task_id: taskId, actor_id: 'qa', actor_type: 'agent' }),
    event('task.sre_approval_recorded', 6, { reason: 'Monitoring clean.' }, { task_id: taskId, actor_id: 'sre', actor_type: 'agent' }),
    event('task.closed', 7, { outcome: 'closed' }, { task_id: taskId, actor_id: 'operator-1', actor_type: 'operator' }),
  ];
}

function createStore() {
  const metrics = {};
  const histories = {
    'TSK-AUTO-1': cleanHistory('TSK-AUTO-1'),
    'TSK-OTHER-TENANT': cleanHistory('TSK-OTHER-TENANT').map(item => ({ ...item, tenant_id: 'tenant-other' })),
  };
  return {
    kind: 'memory',
    listTaskSummaries({ tenantId } = {}) {
      return [
        { task_id: 'TSK-AUTO-1', tenant_id: 'tenant-metrics', closed: true, current_stage: 'DONE' },
        { task_id: 'TSK-OTHER-TENANT', tenant_id: 'tenant-other', closed: true, current_stage: 'DONE' },
      ].filter(task => !tenantId || task.tenant_id === tenantId);
    },
    getTaskCurrentState(taskId, { tenantId } = {}) {
      const history = histories[taskId] || [];
      const tenant = history[0]?.tenant_id;
      if (tenantId && tenant !== tenantId) return null;
      if (!history.length) return null;
      return { task_id: taskId, tenant_id: tenant, closed: true, current_stage: 'DONE', execution_contract_template_tier: 'Simple' };
    },
    getTaskHistory(taskId, { tenantId } = {}) {
      return (histories[taskId] || []).filter(item => !tenantId || item.tenant_id === tenantId);
    },
    updateMetrics(callback) {
      callback(metrics);
    },
    readMetrics() {
      return metrics;
    },
  };
}

async function withServer(callback, options = {}) {
  const secret = 'autonomous-metrics-secret';
  const store = createStore();
  const { server } = createAuditApiServer({ store, jwtSecret: secret, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await callback({ baseUrl: `http://127.0.0.1:${port}`, secret, store });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('autonomous delivery metrics routes aggregate, rebuild, and return per-task signals', async () => {
  await withServer(async ({ baseUrl, secret, store }) => {
    let response = await fetch(`${baseUrl}/api/v1/metrics/autonomous-delivery`, {
      headers: authHeaders(secret, ['pm']),
    });
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.equal(payload.data.summary.total_signals, 1);
    assert.equal(payload.data.summary.autonomous_delivery_rate, 1);
    assert.equal(payload.data.signals[0].task_id, 'TSK-AUTO-1');

    response = await fetch(`${baseUrl}/api/v1/tasks/TSK-AUTO-1/retrospective-signal`, {
      headers: authHeaders(secret, ['product_owner']),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.data.classification_status, 'known');
    assert.equal(payload.data.operator_interventions.count, 0);

    response = await fetch(`${baseUrl}/api/v1/metrics/autonomous-delivery/rebuild`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['admin']) },
      body: JSON.stringify({ persist: false }),
    });
    assert.equal(response.status, 202);
    payload = await response.json();
    assert.equal(payload.data.summary.autonomous_deliveries, 1);
    assert.equal(payload.data.persistence.persisted, false);
    assert.equal(store.readMetrics().feature_autonomous_delivery_metrics_requests_total, 3);
  });
});

test('autonomous delivery metrics routes enforce feature flag and permissions', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/api/v1/metrics/autonomous-delivery`, {
      headers: authHeaders(secret, ['contributor']),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/api/v1/metrics/autonomous-delivery/rebuild`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['reader']) },
      body: JSON.stringify({ persist: false }),
    });
    assert.equal(response.status, 403);
  });

  await withServer(async ({ baseUrl, secret }) => {
    const response = await fetch(`${baseUrl}/api/v1/metrics/autonomous-delivery`, {
      headers: authHeaders(secret, ['reader']),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.details.feature, 'ff_autonomous_delivery_metrics_mvp');
  }, { autonomousDeliveryMetricsMvpEnabled: false });
});
