const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuditStore } = require('../../lib/audit/store');
const {
  REQUIRED_SECTIONS_BY_TIER,
  createExecutionContractDraft,
  deriveExecutionContractProjection,
} = require('../../lib/audit/execution-contracts');
const {
  shouldAutoGeneratePostApprovalArtifacts,
  shouldAutoGenerateArtifactBundle,
  postApprovalArtifactGateSatisfied,
  maybeGeneratePostApprovalRepoArtifacts,
} = require('../../lib/audit/execution-contract-post-approval-artifacts');

function sectionBodiesFor(tier, suffix = '') {
  return Object.fromEntries(
    REQUIRED_SECTIONS_BY_TIER[tier].map((id) => [id, `Completed section ${id}${suffix}.`]),
  );
}

function makeStore() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-approval-artifacts-'));
  return {
    baseDir,
    store: createAuditStore({ baseDir, backend: 'file', allowFileBackend: true }),
  };
}

function uiUxApprovedContract(taskId = 'TSK-001') {
  const history = [{
    event_type: 'task.created',
    event_id: 'evt-create',
    payload: {
      intake_draft: true,
      title: 'UI Update',
      raw_requirements: 'Update desktop command center layout.',
    },
  }];
  const summary = {
    task_id: taskId,
    title: 'UI Update',
    intake_draft: true,
    operator_intake_requirements: 'Update desktop command center layout.',
  };
  const { contract } = createExecutionContractDraft({
    taskId,
    summary,
    history,
    actorId: 'pm',
    body: {
      templateTier: 'Standard',
      displayId: taskId,
      riskFlags: ['human_workflow', 'desktop_visual_validation'],
      sections: sectionBodiesFor('Standard'),
      reviewers: {
        architect: { status: 'approved', approved: true },
        ux: { status: 'approved', approved: true },
        qa: { status: 'approved', approved: true },
        sre: { status: 'approved', approved: true },
      },
    },
  });
  return { ...contract, status: 'approved', task_id: taskId };
}

async function seedApprovedContract(store, taskId, contract) {
  await store.appendEvent({
    taskId,
    tenantId: 'tenant-a',
    eventType: 'task.created',
    actorId: 'pm',
    actorType: 'agent',
    idempotencyKey: `create:${taskId}`,
    payload: {
      title: 'UI Update',
      intake_draft: true,
      initial_stage: 'DRAFT',
      assignee: 'pm',
      priority: 'P2',
      task_type: 'feature',
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
    payload: {
      version: contract.version,
      approval_summary: { canApprove: true },
    },
  });
}

test('shouldAutoGeneratePostApprovalArtifacts follows openclaw delegation env flags', () => {
  assert.equal(
    shouldAutoGeneratePostApprovalArtifacts({ autoGeneratePostApprovalArtifacts: false }),
    false,
  );
  assert.equal(
    shouldAutoGeneratePostApprovalArtifacts({ env: { PM_REFINEMENT_DELEGATE_WORK: 'openclaw' } }),
    true,
  );
  assert.equal(
    shouldAutoGeneratePostApprovalArtifacts({ env: { GOLDEN_PATH_OPENCLAW_POST_APPROVAL_ARTIFACTS: '1' } }),
    true,
  );
});

test('postApprovalArtifactGateSatisfied blocks until UX implementation review is approved', () => {
  const contract = uiUxApprovedContract();
  const history = [];
  assert.equal(postApprovalArtifactGateSatisfied({ contract, history }), false);

  history.push({
    event_type: 'task.ux_implementation_review_recorded',
    payload: {
      contract_version: contract.version,
      status: 'approved',
      approved: true,
    },
  });
  assert.equal(postApprovalArtifactGateSatisfied({ contract, history }), true);
});

test('maybeGeneratePostApprovalRepoArtifacts auto-generates verification report and artifact bundle', async () => {
  const { store } = makeStore();
  const taskId = 'TSK-001';
  const contract = uiUxApprovedContract(taskId);
  await seedApprovedContract(store, taskId, contract);
  await store.appendEvent({
    taskId,
    tenantId: 'tenant-a',
    eventType: 'task.ux_implementation_review_recorded',
    actorId: 'ux-designer',
    actorType: 'agent',
    idempotencyKey: `ux-review:${taskId}:v${contract.version}`,
    payload: {
      contract_version: contract.version,
      status: 'approved',
      approved: true,
      comment: 'Ready for engineer implementation.',
    },
  });

  const result = await maybeGeneratePostApprovalRepoArtifacts({
    store,
    context: { actorId: 'pm', roles: ['pm'], tenantId: 'tenant-a' },
    taskId,
    tenantId: 'tenant-a',
    contract,
    options: { autoGeneratePostApprovalArtifacts: true },
  });

  assert.equal(result.generated, true);
  assert.ok(result.verificationReport?.verificationReport?.report_id);
  assert.ok(result.artifactBundle?.artifactBundle?.bundle_id);

  const history = await store.getTaskHistory(taskId, { tenantId: 'tenant-a' });
  const projection = deriveExecutionContractProjection(history);
  assert.ok(projection.verificationReport);
  assert.ok(projection.artifacts);
  assert.equal(projection.dispatchReadiness.canDispatch, false);
  assert.ok(projection.dispatchReadiness.missingRequiredArtifacts.includes('architect_engineer_assignment'));
});

test('maybeGeneratePostApprovalRepoArtifacts skips when auto generation is disabled', async () => {
  const { store } = makeStore();
  const taskId = 'TSK-002';
  const contract = uiUxApprovedContract(taskId);
  await seedApprovedContract(store, taskId, contract);

  const result = await maybeGeneratePostApprovalRepoArtifacts({
    store,
    context: { actorId: 'pm', roles: ['pm'], tenantId: 'tenant-a' },
    taskId,
    tenantId: 'tenant-a',
    contract,
    options: { autoGeneratePostApprovalArtifacts: false },
  });

  assert.equal(result.generated, false);
  assert.equal(result.reason, 'auto_generate_disabled');
});

test('shouldAutoGenerateArtifactBundle can be disabled independently', () => {
  assert.equal(
    shouldAutoGenerateArtifactBundle({ env: { GOLDEN_PATH_OPENCLAW_POST_APPROVAL_ARTIFACT_BUNDLE: 'off' } }),
    false,
  );
  assert.equal(shouldAutoGenerateArtifactBundle({ autoGenerateArtifactBundle: true }), true);
});