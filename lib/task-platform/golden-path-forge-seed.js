const {
  REQUIRED_SECTIONS_BY_TIER,
  createExecutionContractDraft,
  evaluateExecutionContractAutoApprovalPolicy,
  buildExecutionContractAutoApprovalRecord,
} = require('../audit/execution-contracts');
const { createAuditStore } = require('../audit/store');
const { assertAuditBackendConfiguration } = require('../audit/config');
const { evaluateForgeExecutionReadiness } = require('./forge-canonical-task');
const {
  buildGoldenPathForgeDispatch,
  buildGoldenPathSimpleSections,
} = require('./golden-path-phase1');

function buildGoldenPathForgeReadyContract(taskId) {
  const title = `Golden path forge execution for ${taskId}`;
  const acceptanceCriteria = [
    'POST /tasks/:id/start returns 202',
    'Forge lifecycle reaches completed after gate approvals',
    'QA fail/resume/retest loop recorded in pilot evidence',
  ].join('\n');

  const history = [{
    event_type: 'task.created',
    sequence_number: 1,
    payload: {
      title,
      task_type: 'feature',
      priority: 'P2',
      acceptance_criteria: acceptanceCriteria,
      assignee: 'engineer-jr',
      initial_stage: 'READY',
    },
  }];

  const draft = createExecutionContractDraft({
    taskId,
    summary: {
      task_id: taskId,
      title,
      task_type: 'feature',
      priority: 'P2',
      acceptance_criteria: acceptanceCriteria,
      assignee: 'engineer-jr',
    },
    history,
    actorId: 'golden-path-operator',
    body: {
      templateTier: 'Simple',
      sections: buildGoldenPathSimpleSections(),
      forgeDispatch: buildGoldenPathForgeDispatch(),
      dispatchSignals: {
        proposedEngineerTier: 'Jr',
        workCategory: 'docs',
        clearTestPlan: true,
      },
    },
  });

  const approvedContract = { ...draft.contract, status: 'approved' };
  const autoApproval = evaluateExecutionContractAutoApprovalPolicy({ contract: approvedContract });
  approvedContract.auto_approval = buildExecutionContractAutoApprovalRecord(autoApproval);
  return { createdPayload: history[0].payload, approvedContract };
}

async function persistGoldenPathForgeTask(store, tenantId, taskId, createdPayload, approvedContract) {
  const events = [
    {
      tenantId, taskId, eventType: 'task.created', actorType: 'agent', actorId: 'golden-path-operator',
      idempotencyKey: `create:${taskId}`, payload: createdPayload,
    },
    {
      tenantId, taskId, eventType: 'task.execution_contract_version_recorded', actorType: 'agent', actorId: 'golden-path-operator',
      idempotencyKey: `contract:${taskId}:v1`, payload: { contract: approvedContract },
    },
    {
      tenantId, taskId, eventType: 'task.execution_contract_approved', actorType: 'system', actorId: 'system:policy',
      idempotencyKey: `approve:${taskId}:v1`,
      payload: { version: approvedContract.version, auto_approval: approvedContract.auto_approval },
    },
    {
      tenantId, taskId, eventType: 'task.stage_changed', actorType: 'agent', actorId: 'golden-path-operator',
      idempotencyKey: `stage:${taskId}:DRAFT:READY`, payload: { from_stage: 'DRAFT', to_stage: 'READY' },
    },
    {
      tenantId, taskId, eventType: 'task.assigned', actorType: 'agent', actorId: 'golden-path-operator',
      idempotencyKey: `assign:${taskId}:engineer-jr`, payload: { assignee: 'engineer-jr' },
    },
  ];

  const results = [];
  for (const event of events) {
    results.push(await store.appendEvent(event));
  }
  return results;
}

async function seedGoldenPathForgeTask(options = {}) {
  const taskId = options.taskId || 'TSK-GOLDEN001';
  const tenantId = options.tenantId || 'engineering-team';
  const baseDir = options.baseDir || process.cwd();

  assertAuditBackendConfiguration({
    baseDir,
    runtimeEnv: process.env.NODE_ENV || 'development',
    allowFileBackend: process.env.ALLOW_FILE_AUDIT_BACKEND === 'true',
  });

  const store = options.store || createAuditStore({
    baseDir,
    workflowEngineEnabled: false,
  });

  const state = await store.getTaskCurrentState(taskId, { tenantId });
  const history = await store.getTaskHistory(taskId, { tenantId, limit: 1000 });
  const readiness = evaluateForgeExecutionReadiness({ taskId, state, history });
  if (readiness.ready) {
    return { ok: true, taskId, tenantId, skipped: true, task: readiness.task };
  }

  const { createdPayload, approvedContract } = buildGoldenPathForgeReadyContract(taskId);
  await persistGoldenPathForgeTask(store, tenantId, taskId, createdPayload, approvedContract);
  const after = evaluateForgeExecutionReadiness({
    taskId,
    state: await store.getTaskCurrentState(taskId, { tenantId }),
    history: await store.getTaskHistory(taskId, { tenantId, limit: 1000 }),
  });

  if (!after.ready) {
    return { ok: false, taskId, tenantId, details: after.details };
  }

  return { ok: true, taskId, tenantId, skipped: false, task: after.task };
}

module.exports = {
  buildGoldenPathForgeReadyContract,
  seedGoldenPathForgeTask,
};