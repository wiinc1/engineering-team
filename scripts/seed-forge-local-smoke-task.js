#!/usr/bin/env node
const {
  evaluateForgeExecutionReadiness,
} = require('../lib/task-platform/forge-canonical-task');
const {
  REQUIRED_SECTIONS_BY_TIER,
  createExecutionContractDraft,
  evaluateExecutionContractAutoApprovalPolicy,
  buildExecutionContractAutoApprovalRecord,
} = require('../lib/audit/execution-contracts');
const { assertAuditBackendConfiguration } = require('../lib/audit/config');
const { createAuditStore } = require('../lib/audit/store');

function parseArgs(argv) {
  const args = {
    'task-id': process.env.FORGE_LOCAL_SMOKE_TASK_ID || 'TSK-LOCAL001',
    'tenant-id': process.env.TENANT_ID || 'engineering-team',
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

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

async function persistForgeReadyTaskEvents(store, tenantId, taskId, createdPayload, approvedContract) {
  const events = [
    {
      tenantId,
      taskId,
      eventType: 'task.created',
      actorType: 'agent',
      actorId: 'pm-1',
      idempotencyKey: `create:${taskId}`,
      payload: createdPayload,
    },
    {
      tenantId,
      taskId,
      eventType: 'task.execution_contract_version_recorded',
      actorType: 'agent',
      actorId: 'pm-1',
      idempotencyKey: `contract:${taskId}:v1`,
      payload: { contract: approvedContract },
    },
    {
      tenantId,
      taskId,
      eventType: 'task.execution_contract_approved',
      actorType: 'system',
      actorId: 'system:policy',
      idempotencyKey: `approve:${taskId}:v1`,
      payload: {
        version: approvedContract.version,
        auto_approval: approvedContract.auto_approval,
      },
    },
    {
      tenantId,
      taskId,
      eventType: 'task.stage_changed',
      actorType: 'agent',
      actorId: 'pm-1',
      idempotencyKey: `stage:${taskId}:DRAFT:READY`,
      payload: { from_stage: 'DRAFT', to_stage: 'READY' },
    },
    {
      tenantId,
      taskId,
      eventType: 'task.assigned',
      actorType: 'agent',
      actorId: 'pm-1',
      idempotencyKey: `assign:${taskId}:main`,
      payload: { assignee: 'main' },
    },
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

async function seedForgeLocalSmokeTask(options = {}) {
  const taskId = options.taskId || 'TSK-LOCAL001';
  const tenantId = options.tenantId || process.env.TENANT_ID || 'engineering-team';
  const baseDir = options.baseDir || process.cwd();
  const store = options.store || createSeedAuditStore(baseDir);

  const state = await store.getTaskCurrentState(taskId, { tenantId });
  const history = await store.getTaskHistory(taskId, { tenantId, limit: 1000 });

  if ((state && !history.length) || (!state && history.length)) {
    return {
      ok: false,
      taskId,
      tenantId,
      reason: 'inconsistent_task_projection',
      remediation: 'Use a fresh audit data directory or delete the conflicting task projection before re-seeding.',
    };
  }

  if (history.length) {
    const readiness = evaluateForgeExecutionReadiness({
      taskId,
      state,
      history,
    });
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

  const { createdPayload, approvedContract } = buildForgeReadyApprovedContract(taskId);
  await persistForgeReadyTaskEvents(store, tenantId, taskId, createdPayload, approvedContract);

  const refreshedState = await store.getTaskCurrentState(taskId, { tenantId });
  const refreshedHistory = await store.getTaskHistory(taskId, { tenantId, limit: 1000 });
  const readiness = evaluateForgeExecutionReadiness({
    taskId,
    state: refreshedState,
    history: refreshedHistory,
  });

  if (!readiness.ready) {
    return {
      ok: false,
      taskId,
      tenantId,
      details: readiness.details,
    };
  }

  return {
    ok: true,
    taskId,
    tenantId,
    skipped: false,
    task: readiness.task,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await seedForgeLocalSmokeTask({
    taskId: args['task-id'],
    tenantId: args['tenant-id'],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  buildForgeReadyApprovedContract,
  seedForgeLocalSmokeTask,
};