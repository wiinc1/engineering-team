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

const EXECUTION_CONTRACT_STANDARD_SECTIONS = ['1', '2', '3', '4', '6', '7', '10', '11', '12', '15', '16', '17'];

function standardExecutionContractSections() {
  return Object.fromEntries(EXECUTION_CONTRACT_STANDARD_SECTIONS.map((sectionId) => [
    sectionId,
    `Contract test completed section ${sectionId}.`,
  ]));
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
    '/tasks/{id}/execution-contract:',
    '/tasks/{id}/execution-contract/validate:',
    '/tasks/{id}/execution-contract/markdown:',
    '/tasks/{id}/execution-contract/approve:',
    '/tasks/{id}/execution-contract/verification-report:',
    '/tasks/{id}/contract-coverage-audit:',
    '/tasks/{id}/contract-coverage-audit/validate:',
    '/tasks/{id}/contract-coverage-audit/markdown:',
    '/deferred-considerations:',
    '/tasks/{id}/deferred-considerations:',
    '/tasks/{id}/deferred-considerations/{deferredConsiderationId}/review:',
    '/tasks/{id}/deferred-considerations/{deferredConsiderationId}/promote:',
    '/tasks/{id}/deferred-considerations/{deferredConsiderationId}/close:',
    '/tasks/{id}/execution-contract/artifacts:',
    '/tasks/{id}/execution-contract/artifacts/approve:',
    '/tasks/{id}/close-review/exceptional-dispute:',
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
    'close-governance escalation previews',
    'Human close decisions are accepted only when governed close review is decision-ready',
    'Close-review backtrack now uses a dual-party agreement handshake',
    'approved_correlation_ids',
    'current_owner',
    'task.pm_business_context_completed',
    'List projected task summaries with additive owner metadata',
    'raw_requirements',
    'task.refinement_requested',
    'task.intake_creation_failed',
    'task_creation_failed',
    'invalid_intake_title',
    'maxLength: 120',
    'Intake Draft',
    'ExecutionContract',
    'task.execution_contract_version_recorded',
    'task.execution_contract_approved',
    'ExecutionContractReviewerRouting',
    'ExecutionContractApprovalSummary',
    'riskFlags',
    'approvalSummary',
    'execution_contract_approval_blocked',
    'execution_contract_auto_approval_blocked',
    'execution-contract-low-risk-simple-auto-approval.v1',
    'autoApproval',
    'autoApprovalPolicy',
    'feature_operator_trusted_autonomous_delivery_rate',
    'artifact_bundle_approval_blocked',
    'task.execution_contract_verification_report_generated',
    'ExecutionContractVerificationReport',
    'ExecutionContractDispatchReadiness',
    'ExecutionContractDispatchPolicy',
    'execution-contract-dispatch-policy.v1',
    'dispatchPolicy',
    'selectedEngineerTier',
    'dispatchReadiness',
    'verificationReport',
    'task.execution_contract_artifact_bundle_generated',
    'task.execution_contract_artifact_bundle_approved',
    'task.contract_coverage_audit_submitted',
    'task.contract_coverage_audit_validated',
    'ControlPlaneProjection',
    'task.control_plane_decision_recorded',
    'task.control_plane_exception_recorded',
    'control-plane-policy-decision.v1',
    'delivery-retrospective-signal.v1',
    'context_provenance',
    'ContractCoverageAudit',
    'ContractCoverageAuditValidation',
    'ContractCoverageAuditProjection',
    'execution-contract-coverage-audit.v1',
    'implementation_incomplete',
    'feature_contract_coverage_audits_submitted_total',
    'feature_contract_coverage_audits_closed_total',
    'feature_contract_coverage_implementation_incomplete_total',
    'feature_autonomy_confidence_positive_signals_total',
    'feature_autonomy_confidence_neutral_signals_total',
    'feature_autonomy_confidence_negative_signals_total',
    'DeferredConsideration',
    'DeferredConsiderationProjection',
    'deferred-considerations.v1',
    'task.deferred_consideration_captured',
    'task.deferred_consideration_promoted',
    'required_role_approvals',
    'nonBlockingComments',
    'ff_execution_contracts',
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
    '/sign-in:',
    '/auth/callback:',
    '/auth/session:',
    '/api/auth/session:',
    'authCode',
    'Signed browser bootstrap artifact from the trusted internal auth source.',
    'Authorization Code + PKCE',
    'oidc_error',
    '/overview/governance',
  ]) {
    assert.match(browserAuthSpec, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const snippet of [
    'Only the currently assigned owner may perform this action.',
    'dispatch_policy_blocked',
    'engineer-sr',
    'engineer-principal',
    'Shared browser surfaces such as `/inbox/sre` remain read-only unless a dedicated workflow endpoint is used.',
    'Human close decisions and dual-party close-review backtrack recommendations',
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
    'closeGovernance',
    'decisionReady',
    'pendingReason',
    'pmBusinessContextReview',
    'finalizedByPm',
    'freezeScope',
    'commentable',
    'childTaskId',
    'waitingState',
    '/tasks/{id}/orchestration:',
    'canViewOrchestration',
    'OrchestrationViewResponse',
    'dependencyState',
    'fallbackReason',
    'operatorIntakeRequirements',
    'executionContract',
    'contractCoverageAudit',
    'deferredConsiderations',
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

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-1/detail`, { headers: readerHeaders });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.meta.permissions.canViewOrchestration, true);
    assert.ok(detail.orchestration);

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-1/orchestration`, { headers: readerHeaders });
    assert.equal(response.status, 200);
    const orchestration = await response.json();
    assert.ok(orchestration.planner);
    assert.ok(orchestration.run);

    response = await fetch(`${baseUrl}/tasks/TSK-CONTRACT-1/orchestration`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['pm'] }),
      },
      body: JSON.stringify({ idempotencyKey: 'orch:contract:1' }),
    });
    assert.equal(response.status, 202);
    const started = await response.json();
    assert.ok(started.run.runId);

    response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: contributorHeaders,
      body: JSON.stringify({
        raw_requirements: 'Create a documented contract endpoint from this intake.',
        title: 'Documented Execution Contract intake',
      }),
    });
    assert.equal(response.status, 201);
    const intake = await response.json();

    response = await fetch(`${baseUrl}/tasks/${intake.taskId}/execution-contract`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'pm-1', roles: ['pm', 'reader'] }),
      },
      body: JSON.stringify({
        templateTier: 'Standard',
        sections: standardExecutionContractSections(),
        reviewers: {
          architect: { status: 'approved', actorId: 'architect-contract' },
          ux: { status: 'approved', actorId: 'ux-contract' },
          qa: { status: 'approved', actorId: 'qa-contract' },
        },
      }),
    });
    assert.equal(response.status, 201);
    const executionContract = await response.json();
    assert.equal(executionContract.data.version, 1);
    assert.equal(executionContract.data.validation.status, 'valid');

    response = await fetch(`${baseUrl}/tasks/${intake.taskId}/deferred-considerations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'pm-1', roles: ['pm', 'reader'] }),
      },
      body: JSON.stringify({
        title: 'Consider a bulk-edit shortcut',
        knownContext: 'Operators asked about editing several contract rows together.',
        rationale: 'The approved contract does not include bulk-edit UX.',
        sourceSection: 'Refinement notes',
        sourceAgent: 'pm',
        owner: 'pm',
        revisitTrigger: 'After row-level editing is prioritized.',
        openQuestions: ['Should the shortcut apply across filtered rows?'],
      }),
    });
    assert.equal(response.status, 201);
    const capturedDeferredConsideration = await response.json();
    assert.equal(capturedDeferredConsideration.data.status, 'captured');

    response = await fetch(`${baseUrl}/deferred-considerations`, {
      headers: authHeaders(secret, { sub: 'pm-1', roles: ['pm', 'reader'] }),
    });
    assert.equal(response.status, 200);
    const deferredQueue = await response.json();
    assert.equal(deferredQueue.data.summary.total, 1);
    assert.equal(deferredQueue.data.groups.by_revisit_trigger[0].key, 'After row-level editing is prioritized.');

    response = await fetch(`${baseUrl}/tasks/${intake.taskId}/deferred-considerations`, {
      headers: readerHeaders,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.summary.unresolved_count, 1);

    response = await fetch(`${baseUrl}/tasks/${intake.taskId}/execution-contract/markdown`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'pm-1', roles: ['pm', 'reader'] }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 201);
    assert.match((await response.json()).data.markdown, /Generated from structured Execution Contract data/);

    response = await fetch(`${baseUrl}/tasks/${intake.taskId}/execution-contract/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'pm-1', roles: ['pm', 'reader'] }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 201);
    const approvedContract = await response.json();
    assert.equal(approvedContract.data.committedScope.commitment_status, 'committed');
    assert.equal(approvedContract.data.approvalSummary.deferredConsiderationsExcludedFromCoverage, true);
    assert.equal(
      approvedContract.data.approvalSummary.deferredConsiderationsNotInScope[0].title,
      'Consider a bulk-edit shortcut',
    );

    response = await fetch(`${baseUrl}/tasks/${intake.taskId}/execution-contract/verification-report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { sub: 'pm-1', roles: ['pm', 'reader'] }),
      },
      body: JSON.stringify({
        displayId: 'TSK-105',
        title: 'Generate verification report skeletons from approved Execution Contracts',
      }),
    });
    assert.equal(response.status, 201);
    const report = await response.json();
    assert.equal(report.data.reportId, 'VR-TSK-105-v1');
    assert.equal(report.data.dispatchGate.canDispatch, true);
    assert.match(report.data.path, /^docs\/reports\/TSK-105-/);

    response = await fetch(`${baseUrl}/tasks/${intake.taskId}/execution-contract/verification-report`, {
      headers: readerHeaders,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.report_id, 'VR-TSK-105-v1');

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
    const anomalyDetail = await response.json();
    assert.equal(anomalyDetail.context.pmBusinessContextReview.finalized, true);
    assert.equal(anomalyDetail.context.anomalyChildTask.finalizedByPm, true);
    assert.equal(anomalyDetail.relations.parentTask.id, 'TSK-CONTRACT-ANOM');

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
