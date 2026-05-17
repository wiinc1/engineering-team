const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAuditApiServer } = require('../../lib/audit');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function auth(secret, tenantId, roles = ['sre']) {
  return {
    authorization: `Bearer ${sign({
      sub: `${tenantId}-user`,
      tenant_id: tenantId,
      roles,
      exp: Math.floor(Date.now() / 1000) + 60,
    }, secret)}`,
  };
}

function history(taskId, tenantId) {
  return [
    { event_id: `${taskId}-1`, task_id: taskId, tenant_id: tenantId, event_type: 'task.created', occurred_at: '2026-05-01T10:00:00.000Z', sequence_number: 1, actor_id: 'pm', actor_type: 'user', payload: { initial_stage: 'DRAFT', raw_requirements: 'Security scoped metrics.' } },
    { event_id: `${taskId}-2`, task_id: taskId, tenant_id: tenantId, event_type: 'task.execution_contract_version_recorded', occurred_at: '2026-05-01T10:01:00.000Z', sequence_number: 2, actor_id: 'pm', actor_type: 'user', payload: { contract: { version: 1, template_tier: 'Simple', validation: { status: 'valid' } } } },
    { event_id: `${taskId}-3`, task_id: taskId, tenant_id: tenantId, event_type: 'task.execution_contract_approved', occurred_at: '2026-05-01T10:02:00.000Z', sequence_number: 3, actor_id: 'system:policy', actor_type: 'system', payload: { auto_approval: { approved_by_policy: true } } },
    { event_id: `${taskId}-4`, task_id: taskId, tenant_id: tenantId, event_type: 'task.engineer_submission_recorded', occurred_at: '2026-05-01T10:03:00.000Z', sequence_number: 4, actor_id: 'engineer-sr', actor_type: 'agent', payload: { assignee: 'engineer-sr', commit_sha: 'abc1234' } },
    { event_id: `${taskId}-5`, task_id: taskId, tenant_id: tenantId, event_type: 'task.closed', occurred_at: '2026-05-01T10:04:00.000Z', sequence_number: 5, actor_id: 'operator-1', actor_type: 'operator', payload: { outcome: 'closed' } },
  ];
}

function createStore() {
  const histories = {
    'TSK-TENANT-A': history('TSK-TENANT-A', 'tenant-a'),
    'TSK-TENANT-B': history('TSK-TENANT-B', 'tenant-b'),
  };
  return {
    kind: 'memory',
    listTaskSummaries({ tenantId } = {}) {
      return Object.entries(histories)
        .map(([taskId, events]) => ({ task_id: taskId, tenant_id: events[0].tenant_id, closed: true, current_stage: 'DONE' }))
        .filter(task => !tenantId || task.tenant_id === tenantId);
    },
    getTaskCurrentState(taskId, { tenantId } = {}) {
      const tenant = histories[taskId]?.[0]?.tenant_id;
      if (!tenant || tenant !== tenantId) return null;
      return { task_id: taskId, tenant_id: tenant, closed: true, current_stage: 'DONE', execution_contract_template_tier: 'Simple' };
    },
    getTaskHistory(taskId, { tenantId } = {}) {
      return (histories[taskId] || []).filter(event => event.tenant_id === tenantId);
    },
    updateMetrics() {},
  };
}

async function withServer(callback) {
  const secret = 'autonomous-security-secret';
  const { server } = createAuditApiServer({ store: createStore(), jwtSecret: secret });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await callback({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('autonomous delivery metrics are tenant-scoped and task signals do not leak cross-tenant data', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/api/v1/metrics/autonomous-delivery`, {
      headers: auth(secret, 'tenant-a', ['sre']),
    });
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.deepEqual(payload.data.signals.map(signal => signal.task_id), ['TSK-TENANT-A']);

    response = await fetch(`${baseUrl}/api/v1/tasks/TSK-TENANT-B/retrospective-signal`, {
      headers: auth(secret, 'tenant-a', ['sre']),
    });
    assert.equal(response.status, 404);
    payload = await response.json();
    assert.equal(payload.error.details.task_id, 'TSK-TENANT-B');
    assert.doesNotMatch(JSON.stringify(payload), /tenant-b/);
  });
});

test('autonomous delivery metrics reject missing auth without exposing token configuration', async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/v1/metrics/autonomous-delivery`);
    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.equal(payload.error.code, 'missing_auth_context');
    assert.doesNotMatch(JSON.stringify(payload), /autonomous-security-secret/);
  });
});
