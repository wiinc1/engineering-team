const {
  assertGitHubIntakeProjectBootstrapEnabled,
  isGitHubIntakeProjectBootstrapEnabled,
} = require('./feature-flags');

function issueLabels(payload = {}) {
  return (payload.issue?.labels || []).map((label) => String(label?.name || label).trim().toLowerCase()).filter(Boolean);
}

const PROJECT_BOOTSTRAP_LABELS = new Set(['factory-intake', 'golden-path']);
const DEFAULT_EPIC_ISSUE = 269;

function parseEpicIssueNumber(options = {}) {
  const raw = options.githubIntakeEpicIssue
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

function buildGithubIssueProjectIdempotencyKey(repository, issueNumber) {
  return `github-issue-project:${repository}:${issueNumber}`;
}

function buildProjectName(issueNumber, issueTitle = '') {
  const title = String(issueTitle || '').trim();
  if (title) return `Factory delivery — ${title} [#${issueNumber}]`;
  return `Golden Path Pilot - Issue ${issueNumber}`;
}

function metadataMatchesGithubIssue(project, githubIssueUrl) {
  if (!project || !githubIssueUrl) return false;
  const metadata = project.metadata || {};
  return metadata.githubIssueUrl === githubIssueUrl
    || metadata.github_issue_url === githubIssueUrl;
}

async function findProjectByGithubIssueUrl(taskPlatform, tenantId, githubIssueUrl) {
  if (!githubIssueUrl || typeof taskPlatform?.listProjects !== 'function') return null;
  const projects = await taskPlatform.listProjects({ tenantId, includeArchived: false });
  return projects.find((project) => metadataMatchesGithubIssue(project, githubIssueUrl)) || null;
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
        idempotencyKey: idempotencyKey || `github-issue-project-attach:${taskId}:${projectId}`,
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
    idempotencyKey: idempotencyKey || `github-issue-project-attach:${taskId}:${projectId}`,
  }).then((attached) => ({ attached: true, existing: false, task: attached, version: Number(attached?.version || version) }));
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
  if (!isGitHubIntakeProjectBootstrapEnabled(options)) {
    return { skipped: true, reason: 'feature_disabled' };
  }
  assertGitHubIntakeProjectBootstrapEnabled(options);
  if (!isProjectBootstrapIssue(payload)) {
    return { skipped: true, reason: 'missing_project_bootstrap_label' };
  }
  if (!taskPlatform || typeof taskPlatform.createProject !== 'function' || typeof taskPlatform.updateTaskProject !== 'function') {
    throw new Error('Task platform project APIs are unavailable for GP-005 bootstrap');
  }

  const actorId = 'github-intake-normalizer';
  const issue = payload.issue || {};
  const issueNumber = issue.number ?? intakeBody.githubIssueNumber;
  const githubIssueUrl = intakeBody.githubIssueUrl || issue.html_url || null;
  const repository = intakeBody.githubRepository || null;
  const labels = issueLabels(payload);
  const snapshot = await readTaskSnapshot(taskPlatform, tenantId, taskId);

  if (snapshot?.projectId) {
    return {
      skipped: false,
      existing: true,
      projectId: snapshot.projectId,
      projectName: null,
      taskId,
      attached: false,
    };
  }

  let project = await findProjectByGithubIssueUrl(taskPlatform, tenantId, githubIssueUrl);
  let created = false;
  if (!project) {
    const projectName = buildProjectName(issueNumber, issue.title);
    project = await taskPlatform.createProject({
      tenantId,
      actorId,
      name: projectName,
      summary: String(issue.title || '').trim() || 'Factory intake project bootstrap',
      status: 'ACTIVE',
      ownerActorId: 'pm',
      metadata: {
        goldenPath: labels.includes('golden-path'),
        factoryIntake: labels.includes('factory-intake'),
        epicIssue: parseEpicIssueNumber(options),
        childIssue: issueNumber ?? null,
        githubIssueUrl,
        github_issue_url: githubIssueUrl,
        githubIssueNumber: issueNumber ?? null,
        githubRepository: repository,
      },
      idempotencyKey: repository && issueNumber != null
        ? buildGithubIssueProjectIdempotencyKey(repository, issueNumber)
        : undefined,
      requestId,
    });
    created = true;
  }

  const attach = await attachTaskToProjectWithRetry(taskPlatform, {
    tenantId,
    taskId,
    projectId: project.projectId,
    actorId,
    requestId,
    idempotencyKey: repository && issueNumber != null
      ? `${buildGithubIssueProjectIdempotencyKey(repository, issueNumber)}:attach`
      : undefined,
  });

  logger?.info?.({
    feature: 'ff_github_intake_project_bootstrap',
    action: 'github_issue_project_bootstrapped',
    outcome: 'success',
    request_id: requestId,
    task_id: taskId,
    tenant_id: tenantId,
    project_id: project.projectId,
    github_issue_url: githubIssueUrl,
    created,
    attached: attach.attached,
  });

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
  buildGithubIssueProjectIdempotencyKey,
  buildProjectName,
  findProjectByGithubIssueUrl,
  isProjectBootstrapIssue,
  metadataMatchesGithubIssue,
};