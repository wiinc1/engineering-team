const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAuditApiServer } = require('../../lib/audit/http');
const {
  buildAiAgentPreview,
  evaluateDelegationDryRun,
} = require('../../lib/task-platform/agent-preview');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, roles) {
  return {
    authorization: `Bearer ${sign({
      sub: 'agent-preview-test',
      tenant_id: 'engineering-team',
      roles,
      exp: Math.floor(Date.now() / 1000) + 60,
    }, secret)}`,
  };
}

async function withServer(run, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agent-preview-'));
  const secret = 'ai-agent-preview-secret';
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run({ baseUrl: `http://127.0.0.1:${server.address().port}`, secret, baseDir });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

const validDelegatedQa = {
  agentId: 'qa-preview-live',
  displayName: 'QA Preview Live',
  role: 'qa',
  metadata: {
    delegation: {
      enabled: true,
      specialist: 'qa',
      sampleRequest: 'qa regression verification dry run',
    },
  },
};

test('agent preview returns non-mutating routing, delegation, audit, permission, and fallback impact', async () => {
  await withServer(async ({ baseUrl, secret, baseDir }) => {
    const response = await fetch(`${baseUrl}/api/v1/ai-agents/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['admin']) },
      body: JSON.stringify(validDelegatedQa),
    });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.normalizedAgent.agentId, 'qa-preview-live');
    assert.equal(data.assignmentControlImpact.visibleForNewAssignment, true);
    assert.equal(data.roleInboxImpact.routedRole, 'qa');
    assert.equal(data.pmOverviewBucketImpact.bucket, 'qa');
    assert.equal(data.delegationImpact.enabled, true);
    assert.equal(data.delegationImpact.dryRun.pass, true);
    assert.equal(data.delegationImpact.dryRun.selectedSpecialist, 'qa');
    assert.equal(data.delegationImpact.dryRun.runtimeAgent, 'qa-engineer');
    assert.equal(data.fallbackBehavior.failClosed, true);
    assert.equal(data.fallbackBehavior.coordinatorFallbackAllowedOnActivationFailure, false);
    assert.deepEqual(data.permissionsImpact.requiredToSave, ['agents:write', 'agent-delegation:write']);
    assert.equal(data.auditEventPreview.mutationType, 'agent_activation_previewed');
    assert.equal(data.wouldCreateLiveAgent, true);
    assert.equal(data.blockers.length, 0);
    assert.match(data.previewToken, /^[0-9a-f]{64}$/);

    const storePath = path.join(baseDir, 'data', 'task-platform.json');
    const persisted = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    assert.equal(Object.keys(persisted.ai_agents).some((key) => key.endsWith('::qa-preview-live')), false);
  });
});

test('delegation-enabled activation requires explicit permission and confirmed passing preview', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/api/v1/ai-agents/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['pm']) },
      body: JSON.stringify(validDelegatedQa),
    });
    assert.equal(response.status, 403);
    let body = await response.json();
    assert.equal(body.error.details.permission, 'agent-delegation:write');

    response = await fetch(`${baseUrl}/api/v1/ai-agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['admin']) },
      body: JSON.stringify(validDelegatedQa),
    });
    assert.equal(response.status, 400);
    body = await response.json();
    assert.equal(body.error.code, 'preview_confirmation_required');
    assert.match(body.error.details.previewToken, /^[0-9a-f]{64}$/);

    const previewResponse = await fetch(`${baseUrl}/api/v1/ai-agents/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['admin']) },
      body: JSON.stringify(validDelegatedQa),
    });
    const preview = (await previewResponse.json()).data;
    response = await fetch(`${baseUrl}/api/v1/ai-agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['admin']) },
      body: JSON.stringify({
        ...validDelegatedQa,
        previewConfirmation: { approved: true, token: preview.previewToken },
      }),
    });
    assert.equal(response.status, 201);
    body = await response.json();
    assert.equal(body.data.agentId, 'qa-preview-live');
    assert.equal(body.data.active, true);
  });
});

test('invalid delegation mapping and route collisions block preview and live activation', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const invalid = {
      agentId: 'qa-preview-invalid',
      displayName: 'QA Preview Invalid',
      role: 'qa',
      metadata: {
        delegation: {
          enabled: true,
          specialist: 'qa',
          runtimeAgent: 'not-qa-engineer',
          routeKeywords: ['qa'],
          sampleRequest: 'engineering implementation dry run',
        },
      },
    };
    const response = await fetch(`${baseUrl}/api/v1/ai-agents/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['admin']) },
      body: JSON.stringify(invalid),
    });
    assert.equal(response.status, 200);
    const preview = (await response.json()).data;
    assert.equal(preview.wouldCreateLiveAgent, false);
    assert.equal(preview.delegationImpact.dryRun.pass, false);
    assert.deepEqual(
      preview.blockers.map((blocker) => blocker.code).sort(),
      ['dry_run_route_mismatch', 'route_collision', 'runtime_agent_mismatch'],
    );

    const createResponse = await fetch(`${baseUrl}/api/v1/ai-agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['admin']) },
      body: JSON.stringify({
        ...invalid,
        previewConfirmation: { approved: true, token: preview.previewToken },
      }),
    });
    assert.equal(createResponse.status, 400);
    const body = await createResponse.json();
    assert.equal(body.error.code, 'agent_activation_preview_failed');
  });
});

test('delegation dry run resolves through the OpenClaw runner mapping boundary', () => {
  const result = evaluateDelegationDryRun({
    agentId: 'sre-preview',
    delegation: {
      enabled: true,
      specialist: 'sre',
      routeKeywords: [],
      taskTypes: [],
      sampleRequest: 'sre monitoring runbook dry run',
    },
    env: {
      OPENCLAW_SPECIALIST_MAP: JSON.stringify({ sre: 'custom-sre-runtime' }),
      OPENCLAW_DELEGATION_SESSION_ID: 'preview-session',
      OPENCLAW_DELEGATION_TIMEOUT_SEC: '15',
    },
  });
  assert.equal(result.pass, true);
  assert.equal(result.runtimeAgent, 'custom-sre-runtime');
  assert.deepEqual(result.openClawArgs.slice(0, 4), ['agent', '--json', '--agent', 'custom-sre-runtime']);
  assert.ok(result.openClawArgs.includes('--session-id'));
});

test('unsupported-role requests persist as draft requests without entering live routing', async () => {
  await withServer(async ({ baseUrl, secret, baseDir }) => {
    let response = await fetch(`${baseUrl}/api/v1/agent-role-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['pm']) },
      body: JSON.stringify({
        requestedRole: 'designer',
        displayName: 'Design Specialist',
        justification: 'Operator needs design review coverage.',
        metadata: JSON.parse('{"__proto__":{"polluted":true},"note":"safe metadata"}'),
      }),
    });
    assert.equal(response.status, 201);
    const request = (await response.json()).data;
    assert.equal(request.requestedRole, 'designer');
    assert.equal(request.status, 'requested');
    assert.equal(request.liveRoutingEnabled, false);
    assert.equal({}.polluted, undefined);

    response = await fetch(`${baseUrl}/api/v1/ai-agents?includeInactive=true`, {
      headers: authHeaders(secret, ['pm']),
    });
    assert.equal(response.status, 200);
    const agents = (await response.json()).data;
    assert.equal(agents.some((agent) => agent.role === 'designer' || agent.agentId === request.requestId), false);

    const persisted = JSON.parse(fs.readFileSync(path.join(baseDir, 'data', 'task-platform.json'), 'utf8'));
    assert.equal(Object.values(persisted.agent_role_requests).some((record) => record.requested_role === 'designer'), true);
    assert.equal(Object.keys(persisted.ai_agents).some((key) => /designer/i.test(key)), false);
  });
});

test('AI-agent APIs isolate tenants and reject client-trusted unsupported activation', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const tenantAuth = (tenantId, roles = ['admin']) => ({
      authorization: `Bearer ${sign({
        sub: `actor-${tenantId}`,
        tenant_id: tenantId,
        roles,
        exp: Math.floor(Date.now() / 1000) + 60,
      }, secret)}`,
    });

    let response = await fetch(`${baseUrl}/api/v1/agent-role-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...tenantAuth('tenant-a', ['pm']) },
      body: JSON.stringify({ requestedRole: 'designer', displayName: 'Designer' }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/api/v1/ai-agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...tenantAuth('tenant-a') },
      body: JSON.stringify({ agentId: 'qa-tenant-a', displayName: 'Tenant A QA', role: 'qa' }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/api/v1/ai-agents?includeInactive=true`, {
      headers: tenantAuth('tenant-b'),
    });
    assert.equal(response.status, 200);
    const tenantBAgents = (await response.json()).data;
    assert.equal(tenantBAgents.some((agent) => agent.agentId === 'qa-tenant-a'), false);

    response = await fetch(`${baseUrl}/api/v1/ai-agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...tenantAuth('tenant-a') },
      body: JSON.stringify({
        agentId: 'designer-live',
        displayName: 'Designer Live',
        role: 'designer',
        active: true,
        assignable: true,
        previewConfirmation: { approved: true, token: 'client-supplied' },
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'unsupported_agent_role');
  });
});
