const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('node:child_process');
const { createAuditApiServer } = require('../../lib/audit/http-projects');
const { createFileAuditStore } = require('../../lib/audit/store');
const {
  createExecutionContractDraft,
  REQUIRED_SECTIONS_BY_TIER,
} = require('../../lib/audit/execution-contracts');
const { STAGES } = require('../../lib/audit/workflow');

const RUNNABLE_SURFACE_HEAD_SHA = execFileSync('git', ['rev-parse', 'main'], { encoding: 'utf8' }).trim();

function sign(claims, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, overrides = {}) {
  return {
    authorization: `Bearer ${sign({
      sub: 'golden-path-operator',
      tenant_id: 'tenant-a',
      roles: ['admin'],
      exp: Math.floor(Date.now() / 1000) + 60,
      ...overrides,
    }, secret)}`,
  };
}

async function withServer(run, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-delivery-api-'));
  const secret = 'test-secret';
  const { server, store } = createAuditApiServer({
    baseDir,
    jwtSecret: secret,
    workflowEngineEnabled: false,
    ffWorkflowEngine: true,
    ffEngineerSubmissionEnabled: true,
    ffQaStageEnabled: true,
    ffQaContextRoutingEnabled: true,
    ffExecutionContracts: true,
    ...options,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await run({ baseDir, baseUrl, secret, store });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function uiContractPayload(taskId) {
  const { contract } = createExecutionContractDraft({
    taskId,
    summary: {
      task_id: taskId,
      title: 'Command Center UI',
      intake_draft: true,
      operator_intake_requirements: 'Queue-first Command Center with inspector.',
    },
    history: [{
      event_type: 'task.created',
      payload: {
        intake_draft: true,
        title: 'Command Center UI',
        raw_requirements: 'Queue-first Command Center with inspector.',
      },
    }],
    actorId: 'pm',
    body: {
      templateTier: 'Standard',
      riskFlags: ['human_workflow', 'desktop_visual_validation'],
      dispatchSignals: { workCategory: 'ui_ux' },
      sections: Object.fromEntries(
        REQUIRED_SECTIONS_BY_TIER.Standard.map((id) => [id, `Completed section ${id}.`]),
      ),
      reviewers: {
        architect: { status: 'approved', approved: true },
        ux: { status: 'approved', approved: true },
        qa: { status: 'approved', approved: true },
        sre: { status: 'approved', approved: true },
      },
      designScope: {
        mode: 'behavior_only',
        issueUrl: 'https://github.com/wiinc1/engineering-team/issues/279',
        screenshotPath: 'docs/design/assets/command-console-redesign-target.png',
        parityBar: 'Inspector behavior only.',
      },
      runnableSurface: {
        branch: 'main',
        serveUrl: 'http://127.0.0.1:15173',
        mergePolicy: 'required_before_submission_final',
      },
    },
  });
  return contract;
}

async function seedUiTask(store, taskId) {
  const contract = uiContractPayload(taskId);
  await store.appendEvent({
    taskId,
    tenantId: 'tenant-a',
    eventType: 'task.created',
    actorId: 'pm',
    actorType: 'agent',
    idempotencyKey: `create:${taskId}`,
    payload: {
      title: 'Command Center UI',
      intake_draft: true,
      initial_stage: STAGES.DRAFT,
      assignee: 'pm',
    },
  });
  await store.appendEvent({
    taskId,
    tenantId: 'tenant-a',
    eventType: 'task.execution_contract_version_recorded',
    actorId: 'pm',
    actorType: 'agent',
    idempotencyKey: `contract:${taskId}:v${contract.version}`,
    payload: { contract },
  });
  await store.appendEvent({
    taskId,
    tenantId: 'tenant-a',
    eventType: 'task.execution_contract_approved',
    actorId: 'admin',
    actorType: 'user',
    idempotencyKey: `approve:${taskId}:v${contract.version}`,
    payload: { version: contract.version, approval_summary: { canApprove: true } },
  });
  for (const [fromStage, toStage] of [
    [STAGES.DRAFT, STAGES.BACKLOG],
    [STAGES.BACKLOG, STAGES.ARCHITECT_REVIEW],
    [STAGES.ARCHITECT_REVIEW, STAGES.TECHNICAL_SPEC],
    [STAGES.TECHNICAL_SPEC, STAGES.IMPLEMENTATION],
  ]) {
    await store.appendEvent({
      taskId,
      tenantId: 'tenant-a',
      eventType: 'task.stage_changed',
      actorId: 'admin',
      actorType: 'user',
      idempotencyKey: `stage:${taskId}:${fromStage}:${toStage}`,
      payload: { from_stage: fromStage, to_stage: toStage, assignee: toStage === STAGES.IMPLEMENTATION ? 'engineer-sr' : undefined },
    });
  }
  await store.appendEvent({
    taskId,
    tenantId: 'tenant-a',
    eventType: 'task.assigned',
    actorId: 'admin',
    actorType: 'user',
    idempotencyKey: `assign:${taskId}:engineer-sr`,
    payload: { assignee: 'engineer-sr', previous_assignee: 'pm' },
  });
  return contract;
}

test('engineer-submission returns 409 runnable_surface_not_merged for orphan SHA', async () => {
  await withServer(async ({ baseUrl, secret, store }) => {
    const taskId = 'TSK-PDI-SUB';
    await seedUiTask(store, taskId);

    const response = await fetch(`${baseUrl}/tasks/${taskId}/engineer-submission`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['engineer', 'admin'] }),
      },
      body: JSON.stringify({
        commitSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      }),
    });

    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error.code, 'runnable_surface_not_merged');
  });
});

test('engineer-submission accepts HEAD SHA on main and records runnable_surface_verified', async () => {
  await withServer(async ({ baseUrl, secret, store }) => {
    const taskId = 'TSK-PDI-SUB-OK';
    await seedUiTask(store, taskId);
    const head = RUNNABLE_SURFACE_HEAD_SHA;

    const response = await fetch(`${baseUrl}/tasks/${taskId}/engineer-submission`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['engineer', 'admin'], sub: 'engineer-sr' }),
      },
      body: JSON.stringify({
        commitSha: head,
        visualEvidence: {
          screenshotPath: 'observability/product-visual/tsk-pdi-sub-ok-on-load.png',
          routePath: '/tasks?view=list',
          viewportWidth: 1280,
          capturePhase: 'on_load',
          comparabilityNote: 'Engineer submission visual checkpoint.',
        },
      }),
    });

    if (response.status !== 200) {
      const failure = await response.json();
      assert.fail(`expected 200, got ${response.status}: ${JSON.stringify(failure)}`);
    }
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.runnableSurfaceVerified, true);

    const history = await store.getTaskHistory(taskId, { tenantId: 'tenant-a' });
    const submission = history.find((entry) => entry.event_type === 'task.engineer_submission_recorded');
    assert.equal(submission.payload.runnable_surface_verified, true);
    assert.equal(submission.payload.verified_branch, 'main');
  });
});

test('qa-results pass returns 409 missing_visual_qa_evidence for desktop_visual_validation tasks', async () => {
  await withServer(async ({ baseUrl, secret, store }) => {
    const taskId = 'TSK-PDI-QA';
    await seedUiTask(store, taskId);
    await store.appendEvent({
      taskId,
      tenantId: 'tenant-a',
      eventType: 'task.stage_changed',
      actorId: 'qa',
      actorType: 'user',
      idempotencyKey: `stage:${taskId}:qa`,
      payload: { from_stage: STAGES.IMPLEMENTATION, to_stage: STAGES.QA_TESTING },
    });

    const response = await fetch(`${baseUrl}/tasks/${taskId}/qa-results`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['qa', 'admin'] }),
      },
      body: JSON.stringify({
        outcome: 'pass',
        summary: 'QA pass without visual evidence should be blocked.',
        scenarios: ['On-load screenshot missing'],
      }),
    });

    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error.code, 'missing_visual_qa_evidence');
  });
});

async function seedUiTaskInQa(store, taskId) {
  const contract = await seedUiTask(store, taskId);
  await store.appendEvent({
    taskId,
    tenantId: 'tenant-a',
    eventType: 'task.stage_changed',
    actorId: 'qa',
    actorType: 'user',
    idempotencyKey: `stage:${taskId}:qa`,
    payload: { from_stage: STAGES.IMPLEMENTATION, to_stage: STAGES.QA_TESTING },
  });
  return contract;
}

async function seedUiTaskWithPlatformQaPass(store, taskId) {
  const contract = await seedUiTaskInQa(store, taskId);
  const head = RUNNABLE_SURFACE_HEAD_SHA;
  await store.appendEvent({
    taskId,
    tenantId: 'tenant-a',
    eventType: 'task.engineer_submission_recorded',
    actorId: 'engineer-sr',
    actorType: 'user',
    idempotencyKey: `submission:${taskId}:v1`,
    payload: {
      version: 1,
      commit_sha: head,
      runnable_surface_verified: true,
      verified_branch: 'main',
    },
  });
  await store.appendEvent({
    taskId,
    tenantId: 'tenant-a',
    eventType: 'task.qa_result_recorded',
    actorId: 'qa',
    actorType: 'user',
    idempotencyKey: `qa:${taskId}:pass-no-visual`,
    payload: {
      outcome: 'pass',
      summary: 'Platform QA pass without visual evidence.',
    },
  });
  return contract;
}

test('product-delivery-reconcile records reconciliation event and returns report', async () => {
  await withServer(async ({ baseUrl, secret, store }) => {
    const taskId = 'TSK-PDI-RECON';
    await seedUiTaskWithPlatformQaPass(store, taskId);

    const response = await fetch(`${baseUrl}/tasks/${taskId}/product-delivery-reconcile`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['admin'] }),
      },
      body: JSON.stringify({
        mismatchReason: 'operator_reported_ui_mismatch',
      }),
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.report.task_id, taskId);
    assert.equal(body.data.report.product_delivery.status, 'in_progress');

    const history = await store.getTaskHistory(taskId, { tenantId: 'tenant-a' });
    const reconciliation = history.find((entry) => entry.event_type === 'task.product_delivery_reconciled');
    assert.ok(reconciliation);
    assert.equal(reconciliation.payload.status, 'failed');
    assert.equal(reconciliation.payload.mismatch_reason, 'operator_reported_ui_mismatch');
  });
});

test('qa-results pass returns 409 product_delivery_reconciliation_required after failed reconciliation', async () => {
  await withServer(async ({ baseUrl, secret, store }) => {
    const taskId = 'TSK-PDI-RECON-QA';
    await seedUiTaskInQa(store, taskId);
    await store.appendEvent({
      taskId,
      tenantId: 'tenant-a',
      eventType: 'task.product_delivery_reconciled',
      actorId: 'admin',
      actorType: 'user',
      idempotencyKey: `reconcile:${taskId}`,
      payload: {
        status: 'failed',
        mismatch_reason: 'operator_reported_ui_mismatch',
      },
    });

    const response = await fetch(`${baseUrl}/tasks/${taskId}/qa-results`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['qa', 'admin'] }),
      },
      body: JSON.stringify({
        outcome: 'pass',
        summary: 'QA pass should be blocked until reconciliation is resolved.',
        visualEvidence: {
          screenshotPath: 'observability/product-visual/tsk-pdi-recon-qa.png',
          routePath: '/tasks?view=list',
          viewportWidth: 1280,
          capturePhase: 'on_load',
          comparabilityNote: 'Golden-path on-load screenshot.',
          goldenPathBrowserProfile: 'playwright.golden-path',
        },
      }),
    });

    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error.code, 'product_delivery_reconciliation_required');
  });
});

test('events stage_changed to DONE returns 409 product_delivery_not_verified for UI tasks', async () => {
  await withServer(async ({ baseUrl, secret, store }) => {
    const taskId = 'TSK-PDI-CLOSE';
    await seedUiTaskWithPlatformQaPass(store, taskId);
    await store.appendEvent({
      taskId,
      tenantId: 'tenant-a',
      eventType: 'task.stage_changed',
      actorId: 'pm',
      actorType: 'user',
      idempotencyKey: `stage:${taskId}:close-review`,
      payload: { from_stage: STAGES.SRE_MONITORING, to_stage: STAGES.PM_CLOSE_REVIEW },
    });

    const response = await fetch(`${baseUrl}/tasks/${taskId}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(secret, { roles: ['admin', 'pm'] }),
      },
      body: JSON.stringify({
        eventType: 'task.stage_changed',
        actorType: 'user',
        idempotencyKey: `stage:${taskId}:done`,
        payload: {
          from_stage: STAGES.PM_CLOSE_REVIEW,
          to_stage: STAGES.DONE,
        },
      }),
    });

    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error.code, 'product_delivery_not_verified');
  });
});

test('deriveDeliveryLayersProjection surfaces platform and product divergence', async () => {
  const { deriveDeliveryLayersProjection: deriveLayers } = require('../../lib/audit/product-delivery-integrity');
  const taskId = 'TSK-PDI-PROJ';
  const contract = uiContractPayload(taskId);
  const head = RUNNABLE_SURFACE_HEAD_SHA;
  const history = [
    {
      event_type: 'task.execution_contract_version_recorded',
      payload: { contract },
    },
    {
      event_type: 'task.engineer_submission_recorded',
      payload: { version: 1, commit_sha: head, runnable_surface_verified: true },
    },
    {
      event_type: 'task.qa_result_recorded',
      payload: { outcome: 'pass', summary: 'Platform QA pass without visual evidence.' },
    },
  ];
  const layers = deriveLayers({
    state: { current_stage: 'SRE_MONITORING', assignee: 'engineer-sr' },
    history,
    contract,
    options: { repoRoot: process.cwd() },
  });

  assert.equal(layers.product_delivery.design_scope_mode, 'behavior_only');
  assert.equal(layers.product_delivery.runnable_surface_verified, true);
  assert.equal(layers.product_delivery.visual_verified, false);
  assert.equal(layers.product_delivery.status, 'in_progress');
  assert.equal(layers.platform_delivery.stage, 'SRE_MONITORING');
});