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
  evaluateExecutionContractDispatchReadiness,
} = require('../../lib/audit/execution-contracts');
const {
  augmentDispatchReadinessWithArchitectGate,
  evaluateArchitectEngineerAssignmentGate,
  findLatestArchitectEngineerAssignment,
  maybeStartArchitectEngineerAssignmentAfterPostApproval,
  recordArchitectEngineerAssignment,
} = require('../../lib/audit/execution-contract-architect-dispatch');
const { findLatestUxImplementationReview } = require('../../lib/audit/execution-contract-ux-dispatch');

function sectionBodiesFor(tier, suffix = '') {
  return Object.fromEntries(
    REQUIRED_SECTIONS_BY_TIER[tier].map((id) => [id, `Completed section ${id}${suffix}.`]),
  );
}

function makeStore() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-dispatch-'));
  return {
    baseDir,
    store: createAuditStore({ baseDir, backend: 'file', allowFileBackend: true }),
  };
}

function approvedContract(taskId = 'TSK-010') {
  const history = [{
    event_type: 'task.created',
    event_id: 'evt-create',
    payload: { intake_draft: true, title: 'Backend service adjustment', initial_stage: 'DRAFT' },
  }];
  const { contract } = createExecutionContractDraft({
    taskId,
    summary: { task_id: taskId, title: 'Backend service adjustment', intake_draft: true },
    history,
    actorId: 'pm',
    body: {
      templateTier: 'Standard',
      displayId: taskId,
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

async function seedReadyForArchitectAssignment(store, taskId, contract) {
  await store.appendEvent({
    taskId,
    tenantId: 'tenant-a',
    eventType: 'task.created',
    actorId: 'pm',
    actorType: 'agent',
    idempotencyKey: `create:${taskId}`,
    payload: { title: 'Backend service adjustment', intake_draft: true, initial_stage: 'DRAFT', assignee: 'pm' },
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
  await store.appendEvent({
    taskId,
    tenantId: 'tenant-a',
    eventType: 'task.ux_implementation_review_recorded',
    actorId: 'ux-designer',
    actorType: 'agent',
    idempotencyKey: `ux:${taskId}:v${contract.version}`,
    payload: {
      contract_version: contract.version,
      status: 'approved',
      approved: true,
      comment: 'UX review satisfied for architect assignment tests.',
    },
  });
  await store.appendEvent({
    taskId,
    tenantId: 'tenant-a',
    eventType: 'task.execution_contract_verification_report_generated',
    actorId: 'pm',
    actorType: 'agent',
    idempotencyKey: `vr:${taskId}:v${contract.version}`,
    payload: {
      version: contract.version,
      verification_report: {
        report_id: `VR-${taskId}-v${contract.version}`,
        path: `docs/reports/${taskId}-verification.md`,
      },
    },
  });
}

test('augmentDispatchReadinessWithArchitectGate blocks engineer dispatch until architect assigns', () => {
  const contract = approvedContract();
  const readiness = evaluateExecutionContractDispatchReadiness({
    contract,
    verificationReport: { path: 'docs/reports/TSK-010-verification.md', report_id: 'VR-TSK-010-v1' },
  });

  const blocked = augmentDispatchReadinessWithArchitectGate(readiness, {
    contract,
    architectEngineerAssignment: null,
    history: [],
  });
  // readiness input enables architect gate once verification skeleton gate is already satisfied

  assert.equal(blocked.canDispatch, false);
  assert.ok(blocked.missingRequiredArtifacts.includes('architect_engineer_assignment'));
  assert.equal(blocked.architectEngineerAssignment.assignee, 'architect');

  const unblocked = augmentDispatchReadinessWithArchitectGate(readiness, {
    contract,
    architectEngineerAssignment: {
      engineerTier: 'Sr',
      assignee: 'engineer-sr',
    },
    history: [],
  });

  assert.equal(unblocked.architectEngineerAssignment.satisfied, true);
  assert.equal(unblocked.canDispatch, true);
});

test('recordArchitectEngineerAssignment records assignment and assigns engineer', async () => {
  const { store } = makeStore();
  const taskId = 'TSK-011';
  const contract = approvedContract(taskId);
  await seedReadyForArchitectAssignment(store, taskId, contract);

  const result = await recordArchitectEngineerAssignment({
    store,
    taskId,
    tenantId: 'tenant-a',
    context: { actorId: 'architect', roles: ['architect'], tenantId: 'tenant-a' },
    body: {
      engineerTier: 'Sr',
      assignee: 'engineer-sr',
      tierRationale: 'Standard UI work routes to Sr Engineer by policy.',
      actorType: 'agent',
    },
  });

  assert.equal(result.assignment.assignee, 'engineer-sr');
  const history = await store.getTaskHistory(taskId, { tenantId: 'tenant-a' });
  const projection = deriveExecutionContractProjection(history);
  assert.equal(projection.dispatchReadiness.canDispatch, true);
  assert.equal(findLatestArchitectEngineerAssignment(history, contract.version).assignee, 'engineer-sr');
  assert.ok(history.some((entry) => entry.event_type === 'task.assigned' && entry.payload.assignee === 'engineer-sr'));
});

test('evaluateArchitectEngineerAssignmentGate stays unsatisfied until post-approval gates complete', () => {
  const contract = approvedContract();
  const gate = evaluateArchitectEngineerAssignmentGate({
    contract,
    architectEngineerAssignment: null,
    history: [],
  });
  assert.equal(gate.required, false);

  const history = [{
    event_type: 'task.ux_implementation_review_recorded',
    payload: { contract_version: contract.version, status: 'approved', approved: true },
  }];
  const blocked = evaluateArchitectEngineerAssignmentGate({
    contract,
    architectEngineerAssignment: null,
    history,
  });
  assert.equal(blocked.required, false);
});

test('maybeStartArchitectEngineerAssignmentAfterPostApproval skips when auto delegation is disabled', async () => {
  const { store } = makeStore();
  const taskId = 'TSK-012';
  const contract = approvedContract(taskId);
  await seedReadyForArchitectAssignment(store, taskId, contract);

  const started = await maybeStartArchitectEngineerAssignmentAfterPostApproval({
    store,
    context: { actorId: 'architect', roles: ['architect'], tenantId: 'tenant-a' },
    taskId,
    tenantId: 'tenant-a',
    contract,
    options: { autoDelegateArchitectEngineerAssignment: false },
  });

  assert.equal(started.started, false);
  assert.equal(started.reason, 'auto_delegate_disabled');
});