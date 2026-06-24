const fs = require('node:fs');
const path = require('node:path');
const {
  apiSend,
  data,
  evidencePathForItem,
  makeForgeTaskId,
  persistDirForItem,
} = require('./factory-delivery-shared');
const { savePilotEvidence } = require('./golden-path-shared');
const { seedPilotAgentsOnIntake } = require('./factory-orchestration');

function buildIntakeDescription(requirement) {
  return [
    'Software factory autonomous delivery intake.',
    '',
    'Requirements:',
    requirement.requirements,
    '',
    requirement.githubIssueUrl ? `Source issue: ${requirement.githubIssueUrl}` : '',
    `Template tier: ${requirement.templateTier}`,
  ].filter(Boolean).join('\n');
}

async function createProject(ctx, requirement, projectName) {
  const createProject = await apiSend(ctx, '/api/v1/projects', 'POST', ['pm'], {
    name: projectName,
    summary: requirement.title,
    status: 'ACTIVE',
    metadata: {
      factoryDelivery: true,
      factoryQueueId: requirement.id,
      templateTier: requirement.templateTier,
    },
  });
  if (!createProject.ok) {
    throw new Error(`Project create failed (${createProject.status}): ${JSON.stringify(createProject.body)}`);
  }
  const projectId = data(createProject)?.projectId;
  if (!projectId) throw new Error('Project create succeeded but projectId is missing');
  return projectId;
}

async function createTask(ctx, requirement, projectName) {
  const createTask = await apiSend(ctx, '/api/v1/tasks', 'POST', ['admin'], {
    title: requirement.title,
    description: buildIntakeDescription(requirement),
    status: 'DRAFT',
    priority: 'P2',
    metadata: {
      factory_delivery: true,
      factory_queue_id: requirement.id,
      template_tier: requirement.templateTier,
      github_issue_url: requirement.githubIssueUrl,
      intake_draft: true,
      operator_intake_requirements: requirement.requirements,
    },
  });
  if (!createTask.ok) {
    throw new Error(`Task create failed (${createTask.status}): ${JSON.stringify(createTask.body)}`);
  }
  const task = data(createTask);
  if (!task?.taskId) throw new Error('Task create succeeded but taskId is missing');
  return task;
}

async function attachTaskWithVersionRetry(ctx, taskId, projectId, version) {
  let attachVersion = version;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const attachAttempt = await apiSend(ctx, `/api/v1/tasks/${encodeURIComponent(taskId)}/project`, 'PATCH', ['pm'], {
      projectId,
      version: attachVersion,
    });
    if (attachAttempt.ok) return attachAttempt;
    const expectedVersion = attachAttempt.body?.error?.details?.expectedVersion;
    if (attachAttempt.status === 409 && Number.isInteger(expectedVersion)) {
      attachVersion = expectedVersion;
      continue;
    }
    return attachAttempt;
  }
  return apiSend(ctx, `/api/v1/tasks/${encodeURIComponent(taskId)}/project`, 'PATCH', ['pm'], {
    projectId,
    version: attachVersion,
  });
}

async function attachTaskToProject(ctx, taskId, projectId, version) {
  const assignPm = await apiSend(ctx, `/api/v1/tasks/${encodeURIComponent(taskId)}/owner`, 'PATCH', ['pm'], {
    ownerAgentId: 'pm',
    version,
  });
  if (!assignPm.ok) {
    throw new Error(`PM owner assign failed (${assignPm.status}): ${JSON.stringify(assignPm.body)}`);
  }
  const assignedTask = data(assignPm);
  const attachTask = await attachTaskWithVersionRetry(ctx, taskId, projectId, assignedTask?.version ?? version);
  if (!attachTask.ok) {
    throw new Error(`Task attach failed (${attachTask.status}): ${JSON.stringify(attachTask.body)}`);
  }
}

async function createFactoryIntake(ctx, requirement, options = {}) {
  const projectName = options.projectName
    || `Factory delivery — ${requirement.title} [${requirement.id}]`;
  const projectId = await createProject(ctx, requirement, projectName);
  const task = await createTask(ctx, requirement, projectName);
  await attachTaskToProject(ctx, task.taskId, projectId, task.version);
  return { projectId, taskId: task.taskId, projectName };
}

function writeIntakeEvidence(config, item, intake) {
  const evidencePath = evidencePathForItem(item, config.deliveryDir);
  const persistDir = persistDirForItem(item, config.deliveryDir);
  fs.mkdirSync(path.resolve(process.cwd(), persistDir), { recursive: true });
  savePilotEvidence({
    schemaVersion: '1.0',
    epic: 'factory-autonomous-delivery',
    status: 'phase0_started',
    factoryQueueId: item.id,
    githubIssueUrl: item.githubIssueUrl || null,
    engineeringTeam: {
      projectId: intake.projectId,
      taskId: intake.taskId,
      projectName: intake.projectName,
      requirements: item.requirements,
      templateTier: item.templateTier,
    },
    forgeadapter: {
      taskId: item.forgeTaskId || makeForgeTaskId(item.id),
      startJobId: null,
      completeJobId: null,
    },
    stepsCompleted: [
      ...(item.githubIssueUrl ? ['GP-001'] : []),
      'GP-002',
      'GP-005',
      'GP-012',
    ],
    startedAt: item.createdAt || new Date().toISOString(),
    completedAt: null,
    phase0: {
      mode: 'factory_intake',
      baseUrl: config.baseUrl,
      tenantId: config.tenantId,
      actorId: config.actorId,
      persistDir,
    },
  }, evidencePath);
  return { evidencePath, persistDir };
}

async function completeIntakeRefinementAfterContract(ctx, taskId, contractVersion) {
  const response = await apiSend(ctx, `/tasks/${encodeURIComponent(taskId)}/events`, 'POST', ['pm', 'admin'], {
    eventType: 'task.refinement_completed',
    actorType: 'agent',
    actorId: ctx.actorId || 'factory-orchestrator',
    idempotencyKey: `factory-refinement-complete:${taskId}:v${contractVersion || 1}`,
    payload: {
      agent_id: 'pm',
      intake_draft: true,
      contract_version: contractVersion || 1,
      waiting_state: 'execution_contract_review',
      next_required_action: 'Execution Contract is approved; workflow may advance.',
      trigger: 'factory_phase1_contract',
      delegated: false,
      fallback_reason: 'factory_phase1_contract_path',
    },
  });
  if (!response.ok && response.status !== 202) {
    throw new Error(`PM refinement complete failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response;
}

async function bootstrapFactoryIntakeAgents(baseUrl) {
  const seed = await seedPilotAgentsOnIntake(baseUrl);
  return {
    ok: seed.ok === true,
    stdout: seed.stdout || '',
    stderr: seed.stderr || '',
    status: seed.status || 0,
  };
}

module.exports = {
  createFactoryIntake,
  writeIntakeEvidence,
  completeIntakeRefinementAfterContract,
  bootstrapFactoryIntakeAgents,
};