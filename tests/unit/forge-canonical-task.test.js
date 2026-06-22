const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUIRED_SECTIONS_BY_TIER,
  createExecutionContractDraft,
  deriveExecutionContractProjection,
  evaluateExecutionContractAutoApprovalPolicy,
  buildExecutionContractAutoApprovalRecord,
  normalizeForgeDispatch,
} = require('../../lib/audit/execution-contracts');
const {
  buildForgeCanonicalTask,
  evaluateForgeExecutionReadiness,
  normalizeAcceptanceCriteria,
  normalizePriority,
  normalizeTaskType,
} = require('../../lib/task-platform/forge-canonical-task');

function lowRiskSimpleSections() {
  const sections = Object.fromEntries(
    REQUIRED_SECTIONS_BY_TIER.Simple.map((sectionId) => [sectionId, { id: sectionId, body: `Completed ${sectionId}` }]),
  );
  sections['2'] = { id: '2', body: 'Given approved work, when forge reads it, then canonical fields are returned.\nGiven dispatch is ready, when forge starts, then preflight passes.' };
  sections['4'] = { id: '4', body: 'Run unit coverage for mapper and route auth paths.' };
  return sections;
}

function forgeUnitCreatedPayload() {
  return {
    title: 'Forge canonical mapper',
    task_type: 'Feature',
    priority: 'P1',
    acceptance_criteria: 'Criterion from string\nSecond criterion',
    assignee: 'engineer-sr',
    intake_draft: true,
    raw_requirements: 'Promote to forge execution readiness.',
  };
}

function buildApprovedForgeContract(taskId, history) {
  const createdPayload = history[0].payload;
  const draft = createExecutionContractDraft({
    taskId,
    summary: {
      task_id: taskId,
      title: createdPayload.title,
      task_type: createdPayload.task_type,
      priority: createdPayload.priority,
      acceptance_criteria: createdPayload.acceptance_criteria,
      assignee: createdPayload.assignee,
      intake_draft: createdPayload.intake_draft,
    },
    history,
    actorId: 'pm-1',
    body: {
      templateTier: 'Simple',
      sections: lowRiskSimpleSections(),
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
  return approvedContract;
}

function prependApprovedContractEvents(history, approvedContract) {
  history.unshift({
    event_type: 'task.execution_contract_version_recorded',
    sequence_number: 2,
    payload: { contract: approvedContract },
  });
  history.unshift({
    event_type: 'task.execution_contract_approved',
    sequence_number: 3,
    payload: {
      version: approvedContract.version,
      auto_approval: approvedContract.auto_approval,
    },
  });
}

function approvedSimpleContractHistory(taskId = 'TSK-FORGE-UNIT') {
  const history = [{
    event_type: 'task.created',
    sequence_number: 1,
    payload: forgeUnitCreatedPayload(),
  }];
  const approvedContract = buildApprovedForgeContract(taskId, history);
  prependApprovedContractEvents(history, approvedContract);
  return { history, approvedContract };
}

test('normalizeForgeDispatch persists camelCase upsert fields', () => {
  assert.deepEqual(
    normalizeForgeDispatch({
      targetRepo: 'wiinc1/forgeadapter',
      projectId: 'forgeadapter',
      domain: 'runtime',
      affectsUi: true,
    }),
    {
      target_repo: 'wiinc1/forgeadapter',
      project_id: 'forgeadapter',
      domain: 'runtime',
      affects_ui: true,
    },
  );
});

test('normalizeAcceptanceCriteria handles string and array inputs', () => {
  assert.deepEqual(
    normalizeAcceptanceCriteria('First\n\nSecond'),
    ['First', 'Second'],
  );
  assert.deepEqual(
    normalizeAcceptanceCriteria([' Alpha ', '', 'Beta ']),
    ['Alpha', 'Beta'],
  );
  assert.deepEqual(
    normalizeAcceptanceCriteria('', 'Fallback one\nFallback two'),
    ['Fallback one', 'Fallback two'],
  );
});

test('normalizePriority and normalizeTaskType apply forge aliases', () => {
  assert.equal(normalizePriority('P1'), 'high');
  assert.equal(normalizeTaskType('Bug'), 'bug');
  assert.equal(normalizeTaskType(null, 'docs'), 'research');
});

test('buildForgeCanonicalTask maps approved contract fields for forgeadapter', () => {
  const { history, approvedContract } = approvedSimpleContractHistory('TSK-FORGE-MAP');
  const projection = deriveExecutionContractProjection(history);

  const mapped = buildForgeCanonicalTask({
    taskId: 'TSK-FORGE-MAP',
    summary: {
      task_id: 'TSK-FORGE-MAP',
      title: 'Forge canonical mapper',
      task_type: 'Feature',
      priority: 'P1',
      acceptance_criteria: 'Criterion from string\nSecond criterion',
      current_owner: 'engineer-sr',
      execution_contract: projection,
    },
    contract: approvedContract,
  });

  assert.equal(mapped.ok, true);
  assert.equal(mapped.task.taskId, 'TSK-FORGE-MAP');
  assert.equal(mapped.task.projectId, 'forgeadapter');
  assert.equal(mapped.task.domain, 'runtime');
  assert.equal(mapped.task.targetRepo, 'wiinc1/forgeadapter');
  assert.equal(mapped.task.taskType, 'feature');
  assert.equal(mapped.task.priority, 'high');
  assert.equal(mapped.task.requestedOwner, 'engineer-sr');
  assert.deepEqual(mapped.task.acceptanceCriteria, ['Criterion from string', 'Second criterion']);
});

test('evaluateForgeExecutionReadiness returns 422 when forge_dispatch target repo is missing', () => {
  const { history } = approvedSimpleContractHistory('TSK-FORGE-MISSING');
  const versionEvent = history.find((event) => event.event_type === 'task.execution_contract_version_recorded');
  versionEvent.payload.contract.forge_dispatch = {
    project_id: 'forgeadapter',
    domain: 'runtime',
  };

  const result = evaluateForgeExecutionReadiness({
    taskId: 'TSK-FORGE-MISSING',
    state: {
      task_id: 'TSK-FORGE-MISSING',
      tenant_id: 'tenant-a',
      current_stage: 'READY',
      assignee: 'engineer-sr',
      priority: 'P1',
    },
    history,
  });

  assert.equal(result.ready, false);
  assert.equal(result.statusCode, 422);
  assert.equal(result.code, 'task_not_execution_ready');
  assert.ok(result.details.some((detail) => detail.path === 'targetRepo'));
});

test('evaluateForgeExecutionReadiness returns canonical task for approved Simple contract', () => {
  const { history } = approvedSimpleContractHistory('TSK-FORGE-READY');
  const result = evaluateForgeExecutionReadiness({
    taskId: 'TSK-FORGE-READY',
    state: {
      task_id: 'TSK-FORGE-READY',
      tenant_id: 'tenant-a',
      current_stage: 'READY',
      assignee: 'engineer-sr',
      priority: 'P1',
    },
    history,
  });

  assert.equal(result.ready, true);
  assert.equal(result.task.taskId, 'TSK-FORGE-READY');
  assert.equal(result.task.targetRepo, 'wiinc1/forgeadapter');
  assert.equal(result.task.affectsUi, false);
});