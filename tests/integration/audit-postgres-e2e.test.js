const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createPgPoolFromEnv, createPostgresAuditStore, createAuditApiServer } = require('../../lib/audit');

const connectionString = process.env.DATABASE_URL;
const shouldRun = Boolean(connectionString);

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, payload = {}) {
  return {
    authorization: `Bearer ${sign({ sub: 'principal-engineer', tenant_id: 'tenant-int', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 60, ...payload }, secret)}`,
  };
}

const pgTest = shouldRun ? test : test.skip;

pgTest('postgres audit flow covers migration -> ingest -> projection queue -> outbox -> metrics', async () => {
  const pool = createPgPoolFromEnv(connectionString);
  const store = createPostgresAuditStore({ pool, baseDir: process.cwd(), maxAttempts: 2 });
  const secret = 'integration-secret';
  const { server } = createAuditApiServer({ store, jwtSecret: secret });

  try {
    await store.runMigrations({ baseDir: process.cwd() });
    await pool.query('TRUNCATE audit_projection_queue, audit_outbox, audit_task_history, audit_task_current_state, audit_task_relationships, audit_events, audit_metrics RESTART IDENTITY CASCADE');

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, { roles: ['contributor'] }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-PG-001/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-PG-001',
        traceId: 'trace-pg-1',
        correlationId: 'corr-pg-1',
        payload: { title: 'Postgres e2e task', initial_stage: 'BACKLOG', priority: 'P0', waiting_state: 'awaiting_pm_decision', next_required_action: 'PM triage required' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-PG-001/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.stage_changed',
        actorType: 'agent',
        idempotencyKey: 'move:TSK-PG-001:IN_PROGRESS',
        correlationId: 'corr-pg-2',
        payload: { from_stage: 'BACKLOG', to_stage: 'IN_PROGRESS' },
      }),
    });
    assert.equal(response.status, 202);

    const readHeaders = authHeaders(secret, { roles: ['reader'] });
    response = await fetch(`${baseUrl}/tasks/TSK-PG-001/history`, { headers: readHeaders });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [], page_info: { limit: 25, next_cursor: null, has_more: false } });

    response = await fetch(`${baseUrl}/projections/process?limit=100`, {
      method: 'POST',
      headers: authHeaders(secret, { roles: ['admin'] }),
    });
    assert.equal(response.status, 202);
    const projectionResult = await response.json();
    assert.equal(projectionResult.processed, 2);

    const published = [];
    const outboxResult = await store.processOutbox(event => published.push(event), 100);
    assert.equal(outboxResult.processed, 2);
    assert.equal(published.length, 2);

    response = await fetch(`${baseUrl}/tasks/TSK-PG-001/history`, { headers: readHeaders });
    const historyPayload = await response.json();
    const history = historyPayload.items;
    assert.equal(history.length, 2);
    assert.equal(history[0].sequence_number, 2);
    assert.equal(history[1].sequence_number, 1);
    assert.equal(history[0].summary, 'Stage changed BACKLOG → IN_PROGRESS');

    response = await fetch(`${baseUrl}/tasks/TSK-PG-001/state`, { headers: readHeaders });
    const state = await response.json();
    assert.equal(state.current_stage, 'IN_PROGRESS');
    assert.equal(state.priority, 'P0');
    assert.equal(state.waiting_state, null);
    assert.equal(state.next_required_action, null);
    assert.equal(state.wip_owner, 'principal-engineer');
    assert.ok(state.wip_started_at);
    assert.ok(state.queue_entered_at);

    response = await fetch(`${baseUrl}/tasks/TSK-PG-001/observability-summary`, { headers: readHeaders });
    const summary = await response.json();
    assert.equal(summary.event_count, 2);
    assert.deepEqual(summary.correlation.approved_correlation_ids.sort(), ['corr-pg-1', 'corr-pg-2']);
    assert.equal(summary.access.restricted, true);

    const metrics = await store.readMetrics();
    assert.equal(metrics.workflow_audit_events_written_total, 2);
    assert.equal(metrics.workflow_projection_events_processed_total, 2);
    assert.equal(metrics.workflow_outbox_events_published_total, 2);
    assert.equal(metrics.workflow_history_queries_total >= 2, true);
    assert.equal(metrics.workflow_projection_lag_seconds, 0);

    await assert.rejects(
      () => pool.query("UPDATE audit_events SET event_type = 'task.closed' WHERE task_id = 'TSK-PG-001'"),
      /append-only/,
    );

    const rebuild = await store.rebuildProjections();
    assert.equal(rebuild.rebuiltEvents, 2);

    const postRebuildHistory = await store.getTaskHistory('TSK-PG-001', { tenantId: 'tenant-int' });
    assert.equal(postRebuildHistory.length, 2);

    const rebuiltState = await store.getTaskCurrentState('TSK-PG-001', { tenantId: 'tenant-int' });
    assert.equal(rebuiltState.wip_owner, 'principal-engineer');
    assert.ok(rebuiltState.wip_started_at);
  } finally {
    await new Promise(resolve => server.close(() => resolve()));
    await pool.end();
  }
});

pgTest('postgres store honors ff_audit_foundation kill switch', async () => {
  const pool = createPgPoolFromEnv(connectionString);
  const store = createPostgresAuditStore({ pool, baseDir: process.cwd(), auditFoundationEnabled: false });
  try {
    await assert.rejects(() => store.appendEvent({
      taskId: 'TSK-PG-DISABLED',
      tenantId: 'tenant-int',
      eventType: 'task.created',
      actorType: 'agent',
      actorId: 'principal-engineer',
      idempotencyKey: 'create:TSK-PG-DISABLED',
    }), /ff_audit_foundation/);
  } finally {
    await pool.end();
  }
});
