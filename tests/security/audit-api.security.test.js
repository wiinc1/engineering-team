const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAuditApiServer } = require('../../lib/audit/http');
const { signBrowserAuthCode } = require('../../lib/auth/jwt');
const { assertSpecialistDelegationEnabled } = require('../../lib/audit/feature-flags');

function sign(payload, secret, header = { alg: 'HS256', typ: 'JWT' }) {
  const headerPart = Buffer.from(JSON.stringify(header)).toString('base64url');
  const bodyPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${headerPart}.${bodyPart}`).digest('base64url');
  return `${headerPart}.${bodyPart}.${signature}`;
}

function signRs256(payload, privateKey, header = { alg: 'RS256', typ: 'JWT', kid: 'kid-1' }) {
  const headerPart = Buffer.from(JSON.stringify(header)).toString('base64url');
  const bodyPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${headerPart}.${bodyPart}`), privateKey).toString('base64url');
  return `${headerPart}.${bodyPart}.${signature}`;
}

async function withServer(run, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-security-'));
  const secret = 'security-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret, baseDir });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function browserAuthCode(secret, payload = {}, options = {}) {
  return signBrowserAuthCode({
    actorId: 'pm-1',
    tenantId: 'tenant-sec',
    roles: ['pm', 'reader'],
    ...payload,
  }, secret, options);
}

function githubSignature(secret, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

const EXECUTION_CONTRACT_STANDARD_SECTIONS = ['1', '2', '3', '4', '6', '7', '10', '11', '12', '15', '16', '17'];
const EXECUTION_CONTRACT_SIMPLE_SECTIONS = ['1', '2', '4', '11', '12', '15', '16', '17'];

function standardExecutionContractSections() {
  return Object.fromEntries(EXECUTION_CONTRACT_STANDARD_SECTIONS.map((sectionId) => [
    sectionId,
    `Security completed Standard section ${sectionId}.`,
  ]));
}

function simpleExecutionContractSections() {
  return {
    ...Object.fromEntries(EXECUTION_CONTRACT_SIMPLE_SECTIONS.map((sectionId) => [
      sectionId,
      `Security completed Simple section ${sectionId}.`,
    ])),
    2: 'Given risk flags exist, when auto-approval policy runs, then explicit Operator Approval is still required.',
    11: 'Rollback by reverting the change or disabling the low-risk Simple auto-approval policy.',
    17: 'Operator handoff records policy, rationale, and timestamp.',
  };
}

// Governance note: audit-facing route changes should keep security coverage updated in the same change set.

test('specialist delegation disablement exposes only the canonical feature flag identifier', () => {
  assert.throws(
    () => assertSpecialistDelegationEnabled({ ffSpecialistDelegation: 'false' }),
    (error) => {
      assert.equal(error.code, 'feature_disabled');
      assert.match(error.message, /ff_real_specialist_delegation/);
      assert.doesNotMatch(error.message, /ff_specialist_delegation/);
      assert.equal(error.details.feature, 'ff_real_specialist_delegation');
      return true;
    },
  );
});

test('rejects tampered, expired, and issuer-mismatched bearer tokens', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const expired = sign({ sub: 'sec', tenant_id: 'tenant-sec', roles: ['reader'], exp: Math.floor(Date.now() / 1000) - 10 }, secret);
    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-1/history`, { headers: { authorization: `Bearer ${expired}` } });
    assert.equal(response.status, 401);
    assert.match(JSON.stringify(await response.json()), /expired/i);

    const wrongSecret = sign({ sub: 'sec', tenant_id: 'tenant-sec', roles: ['reader'], exp: Math.floor(Date.now() / 1000) + 60 }, 'not-the-secret');
    response = await fetch(`${baseUrl}/tasks/TSK-SEC-1/history`, { headers: { authorization: `Bearer ${wrongSecret}` } });
    assert.equal(response.status, 401);

    const issuerToken = sign({ sub: 'sec', tenant_id: 'tenant-sec', roles: ['reader'], iss: 'unexpected', exp: Math.floor(Date.now() / 1000) + 60 }, secret);
    const { server } = createAuditApiServer({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'audit-security-issuer-')), jwtSecret: secret, jwtIssuer: 'expected-issuer' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      response = await fetch(`http://127.0.0.1:${port}/tasks/TSK-SEC-1/history`, { headers: { authorization: `Bearer ${issuerToken}` } });
      assert.equal(response.status, 401);
    } finally {
      await new Promise(resolve => server.close(() => resolve()));
    }
  });
});

test('rejects invalid JSON, oversized bodies, and legacy headers unless explicitly enabled', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const auth = { authorization: `Bearer ${sign({ sub: 'sec', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };

    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-2/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: '{not valid json}',
    });
    assert.equal(response.status, 400);

    await assert.rejects(
      () => fetch(`${baseUrl}/tasks/TSK-SEC-2/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'oversized', payload: { body: 'x'.repeat(1024 * 1024 + 32) } }),
      }),
      /fetch failed/i,
    );

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-2/history`, {
      headers: { 'x-tenant-id': 'tenant-sec', 'x-actor-id': 'legacy', 'x-roles': 'reader' },
    });
    assert.equal(response.status, 401);
  });

  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/tasks/TSK-SEC-2/history`, {
      headers: { 'x-tenant-id': 'tenant-sec', 'x-actor-id': 'legacy', 'x-roles': 'reader' },
    });
    assert.equal(response.status, 200);
  }, { allowLegacyHeaders: true });
});

test('omits restricted telemetry fields for under-authorized task viewers', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorAuth = { authorization: `Bearer ${sign({ sub: 'eng', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const readerAuth = { authorization: `Bearer ${sign({ sub: 'pm', tenant_id: 'tenant-sec', roles: ['reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };

    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-3/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-SEC-3', traceId: 'trace-sec-3', correlationId: 'corr-sec-3', payload: { title: 'Security telemetry task', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-3/observability-summary`, { headers: readerAuth });
    assert.equal(response.status, 200);
    const restricted = await response.json();
    assert.equal(restricted.access.restricted, true);
    assert.deepEqual(restricted.access.omitted_fields, ['trace_ids', 'metrics', 'privileged_links']);
    assert.equal(restricted.trace_ids, undefined);
    assert.equal(restricted.metrics, undefined);
    assert.deepEqual(restricted.correlation.approved_correlation_ids, ['corr-sec-3']);
  });
});

test('reader scope keeps owner metadata visible while assignment remains forbidden', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorAuth = { authorization: `Bearer ${sign({ sub: 'eng', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const pmAuth = { authorization: `Bearer ${sign({ sub: 'pm', tenant_id: 'tenant-sec', roles: ['pm'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const readerAuth = { authorization: `Bearer ${sign({ sub: 'reader', tenant_id: 'tenant-sec', roles: ['reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };

    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-4/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-SEC-4', payload: { title: 'Owner visibility task', initial_stage: 'BACKLOG' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-4/assignment`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...pmAuth },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-4`, { headers: readerAuth });
    assert.equal(response.status, 200);
    const summary = await response.json();
    assert.equal(summary.current_owner, 'qa');
    assert.deepEqual(summary.owner, { actor_id: 'qa', display_name: 'qa' });

    response = await fetch(`${baseUrl}/tasks`, { headers: readerAuth });
    assert.equal(response.status, 200);
    const taskList = await response.json();
    assert.equal(taskList.items[0].current_owner, 'qa');

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-4/assignment`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...readerAuth },
      body: JSON.stringify({ agentId: null }),
    });
    assert.equal(response.status, 403);
  });
});

test('rejects engineer-only delivery mutations when the task has been reassigned away from engineering', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorAuth = { authorization: `Bearer ${sign({ sub: 'eng', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const pmAuth = { authorization: `Bearer ${sign({ sub: 'pm', tenant_id: 'tenant-sec', roles: ['pm'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const engineerAuth = { authorization: `Bearer ${sign({ sub: 'engineer-user', tenant_id: 'tenant-sec', roles: ['engineer'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };

    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-OWNER/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({ eventType: 'task.created', actorType: 'agent', idempotencyKey: 'create:TSK-SEC-OWNER', payload: { title: 'Owner-restricted task', initial_stage: 'IMPLEMENTATION' } }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-OWNER/assignment`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...pmAuth },
      body: JSON.stringify({ agentId: 'qa' }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-OWNER/check-ins`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...engineerAuth },
      body: JSON.stringify({ summary: 'Wrong owner tried to check in.' }),
    });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error.code, 'forbidden');
    assert.match(body.error.message, /currently assigned owner/i);
  });
});

test('rejects SRE monitoring mutations for callers without SRE or admin privileges', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorAuth = { authorization: `Bearer ${sign({ sub: 'eng', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const readerAuth = { authorization: `Bearer ${sign({ sub: 'reader', tenant_id: 'tenant-sec', roles: ['reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };

    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-SRE/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-SEC-SRE',
        payload: { title: 'Restricted SRE task', initial_stage: 'SRE_MONITORING' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-SRE/sre-monitoring/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...readerAuth },
      body: JSON.stringify({
        deploymentEnvironment: 'production',
        deploymentUrl: 'https://deploy.example/releases/sec-1',
        deploymentVersion: '2026.04.15-1',
      }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'forbidden');

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-SRE/sre-monitoring/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...readerAuth },
      body: JSON.stringify({
        reason: 'No authority',
        evidence: ['reader attempted approval'],
      }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'forbidden');

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-SRE/sre-monitoring/anomaly-child-task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...readerAuth },
      body: JSON.stringify({
        title: 'Investigate restricted anomaly',
        service: 'checkout-api',
        anomalySummary: 'Reader attempted anomaly creation.',
        metrics: ['5xx_rate: 8%'],
        logs: ['reader-request log sample'],
        errorSamples: ['TimeoutError'],
      }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'forbidden');
  });
});

test('rejects exceptional-dispute escalation for readers while allowing canonical human decisions on stakeholder escalation items', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorAuth = { authorization: `Bearer ${sign({ sub: 'eng', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const pmAuth = { authorization: `Bearer ${sign({ sub: 'pm', tenant_id: 'tenant-sec', roles: ['pm'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const readerAuth = { authorization: `Bearer ${sign({ sub: 'reader', tenant_id: 'tenant-sec', roles: ['reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const stakeholderAuth = { authorization: `Bearer ${sign({ sub: 'human', tenant_id: 'tenant-sec', roles: ['stakeholder'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };

    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-CLOSE/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-SEC-CLOSE',
        payload: { title: 'Close-review security task', initial_stage: 'PM_CLOSE_REVIEW' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-CLOSE/close-review/exceptional-dispute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...readerAuth },
      body: JSON.stringify({
        summary: 'Reader should not be able to escalate.',
        recommendation: 'Reject unauthorized escalation.',
        rationale: 'No write privileges.',
        severity: 'high',
      }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-CLOSE/close-review/exceptional-dispute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...pmAuth },
      body: JSON.stringify({
        summary: 'PM disputes whether cancellation is safer than reopening implementation.',
        recommendation: 'Human stakeholder should decide whether to cancel or reopen implementation.',
        rationale: 'Business timing changed after the close gate failed.',
        severity: 'critical',
      }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-CLOSE/close-review/human-decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...stakeholderAuth },
      body: JSON.stringify({
        outcome: 'request_more_context',
        summary: 'Need a clearer customer impact statement.',
        rationale: 'Escalation copy is not yet sufficient.',
        confirmationRequired: true,
      }),
    });
    assert.equal(response.status, 201);
  });
});

test('rejects premature human close decisions and requires counterpart approval before close-review backtrack routes', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorAuth = { authorization: `Bearer ${sign({ sub: 'eng', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const pmAuth = { authorization: `Bearer ${sign({ sub: 'pm', tenant_id: 'tenant-sec', roles: ['pm', 'reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const architectAuth = { authorization: `Bearer ${sign({ sub: 'architect', tenant_id: 'tenant-sec', roles: ['architect'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const stakeholderAuth = { authorization: `Bearer ${sign({ sub: 'stakeholder', tenant_id: 'tenant-sec', roles: ['stakeholder'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };

    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-CLOSE-GUARD/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-SEC-CLOSE-GUARD',
        payload: {
          title: 'Governed close review security guardrails',
          initial_stage: 'PM_CLOSE_REVIEW',
          acceptance_criteria: ['Keep stakeholder actions explicit'],
          waiting_state: 'awaiting_human_close_review',
          next_required_action: 'Human close review is required before final closure.',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-CLOSE-GUARD/close-review/human-decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...stakeholderAuth },
      body: JSON.stringify({
        outcome: 'approve',
        summary: 'Attempting to approve before decision readiness exists.',
        rationale: 'This should be rejected.',
      }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'human_close_decision_not_ready');

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-CLOSE-GUARD/close-review/backtrack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...pmAuth },
      body: JSON.stringify({
        reasonCode: 'criteria_gap',
        rationale: 'The close gate failed and implementation follow-up is required.',
        agreementArtifact: 'pm+architect-security-guard',
      }),
    });
    assert.equal(response.status, 202);
    let payload = await response.json();
    assert.equal(payload.data.awaitingRole, 'architect');

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-CLOSE-GUARD/state`, {
      headers: stakeholderAuth,
    });
    assert.equal(response.status, 200);
    let state = await response.json();
    assert.equal(state.current_stage, 'PM_CLOSE_REVIEW');

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-CLOSE-GUARD/close-review/backtrack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...architectAuth },
      body: JSON.stringify({
        reasonCode: 'criteria_gap',
        rationale: 'The close gate failed and implementation follow-up is required.',
        agreementArtifact: 'pm+architect-security-guard',
      }),
    });
    assert.equal(response.status, 201);
    payload = await response.json();
    assert.equal(payload.data.routedToStage, 'IMPLEMENTATION');

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-CLOSE-GUARD/state`, {
      headers: stakeholderAuth,
    });
    assert.equal(response.status, 200);
    state = await response.json();
    assert.equal(state.current_stage, 'IMPLEMENTATION');
  });
});

test('rejects generic anomaly-workflow event bypasses for PM completion and parent unblocking', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorAuth = { authorization: `Bearer ${sign({ sub: 'eng', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const pmAuth = { authorization: `Bearer ${sign({ sub: 'pm-1', tenant_id: 'tenant-sec', roles: ['pm', 'reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const sreAuth = { authorization: `Bearer ${sign({ sub: 'sre-1', tenant_id: 'tenant-sec', roles: ['sre', 'reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };

    let response = await fetch(`${baseUrl}/tasks/TSK-SEC-ANOM/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-SEC-ANOM',
        payload: { title: 'Security anomaly parent', initial_stage: 'SRE_MONITORING' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-ANOM/sre-monitoring/anomaly-child-task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...sreAuth },
      body: JSON.stringify({
        title: 'Investigate restricted anomaly',
        service: 'checkout-api',
        anomalySummary: 'Security test anomaly',
        metrics: ['5xx_rate: 8%'],
        logs: ['security log sample'],
        errorSamples: ['TimeoutError'],
      }),
    });
    assert.equal(response.status, 201);
    const { data } = await response.json();

    response = await fetch(`${baseUrl}/tasks/${data.childTaskId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({
        eventType: 'task.pm_business_context_completed',
        actorType: 'user',
        idempotencyKey: `forbidden-pm-complete:${data.childTaskId}`,
        payload: { business_context: 'Contributor tried to bypass PM review.' },
      }),
    });
    assert.equal(response.status, 403);
    assert.match(JSON.stringify(await response.json()), /PM\/admin/i);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-ANOM/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({
        eventType: 'task.unblocked',
        actorType: 'user',
        idempotencyKey: 'forbidden-parent-unblock',
        payload: { child_task_id: data.childTaskId, reason: 'Manual override' },
      }),
    });
    assert.equal(response.status, 403);
    assert.match(JSON.stringify(await response.json()), /resolution flow/i);
  });
});

test('browser auth bootstrap rejects missing and incomplete auth codes', async () => {
  await withServer(async ({ baseUrl, secret, baseDir }) => {
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
      body: JSON.stringify({
        authCode: 'actor=pm-1;roles=pm,reader',
      }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_auth_code');

    response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: browserAuthCode('wrong-secret'),
      }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_auth_code');

    response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: browserAuthCode(secret, {}, { issuer: 'unexpected-issuer' }),
      }),
    });
    assert.equal(response.status, 200);

    const log = fs.readFileSync(path.join(baseDir, 'observability', 'workflow-audit.log'), 'utf8');
    assert.match(log, /"path":"\/auth\/session"/);
    assert.match(log, /"error_code":"invalid_auth_code"/);
    assert.match(log, /"request_id":"/);
  });

  await withServer(async ({ baseUrl, secret }) => {
    const response = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authCode: browserAuthCode(secret, {}, { issuer: 'unexpected-issuer' }),
      }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_auth_code');
  }, { browserAuthCodeIssuer: 'expected-issuer' });
});

test('browser bootstrap tokens stay usable when the API enforces issuer and audience verification', async () => {
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

    const followUp = await fetch(`${baseUrl}/tasks`, {
      headers: { authorization: `Bearer ${payload.data.accessToken}` },
    });
    assert.equal(followUp.status, 200);
  }, { jwtIssuer: 'expected-issuer', jwtAudience: 'expected-audience' });
});

test('protects intake draft creation with auth, permission, and feature flag checks', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raw_requirements: 'Unauthorized intake request.' }),
    });
    assert.equal(response.status, 401);

    response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sign({ sub: 'reader', tenant_id: 'tenant-sec', roles: ['reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
      },
      body: JSON.stringify({ raw_requirements: 'Reader cannot create intake.' }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sign({ sub: 'pm', tenant_id: 'tenant-sec', roles: ['pm'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
      },
      body: JSON.stringify({ raw_requirements: '   ' }),
    });
    assert.equal(response.status, 400);
  });

  await withServer(async ({ baseUrl, secret }) => {
    const response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sign({ sub: 'pm', tenant_id: 'tenant-sec', roles: ['pm'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
      },
      body: JSON.stringify({ raw_requirements: 'Feature-flagged intake request.' }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.details.feature, 'ff_intake_draft_creation');
  }, { intakeDraftCreationEnabled: false });
});

test('protects Execution Contract generation with role, source, and feature-flag checks', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sign({ sub: 'operator', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
      },
      body: JSON.stringify({ raw_requirements: 'Secure the Execution Contract route.' }),
    });
    assert.equal(response.status, 201);
    const created = await response.json();

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateTier: 'Standard' }),
    });
    assert.equal(response.status, 401);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sign({ sub: 'reader', tenant_id: 'tenant-sec', roles: ['reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
      },
      body: JSON.stringify({ templateTier: 'Standard' }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sign({ sub: 'reader', tenant_id: 'tenant-sec', roles: ['reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-NON-INTAKE/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sign({ sub: 'admin', tenant_id: 'tenant-sec', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
      },
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-SEC-NON-INTAKE',
        payload: { title: 'Not an intake', initial_stage: 'BACKLOG' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-SEC-NON-INTAKE/execution-contract`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sign({ sub: 'pm', tenant_id: 'tenant-sec', roles: ['pm'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
      },
      body: JSON.stringify({ templateTier: 'Standard' }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'execution_contract_requires_intake_draft');
  });

  await withServer(async ({ baseUrl, secret }) => {
    const response = await fetch(`${baseUrl}/tasks/TSK-SEC-FLAG/execution-contract`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sign({ sub: 'pm', tenant_id: 'tenant-sec', roles: ['pm'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}`,
      },
      body: JSON.stringify({ templateTier: 'Standard' }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.details.feature, 'ff_execution_contracts');
  }, { executionContractsEnabled: false });
});

test('rejects direct Execution Contract approval event bypasses and enforces approval gates', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorAuth = { authorization: `Bearer ${sign({ sub: 'operator', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const pmAuth = { authorization: `Bearer ${sign({ sub: 'pm', tenant_id: 'tenant-sec', roles: ['pm', 'reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };

    let response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({ raw_requirements: 'Do not let generic events bypass contract approval gates.' }),
    });
    assert.equal(response.status, 201);
    const created = await response.json();

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...pmAuth },
      body: JSON.stringify({
        templateTier: 'Standard',
        riskFlags: ['deployment'],
        sections: standardExecutionContractSections(),
        reviewers: {
          architect: { status: 'approved', actorId: 'architect-sec' },
          ux: { status: 'approved', actorId: 'ux-sec' },
          qa: { status: 'pending' },
          sre: { status: 'pending' },
        },
      }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({
        eventType: 'task.execution_contract_approved',
        actorType: 'user',
        idempotencyKey: `forbidden-contract-approval:${created.taskId}`,
        payload: { version: 1, validation: { status: 'valid' } },
      }),
    });
    assert.equal(response.status, 403);
    assert.match(JSON.stringify(await response.json()), /dedicated approval endpoint/i);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({
        eventType: 'task.execution_contract_artifact_bundle_approved',
        actorType: 'user',
        idempotencyKey: `forbidden-artifact-approval:${created.taskId}`,
        payload: { version: 1, bundle_id: 'ART-TSK-1-v1', artifact_bundle: { status: 'approved_for_commit' } },
      }),
    });
    assert.equal(response.status, 403);
    assert.match(JSON.stringify(await response.json()), /artifact-bundle approval must use the dedicated approval endpoint/i);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({
        eventType: 'task.execution_contract_verification_report_generated',
        actorType: 'user',
        idempotencyKey: `forbidden-verification-report:${created.taskId}`,
        payload: { version: 1, report_id: 'VR-TSK-1-v1', verification_report: { status: 'generated' } },
      }),
    });
    assert.equal(response.status, 403);
    assert.match(JSON.stringify(await response.json()), /verification report skeletons must use the dedicated generation endpoint/i);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({
        eventType: 'task.contract_coverage_audit_validated',
        actorType: 'user',
        idempotencyKey: `forbidden-contract-coverage:${created.taskId}`,
        payload: { audit_id: 'CCA-BYPASS', validation: { status: 'closed' } },
      }),
    });
    assert.equal(response.status, 403);
    assert.match(JSON.stringify(await response.json()), /Contract Coverage Audit events must use the dedicated coverage endpoint/i);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/history`, {
      headers: pmAuth,
    });
    assert.equal(response.status, 200);
    const historyAfterRejectedArtifactBypass = await response.json();
    assert.ok(!historyAfterRejectedArtifactBypass.items.some((event) => event.event_type === 'task.execution_contract_artifact_bundle_approved'));
    assert.ok(!historyAfterRejectedArtifactBypass.items.some((event) => event.event_type === 'task.execution_contract_verification_report_generated'));
    assert.ok(!historyAfterRejectedArtifactBypass.items.some((event) => event.event_type === 'task.contract_coverage_audit_validated'));

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...pmAuth },
      body: JSON.stringify({ approvalNote: 'Attempt with missing QA and SRE approvals.' }),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error.code, 'execution_contract_approval_blocked');
    assert.deepEqual(body.error.details.missing_required_approvals.map((item) => item.role), ['qa', 'sre']);
  });
});

test('fails closed when policy auto-approval is requested for risk-bearing Simple contracts', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorAuth = { authorization: `Bearer ${sign({ sub: 'operator', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const pmAuth = { authorization: `Bearer ${sign({ sub: 'pm', tenant_id: 'tenant-sec', roles: ['pm', 'reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };

    let response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({
        raw_requirements: 'Auto approval must fail closed for risk-bearing Simple work.',
        title: 'Risk-bearing Simple auto approval',
      }),
    });
    assert.equal(response.status, 201);
    const created = await response.json();

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...pmAuth },
      body: JSON.stringify({
        templateTier: 'Simple',
        riskFlags: ['deployment'],
        sections: simpleExecutionContractSections(),
        reviewers: {
          qa: { status: 'approved', actorId: 'qa-sec' },
          sre: { status: 'approved', actorId: 'sre-sec' },
        },
        autoApprovalSignals: {
          productionSensitivePaths: ['Production auth callback configuration.'],
        },
      }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...pmAuth },
      body: JSON.stringify({ autoApproval: true }),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error.code, 'execution_contract_auto_approval_blocked');
    assert.ok(body.error.details.blocking_reasons.some((reason) => reason.code === 'risk_flags_require_operator_approval'));
    assert.ok(body.error.details.blocking_reasons.some((reason) => reason.code === 'production_auth_security_data_model_path_present'));

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/history`, {
      headers: pmAuth,
    });
    assert.equal(response.status, 200);
    const history = await response.json();
    assert.ok(!history.items.some((event) => event.event_type === 'task.execution_contract_approved'));
  });
});

test('rejects generic assignment event bypasses of approved-contract dispatch policy', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorAuth = { authorization: `Bearer ${sign({ sub: 'operator', tenant_id: 'tenant-sec', roles: ['contributor'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };
    const pmAuth = { authorization: `Bearer ${sign({ sub: 'pm', tenant_id: 'tenant-sec', roles: ['pm', 'reader'], exp: Math.floor(Date.now() / 1000) + 60 }, secret)}` };

    let response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({
        raw_requirements: 'Do not let generic assignment events bypass dispatch policy.',
        title: 'Dispatch policy bypass',
      }),
    });
    assert.equal(response.status, 201);
    const created = await response.json();

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...pmAuth },
      body: JSON.stringify({
        templateTier: 'Simple',
        sections: {
          1: 'As an operator, I want dispatch policy enforcement.',
          2: 'Given unsafe Jr dispatch, then generic events are blocked.',
          4: 'Manual review after implementation.',
          11: 'Roll out behind existing feature gates.',
          12: 'Record audit history.',
          15: 'Generic event bypass is rejected.',
          16: 'Smoke assignment policy after deployment.',
          17: 'Operator reviews dispatch blockers.',
        },
        dispatchSignals: {
          workCategory: 'feature',
        },
      }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...pmAuth },
      body: JSON.stringify({ approvalNote: 'Approved for dispatch policy bypass test.' }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({
        eventType: 'task.stage_changed',
        actorType: 'user',
        idempotencyKey: `dispatch-policy-bypass-stage:${created.taskId}`,
        payload: { to_stage: 'BACKLOG' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...contributorAuth },
      body: JSON.stringify({
        eventType: 'task.assigned',
        actorType: 'user',
        idempotencyKey: `dispatch-policy-bypass-assign:${created.taskId}`,
        payload: { assignee: 'engineer-jr' },
      }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, 'workflow_violation');
    assert.match(body.error.message, /Jr Engineer dispatch requires a clear failing or pending test plan/);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/history`, {
      headers: pmAuth,
    });
    assert.equal(response.status, 200);
    const history = await response.json();
    assert.ok(!history.items.some((event) => event.event_type === 'task.assigned' && event.payload.assignee === 'engineer-jr'));
  });
});

test('accepts production-style JWKS tokens with explicit claim mapping', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  await withServer(async ({ baseUrl }) => {
    const token = signRs256({
      actor: 'pm-prod',
      tenant: 'tenant-prod',
      groups: ['pm', 'reader'],
      iss: 'https://idp.example.test/',
      aud: 'engineering-team-api',
      exp: Math.floor(Date.now() / 1000) + 60,
    }, privateKey);

    const response = await fetch(`${baseUrl}/tasks`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items, []);
  }, {
    jwtJwks: { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'kid-1', use: 'sig', alg: 'RS256' }] },
    jwtIssuer: 'https://idp.example.test/',
    jwtAudience: 'engineering-team-api',
    actorClaim: 'actor',
    tenantClaim: 'tenant',
    rolesClaim: 'groups',
  });
});

test('rejects GitHub webhook deliveries with missing or invalid signatures', async () => {
  await withServer(async ({ baseUrl }) => {
    const body = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'wiinc1/engineering-team' },
      sender: { login: 'octocat' },
      pull_request: {
        node_id: 'PR_sig',
        number: 55,
        title: 'feat: TSK-SEC-9',
        body: 'Implements TSK-SEC-9',
        html_url: 'https://github.com/wiinc1/engineering-team/pull/55',
        state: 'open',
        updated_at: '2026-04-13T23:00:00.000Z',
      },
    });

    let response = await fetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-sec-1',
      },
      body,
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_github_signature');

    response = await fetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-sec-2',
        'x-hub-signature-256': githubSignature('wrong-secret', body),
      },
      body,
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'invalid_github_signature');
  }, { githubWebhookSecret: 'gh-webhook-secret' });
});

test('keeps browser bootstrap compatibility tokens usable during JWKS rollout when a signing secret is still configured', async () => {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
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

    const followUp = await fetch(`${baseUrl}/tasks`, {
      headers: { authorization: `Bearer ${payload.data.accessToken}` },
    });
    assert.equal(followUp.status, 200);
  }, {
    jwtJwks: { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'kid-1', use: 'sig', alg: 'RS256' }] },
    jwtIssuer: 'expected-issuer',
    jwtAudience: 'expected-audience',
  });
});
