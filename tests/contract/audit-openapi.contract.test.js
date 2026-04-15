const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAuditApiServer } = require('../../lib/audit/http');
const { signBrowserAuthCode } = require('../../lib/auth/jwt');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, payload = {}) {
  return {
    authorization: `Bearer ${sign({ sub: 'contract-tester', tenant_id: 'tenant-contract', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 60, ...payload }, secret)}`,
  };
}

async function withServer(run) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-contract-'));
  const secret = 'contract-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function browserAuthCode(secret, payload = {}, options = {}) {
  return signBrowserAuthCode({
    actorId: 'pm-1',
    tenantId: 'tenant-contract',
    roles: ['pm', 'reader'],
    ...payload,
  }, secret, options);
}

// Governance note: audit-facing route changes should keep contract coverage updated in the same change set.

test('openapi contract documents the live audit routes and auth model', () => {
  const spec = fs.readFileSync(path.join(__dirname, '../../docs/api/audit-foundation-openapi.yml'), 'utf8');
  const ownerReadSpec = fs.readFileSync(path.join(__dirname, '../../docs/api/task-owner-surfaces-openapi.yml'), 'utf8');
  const browserAuthSpec = fs.readFileSync(path.join(__dirname, '../../docs/api/authenticated-browser-app-openapi.yml'), 'utf8');
  const assignmentSpec = fs.readFileSync(path.join(__dirname, '../../docs/api/task-assignment-openapi.yml'), 'utf8');
  const taskDetailSpec = fs.readFileSync(path.join(__dirname, '../../docs/api/task-detail-history-telemetry-openapi.yml'), 'utf8');

  for (const snippet of [
    '/tasks:',
    '/tasks/{id}:',
    '/tasks/{id}/events:',
    '/tasks/{id}/history:',
    '/tasks/{id}/state:',
    '/tasks/{id}/relationships:',
    '/tasks/{id}/observability-summary:',
    '/tasks/{id}/sre-monitoring/start:',
    '/tasks/{id}/sre-monitoring/approve:',
    '/tasks/{id}/sre-monitoring/anomaly-child-task:',
    '/tasks/{id}/pm-business-context:',
    '/metrics:',
    '/projections/process:',
    'BearerAuth:',
    'x-tenant-id',
    'x-actor-id',
    'next_cursor',
    'limit',
    'dateFrom',
    'dateTo',
    'queue_entered_at',
    'wip_owner',
    'ff-sre-monitoring',
    'processExpiredSreMonitoring',
    'approved_correlation_ids',
    'current_owner',
    'task.pm_business_context_completed',
    'List projected task summaries with additive owner metadata',
  ]) {
    assert.match(spec, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const snippet of [
    '/tasks:',
    '/tasks/{id}:',
    'List task summaries with read-only owner metadata',
    'Assignment mutation stays on `PATCH /tasks/{id}/assignment`.',
    'engineer-jr',
    'engineer-sr',
    'governance_review',
  ]) {
    assert.match(ownerReadSpec, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const snippet of [
    '/auth/session:',
    '/api/auth/session:',
    'authCode',
    'accessToken',
    'expiresAt',
    'Signed browser bootstrap artifact from the trusted internal auth source.',
    '/overview/governance',
  ]) {
    assert.match(browserAuthSpec, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const snippet of [
    'Only the currently assigned owner may perform this action.',
    'engineer-sr',
    'Shared browser surfaces such as `/inbox/sre` remain read-only unless a dedicated workflow endpoint is used.',
  ]) {
    assert.match(assignmentSpec, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const snippet of [
    'sreMonitoring',
    'deployment',
    'windowEndsAt',
    'telemetry',
    'approval',
    'escalation',
    'pmBusinessContextReview',
    'finalizedByPm',
    'freezeScope',
    'commentable',
    'childTaskId',
    'waitingState',
  ]) {
    assert.match(taskDetailSpec, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('documented endpoints satisfy the runtime contract', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { roles: ['contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-CONTRACT-1',
        payload: { title: 'Contract task', initial_stage: 'BACKLOG', priority: 'P1' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.child_link_added',
        actorType: 'agent',
        idempotencyKey: 'child:TSK-CONTRACT-1',
        payload: { child_task_id: 'TSK-CHILD-9' },
      }),
    });
    assert.equal(response.status, 202);

    const readerHeaders = authHeaders(secret, { roles: ['reader'] });
    response = await fetch(`${baseUrl}/tasks`, { headers: readerHeaders });
    assert.equal(response.status, 200);
    const taskList = await response.json();
    assert.equal(taskList.items.length, 1);
    assert.equal(taskList.items[0].task_id, 'TSK-CONTRACT-1');
    assert.equal(taskList.items[0].current_owner, null);

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-1`, { headers: readerHeaders });
    assert.equal(response.status, 200);
    const taskSummary = await response.json();
    assert.equal(taskSummary.title, 'Contract task');
    assert.equal(taskSummary.owner, null);

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-1/history`, { headers: readerHeaders });
    assert.equal(response.status, 200);
    const history = await response.json();
    assert.equal(history.items.length, 2);
    assert.equal(history.items[0].item_id, history.items[0].event_id);

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-1/history?limit=1`, { headers: readerHeaders });
    assert.equal(response.status, 200);
    const paginatedHistory = await response.json();
    assert.equal(paginatedHistory.items.length, 1);
    assert.equal(paginatedHistory.page_info.next_cursor, '2');

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-1/history?eventType=task.created&dateFrom=2000-01-01T00:00:00.000Z`, { headers: readerHeaders });
    assert.equal(response.status, 200);
    const filteredHistory = await response.json();
    assert.equal(filteredHistory.items.length, 1);
    assert.equal(filteredHistory.items[0].event_type, 'task.created');

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-1/state`, { headers: readerHeaders });
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.current_stage, 'BACKLOG');

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-1/relationships`, { headers: readerHeaders });
    assert.equal(response.status, 200);
    const relationships = await response.json();
    assert.deepEqual(relationships.child_task_ids, ['TSK-CHILD-9']);

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-1/observability-summary`, { headers: readerHeaders });
    assert.equal(response.status, 200);
    const summary = await response.json();
    assert.equal(summary.event_count, 2);
    assert.equal(summary.access.restricted, true);
    assert.deepEqual(summary.correlation.approved_correlation_ids, ['child:TSK-CONTRACT-1', 'create:TSK-CONTRACT-1']);

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-ANOM/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-CONTRACT-ANOM',
        payload: { title: 'Contract anomaly task', initial_stage: 'SRE_MONITORING', priority: 'P1' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-ANOM/sre-monitoring/anomaly-child-task`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['sre', 'reader'] }),
      },
      body: JSON.stringify({
        title: 'Investigate contract anomaly',
        service: 'checkout-api',
        anomalySummary: '5xx rate spiked after deployment.',
        metrics: ['5xx_rate: 8%'],
        logs: ['checkout-api log sample'],
        errorSamples: ['TimeoutError'],
      }),
    });
    assert.equal(response.status, 201);
    const anomalyChild = await response.json();
    assert.equal(anomalyChild.data.parentTaskId, 'TSK-CONTRACT-ANOM');
    assert.equal(anomalyChild.data.priority, 'P0');

    response = await fetch(`${baseUrl}/tasks/${anomalyChild.data.childTaskId}/pm-business-context`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'pm-1', roles: ['pm', 'reader'] }),
      },
      body: JSON.stringify({
        businessContext: 'PM validated customer impact and cleared architect follow-up.',
      }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/${anomalyChild.data.childTaskId}/detail`, {
      headers: authHeaders(secret, { roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.context.pmBusinessContextReview.finalized, true);
    assert.equal(detail.context.anomalyChildTask.finalizedByPm, true);
    assert.equal(detail.relations.parentTask.id, 'TSK-CONTRACT-ANOM');

    response = await fetch(`${baseUrl}/metrics`, { headers: authHeaders(secret, { roles: ['admin'] }) });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /workflow_audit_events_written_total/);

    response = await fetch(`${baseUrl}/projections/process?limit=25`, {
      method: 'POST',
      headers: authHeaders(secret, { roles: ['admin'] }),
    });
    assert.equal(response.status, 202);
  });
});

test('browser auth bootstrap endpoint satisfies the documented session contract', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: browserAuthCode(secret),
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(typeof payload.data.accessToken, 'string');
    assert.equal(payload.data.claims.actor_id, 'pm-1');
    assert.equal(payload.data.claims.tenant_id, 'tenant-contract');
    assert.deepEqual(payload.data.claims.roles, ['pm', 'reader']);
  });
});
