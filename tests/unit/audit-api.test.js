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
    authorization: `Bearer ${sign({ sub: 'principal-engineer', tenant_id: 'tenant-a', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 60, ...payload }, secret)}`,
  };
}

function browserAuthCode(secret, payload = {}, options = {}) {
  return signBrowserAuthCode({
    actorId: 'pm-1',
    tenantId: 'tenant-a',
    roles: ['pm', 'reader'],
    ...payload,
  }, secret, options);
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

test('issues browser bootstrap sessions from the auth exchange endpoint and supports the /api alias', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: browserAuthCode(secret),
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.ok(payload.data.accessToken);
    assert.equal(payload.data.claims.actor_id, 'pm-1');
    assert.equal(payload.data.claims.tenant_id, 'tenant-a');
    assert.deepEqual(payload.data.claims.roles, ['pm', 'reader']);

    const sessionRead = await fetch(`${baseUrl}/tasks`, {
      headers: {
        authorization: `Bearer ${payload.data.accessToken}`,
      },
    });
    assert.equal(sessionRead.status, 200);

    response = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: browserAuthCode(secret, {
          actorId: 'engineer-1',
          roles: ['engineer', 'reader', 'contributor'],
        }),
      }),
    });
    assert.equal(response.status, 200);
    const aliasPayload = await response.json();
    assert.equal(aliasPayload.success, true);
    assert.equal(aliasPayload.data.claims.actor_id, 'engineer-1');
  });
});

test('rejects malformed browser auth bootstrap requests', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'missing_auth_code');

    response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authCode: 'tenant=tenant-a;roles=reader' }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_auth_code');

    response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authCode: `${browserAuthCode(secret)}tampered` }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_auth_code');
  });
});

test('browser bootstrap session tokens include configured issuer and audience claims', async () => {
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

    const sessionRead = await fetch(`${baseUrl}/tasks`, {
      headers: {
        authorization: `Bearer ${payload.data.accessToken}`,
      },
    });
    assert.equal(sessionRead.status, 200);

    const claims = JSON.parse(Buffer.from(payload.data.accessToken.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(claims.iss, 'expected-issuer');
    assert.equal(claims.aud, 'expected-audience');
  }, { jwtIssuer: 'expected-issuer', jwtAudience: 'expected-audience' });
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
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-201', traceId: 'trace-1', correlationId: 'corr-1', payload: { title: 'Projection task', initial_stage: 'BACKLOG', priority: 'P0', technical_spec: 'Initial technical spec', monitoring_spec: 'Initial monitoring spec', linked_prs: [{ id: 'pr-7', number: 7, title: 'feat: task detail', state: 'open', repository: 'wiinc1/engineering-team' }] } }),
    });
    await fetch(`${baseUrl}/tasks/TSK-201/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.child_link_added', actorType: 'agent', idempotencyKey: 'child:TSK-201', payload: { child_task_id: 'TSK-202' } }),
    });
    await fetch(`${baseUrl}/tasks/TSK-202/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-202', payload: { title: 'Child task', initial_stage: 'REVIEW' } }),
    });
    await fetch(`${baseUrl}/tasks/TSK-201/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.comment_workflow_recorded', actorType: 'agent', idempotencyKey: 'comment:TSK-201', payload: { technical_spec: 'Revised technical spec', monitoring_spec: 'Revised monitoring spec' } }),
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
    assert.equal(summary.event_count, 3);
    assert.equal(summary.access.restricted, true);
    assert.deepEqual(summary.correlation.approved_correlation_ids, ['comment:TSK-201', 'child:TSK-201', 'corr-1']);
    assert.equal(summary.trace_ids, undefined);

    const detailRes = await fetch(`${baseUrl}/tasks/TSK-201/detail`, { headers: readHeaders });
    const detail = await detailRes.json();
    assert.equal(detailRes.status, 200);
    assert.equal(detail.task.id, 'TSK-201');
    assert.equal(detail.task.status, 'active');
    assert.equal(detail.summary.prStatus.label, '1 open PR linked');
    assert.equal(detail.summary.childStatus.total, 1);
    assert.equal(detail.context.technicalSpec, 'Revised technical spec');
    assert.equal(detail.context.monitoringSpec, 'Revised monitoring spec');
    assert.equal(detail.meta.permissions.canViewLinkedPrMetadata, true);
    assert.equal(detail.relations.linkedPrs[0].number, 7);
    assert.equal(detail.relations.childTasks[0].stage, 'REVIEW');
    assert.equal(detail.relations.childTasks[0].id, 'TSK-202');

    const metricsRes = await fetch(`${baseUrl}/metrics`, { headers: authHeaders(secret, { tenant_id: 'tenant-z', roles: ['admin'] }) });
    const metrics = await metricsRes.text();
    assert.equal(metricsRes.status, 200);
    assert.match(metrics, /workflow_audit_events_written_total 4/);
    assert.match(metrics, /workflow_projection_lag_seconds 0/);
  });
});

test('omits restricted detail sections server-side for low-permission viewers', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const writeHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { tenant_id: 'tenant-z', roles: ['contributor'] }),
    };

    await fetch(`${baseUrl}/tasks/TSK-301/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-301', payload: { title: 'Restricted detail', initial_stage: 'BACKLOG', child_task_ids: ['TSK-302'] } }),
    });
    await fetch(`${baseUrl}/tasks/TSK-302/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-302', payload: { title: 'Restricted child', initial_stage: 'TODO' } }),
    });
    await fetch(`${baseUrl}/tasks/TSK-301/events`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ eventType: 'task.comment_workflow_recorded', actorType: 'agent', idempotencyKey: 'comment:TSK-301', payload: { body: 'Hidden comment', linked_prs: [{ number: 12, title: 'feat: hidden detail' }] } }),
    });

    const response = await fetch(`${baseUrl}/tasks/TSK-301/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-z', roles: ['stakeholder'] }),
    });
    const detail = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(detail.activity.comments, []);
    assert.deepEqual(detail.activity.auditLog, []);
    assert.deepEqual(detail.relations.linkedPrs, []);
    assert.deepEqual(detail.relations.childTasks, []);
    assert.equal(detail.telemetry.availability, 'restricted');
    assert.equal(detail.meta.permissions.canViewComments, false);
    assert.equal(detail.meta.permissions.canViewAuditLog, false);
    assert.equal(detail.meta.permissions.canViewTelemetry, false);
    assert.equal(detail.meta.permissions.canViewChildTasks, false);
    assert.equal(detail.meta.permissions.canViewLinkedPrMetadata, false);
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

test('supports review question workflow endpoints and blocks architect handoff until blocking questions are resolved', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-rq', roles: ['contributor', 'architect'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-RQ-1', payload: { title: 'Review question task', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-RQ-1:ARCHITECT_REVIEW', payload: { from_stage: 'BACKLOG', to_stage: 'ARCHITECT_REVIEW' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'observer', tenant_id: 'tenant-rq', roles: ['contributor'] }),
      },
      body: JSON.stringify({ prompt: 'Unauthorized review question', blocking: true }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ prompt: 'What is the PM-approved state machine?', blocking: true }),
    });
    assert.equal(response.status, 201);
    const createdQuestion = await response.json();
    assert.ok(createdQuestion.questionId);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-rq', roles: ['reader'] }),
    });
    const summary = await response.json();
    assert.equal(summary.blocked, true);
    assert.equal(summary.waiting_state, 'pm_review_question_resolution');
    assert.equal(summary.next_required_action, 'Resolve blocking architect review questions');

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-rq', roles: ['reader'] }),
    });
    const detail = await response.json();
    assert.equal(detail.reviewQuestions.summary.unresolvedBlockingCount, 1);
    assert.equal(detail.reviewQuestions.items[0].state, 'open');
    assert.equal(detail.reviewQuestions.pinned.length, 1);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-RQ-1:TECHNICAL_SPEC:blocked', payload: { from_stage: 'ARCHITECT_REVIEW', to_stage: 'TECHNICAL_SPEC' } }),
    });
    const blockedTransition = await response.json();
    assert.equal(response.status, 400);
    assert.equal(blockedTransition.error.code, 'workflow_violation');

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions/${createdQuestion.questionId}/answers`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'observer', tenant_id: 'tenant-rq', roles: ['contributor'] }),
      },
      body: JSON.stringify({ body: 'Trying to answer without PM role.' }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions/${createdQuestion.questionId}/answers`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'pm-user', tenant_id: 'tenant-rq', roles: ['pm', 'contributor'] }),
      },
      body: JSON.stringify({ body: 'Use open, answered, resolved, reopened.' }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions/${createdQuestion.questionId}/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'observer', tenant_id: 'tenant-rq', roles: ['contributor'] }),
      },
      body: JSON.stringify({ resolution: 'Looks good' }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions/${createdQuestion.questionId}/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'pm-user', tenant_id: 'tenant-rq', roles: ['pm', 'contributor'] }),
      },
      body: JSON.stringify({ resolution: 'PM resolved after answer' }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions/${createdQuestion.questionId}/reopen`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-rq', roles: ['architect', 'contributor'] }),
      },
      body: JSON.stringify({ reason: 'Need more detail' }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions/${createdQuestion.questionId}/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'pm-user', tenant_id: 'tenant-rq', roles: ['pm', 'contributor'] }),
      },
      body: JSON.stringify({ resolution: 'Resolved again' }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/review-questions`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-rq', roles: ['reader'] }),
    });
    const questions = await response.json();
    assert.equal(questions.summary.unresolvedBlockingCount, 0);
    assert.equal(questions.items[0].resolvedBy, 'pm-user');
    assert.equal(questions.items[0].state, 'resolved');

    response = await fetch(`${baseUrl}/tasks/TSK-RQ-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-RQ-1:TECHNICAL_SPEC:ok', payload: { from_stage: 'ARCHITECT_REVIEW', to_stage: 'TECHNICAL_SPEC' } }),
    });
    assert.equal(response.status, 202);
  });
});

test('records structured architect handoff details, versions revisions, and blocks implementation until ready', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-handoff', roles: ['architect', 'contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-HO-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-HO-1', payload: { title: 'Architect handoff task', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-HO-1:ARCHITECT_REVIEW', payload: { from_stage: 'BACKLOG', to_stage: 'ARCHITECT_REVIEW' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-HO-1:TECHNICAL_SPEC', payload: { from_stage: 'ARCHITECT_REVIEW', to_stage: 'TECHNICAL_SPEC' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-HO-1:IMPLEMENTATION:blocked', payload: { from_stage: 'TECHNICAL_SPEC', to_stage: 'IMPLEMENTATION' } }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'workflow_violation');

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/architect-handoff`, {
      method: 'PUT',
      headers: architectHeaders,
      body: JSON.stringify({
        readyForEngineering: true,
        engineerTier: 'Sr',
        tierRationale: 'Standard scope with audit and UI work.',
        technicalSpec: {
          summary: 'Define API contract.',
          scope: 'No cross-tenant writes.',
          design: 'Dedicated handoff endpoint.',
          rolloutPlan: 'Ship behind ff-architect-spec-tiering.',
        },
        monitoringSpec: {
          service: 'workflow-audit-api',
          dashboardUrls: ['https://dash.example/handoff'],
          alertPolicies: ['Latency budget breach'],
          runbook: 'docs/runbooks/audit-foundation.md',
          successMetrics: ['p95 under 250ms'],
        },
      }),
    });
    assert.equal(response.status, 200);
    const firstHandoff = await response.json();
    assert.equal(firstHandoff.data.version, 1);
    assert.equal(firstHandoff.data.engineerTier, 'Sr');

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-handoff', roles: ['reader'] }),
    });
    const detail = await response.json();
    assert.equal(response.status, 200);
    assert.equal(detail.context.architectHandoff.version, 1);
    assert.equal(detail.context.architectHandoff.engineerTier, 'Sr');
    assert.equal(detail.context.architectHandoff.tierRationale, 'Standard scope with audit and UI work.');
    assert.equal(detail.context.architectHandoff.monitoringSpec.dashboardUrls[0], 'https://dash.example/handoff');
    assert.match(detail.context.technicalSpec, /Define API contract/);

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/architect-handoff`, {
      method: 'PUT',
      headers: architectHeaders,
      body: JSON.stringify({
        readyForEngineering: true,
        engineerTier: 'Principal',
        tierRationale: 'Scope expanded to cross-team migration.',
        technicalSpec: {
          summary: 'Define API contract and migration path.',
          scope: 'Coordinate rollout across services.',
          design: 'Dedicated endpoint plus versioned handoff.',
          rolloutPlan: 'Canary then default on.',
        },
        monitoringSpec: {
          service: 'workflow-audit-api',
          dashboardUrls: ['https://dash.example/handoff-v2'],
          alertPolicies: ['Latency budget breach', 'Error budget breach'],
          runbook: 'docs/runbooks/audit-foundation.md',
          successMetrics: ['p95 under 250ms', 'error rate under 1%'],
        },
      }),
    });
    assert.equal(response.status, 200);
    const revisedHandoff = await response.json();
    assert.equal(revisedHandoff.data.version, 2);
    assert.equal(revisedHandoff.data.engineerTier, 'Principal');

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-HO-1:IMPLEMENTATION:ok', payload: { from_stage: 'TECHNICAL_SPEC', to_stage: 'IMPLEMENTATION' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-HO-1/state`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-handoff', roles: ['reader'] }),
    });
    const state = await response.json();
    assert.equal(state.engineer_tier, 'Principal');
    assert.equal(state.architect_handoff_version, 2);
    assert.equal(state.ready_for_engineering, true);
  });
});

test('validates required architect handoff fields and feature flag state', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-handoff', roles: ['architect', 'contributor'] }),
    };

    await fetch(`${baseUrl}/tasks/TSK-HO-2/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-HO-2', payload: { title: 'Architect handoff validation', initial_stage: 'ARCHITECT_REVIEW' } }),
    });

    let response = await fetch(`${baseUrl}/tasks/TSK-HO-2/architect-handoff`, {
      method: 'PUT',
      headers: architectHeaders,
      body: JSON.stringify({
        readyForEngineering: false,
        engineerTier: '',
        tierRationale: '',
        technicalSpec: { summary: '', scope: '', design: '', rolloutPlan: '' },
        monitoringSpec: { service: '', dashboardUrls: [], alertPolicies: [], runbook: '', successMetrics: [] },
      }),
    });
    assert.equal(response.status, 400);
    const invalidBody = await response.json();
    assert.equal(invalidBody.error.code, 'missing_required_architect_fields');
    assert.ok(invalidBody.error.details.missing_fields.includes('technicalSpec.summary'));
    assert.ok(invalidBody.error.details.missing_fields.includes('readyForEngineering'));
  });

  await withServer(async ({ baseUrl, secret }) => {
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-handoff', roles: ['architect', 'contributor'] }),
    };

    const response = await fetch(`${baseUrl}/tasks/TSK-HO-3/architect-handoff`, {
      method: 'PUT',
      headers: architectHeaders,
      body: JSON.stringify({
        readyForEngineering: true,
        engineerTier: 'Sr',
        tierRationale: 'Disabled path test.',
        technicalSpec: { summary: 'a', scope: 'b', design: 'c', rolloutPlan: 'd' },
        monitoringSpec: { service: 'svc', dashboardUrls: ['x'], alertPolicies: ['y'], runbook: 'z', successMetrics: ['m'] },
      }),
    });
    assert.equal(response.status, 503);
    const disabledBody = await response.json();
    assert.equal(disabledBody.error.code, 'feature_disabled');
    assert.equal(disabledBody.error.details.feature, 'ff_architect_spec_tiering');
  }, { architectSpecTieringEnabled: false });
});

test('records engineer implementation metadata, exposes the primary reference in detail, and blocks QA until submitted', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-engineer', roles: ['architect', 'contributor'] }),
    };
    const engineerHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'engineer-user', tenant_id: 'tenant-engineer', roles: ['engineer', 'contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-ENG-1', payload: { title: 'Engineer handoff validation', initial_stage: 'ARCHITECT_REVIEW' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-ENG-1:TECHNICAL_SPEC', payload: { from_stage: 'ARCHITECT_REVIEW', to_stage: 'TECHNICAL_SPEC' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/architect-handoff`, {
      method: 'PUT',
      headers: architectHeaders,
      body: JSON.stringify({
        readyForEngineering: true,
        engineerTier: 'Sr',
        tierRationale: 'Standard implementation ownership.',
        technicalSpec: {
          summary: 'Engineers need the full architected implementation plan.',
          scope: 'Keep tenant isolation intact.',
          design: 'Submit implementation metadata before QA.',
          rolloutPlan: 'Feature-flag the handoff path.',
        },
        monitoringSpec: {
          service: 'workflow-audit-api',
          dashboardUrls: ['https://dash.example/engineer'],
          alertPolicies: ['Implementation queue latency breach'],
          runbook: 'docs/runbooks/audit-foundation.md',
          successMetrics: ['submission coverage 100%'],
        },
      }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-ENG-1:IMPLEMENTATION', payload: { from_stage: 'TECHNICAL_SPEC', to_stage: 'IMPLEMENTATION' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-ENG-1:QA_TESTING:blocked', payload: { from_stage: 'IMPLEMENTATION', to_stage: 'QA_TESTING' } }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /QA handoff cannot be completed until engineer submission includes a commit SHA or PR URL/);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({
        commitSha: 'abc1234def5678',
        prUrl: 'https://github.com/wiinc1/engineering-team/pull/14',
      }),
    });
    assert.equal(response.status, 200);
    const submissionBody = await response.json();
    assert.equal(submissionBody.data.version, 1);
    assert.equal(submissionBody.data.primaryReference.type, 'pr_url');

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-engineer', roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.context.engineerSubmission.version, 1);
    assert.equal(detail.context.engineerSubmission.commitSha, 'abc1234def5678');
    assert.equal(detail.context.engineerSubmission.primaryReference.label, 'https://github.com/wiinc1/engineering-team/pull/14');
    assert.match(detail.activity.auditLog[0].summary, /Engineer submission recorded/);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-ENG-1:QA_TESTING:ok', payload: { from_stage: 'IMPLEMENTATION', to_stage: 'QA_TESTING' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-1/state`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-engineer', roles: ['reader'] }),
    });
    const state = await response.json();
    assert.equal(state.current_stage, 'QA_TESTING');
    assert.equal(state.implementation_commit_sha, 'abc1234def5678');
    assert.equal(state.implementation_pr_url, 'https://github.com/wiinc1/engineering-team/pull/14');
  });
});

test('validates engineer metadata formats, stage restrictions, and feature flag state', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const engineerHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'engineer-user', tenant_id: 'tenant-engineer', roles: ['engineer', 'contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-ENG-2/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-ENG-2', payload: { title: 'Engineer metadata validation', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-2/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({ commitSha: '', prUrl: '' }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'invalid_stage');

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-2/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-ENG-2:IN_PROGRESS', payload: { from_stage: 'BACKLOG', to_stage: 'IN_PROGRESS' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-2/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({ commitSha: 'bad sha', prUrl: 'https://example.com/pull/14' }),
    });
    assert.equal(response.status, 400);
    const invalidBody = await response.json();
    assert.equal(invalidBody.error.code, 'invalid_engineer_metadata');
    assert.ok(invalidBody.error.details.invalid_fields.includes('commitSha'));
    assert.ok(invalidBody.error.details.invalid_fields.includes('prUrl'));

    response = await fetch(`${baseUrl}/tasks/TSK-ENG-2/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({ commitSha: '', prUrl: '' }),
    });
    assert.equal(response.status, 400);
    const missingBody = await response.json();
    assert.equal(missingBody.error.code, 'missing_required_engineer_metadata');
    assert.ok(missingBody.error.details.missing_fields.includes('commitShaOrPrUrl'));
  });

  await withServer(async ({ baseUrl, secret }) => {
    const engineerHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'engineer-user', tenant_id: 'tenant-engineer', roles: ['engineer', 'contributor'] }),
    };

    const response = await fetch(`${baseUrl}/tasks/TSK-ENG-3/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({ commitSha: 'abc1234' }),
    });
    assert.equal(response.status, 503);
    const disabledBody = await response.json();
    assert.equal(disabledBody.error.code, 'feature_disabled');
    assert.equal(disabledBody.error.details.feature, 'ff_engineer_submission');
  }, { engineerSubmissionEnabled: false });
});

test('enforces task locking, allows expiry/release recovery, and exempts architect read-only check-ins', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const engineerHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'engineer-user', tenant_id: 'tenant-lock', roles: ['engineer', 'contributor'] }),
    };
    const pmHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'pm-user', tenant_id: 'tenant-lock', roles: ['pm'] }),
    };
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-lock', roles: ['architect', 'contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-LOCK-1', payload: { title: 'Lock semantics', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/lock`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ reason: 'Engineer editing task state', action: 'stage_transition', ttlSeconds: 600 }),
    });
    assert.equal(response.status, 200);
    const firstLock = await response.json();

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/lock`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ reason: 'Extending edit session', action: 'stage_transition', ttlSeconds: 900 }),
    });
    assert.equal(response.status, 200);
    const renewedLock = await response.json();
    assert.notEqual(renewedLock.data.lock.expiresAt, firstLock.data.lock.expiresAt);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/assignment`, {
      method: 'PATCH',
      headers: pmHeaders,
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 409);
    const lockConflict = await response.json();
    assert.equal(lockConflict.error.code, 'task_locked');
    assert.equal(lockConflict.error.details.lock.owner_id, 'engineer-user');

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({
        eventType: 'task.comment_workflow_recorded',
        actorType: 'agent',
        idempotencyKey: 'checkin:TSK-LOCK-1',
        payload: { comment_type: 'architect_check_in', body: 'Read-only architecture check-in while the task is locked.' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({
        eventType: 'task.stage_changed',
        actorType: 'agent',
        idempotencyKey: 'move:TSK-LOCK-1:TODO',
        payload: { from_stage: 'BACKLOG', to_stage: 'TODO' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-lock', roles: ['reader'] }),
    });
    let detail = await response.json();
    assert.equal(response.status, 200);
    assert.equal(detail.meta.lock, null);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/lock`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ reason: 'Wrap-up after transition', action: 'final_cleanup', ttlSeconds: 300 }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/lock`, {
      method: 'DELETE',
      headers: engineerHeaders,
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/assignment`, {
      method: 'PATCH',
      headers: pmHeaders,
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-LOCK-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-lock', roles: ['reader'] }),
    });
    detail = await response.json();
    assert.equal(response.status, 200);
    assert.equal(detail.meta.lock, null);
    assert.match(detail.activity.auditLog.find((entry) => entry.type === 'task.lock_conflict').summary, /Task lock conflict/);
    assert.match(detail.activity.auditLog.find((entry) => entry.type === 'task.lock_released').summary, /Task lock released/);
  });
});

test('records structured workflow threads with type, blocking state, resolution, and workflow-event linkage', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-thread', roles: ['architect', 'contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-THREAD-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-THREAD-1', payload: { title: 'Structured comments', initial_stage: 'ARCHITECT_REVIEW' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-THREAD-1/workflow-threads`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        commentType: 'escalation',
        title: 'Need PM approval on degraded rollout path',
        body: 'Escalate the missing rollout decision before implementation proceeds.',
        blocking: true,
        linkedEventId: 'evt-rollout-1',
      }),
    });
    assert.equal(response.status, 201);
    const created = await response.json();

    response = await fetch(`${baseUrl}/tasks/TSK-THREAD-1/workflow-threads/${created.threadId}/replies`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ body: 'Added PM follow-up context and deployment constraints.' }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-THREAD-1/workflow-threads/${created.threadId}/resolve`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({ resolution: 'PM approved the rollout guardrail.' }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-THREAD-1/workflow-threads`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-thread', roles: ['reader'] }),
    });
    assert.equal(response.status, 200);
    const threads = await response.json();
    assert.equal(threads.summary.total, 1);
    assert.equal(threads.summary.resolvedCount, 1);
    assert.equal(threads.items[0].commentType, 'escalation');
    assert.equal(threads.items[0].linkedEventId, 'evt-rollout-1');
    assert.equal(threads.items[0].blocking, true);
    assert.equal(threads.items[0].messages.length, 3);

    response = await fetch(`${baseUrl}/tasks/TSK-THREAD-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-thread', roles: ['reader'] }),
    });
    const detail = await response.json();
    assert.equal(response.status, 200);
    assert.equal(detail.activity.workflowThreads.items[0].commentType, 'escalation');
    assert.match(detail.activity.auditLog[0].summary, /resolved/);
  });
});

test('records structured QA results, routes fail/pass outcomes, preserves re-test linkage, and exposes escalation packages plus fix history', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const architectHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'architect-user', tenant_id: 'tenant-qa', roles: ['architect', 'contributor'] }),
    };
    const engineerHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'engineer-user', tenant_id: 'tenant-qa', roles: ['engineer', 'contributor'] }),
    };
    const qaHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { sub: 'qa-user', tenant_id: 'tenant-qa', roles: ['qa', 'contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-QA-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-QA-1',
        payload: {
          title: 'QA workflow package',
          initial_stage: 'ARCHITECT_REVIEW',
          business_context: 'Ship workflow handoff safely.',
          acceptance_criteria: ['QA artifacts are structured'],
          definition_of_done: ['QA fail routes to implementation', 'QA pass routes to SRE'],
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-QA-1:TECHNICAL_SPEC', payload: { from_stage: 'ARCHITECT_REVIEW', to_stage: 'TECHNICAL_SPEC' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/architect-handoff`, {
      method: 'PUT',
      headers: architectHeaders,
      body: JSON.stringify({
        readyForEngineering: true,
        engineerTier: 'Sr',
        tierRationale: 'Standard implementation with QA loop.',
        technicalSpec: {
          summary: 'Implement structured QA artifact routing.',
          scope: 'No cross-tenant leakage.',
          design: 'Persist QA result artifacts and route by outcome.',
          rolloutPlan: 'Feature-flag the QA path.',
        },
        monitoringSpec: {
          service: 'workflow-audit-api',
          dashboardUrls: ['https://dash.example/qa'],
          alertPolicies: ['QA handoff failures'],
          runbook: 'docs/runbooks/audit-foundation.md',
          successMetrics: ['QA route coverage 100%'],
        },
      }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/events`, {
      method: 'POST',
      headers: architectHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-QA-1:IMPLEMENTATION', payload: { from_stage: 'TECHNICAL_SPEC', to_stage: 'IMPLEMENTATION' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({ commitSha: 'abc1234def5678', prUrl: 'https://github.com/wiinc1/engineering-team/pull/101' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-QA-1:QA_TESTING', payload: { from_stage: 'IMPLEMENTATION', to_stage: 'QA_TESTING' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/qa-results`, {
      method: 'POST',
      headers: qaHeaders,
      body: JSON.stringify({
        outcome: 'fail',
        summary: 'Regression in the audit history view.',
        scenarios: ['history tab render'],
        findings: ['timeline does not show latest event'],
        reproductionSteps: ['open task detail', 'switch to history'],
        stackTraces: ['TypeError: timeline is undefined'],
        envLogs: ['browser:chromium', 'api:local'],
        retestScope: ['history tab render', 'timeline pagination'],
      }),
    });
    assert.equal(response.status, 201);
    const failedQa = await response.json();
    assert.equal(failedQa.data.routedToStage, 'IMPLEMENTATION');
    assert.equal(failedQa.data.escalationPackage.routing.required_engineer_tier, 'Sr');
    assert.equal(failedQa.data.escalationPackage.previous_fix_history.length, 1);
    assert.equal(failedQa.data.escalationPackage.notification_preview.recipient_role, 'engineer');
    assert.equal(failedQa.data.escalationPackage.notification_preview.highlights[0], 'Regression in the audit history view.');

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/state`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-qa', roles: ['reader'] }),
    });
    let state = await response.json();
    assert.equal(state.current_stage, 'IMPLEMENTATION');

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/engineer-submission`, {
      method: 'PUT',
      headers: engineerHeaders,
      body: JSON.stringify({ commitSha: 'fedcba987654321', prUrl: 'https://github.com/wiinc1/engineering-team/pull/102' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/events`, {
      method: 'POST',
      headers: engineerHeaders,
      body: JSON.stringify({ eventType: 'task.stage_changed', actorType: 'agent', idempotencyKey: 'move:TSK-QA-1:QA_TESTING:retest', payload: { from_stage: 'IMPLEMENTATION', to_stage: 'QA_TESTING' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/qa-results`, {
      method: 'POST',
      headers: qaHeaders,
      body: JSON.stringify({
        outcome: 'pass',
        summary: 'Scoped re-test passed after the second implementation submission.',
        scenarios: ['history tab render', 'timeline pagination'],
        findings: [],
        reproductionSteps: [],
        stackTraces: [],
        envLogs: [],
        retestScope: ['history tab render', 'timeline pagination'],
      }),
    });
    assert.equal(response.status, 201);
    const passedQa = await response.json();
    assert.equal(passedQa.data.runKind, 'retest');
    assert.equal(passedQa.data.routedToStage, 'SRE_MONITORING');

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/detail`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-qa', roles: ['reader'] }),
    });
    const detail = await response.json();
    assert.equal(response.status, 200);
    assert.equal(detail.context.qaResults.summary.total, 2);
    assert.equal(detail.context.qaResults.latest.runKind, 'retest');
    assert.equal(detail.context.qaResults.latest.priorRunId, failedQa.data.runId);
    assert.equal(detail.context.implementationHistory.length, 2);
    assert.equal(detail.context.qaResults.items[1].escalationPackage.pm_requirements.business_context, 'Ship workflow handoff safely.');

    response = await fetch(`${baseUrl}/tasks/TSK-QA-1/state`, {
      headers: authHeaders(secret, { tenant_id: 'tenant-qa', roles: ['reader'] }),
    });
    state = await response.json();
    assert.equal(state.current_stage, 'SRE_MONITORING');
  });
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

test('returns standardized error payload when task detail page feature flag is off', async () => {
  const prior = process.env.FF_TASK_DETAIL_PAGE;
  process.env.FF_TASK_DETAIL_PAGE = '0';

  try {
    await withServer(async ({ baseUrl, secret }) => {
      const response = await fetch(`${baseUrl}/tasks/TSK-999/detail`, {
        headers: authHeaders(secret, { tenant_id: 'tenant-a', roles: ['reader'] }),
      });
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.error.code, 'feature_disabled');
      assert.equal(body.error.details.feature, 'ff_task_detail_page');
      assert.ok(body.error.request_id);
    });
  } finally {
    if (prior == null) delete process.env.FF_TASK_DETAIL_PAGE;
    else process.env.FF_TASK_DETAIL_PAGE = prior;
  }
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
