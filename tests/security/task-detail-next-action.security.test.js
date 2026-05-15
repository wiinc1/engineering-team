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

function authHeaders(secret, roles, sub = roles[0] || 'reader') {
  return {
    authorization: `Bearer ${sign({
      sub,
      tenant_id: 'tenant-next-action-sec',
      roles,
      exp: Math.floor(Date.now() / 1000) + 60,
    }, secret)}`,
  };
}

async function withServer(run) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-next-action-sec-'));
  const secret = 'task-next-action-sec-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function screen(overrides = {}) {
  return {
    summary: {
      taskId: 'TSK-SEC-NEXT-ACTION',
      title: 'Protected next action',
      currentStage: overrides.stage || 'QA_TESTING',
      currentOwner: 'qa',
      nextRequiredAction: overrides.nextRequiredAction || 'QA verification required',
      blocked: Boolean(overrides.blocked),
      waitingState: overrides.waitingState || null,
      freshness: { status: 'fresh', last_updated_at: '2026-05-15T10:00:00.000Z' },
    },
    detail: {
      task: { id: 'TSK-SEC-NEXT-ACTION', title: 'Protected next action', stage: overrides.stage || 'QA_TESTING', status: 'active' },
      summary: {
        owner: { id: 'qa', label: 'QA Engineer' },
        nextAction: { label: overrides.nextRequiredAction || 'QA verification required' },
        blockedState: { isBlocked: Boolean(overrides.blocked), waitingOn: overrides.waitingState || null },
        timers: { freshness: 'fresh' },
      },
      context: {},
      blockers: [],
      meta: { freshness: { status: 'fresh', lastUpdatedAt: '2026-05-15T10:00:00.000Z' } },
    },
  };
}

test('security: reader-only next-action state hides action controls client-side', async () => {
  const { resolveTaskDetailNextAction } = await import('../../src/features/task-detail/next-action.mjs');

  const result = resolveTaskDetailNextAction(screen(), { sub: 'reader-1', roles: ['reader'] });

  assert.equal(result.action, 'read_only_status');
  assert.equal(result.controlsAvailable, false);
  assert.equal(result.primaryHref, null);
  assert.equal(result.primaryLabel, null);
  assert.match(result.reason, /QA verification required/);
});

test('security: reader cannot submit QA next action through the workflow endpoint', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributor = { 'content-type': 'application/json', ...authHeaders(secret, ['contributor'], 'seed-1') };
    const reader = { 'content-type': 'application/json', ...authHeaders(secret, ['reader'], 'reader-1') };

    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-NEXT-ACTION/events`, {
      method: 'POST',
      headers: contributor,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-SEC-NEXT-ACTION',
        payload: { title: 'Protected QA action task', initial_stage: 'QA_TESTING' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-NEXT-ACTION/qa-results`, {
      method: 'POST',
      headers: reader,
      body: JSON.stringify({
        outcome: 'pass',
        summary: 'Reader attempted unauthorized QA submission.',
        scenarios: ['browser matrix'],
        findings: [],
      }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'forbidden');

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-NEXT-ACTION/history`, {
      headers: authHeaders(secret, ['reader'], 'reader-1'),
    });
    assert.equal(response.status, 200);
    const history = await response.json();
    assert.equal(history.items.some((item) => item.event_type === 'task.qa_result_recorded'), false);
  });
});
