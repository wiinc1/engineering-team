const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAuditApiServer } = require('../../lib/audit/http');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, payload = {}) {
  return {
    authorization: `Bearer ${sign({ sub: 'principal-engineer', tenant_id: 'tenant-a', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 60, ...payload }, secret)}`,
  };
}

async function withServer(run, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-api-'));
  const secret = 'test-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run({ baseDir, baseUrl, secret });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('enforces bearer-token auth context and isolates reads by tenant claim', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const unauthorized = await fetch(`${baseUrl}/tasks/TSK-200/history`);
    assert.equal(unauthorized.status, 401);
    const unauthorizedBody = await unauthorized.json();
    assert.equal(unauthorizedBody.error.code, 'missing_auth_context');
    assert.ok(unauthorized.headers.get('x-request-id'));

    const createRes = await fetch(`${baseUrl}/tasks/TSK-200/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
      },
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-200', payload: { title: 'Tenant task', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(createRes.status, 202);

    const okHistory = await fetch(`${baseUrl}/tasks/TSK-200/history`, { headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }) });
    const history = await okHistory.json();
    assert.equal(okHistory.status, 200);
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].tenant_id, 'tenant-a');

    const wrongTenantState = await fetch(`${baseUrl}/tasks/TSK-200/state`, { headers: authHeaders(secret, { tenant_id: 'tenant-b', roles: ['reader'] }) });
    assert.equal(wrongTenantState.status, 404);
    assert.equal((await wrongTenantState.json()).error.code, 'task_not_found');
  });
});

test('enforces role-based permissions for writes and metrics', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const forbiddenWrite = await fetch(`${baseUrl}/tasks/TSK-202/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'observer', tenant_id: 'tenant-a', roles: ['reader'] }),
      },
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-202' }),
    });
    assert.equal(forbiddenWrite.status, 403);
    assert.equal((await forbiddenWrite.json()).error.code, 'forbidden');

    const forbiddenMetrics = await fetch(`${baseUrl}/metrics`, { headers: authHeaders(secret, { sub: 'observer', tenant_id: 'tenant-a', roles: ['reader'] }) });
    assert.equal(forbiddenMetrics.status, 403);
  });
});

test('returns state, relationships, observability summary, and metrics from projections', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const writeHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-z', roles: ['contributor'] }),
    };

    await fetch(`${baseUrl}/tasks/TSK-201/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-201', traceId: 'trace-1', correlationId: 'corr-1', payload: { title: 'Projection task', initial_stage: 'BACKLOG', priority: 'P0' } }),
    });
    await fetch(`${baseUrl}/tasks/TSK-201/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.child_link_added', actorType: 'agent', idempotencyKey: 'child:TSK-201', payload: { child_task_id: 'TSK-202' } }),
    });

    const readHeaders = authHeaders(secret, { tenant_id: 'tenant-z', roles: ['reader'] });
    const taskRes = await fetch(`${baseUrl}/tasks/TSK-201`, { headers: readHeaders });
    const taskSummary = await taskRes.json();
    assert.equal(taskRes.status, 200);
    assert.equal(taskSummary.title, 'Projection task');
    assert.equal(taskSummary.priority, 'P0');

    const stateRes = await fetch(`${baseUrl}/tasks/TSK-201/state`, { headers: readHeaders });
    const state = await stateRes.json();
    assert.equal(stateRes.status, 200);
    assert.equal(state.priority, 'P0');

    const relationshipsRes = await fetch(`${baseUrl}/tasks/TSK-201/relationships`, { headers: readHeaders });
    const relationships = await relationshipsRes.json();
    assert.equal(relationshipsRes.status, 200);
    assert.deepEqual(relationships.child_task_ids, ['TSK-202']);

    const summaryRes = await fetch(`${baseUrl}/tasks/TSK-201/observability-summary`, { headers: readHeaders });
    const summary = await summaryRes.json();
    assert.equal(summaryRes.status, 200);
    assert.equal(summary.event_count, 2);
    assert.equal(summary.access.restricted, true);
    assert.deepEqual(summary.correlation.approved_correlation_ids, ['child:TSK-201', 'corr-1']);
    assert.equal(summary.trace_ids, undefined);

    const metricsRes = await fetch(`${baseUrl}/metrics`, { headers: authHeaders(secret, { tenant_id: 'tenant-z', roles: ['admin'] }) });
    const metrics = await metricsRes.text();
    assert.equal(metricsRes.status, 200);
    assert.match(metrics, /workflow_audit_events_written_total 2/);
    assert.match(metrics, /workflow_projection_lag_seconds 0/);
  });
});

test('supports history pagination and writes explicit audit-access logs for reads', async () => {
  await withServer(async ({ baseDir, baseUrl, secret }) => {
    const writeHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
    };
    for (let index = 1; index <= 3; index += 1) {
      const eventType = index === 1 ? 'task.created' : 'task.comment_workflow_recorded';
      const payload = index === 1 ? { title: 'Paged task', initial_stage: 'BACKLOG' } : { comment_type: `note-${index}` };
      const response = await fetch(`${baseUrl}/tasks/TSK-203/events`, {
        method: 'POST',
        headers: writeHeaders,
        body: JSON.stringify({ eventType, actorType: 'agent', idempotencyKey: `page:${index}`, payload }),
      });
      assert.equal(response.status, 202);
    }

    const readHeaders = authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] });
    let response = await fetch(`${baseUrl}/tasks/TSK-203/history?limit=2`, { headers: readHeaders });
    assert.equal(response.status, 200);
    const firstPage = await response.json();
    assert.equal(firstPage.items.length, 2);
    assert.equal(firstPage.page_info.has_more, true);
    assert.equal(firstPage.page_info.next_cursor, '2');
    assert.equal(firstPage.items[0].summary, 'Workflow comment recorded: note-3');
    assert.equal(firstPage.items[0].display.fallback_used, false);

    response = await fetch(`${baseUrl}/tasks/TSK-203/history?limit=2&cursor=2`, { headers: readHeaders });
    const secondPage = await response.json();
    assert.equal(secondPage.items.length, 1);
    assert.equal(secondPage.page_info.has_more, false);

    const log = fs.readFileSync(path.join(baseDir, 'observability', 'workflow-audit.log'), 'utf8');
    assert.match(log, /"action":"audit_access"/);
    assert.match(log, /"resource":"history"/);
  }, { historyLatencyRegressionThresholdMs: 0 });
});

test('supports AI-agent registry reads and assignment writes on the audit API path', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const createHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-204/events`, {
      method: 'POST',
      headers: createHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-204', payload: { title: 'Assigned task', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/ai-agents`, { headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }) });
    assert.equal(response.status, 200);
    const agents = await response.json();
    assert.equal(agents.items.some(agent => agent.id === 'qa'), true);

    response = await fetch(`${baseUrl}/tasks/TSK-204/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);
    const assigned = await response.json();
    assert.equal(assigned.data.owner.agentId, 'qa');

    response = await fetch(`${baseUrl}/tasks/TSK-204/state`, { headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }) });
    const state = await response.json();
    assert.equal(state.assignee, 'qa');

    response = await fetch(`${baseUrl}/tasks/TSK-204/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: null }),
    });
    assert.equal(response.status, 200);
    const unassigned = await response.json();
    assert.equal(unassigned.data.owner, null);
  });
});

test('rejects unauthorized or invalid AI-agent assignment attempts', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    await fetch(`${baseUrl}/tasks/TSK-205/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
      },
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-205', payload: { title: 'Protected assignment task', initial_stage: 'BACKLOG' } }),
    });

    let response = await fetch(`${baseUrl}/tasks/TSK-205/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/tasks/TSK-205/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: 'not-real' }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_agent');
  });
});

test('accepts /api-prefixed assignment and agent routes for docs compatibility', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    await fetch(`${baseUrl}/tasks/TSK-206/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
      },
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-206', payload: { title: 'Doc compatibility task', initial_stage: 'BACKLOG' } }),
    });

    let response = await fetch(`${baseUrl}/api/ai-agents`, { headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).items.some(agent => agent.id === 'qa'), true);

    response = await fetch(`${baseUrl}/api/tasks/TSK-206/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.owner.agentId, 'qa');
  });
});

test('returns standardized error payload when feature flag kill switch is off', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const response = await fetch(`${baseUrl}/tasks/TSK-999/history`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }),
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'feature_disabled');
    assert.equal(body.error.details.feature, 'ff_audit_foundation');
    assert.ok(body.error.request_id);
  }, { auditFoundationEnabled: false });
});


test('lists projected task summaries with owner and unassigned states', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const writeHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-301/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-301', payload: { title: 'Owned task', initial_stage: 'BACKLOG', priority: 'P1' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-302/events`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-302', payload: { title: 'Unassigned task', initial_stage: 'TODO', priority: 'P2' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-301/assignment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { tenant_id: 'tenant-a', roles: ['pm'] }),
      },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks`, { headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.items.length, 2);
    const owned = payload.items.find(item => item.task_id === 'TSK-301');
    const unassigned = payload.items.find(item => item.task_id === 'TSK-302');
    assert.equal(owned.title, 'Owned task');
    assert.equal(owned.current_owner, 'qa');
    assert.equal(unassigned.current_owner, null);
    assert.equal(unassigned.owner, null);
  });
});
