const {
  evaluateForgeExecutionReadiness,
} = require('../task-platform/forge-canonical-task');
const {
  REQUIRED_SECTIONS_BY_TIER,
  createExecutionContractDraft,
  evaluateExecutionContractAutoApprovalPolicy,
  buildExecutionContractAutoApprovalRecord,
} = require('../audit/execution-contracts');
const { assertAuditBackendConfiguration } = require('../audit/config');
const { createAuditStore } = require('../audit/store');

function forgeReadySimpleSections(taskId) {
  const sections = Object.fromEntries(
    REQUIRED_SECTIONS_BY_TIER.Simple.map((sectionId) => [sectionId, { id: sectionId, body: `Completed ${sectionId}` }]),
  );
  sections['2'] = {
    id: '2',
    body: [
      'POST /tasks/:id/start returns 202',
      'GET /jobs/:id returns succeeded',
      'GET /tasks/:id/runtime shows running state with review gates',
    ].join('\n'),
  };
  sections['4'] = {
    id: '4',
    body: `Run npm run smoke:local against forgeadapter with seeded ${taskId}.`,
  };
  sections['11'] = {
    id: '11',
    body: 'Rollback by reverting the seeded local smoke task and clearing the isolated audit data directory.',
  };
  return sections;
}

function buildForgeReadyApprovedContract(taskId) {
  const title = `Local forgeadapter start smoke for ${taskId}.`;
  const acceptanceCriteria = [
    'POST /tasks/:id/start returns 202',
    'GET /jobs/:id returns succeeded',
    'GET /tasks/:id/runtime shows running state with review gates',
  ].join('\n');

  const history = [{
    event_type: 'task.created',
    sequence_number: 1,
    payload: {
      title,
      task_type: 'feature',
      priority: 'P1',
      acceptance_criteria: acceptanceCriteria,
      assignee: 'main',
      initial_stage: 'DRAFT',
    },
  }];

  const draft = createExecutionContractDraft({
    taskId,
    summary: {
      task_id: taskId,
      title,
      task_type: 'feature',
      priority: 'P1',
      acceptance_criteria: acceptanceCriteria,
      assignee: 'main',
    },
    history,
    actorId: 'pm-1',
    body: {
      templateTier: 'Simple',
      sections: forgeReadySimpleSections(taskId),
      forgeDispatch: {
        targetRepo: 'wiinc1/forgeadapter',
        projectId: 'forgeadapter',
        domain: 'runtime',
        affectsUi: false,
      },
    },
  });

  const approvedContract = { ...draft.contract, status: 'approved' };
  const autoApproval = evaluateExecutionContractAutoApprovalPolicy({ contract: approvedContract });
  approvedContract.auto_approval = buildExecutionContractAutoApprovalRecord(autoApproval);
  return { createdPayload: history[0].payload, approvedContract };
}

function buildForgeReadyContractEvents(tenantId, taskId, createdPayload, approvedContract) {
  return [
    {
      tenantId, taskId, eventType: 'task.created', actorType: 'agent', actorId: 'pm-1',
      idempotencyKey: `create:${taskId}`, payload: createdPayload,
    },
    {
      tenantId, taskId, eventType: 'task.execution_contract_version_recorded', actorType: 'agent', actorId: 'pm-1',
      idempotencyKey: `contract:${taskId}:v1`, payload: { contract: approvedContract },
    },
    {
      tenantId, taskId, eventType: 'task.execution_contract_approved', actorType: 'system', actorId: 'system:policy',
      idempotencyKey: `approve:${taskId}:v1`,
      payload: { version: approvedContract.version, auto_approval: approvedContract.auto_approval },
    },
  ];
}

function buildForgeReadyLifecycleEvents(tenantId, taskId) {
  return [
    {
      tenantId, taskId, eventType: 'task.stage_changed', actorType: 'agent', actorId: 'pm-1',
      idempotencyKey: `stage:${taskId}:DRAFT:READY`, payload: { from_stage: 'DRAFT', to_stage: 'READY' },
    },
    {
      tenantId, taskId, eventType: 'task.assigned', actorType: 'agent', actorId: 'pm-1',
      idempotencyKey: `assign:${taskId}:main`, payload: { assignee: 'main' },
    },
  ];
}

async function persistForgeReadyTaskEvents(store, tenantId, taskId, createdPayload, approvedContract) {
  const events = [
    ...buildForgeReadyContractEvents(tenantId, taskId, createdPayload, approvedContract),
    ...buildForgeReadyLifecycleEvents(tenantId, taskId),
  ];
  const results = [];
  for (const event of events) {
    results.push(await store.appendEvent(event));
  }
  return results;
}

function createSeedAuditStore(baseDir) {
  assertAuditBackendConfiguration({
    baseDir,
    runtimeEnv: process.env.NODE_ENV || 'development',
    allowFileBackend: process.env.ALLOW_FILE_AUDIT_BACKEND === 'true',
  });

  return createAuditStore({
    baseDir,
    workflowEngineEnabled: false,
  });
}

function resolveExistingTaskSeedOutcome({ taskId, tenantId, state, history }) {
  if ((state && !history.length) || (!state && history.length)) {
    return {
      ok: false,
      taskId,
      tenantId,
      reason: 'inconsistent_task_projection',
      remediation: 'Use a fresh audit data directory or delete the conflicting task projection before re-seeding.',
    };
  }

  if (!history.length) {
    return null;
  }

  const readiness = evaluateForgeExecutionReadiness({ taskId, state, history });
  if (readiness.ready) {
    return {
      ok: true,
      taskId,
      tenantId,
      skipped: true,
      reason: 'already_execution_ready',
      task: readiness.task,
    };
  }

  return {
    ok: false,
    taskId,
    tenantId,
    reason: 'conflicting_task_state',
    remediation: 'Task exists but is not execution-ready. Use a fresh audit data directory or a different --task-id.',
    details: readiness.details,
  };
}

async function loadTaskReadiness(store, tenantId, taskId) {
  const state = await store.getTaskCurrentState(taskId, { tenantId });
  const history = await store.getTaskHistory(taskId, { tenantId, limit: 1000 });
  return evaluateForgeExecutionReadiness({ taskId, state, history });
}

async function seedForgeLocalSmokeTask(options = {}) {
  const taskId = options.taskId || 'TSK-LOCAL001';
  const tenantId = options.tenantId || process.env.TENANT_ID || 'engineering-team';
  const baseDir = options.baseDir || process.cwd();
  const store = options.store || createSeedAuditStore(baseDir);

  const state = await store.getTaskCurrentState(taskId, { tenantId });
  const history = await store.getTaskHistory(taskId, { tenantId, limit: 1000 });
  const existingOutcome = resolveExistingTaskSeedOutcome({ taskId, tenantId, state, history });
  if (existingOutcome) {
    return existingOutcome;
  }

  const { createdPayload, approvedContract } = buildForgeReadyApprovedContract(taskId);
  await persistForgeReadyTaskEvents(store, tenantId, taskId, createdPayload, approvedContract);

  const readiness = await loadTaskReadiness(store, tenantId, taskId);
  if (!readiness.ready) {
    return { ok: false, taskId, tenantId, details: readiness.details };
  }

  return {
    ok: true,
    taskId,
    tenantId,
    skipped: false,
    task: readiness.task,
  };
}

module.exports = {
  buildForgeReadyApprovedContract,
  seedForgeLocalSmokeTask,
};