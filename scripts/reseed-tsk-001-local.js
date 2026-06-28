#!/usr/bin/env node

const { createAuditStore } = require('../lib/audit/store');
const { STAGES } = require('../lib/audit/workflow');
const {
  REQUIRED_SECTIONS_BY_TIER,
  createExecutionContractDraft,
  deriveExecutionContractProjection,
  approveExecutionContractArtifactBundle,
} = require('../lib/audit/execution-contracts');
const { buildUiAcceptanceCriteriaSection } = require('../lib/audit/product-delivery-integrity');
const { recordArchitectEngineerAssignment } = require('../lib/audit/execution-contract-architect-dispatch');
const { maybeGeneratePostApprovalRepoArtifacts } = require('../lib/audit/execution-contract-post-approval-artifacts');
const { evaluateForgeExecutionReadiness } = require('../lib/task-platform/forge-canonical-task');

const TASK_ID = process.env.TSK_RESEED_TASK_ID || 'TSK-001';
const TENANT_ID = process.env.DEFAULT_TENANT_ID || process.env.TENANT_ID || 'engineering-team';

const DESIGN_SCOPE = {
  mode: 'behavior_only',
  issueUrl: 'https://github.com/wiinc1/engineering-team/issues/279',
  screenshotPath: 'docs/design/assets/command-console-redesign-target.png',
  parityBar: 'Queue selection and persistent inspector behavior only; not full issue #279 redesign.',
};

const ACCEPTANCE_CRITERIA = buildUiAcceptanceCriteriaSection({
  designScope: DESIGN_SCOPE,
  operatorPath: {
    route: '/tasks?view=list',
    on_load: 'Queue-first Command Center chrome is visible on first paint.',
    on_select: 'Persistent inspector opens with selected task context.',
  },
}).split('\n').filter((line) => line && !line.startsWith('Acceptance Criteria') && !/^Design scope:|^Parity bar:|^Template:/.test(line));

function sectionBodiesFor(tier) {
  const sections = Object.fromEntries(
    REQUIRED_SECTIONS_BY_TIER[tier].map((id) => [id, `Completed section ${id} for ${TASK_ID}.`]),
  );
  sections['2'] = {
    id: '2',
    body: ['Acceptance Criteria', ...ACCEPTANCE_CRITERIA.map((item, index) => `${index + 1}. ${item}`)].join('\n'),
  };
  return sections;
}

function buildApprovedContract() {
  const history = [{
    event_type: 'task.created',
    payload: {
      intake_draft: true,
      title: 'UI Update',
      raw_requirements: 'Update desktop Command Center to queue-first layout with persistent inspector.',
    },
  }];
  const summary = {
    task_id: TASK_ID,
    title: 'UI Update',
    intake_draft: true,
    operator_intake_requirements: 'Update desktop Command Center to queue-first layout with persistent inspector.',
  };
  const { contract } = createExecutionContractDraft({
    taskId: TASK_ID,
    summary,
    history,
    actorId: 'pm',
    body: {
      templateTier: 'Standard',
      displayId: TASK_ID,
      riskFlags: ['human_workflow', 'desktop_visual_validation'],
      sections: sectionBodiesFor('Standard'),
      reviewers: {
        architect: { status: 'approved', approved: true },
        ux: { status: 'approved', approved: true },
        qa: { status: 'approved', approved: true },
        sre: { status: 'approved', approved: true },
      },
      forgeDispatch: {
        targetRepo: 'wiinc1/engineering-team',
        projectId: 'engineering-team',
        domain: 'workflow',
      },
      dispatchSignals: {
        proposedEngineerTier: 'Sr',
        workCategory: 'ui_ux',
      },
      designScope: DESIGN_SCOPE,
      runnableSurface: {
        branch: 'main',
        serveUrl: 'http://127.0.0.1:15173',
        mergePolicy: 'required_before_submission_final',
      },
      operatorVerificationPath: {
        route: '/tasks?view=list',
        onLoad: 'Queue-first Command Center chrome is visible on first paint.',
        onSelect: 'Persistent inspector opens with selected task context.',
      },
    },
  });
  return { ...contract, status: 'approved', task_id: TASK_ID };
}

function createStore({ workflowEngineEnabled = false } = {}) {
  return createAuditStore({
    workflowEngineEnabled,
    ffAuditFoundation: true,
    ffWorkflowEngine: true,
    ffExecutionContracts: true,
    ffIntakeDraftCreation: true,
  });
}

async function appendStage(store, fromStage, toStage, payload = {}) {
  await store.appendEvent({
    taskId: TASK_ID,
    tenantId: TENANT_ID,
    eventType: 'task.stage_changed',
    actorId: 'admin@golden-path.local',
    actorType: 'user',
    idempotencyKey: `reseed:${TASK_ID}:${fromStage}:${toStage}`,
    payload: { from_stage: fromStage, to_stage: toStage, ...payload },
  });
}

async function seedBaseContract(store, contract, { skipCreated = false, skipRefinement = false } = {}) {
  if (!skipCreated) await store.appendEvent({
    taskId: TASK_ID,
    tenantId: TENANT_ID,
    eventType: 'task.created',
    actorId: 'pm',
    actorType: 'agent',
    idempotencyKey: `create:${TASK_ID}`,
    payload: {
      title: 'UI Update',
      intake_draft: true,
      initial_stage: STAGES.DRAFT,
      assignee: 'pm',
      priority: 'medium',
      task_type: 'feature',
      acceptance_criteria: ACCEPTANCE_CRITERIA,
      raw_requirements: 'Update desktop Command Center to queue-first layout with persistent inspector.',
    },
  });
  if (!skipRefinement) await store.appendEvent({
    taskId: TASK_ID,
    tenantId: TENANT_ID,
    eventType: 'task.refinement_requested',
    actorId: 'pm',
    actorType: 'agent',
    idempotencyKey: `refine:${TASK_ID}`,
    payload: { intake_draft: true, trigger: 'gitlab_intake' },
  });
  await store.appendEvent({
    taskId: TASK_ID,
    tenantId: TENANT_ID,
    eventType: 'task.execution_contract_version_recorded',
    actorId: 'pm',
    actorType: 'agent',
    idempotencyKey: `contract:${TASK_ID}:v${contract.version}`,
    payload: { contract },
  });
  await store.appendEvent({
    taskId: TASK_ID,
    tenantId: TENANT_ID,
    eventType: 'task.execution_contract_approved',
    actorId: 'admin@golden-path.local',
    actorType: 'user',
    idempotencyKey: `approve:${TASK_ID}:v${contract.version}`,
    payload: {
      version: contract.version,
      approval_summary: { canApprove: true },
    },
  });
  await store.appendEvent({
    taskId: TASK_ID,
    tenantId: TENANT_ID,
    eventType: 'task.refinement_completed',
    actorId: 'pm',
    actorType: 'agent',
    idempotencyKey: `refine-complete:${TASK_ID}:v${contract.version}`,
    payload: { version: contract.version, intake_draft: true },
  });
  await store.appendEvent({
    taskId: TASK_ID,
    tenantId: TENANT_ID,
    eventType: 'task.ux_implementation_review_recorded',
    actorId: 'ux-designer',
    actorType: 'agent',
    idempotencyKey: `ux-review:${TASK_ID}:v${contract.version}`,
    payload: {
      contract_version: contract.version,
      status: 'approved',
      approved: true,
      comment: 'UX implementation review approved for Command Center queue-first layout.',
    },
  });
}

async function approveArtifactBundle(store, contract) {
  const history = await store.getTaskHistory(TASK_ID, { tenantId: TENANT_ID });
  const projection = deriveExecutionContractProjection(history);
  const bundle = projection.artifacts?.latest || projection.artifacts;
  if (!bundle) return { skipped: true, reason: 'no_artifact_bundle' };

  const approved = approveExecutionContractArtifactBundle({
    bundle,
    actorId: 'pm',
    body: {
      approvals: {
        pm: { status: 'approved', actorId: 'pm' },
      },
    },
  });
  await store.appendEvent({
    taskId: TASK_ID,
    tenantId: TENANT_ID,
    eventType: 'task.execution_contract_artifact_bundle_approved',
    actorId: 'pm',
    actorType: 'agent',
    idempotencyKey: `artifact-bundle-approve:${TASK_ID}:v${contract.version}`,
    payload: {
      version: contract.version,
      bundle_id: approved.bundle_id || bundle.bundle_id,
      artifact_bundle: approved,
      approval_summary: approved.approval_summary || { canCommit: true },
    },
  });
  return { skipped: false, bundleId: approved.bundle_id || bundle.bundle_id };
}

async function advanceToImplementation(store) {
  const implementationReady = {
    waiting_state: 'implementation',
    next_required_action: 'Assigned to engineer-sr. Implementation may begin.',
  };
  const transitions = [
    [STAGES.DRAFT, STAGES.BACKLOG, {}],
    [STAGES.BACKLOG, STAGES.ARCHITECT_REVIEW, {}],
    [STAGES.ARCHITECT_REVIEW, STAGES.TECHNICAL_SPEC, {}],
    [STAGES.TECHNICAL_SPEC, STAGES.IMPLEMENTATION, implementationReady],
  ];
  for (const [fromStage, toStage, payload] of transitions) {
    await appendStage(store, fromStage, toStage, payload);
  }
}

async function ensureImplementationWaitingState(store) {
  const state = await store.getTaskCurrentState(TASK_ID, { tenantId: TENANT_ID });
  if (state?.current_stage !== STAGES.IMPLEMENTATION || state?.waiting_state) return;
  await store.appendEvent({
    taskId: TASK_ID,
    tenantId: TENANT_ID,
    eventType: 'task.unblocked',
    actorId: 'admin@golden-path.local',
    actorType: 'user',
    idempotencyKey: `reseed:${TASK_ID}:implementation-ready`,
    payload: {
      waiting_state: 'implementation',
      next_required_action: 'Assigned to engineer-sr. Implementation may begin.',
      reason: 'reseed_sync_after_postgres_reset',
    },
  });
}

async function processQueues(store) {
  if (typeof store.processProjectionQueue === 'function') {
    await store.processProjectionQueue(100);
  }
  if (typeof store.processOutbox === 'function') {
    await store.processOutbox(async () => {}, 100);
  }
}

function historyHasEvent(history, eventType) {
  return history.some((entry) => entry.event_type === eventType);
}

async function main() {
  const store = createStore({ workflowEngineEnabled: false });
  const existing = await store.getTaskCurrentState(TASK_ID, { tenantId: TENANT_ID });
  let history = existing
    ? await store.getTaskHistory(TASK_ID, { tenantId: TENANT_ID, limit: 500 })
    : [];

  if (existing?.current_stage === STAGES.IMPLEMENTATION && existing.assignee === 'engineer-sr') {
    await ensureImplementationWaitingState(store);
    if (typeof store.rebuildProjections === 'function') {
      await store.rebuildProjections();
    }
    await processQueues(store);
    const refreshed = await store.getTaskCurrentState(TASK_ID, { tenantId: TENANT_ID });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      skipped: true,
      reason: 'already_at_target_state',
      taskId: TASK_ID,
      stage: refreshed?.current_stage || existing.current_stage,
      owner: refreshed?.assignee || existing.assignee,
      waitingState: refreshed?.waiting_state || null,
    }, null, 2)}\n`);
    return;
  }

  const contract = buildApprovedContract();
  const context = {
    actorId: 'architect',
    roles: ['architect', 'reader'],
    tenantId: TENANT_ID,
  };

  if (!existing) {
    await seedBaseContract(store, contract);
  } else {
    await seedBaseContract(store, contract, {
      skipCreated: historyHasEvent(history, 'task.created'),
      skipRefinement: historyHasEvent(history, 'task.refinement_requested'),
    });
    if (!historyHasEvent(history, 'task.execution_contract_version_recorded')) {
      await store.appendEvent({
        taskId: TASK_ID,
        tenantId: TENANT_ID,
        eventType: 'task.execution_contract_version_recorded',
        actorId: 'pm',
        actorType: 'agent',
        idempotencyKey: `contract:${TASK_ID}:v${contract.version}`,
        payload: { contract },
      });
    }
    if (!historyHasEvent(history, 'task.execution_contract_approved')) {
      await store.appendEvent({
        taskId: TASK_ID,
        tenantId: TENANT_ID,
        eventType: 'task.execution_contract_approved',
        actorId: 'admin@golden-path.local',
        actorType: 'user',
        idempotencyKey: `approve:${TASK_ID}:v${contract.version}`,
        payload: { version: contract.version, approval_summary: { canApprove: true } },
      });
    }
    history = await store.getTaskHistory(TASK_ID, { tenantId: TENANT_ID, limit: 500 });
  }

  if (!historyHasEvent(history, 'task.ux_implementation_review_recorded')) {
    await store.appendEvent({
      taskId: TASK_ID,
      tenantId: TENANT_ID,
      eventType: 'task.ux_implementation_review_recorded',
      actorId: 'ux-designer',
      actorType: 'agent',
      idempotencyKey: `ux-review:${TASK_ID}:v${contract.version}`,
      payload: {
        contract_version: contract.version,
        status: 'approved',
        approved: true,
        comment: 'UX implementation review approved for Command Center queue-first layout.',
      },
    });
  }

  history = await store.getTaskHistory(TASK_ID, { tenantId: TENANT_ID, limit: 500 });
  if (!historyHasEvent(history, 'task.refinement_completed')) {
    await store.appendEvent({
      taskId: TASK_ID,
      tenantId: TENANT_ID,
      eventType: 'task.refinement_completed',
      actorId: 'pm',
      actorType: 'agent',
      idempotencyKey: `refine-complete:${TASK_ID}:v${contract.version}`,
      payload: { version: contract.version, intake_draft: true },
    });
  }

  async function ensurePostApprovalArtifacts() {
    let outputs = await maybeGeneratePostApprovalRepoArtifacts({
      store,
      context: { actorId: 'pm', roles: ['pm', 'reader'], tenantId: TENANT_ID },
      taskId: TASK_ID,
      tenantId: TENANT_ID,
      contract,
      options: { autoGeneratePostApprovalArtifacts: true },
    });
    let refreshed = await store.getTaskHistory(TASK_ID, { tenantId: TENANT_ID, limit: 500 });
    if (!historyHasEvent(refreshed, 'task.execution_contract_artifact_bundle_generated')) {
      outputs = await maybeGeneratePostApprovalRepoArtifacts({
        store,
        context: { actorId: 'pm', roles: ['pm', 'reader'], tenantId: TENANT_ID },
        taskId: TASK_ID,
        tenantId: TENANT_ID,
        contract: deriveExecutionContractProjection(refreshed).latest || contract,
        options: { autoGeneratePostApprovalArtifacts: true },
      });
      refreshed = await store.getTaskHistory(TASK_ID, { tenantId: TENANT_ID, limit: 500 });
    }
    return { outputs, history: refreshed };
  }

  ({ history } = await ensurePostApprovalArtifacts());
  if (!historyHasEvent(history, 'task.execution_contract_artifact_bundle_approved')) {
    const artifactResult = await approveArtifactBundle(store, contract);
    if (artifactResult.skipped) {
      throw new Error(`artifact_bundle_approval_skipped: ${artifactResult.reason || 'unknown'}`);
    }
    history = await store.getTaskHistory(TASK_ID, { tenantId: TENANT_ID, limit: 500 });
  }
  if (!historyHasEvent(history, 'task.architect_engineer_assignment_recorded')) {
    await recordArchitectEngineerAssignment({
    store,
    taskId: TASK_ID,
    tenantId: TENANT_ID,
    context,
    body: {
      engineerTier: 'Sr',
      assignee: 'engineer-sr',
      tierRationale: 'Command Center UI work requires Sr engineer implementation after UX delegation.',
      readyForEngineering: true,
      actorType: 'agent',
    },
    });
  }

  const stateBeforeStages = await store.getTaskCurrentState(TASK_ID, { tenantId: TENANT_ID });
  if (stateBeforeStages?.current_stage !== STAGES.IMPLEMENTATION) {
    await advanceToImplementation(store);
  } else {
    await ensureImplementationWaitingState(store);
  }

  if (typeof store.rebuildProjections === 'function') {
    await store.rebuildProjections();
  }
  await processQueues(store);

  const state = await store.getTaskCurrentState(TASK_ID, { tenantId: TENANT_ID });
  history = await store.getTaskHistory(TASK_ID, { tenantId: TENANT_ID, limit: 500 });
  const projection = deriveExecutionContractProjection(history);
  const forgeReadiness = evaluateForgeExecutionReadiness({
    taskId: TASK_ID,
    state,
    history,
  });

  const summary = {
    ok: true,
    taskId: TASK_ID,
    stage: state?.current_stage || null,
    owner: state?.assignee || null,
    waitingState: state?.waiting_state || null,
    nextRequiredAction: state?.next_required_action || null,
    canDispatch: projection.dispatchReadiness?.canDispatch === true,
    forgeReady: forgeReadiness.ready === true,
    forgeTask: forgeReadiness.task || null,
    eventCount: history.length,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});