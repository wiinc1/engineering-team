const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAuditApiServer } = require('../../lib/audit');
const { createProjectionWorker } = require('../../lib/audit/workers');
const { assertSpecialistDelegationEnabled } = require('../../lib/audit/feature-flags');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, roles, overrides = {}) {
  return {
    authorization: `Bearer ${sign({ sub: 'e2e-tester', tenant_id: 'tenant-e2e', roles, exp: Math.floor(Date.now() / 1000) + 60, ...overrides }, secret)}`,
  };
}

const EXECUTION_CONTRACT_COMPLEX_SECTIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '14', '15', '16', '17'];

function complexExecutionContractSections() {
  return Object.fromEntries(EXECUTION_CONTRACT_COMPLEX_SECTIONS.map((sectionId) => [
    sectionId,
    `E2E completed Complex-tier section ${sectionId}.`,
  ]));
}

async function withServer(run, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-e2e-'));
  const secret = 'e2e-secret';
  const { server, store } = createAuditApiServer({ baseDir, jwtSecret: secret, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret, baseDir, store });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('must-have: accepted workflow writes persist immutable canonical audit history entries', async () => {
  await withServer(async ({ baseUrl, secret, baseDir }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, ['contributor']),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-E2E-001/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-E2E-001',
        correlationId: 'corr-e2e-1',
        traceId: 'trace-e2e-1',
        payload: { title: 'E2E task', initial_stage: 'BACKLOG', priority: 'P1' },
      }),
    });
    assert.equal(response.status, 202);
    const created = await response.json();
    assert.equal(created.duplicate, false);
    assert.equal(created.event.sequence_number, 1);
    assert.equal(created.event.event_type, 'task.created');

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-001/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.stage_changed',
        actorType: 'agent',
        idempotencyKey: 'move:TSK-E2E-001:IN_PROGRESS',
        correlationId: 'corr-e2e-2',
        payload: { from_stage: 'BACKLOG', to_stage: 'IN_PROGRESS' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-001/history`, { headers: authHeaders(secret, ['reader']) });
    assert.equal(response.status, 200);
    const history = await response.json();
    assert.equal(history.items.length, 2);
    assert.equal(history.items[0].event_type, 'task.stage_changed');
    assert.equal(history.items[1].event_type, 'task.created');
    assert.equal(history.items[0].sequence_number, 2);
    assert.equal(history.items[0].payload.to_stage, 'IN_PROGRESS');

    const rawEvents = fs.readFileSync(path.join(baseDir, 'data', 'workflow-audit-events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(rawEvents.length, 2);
    assert.deepEqual(rawEvents.map(event => event.sequence_number), [1, 2]);
    assert.ok(rawEvents.every(event => event.event_id && event.recorded_at && event.occurred_at));
  });
});

test('must-have: duplicate retries stay idempotent and do not create extra audit events', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const headers = {
      'content-type': 'application/json',
      ...authHeaders(secret, ['contributor']),
    };

    const body = JSON.stringify({
      eventType: 'task.created',
      actorType: 'agent',
      idempotencyKey: 'create:TSK-E2E-002',
      payload: { title: 'Duplicate-safe task', initial_stage: 'BACKLOG' },
    });

    let response = await fetch(`${baseUrl}/tasks/TSK-E2E-002/events`, { method: 'POST', headers, body });
    const first = await response.json();
    assert.equal(response.status, 202);
    assert.equal(first.duplicate, false);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-002/events`, { method: 'POST', headers, body });
    const second = await response.json();
    assert.equal(response.status, 202);
    assert.equal(second.duplicate, true);
    assert.equal(second.event.event_id, first.event.event_id);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-002/history`, { headers: authHeaders(secret, ['reader']) });
    const history = await response.json();
    assert.equal(history.items.length, 1);
  });
});

test('e2e: raw operator requirements create a draft routed only to PM refinement', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['contributor']),
      },
      body: JSON.stringify({
        raw_requirements: 'Operator notes that still need PM shaping before implementation.',
      }),
    });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.status, 'DRAFT');
    assert.equal(created.intakeDraft, true);
    assert.equal(created.nextRequiredAction, 'PM refinement required');

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/state`, {
      headers: authHeaders(secret, ['reader']),
    });
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.current_stage, 'DRAFT');
    assert.equal(state.assignee, 'pm');
    assert.equal(state.waiting_state, 'task_refinement');
    assert.equal(state.next_required_action, 'PM refinement required');
    assert.equal(state.wip_started_at, null);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/history`, {
      headers: authHeaders(secret, ['reader']),
    });
    assert.equal(response.status, 200);
    const history = await response.json();
    assert.deepEqual(history.items.map((event) => event.event_type), ['task.refinement_requested', 'task.created']);
    assert.ok(!history.items.some((event) => event.event_type === 'task.stage_changed'));
  });
});

test('e2e: PM generates a versioned Execution Contract and Markdown without dispatching implementation', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['contributor']),
      },
      body: JSON.stringify({
        raw_requirements: 'Turn this intake into a structured execution contract before any engineer dispatch.',
        title: 'Contract before dispatch',
      }),
    });
    assert.equal(response.status, 201);
    const created = await response.json();

    const pmHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, ['pm', 'reader'], { sub: 'pm-e2e' }),
    };
    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({
        templateTier: 'Complex',
        sections: complexExecutionContractSections(),
        scopeBoundaries: {
          committedRequirements: ['Future implementation must satisfy the approved contract sections.'],
          outOfScope: ['Runtime engineer dispatch is not performed by this workflow.'],
          deferredConsiderations: ['Deferred Considerations promotion is tracked separately.'],
        },
        reviewers: {
          architect: { status: 'approved', actorId: 'architect-e2e' },
          ux: { status: 'approved', actorId: 'ux-e2e' },
          qa: { status: 'approved', actorId: 'qa-e2e' },
        },
      }),
    });
    assert.equal(response.status, 201);
    let contract = await response.json();
    assert.equal(contract.data.version, 1);
    assert.equal(contract.data.validation.status, 'valid');

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({
        templateTier: 'Complex',
        sections: {
          ...complexExecutionContractSections(),
          6: {
            title: 'Architecture & Integration',
            body: 'E2E completed Complex-tier section 6.',
            ownerRole: 'architect',
            contributor: 'architect-e2e',
            approvalStatus: 'approved',
            payloadSchemaVersion: 2,
            payloadJson: { architecture_decision: 'Metadata-only material change is versioned.' },
            provenanceReferences: ['CONTEXT.md#execution-contract'],
          },
        },
        scopeBoundaries: {
          committedRequirements: ['Future implementation must satisfy the approved contract sections.'],
          outOfScope: ['Runtime engineer dispatch is not performed by this workflow.'],
          deferredConsiderations: ['Deferred Considerations promotion is tracked separately.'],
        },
        reviewers: {
          architect: { status: 'approved', actorId: 'architect-e2e' },
          ux: { status: 'approved', actorId: 'ux-e2e' },
          qa: { status: 'approved', actorId: 'qa-e2e' },
        },
      }),
    });
    assert.equal(response.status, 201);
    contract = await response.json();
    assert.equal(contract.data.version, 2);
    assert.equal(contract.data.materialChange, true);
    assert.equal(contract.data.contract.sections['6'].payload_schema_version, 2);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract/markdown`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 201);
    const markdown = await response.json();
    assert.match(markdown.data.markdown, /Authoritative Source: structured Task execution_contract data/);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract/approve`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 201);
    const approval = await response.json();
    assert.equal(approval.data.committedScope.commitment_status, 'committed');
    assert.equal(approval.data.committedScope.committed_requirements[0].text, 'Future implementation must satisfy the approved contract sections.');

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract/artifacts`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({
        displayId: 'TSK-104',
        title: 'Implement Refinement Decision Logs and Task-ID Artifact Generation',
        approvals: {
          pm: { status: 'approved', actorId: 'pm-e2e' },
        },
      }),
    });
    assert.equal(response.status, 201);
    const artifacts = await response.json();
    assert.equal(artifacts.data.generatedArtifacts.user_story.path, 'docs/user-stories/TSK-104-implement-refinement-decision-logs-and-task-id-artifact-generation.md');
    assert.equal(artifacts.data.commitPolicy.commit_allowed, false);
    assert.deepEqual(artifacts.data.approvalSummary.missingRequiredApprovals.map((item) => item.role), ['architect']);

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/execution-contract/artifacts/approve`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({
        approvals: {
          architect: { status: 'approved', actorId: 'architect-e2e' },
        },
      }),
    });
    assert.equal(response.status, 201);
    const artifactApproval = await response.json();
    assert.equal(artifactApproval.data.commitPolicy.commit_allowed, true);
    assert.equal(artifactApproval.data.artifactBundle.approvals.pm.status, 'approved');
    assert.equal(artifactApproval.data.artifactBundle.approvals.architect.status, 'approved');

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, ['contributor'], { sub: 'engineer-dispatcher' }),
      },
      body: JSON.stringify({
        eventType: 'task.stage_changed',
        actorType: 'user',
        idempotencyKey: `dispatch-attempt:${created.taskId}`,
        payload: { from_stage: 'DRAFT', to_stage: 'BACKLOG' },
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'workflow_violation');

    response = await fetch(`${baseUrl}/tasks/${created.taskId}/history`, {
      headers: authHeaders(secret, ['reader']),
    });
    assert.equal(response.status, 200);
    const history = await response.json();
    assert.ok(history.items.some((event) => event.event_type === 'task.execution_contract_version_recorded'));
    assert.ok(history.items.some((event) => event.event_type === 'task.execution_contract_markdown_generated'));
    assert.ok(history.items.some((event) => event.event_type === 'task.execution_contract_approved'));
    assert.ok(history.items.some((event) => event.event_type === 'task.execution_contract_artifact_bundle_generated'));
    assert.ok(history.items.some((event) => event.event_type === 'task.execution_contract_artifact_bundle_approved'));
    assert.ok(!history.items.some((event) => event.event_type === 'task.engineer_submission_recorded'));
  });
});

test('must-have: task history is queryable chronologically and supports event, actor, and date filtering', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const headers = {
      'content-type': 'application/json',
      ...authHeaders(secret, ['contributor']),
    };

    const events = [
      {
        eventType: 'task.created',
        actorType: 'agent',
        actorId: 'pm-1',
        idempotencyKey: 'create:TSK-E2E-003',
        occurredAt: '2026-03-31T10:00:00.000Z',
        payload: { title: 'Filterable task', initial_stage: 'BACKLOG' },
      },
      {
        eventType: 'task.assigned',
        actorType: 'agent',
        actorId: 'pm-1',
        idempotencyKey: 'assign:TSK-E2E-003',
        occurredAt: '2026-03-31T10:01:00.000Z',
        payload: { assignee: 'engineer-1' },
      },
      {
        eventType: 'task.stage_changed',
        actorType: 'agent',
        actorId: 'engineer-1',
        idempotencyKey: 'move:TSK-E2E-003',
        occurredAt: '2026-03-31T10:02:00.000Z',
        payload: { from_stage: 'BACKLOG', to_stage: 'IN_PROGRESS' },
      },
    ];

    for (const event of events) {
      const response = await fetch(`${baseUrl}/tasks/TSK-E2E-003/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify(event),
      });
      assert.equal(response.status, 202);
    }

    let response = await fetch(`${baseUrl}/tasks/TSK-E2E-003/history`, { headers: authHeaders(secret, ['reader']) });
    let history = await response.json();
    assert.deepEqual(history.items.map(event => event.sequence_number), [3, 2, 1]);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-003/history?eventType=task.assigned`, { headers: authHeaders(secret, ['reader']) });
    history = await response.json();
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].payload.assignee, 'engineer-1');

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-003/history?actorId=pm-1`, { headers: authHeaders(secret, ['reader']) });
    history = await response.json();
    assert.equal(history.items.length, 2);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-003/history?from=2026-03-31T10:01:00.000Z&to=2026-03-31T10:02:00.000Z`, { headers: authHeaders(secret, ['reader']) });
    history = await response.json();
    assert.equal(history.items.length, 2);
    assert.deepEqual(history.items.map(event => event.event_type), ['task.stage_changed', 'task.assigned']);
  });
});

test('must-have: workflow history remains separate from observability telemetry surfaces', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const headers = {
      'content-type': 'application/json',
      ...authHeaders(secret, ['contributor']),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-E2E-004/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-E2E-004',
        traceId: 'trace-separation',
        correlationId: 'corr-separation',
        payload: { title: 'Separation task', initial_stage: 'BACKLOG' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-004/history`, { headers: authHeaders(secret, ['reader']) });
    const history = await response.json();
    assert.equal(history.items.length, 1);
    assert.equal(Object.hasOwn(history.items[0], 'metrics'), false);
    assert.equal(Object.hasOwn(history.items[0], 'event_count'), false);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-004/observability-summary`, { headers: authHeaders(secret, ['reader']) });
    const summary = await response.json();
    assert.equal(summary.event_count, 1);
    assert.equal(Array.isArray(summary.correlation.approved_correlation_ids), true);
    assert.equal(Object.hasOwn(summary, 'metrics'), false);
  });
});

test('must-have: canonical specialist delegation disablement produces the stable rollout error contract', () => {
  assert.throws(
    () => assertSpecialistDelegationEnabled({ ffRealSpecialistDelegation: 'false' }),
    (error) => {
      assert.equal(error.code, 'feature_disabled');
      assert.equal(error.statusCode, 503);
      assert.equal(error.details.feature, 'ff_real_specialist_delegation');
      return true;
    },
  );
});

test('must-have: projection freshness is immediate on the default file-backed sync projection path', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const headers = {
      'content-type': 'application/json',
      ...authHeaders(secret, ['contributor']),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-E2E-005/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-E2E-005',
        payload: { title: 'Fresh task', initial_stage: 'BACKLOG' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-005/history`, { headers: authHeaders(secret, ['reader']) });
    const history = await response.json();
    assert.equal(history.items.length, 1);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-005/observability-summary`, { headers: authHeaders(secret, ['admin']) });
    const summary = await response.json();
    assert.equal(summary.metrics.workflow_projection_lag_seconds, 0);
  });
});

test('must-have: unauthorized callers are blocked by tenant-scoped RBAC and cannot read cross-tenant data', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, ['contributor'], { tenant_id: 'tenant-a' }),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-E2E-006/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-E2E-006',
        payload: { title: 'Tenant scoped task', initial_stage: 'BACKLOG' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-006/history`, { headers: authHeaders(secret, ['reader'], { tenant_id: 'tenant-b' }) });
    const crossTenantHistory = await response.json();
    assert.deepEqual(crossTenantHistory.items, []);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-006/history`, { headers: authHeaders(secret, ['reader'], { tenant_id: 'tenant-a' }) });
    const sameTenantHistory = await response.json();
    assert.equal(sameTenantHistory.items.length, 1);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-006/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(secret, ['reader'], { tenant_id: 'tenant-a' }) },
      body: JSON.stringify({
        eventType: 'task.stage_changed',
        actorType: 'agent',
        idempotencyKey: 'move:TSK-E2E-006',
        payload: { from_stage: 'BACKLOG', to_stage: 'IN_PROGRESS' },
      }),
    });
    assert.equal(response.status, 403);
  });
});

test('must-have: worker processing materializes expired SRE monitoring escalation without a read-side write', async () => {
  await withServer(async ({ baseUrl, secret, store }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, ['contributor']),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-E2E-SRE-001/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-E2E-SRE-001',
        payload: {
          title: 'Expired SRE monitoring task',
          initial_stage: 'SRE_MONITORING',
          linked_prs: [{
            id: 'pr-e2e-sre-1',
            number: 901,
            title: 'feat: sre monitoring e2e',
            repository: 'wiinc1/engineering-team',
            merged: true,
            state: 'closed',
            merged_at: '2026-04-14T12:00:00.000Z',
          }],
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-SRE-001/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.sre_monitoring_started',
        actorType: 'user',
        idempotencyKey: 'start:TSK-E2E-SRE-001',
        payload: {
          deployment_environment: 'production',
          deployment_url: 'https://deploy.example/releases/901',
          deployment_version: '2026.04.15-1',
          deployment_status: 'success',
          window_hours: 48,
          window_ends_at: '2026-04-14T00:00:00.000Z',
        },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-SRE-001/state`, { headers: authHeaders(secret, ['reader']) });
    assert.equal(response.status, 200);
    let state = await response.json();
    assert.equal(state.waiting_state, null);

    const worker = createProjectionWorker(store, { batchSize: 25 });
    const result = await worker.runOnce();
    assert.equal(result.expiredProcessed, 1);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-SRE-001/state`, { headers: authHeaders(secret, ['reader']) });
    assert.equal(response.status, 200);
    state = await response.json();
    assert.equal(state.waiting_state, 'awaiting_human_stakeholder_escalation');
  });
});

test('must-have: live monitoring anomalies can become linked child tasks with parent blocking and PM re-entry', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const contributorHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, ['contributor']),
    };
    const sreHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, ['sre', 'reader']),
    };
    const pmHeaders = {
      'content-type': 'application/json',
      ...authHeaders(secret, ['pm', 'reader']),
    };

    let response = await fetch(`${baseUrl}/tasks/TSK-E2E-ANOM-1/events`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        eventType: 'task.created',
        actorType: 'agent',
        idempotencyKey: 'create:TSK-E2E-ANOM-1',
        payload: { title: 'Live anomaly parent', initial_stage: 'SRE_MONITORING', priority: 'P1' },
      }),
    });
    assert.equal(response.status, 202);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-ANOM-1/sre-monitoring/anomaly-child-task`, {
      method: 'POST',
      headers: sreHeaders,
      body: JSON.stringify({
        title: 'Investigate checkout-api anomaly',
        service: 'checkout-api',
        anomalySummary: 'Checkout 5xx errors spiked in production.',
        metrics: ['5xx_rate: 8%'],
        logs: ['checkout-api pod restart loop'],
        errorSamples: ['TimeoutError at /checkout'],
      }),
    });
    assert.equal(response.status, 201);
    const created = await response.json();
    const childTaskId = created.data.childTaskId;

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-ANOM-1/relationships`, { headers: authHeaders(secret, ['reader']) });
    assert.equal(response.status, 200);
    const relationships = await response.json();
    assert.deepEqual(relationships.child_task_ids, [childTaskId]);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-ANOM-1/state`, { headers: authHeaders(secret, ['reader']) });
    assert.equal(response.status, 200);
    const parentState = await response.json();
    assert.equal(parentState.blocked, true);
    assert.equal(parentState.waiting_state, 'child_task_investigation');

    response = await fetch(`${baseUrl}/tasks/${childTaskId}/state`, { headers: authHeaders(secret, ['reader']) });
    assert.equal(response.status, 200);
    const childState = await response.json();
    assert.equal(childState.priority, 'P0');
    assert.equal(childState.assignee, 'pm');
    assert.equal(childState.waiting_state, 'pm_business_context_required');

    response = await fetch(`${baseUrl}/tasks/${childTaskId}/pm-business-context`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({
        businessContext: 'PM confirmed customer impact and approved architect follow-up.',
      }),
    });
    assert.equal(response.status, 200);

    for (const [fromStage, toStage] of [
      ['BACKLOG', 'TODO'],
      ['TODO', 'IN_PROGRESS'],
      ['IN_PROGRESS', 'VERIFY'],
      ['VERIFY', 'DONE'],
    ]) {
      response = await fetch(`${baseUrl}/tasks/${childTaskId}/events`, {
        method: 'POST',
        headers: contributorHeaders,
        body: JSON.stringify({
          eventType: 'task.stage_changed',
          actorType: 'agent',
          idempotencyKey: `e2e:${childTaskId}:${fromStage}:${toStage}`,
          payload: { from_stage: fromStage, to_stage: toStage },
        }),
      });
      assert.equal(response.status, 202);
    }

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-ANOM-1/state`, { headers: authHeaders(secret, ['reader']) });
    assert.equal(response.status, 200);
    const unblockedParentState = await response.json();
    assert.equal(unblockedParentState.blocked, false);
    assert.equal(unblockedParentState.waiting_state, null);
  });
});

test('must-have: feature flag kill switch disables write and read surfaces cleanly', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    let response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/tasks/TSK-E2E-007/history`, { headers: authHeaders(secret, ['reader']) });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'feature_disabled');
  }, { auditFoundationEnabled: false });
});
