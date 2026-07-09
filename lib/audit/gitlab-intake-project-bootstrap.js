const {
  assertGitLabIntakeProjectBootstrapEnabled,
  isGitLabIntakeProjectBootstrapEnabled,
} = require('./feature-flags');
const {
  issueLabels,
  issueIid,
  issueTitle,
  projectPath,
} = require('./gitlab');

const PROJECT_BOOTSTRAP_LABELS = new Set(['factory-intake', 'golden-path']);
const DEFAULT_EPIC_ISSUE = 269;

function parseEpicIssueNumber(options = {}) {
  const raw = options.gitlabIntakeEpicIssue
    || options.githubIntakeEpicIssue
    || process.env.GITLAB_INTAKE_EPIC_ISSUE
    || process.env.GITHUB_INTAKE_EPIC_ISSUE
    || process.env.GOLDEN_PATH_EPIC_ISSUE
    || DEFAULT_EPIC_ISSUE;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EPIC_ISSUE;
}

function isProjectBootstrapIssue(payload = {}) {
  const labels = issueLabels(payload);
  return labels.some((label) => PROJECT_BOOTSTRAP_LABELS.has(label));
}

function buildGitlabIssueProjectIdempotencyKey(repository, issueIidValue) {
  return `gitlab-issue-project:${repository}:${issueIidValue}`;
}

function buildProjectName(issueIidValue, issueTitleValue = '') {
  const title = String(issueTitleValue || '').trim();
  if (title) return `Factory delivery — ${title} [#${issueIidValue}]`;
  return `Golden Path Pilot - Issue ${issueIidValue}`;
}

function metadataMatchesForgeIssue(project, forgeIssueUrl) {
  if (!project || !forgeIssueUrl) return false;
  const metadata = project.metadata || {};
  return metadata.forgeIssueUrl === forgeIssueUrl
    || metadata.forge_issue_url === forgeIssueUrl
    || metadata.gitlabIssueUrl === forgeIssueUrl
    || metadata.gitlab_issue_url === forgeIssueUrl
    || metadata.githubIssueUrl === forgeIssueUrl
    || metadata.github_issue_url === forgeIssueUrl;
}

async function findProjectByForgeIssueUrl(taskPlatform, tenantId, forgeIssueUrl) {
  if (!forgeIssueUrl || typeof taskPlatform?.listProjects !== 'function') return null;
  const projects = await taskPlatform.listProjects({ tenantId, includeArchived: false });
  return projects.find((project) => metadataMatchesForgeIssue(project, forgeIssueUrl)) || null;
}

async function readTaskSnapshot(taskPlatform, tenantId, taskId) {
  if (!taskPlatform || typeof taskPlatform.getTask !== 'function') return null;
  const task = await taskPlatform.getTask({ tenantId, taskId });
  if (!task) return null;
  const hydrated = typeof taskPlatform.hydrateTask === 'function'
    ? await taskPlatform.hydrateTask(task)
    : task;
  return {
    taskId,
    version: Number(hydrated?.version || task.version || 1),
    projectId: hydrated?.projectId || hydrated?.project_id || task.projectId || task.project_id || null,
  };
}

async function attachTaskToProjectWithRetry(taskPlatform, {
  tenantId,
  taskId,
  projectId,
  actorId,
  requestId,
  idempotencyKey,
}) {
  const snapshot = await readTaskSnapshot(taskPlatform, tenantId, taskId);
  if (!snapshot) {
    throw new Error(`Task ${taskId} not found for project bootstrap`);
  }
  if (snapshot.projectId === projectId) {
    return { attached: false, existing: true, task: snapshot, version: snapshot.version };
  }

  let version = snapshot.version;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const attached = await taskPlatform.updateTaskProject({
        tenantId,
        taskId,
        projectId,
        version,
        actorId,
        requestId,
        idempotencyKey: idempotencyKey || `gitlab-issue-project-attach:${taskId}:${projectId}`,
      });
      return { attached: true, existing: false, task: attached, version: Number(attached?.version || version) };
    } catch (error) {
      const expectedVersion = error?.details?.expectedVersion;
      if (error?.code === 'version_conflict' && Number.isInteger(expectedVersion)) {
        version = expectedVersion;
        continue;
      }
      throw error;
    }
  }

  return taskPlatform.updateTaskProject({
    tenantId,
    taskId,
    projectId,
    version,
    actorId,
    requestId,
    idempotencyKey: idempotencyKey || `gitlab-issue-project-attach:${taskId}:${projectId}`,
  }).then((attached) => ({ attached: true, existing: false, task: attached, version: Number(attached?.version || version) }));
}

function assertGitlabProjectApis(taskPlatform) {
  if (!taskPlatform || typeof taskPlatform.createProject !== 'function' || typeof taskPlatform.updateTaskProject !== 'function') {
    throw new Error('Task platform project APIs are unavailable for GP-005 bootstrap');
  }
}

function buildGitlabBootstrapContext(payload = {}, intakeBody = {}, options = {}) {
  const iid = issueIid(payload) ?? intakeBody.gitlabIssueIid;
  const repository = intakeBody.gitlabProjectPath || projectPath(payload);
  return {
    actorId: 'gitlab-intake-normalizer',
    iid,
    forgeIssueUrl: intakeBody.forgeIssueUrl || intakeBody.gitlabIssueUrl || null,
    repository,
    labels: issueLabels(payload),
    title: issueTitle(payload),
    projectIdempotencyKey: repository && iid != null
      ? buildGitlabIssueProjectIdempotencyKey(repository, iid)
      : undefined,
    epicIssue: parseEpicIssueNumber(options),
  };
}

function existingProjectResult(snapshot, taskId) {
  if (!snapshot?.projectId) return null;
  return {
    skipped: false,
    existing: true,
    projectId: snapshot.projectId,
    projectName: null,
    taskId,
    attached: false,
  };
}

async function createGitlabProject(taskPlatform, tenantId, context, requestId) {
  const projectName = buildProjectName(context.iid, context.title);
  return taskPlatform.createProject({
    tenantId,
    actorId: context.actorId,
    name: projectName,
    summary: context.title || 'Factory intake project bootstrap',
    status: 'ACTIVE',
    ownerActorId: 'pm',
    metadata: {
      goldenPath: context.labels.includes('golden-path'),
      factoryIntake: context.labels.includes('factory-intake'),
      epicIssue: context.epicIssue,
      childIssue: context.iid ?? null,
      forgeIssueUrl: context.forgeIssueUrl,
      forge_issue_url: context.forgeIssueUrl,
      gitlabIssueUrl: context.forgeIssueUrl,
      gitlab_issue_url: context.forgeIssueUrl,
      gitlabIssueIid: context.iid ?? null,
      gitlabProjectPath: context.repository,
      intakeProvider: 'gitlab',
    },
    idempotencyKey: context.projectIdempotencyKey,
    requestId,
  });
}

function logGitlabBootstrap(logger, { requestId, taskId, tenantId, project, context, created, attach }) {
  logger?.info?.({
    feature: 'ff_gitlab_intake_project_bootstrap',
    action: 'gitlab_issue_project_bootstrapped',
    outcome: 'success',
    request_id: requestId,
    task_id: taskId,
    tenant_id: tenantId,
    project_id: project.projectId,
    forge_issue_url: context.forgeIssueUrl,
    created,
    attached: attach.attached,
  });
}

async function bootstrapProjectForIssueIntake({
  taskPlatform,
  tenantId,
  taskId,
  payload = {},
  intakeBody = {},
  options = {},
  requestId = null,
  logger = null,
}) {
  if (!isGitLabIntakeProjectBootstrapEnabled(options)) return { skipped: true, reason: 'feature_disabled' };
  assertGitLabIntakeProjectBootstrapEnabled(options);
  if (!isProjectBootstrapIssue(payload)) {
    return { skipped: true, reason: 'missing_project_bootstrap_label' };
  }
  assertGitlabProjectApis(taskPlatform);
  const context = buildGitlabBootstrapContext(payload, intakeBody, options);
  const snapshot = await readTaskSnapshot(taskPlatform, tenantId, taskId);
  const existing = existingProjectResult(snapshot, taskId);
  if (existing) return existing;

  let project = await findProjectByForgeIssueUrl(taskPlatform, tenantId, context.forgeIssueUrl);
  let created = false;
  if (!project) {
    project = await createGitlabProject(taskPlatform, tenantId, context, requestId);
    created = true;
  }

  const attach = await attachTaskToProjectWithRetry(taskPlatform, {
    tenantId,
    taskId,
    projectId: project.projectId,
    actorId: context.actorId,
    requestId,
    idempotencyKey: context.projectIdempotencyKey ? `${context.projectIdempotencyKey}:attach` : undefined,
  });

  logGitlabBootstrap(logger, { requestId, taskId, tenantId, project, context, created, attach });

  return {
    skipped: false,
    existing: !created,
    created,
    projectId: project.projectId,
    projectName: project.name,
    taskId,
    attached: attach.attached || attach.existing,
  };
}

module.exports = {
  DEFAULT_EPIC_ISSUE,
  PROJECT_BOOTSTRAP_LABELS,
  attachTaskToProjectWithRetry,
  bootstrapProjectForIssueIntake,
  buildGitlabIssueProjectIdempotencyKey,
  buildProjectName,
  findProjectByForgeIssueUrl,
  isProjectBootstrapIssue,
  metadataMatchesForgeIssue,
};
