const {
  assertTaskCreationEnabled,
  assertIntakeDraftCreationEnabled,
  assertGitLabIntakeNormalizerEnabled,
} = require('./feature-flags');
const {
  issueAction,
  issueDescription,
  issueIid,
  issueLabels,
  issueTitle,
  issueUrl,
  projectPath,
} = require('./gitlab');
const { bootstrapProjectForIssueIntake } = require('./gitlab-intake-project-bootstrap');
const {
  createdIntakeResponse,
  existingIntakeResponse,
  intakeIgnoredResponse,
  findExistingIntakeTaskByForgeIssueUrl,
  syncExistingIntakeTaskFromForgeIssue,
} = require('./forge-issue-intake-shared');

const DEFAULT_OPT_IN_LABEL = 'factory-intake';
const SUPPORTED_ISSUE_ACTIONS = new Set(['open', 'update', 'reopen']);

function parseRepoTenantMap(options = {}) {
  const raw = options.gitlabIntakeRepoTenantMap
    || options.githubIntakeRepoTenantMap
    || process.env.GITLAB_INTAKE_REPO_TENANT_MAP
    || process.env.GITHUB_INTAKE_REPO_TENANT_MAP
    || '';
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function resolveIntakeTenantForRepository(fullName, options = {}) {
  const map = parseRepoTenantMap(options);
  if (fullName && map[fullName]) return String(map[fullName]).trim();
  return String(
    options.gitlabIntakeDefaultTenant
    || options.githubIntakeDefaultTenant
    || process.env.GITLAB_INTAKE_DEFAULT_TENANT
    || process.env.GITHUB_INTAKE_DEFAULT_TENANT
    || 'engineering-team',
  ).trim();
}

function resolveOptInLabel(options = {}) {
  return String(
    options.gitlabIntakeOptInLabel
    || options.githubIntakeOptInLabel
    || process.env.GITLAB_INTAKE_OPT_IN_LABEL
    || process.env.GITHUB_INTAKE_OPT_IN_LABEL
    || DEFAULT_OPT_IN_LABEL,
  ).trim().toLowerCase();
}

function isFactoryIntakeIssue(payload = {}, options = {}) {
  const label = resolveOptInLabel(options);
  return issueLabels(payload).includes(label);
}

function buildGitlabIssueIntakeIdempotencyKey(repository, issueIidValue) {
  return `gitlab-issue-intake:${repository}:${issueIidValue}`;
}

function buildRawRequirementsFromIssue(payload = {}, repository = null, issueIidValue = null) {
  const body = issueDescription(payload);
  const title = issueTitle(payload);
  const url = issueUrl(payload);
  if (body) {
    return body;
  }
  return [
    'GitLab issue intake (description empty).',
    '',
    title ? `Title: ${title}` : null,
    url ? `Issue: ${url}` : (repository && issueIidValue != null ? `Issue: ${repository}#${issueIidValue}` : null),
    '',
    'Operator: paste acceptance criteria into the Intake Draft or edit the linked GitLab issue and re-deliver the webhook.',
  ].filter(Boolean).join('\n');
}

function normalizeIssueIntakeBody(payload = {}, options = {}) {
  const repository = projectPath(payload);
  const iid = issueIid(payload);
  const title = issueTitle(payload);
  const forgeIssueUrl = issueUrl(payload);
  return {
    title: title || undefined,
    rawRequirements: buildRawRequirementsFromIssue(payload, repository, iid),
    forgeIssueUrl,
    gitlabIssueUrl: forgeIssueUrl,
    gitlabIssueIid: iid ?? null,
    gitlabProjectPath: repository,
    actorType: 'system',
    idempotencyKey: repository && iid != null
      ? buildGitlabIssueIntakeIdempotencyKey(repository, iid)
      : undefined,
  };
}

async function maybeBootstrapIssueProject({
  taskPlatform,
  tenantId,
  taskId,
  payload,
  intakeBody,
  options,
  requestId,
  logger,
}) {
  try {
    return await bootstrapProjectForIssueIntake({
      taskPlatform,
      tenantId,
      taskId,
      payload,
      intakeBody,
      options,
      requestId,
      logger,
    });
  } catch (error) {
    logger?.error?.({
      feature: 'ff_gitlab_intake_project_bootstrap',
      action: 'gitlab_issue_project_bootstrap_failed',
      outcome: 'error',
      request_id: requestId,
      task_id: taskId,
      tenant_id: tenantId,
      forge_issue_url: intakeBody.forgeIssueUrl,
      message: error?.message || String(error),
    });
    throw error;
  }
}

async function createIssueIntakeDraft({
  store,
  taskPlatform,
  createIntakeDraft,
  intakeBody,
  tenantId,
  payload,
  options,
  requestId,
  deliveryId,
  logger,
}) {
  const result = await createIntakeDraft({
    store,
    taskPlatform,
    context: { tenantId, actorId: 'gitlab-intake-normalizer', roles: ['admin', 'contributor'] },
    body: intakeBody,
    options,
    requestId,
  });
  if (result?.created?.duplicate) {
    const projectBootstrap = await maybeBootstrapIssueProject({
      taskPlatform, tenantId, taskId: result.createdTaskId, payload, intakeBody, options, requestId, logger,
    });
    return existingIntakeResponse({ taskId: result.createdTaskId, tenantId }, intakeBody, true, projectBootstrap);
  }
  const projectBootstrap = await maybeBootstrapIssueProject({
    taskPlatform, tenantId, taskId: result.createdTaskId, payload, intakeBody, options, requestId, logger,
  });
  logger?.info?.({
    feature: 'ff_gitlab_intake_normalizer',
    action: 'gitlab_issue_intake_created',
    outcome: 'success',
    request_id: requestId,
    delivery_id: deliveryId,
    task_id: result.createdTaskId,
    tenant_id: tenantId,
    forge_issue_url: intakeBody.forgeIssueUrl,
    project_id: projectBootstrap?.projectId || null,
  });
  return createdIntakeResponse({
    deliveryId,
    result,
    tenantId,
    intakeBody,
    projectBootstrap,
    intakeProvider: 'gitlab',
  });
}

async function processGitLabIssueIntakeWebhook({
  store,
  taskPlatform,
  createIntakeDraft,
  payload = {},
  action = '',
  deliveryId = '',
  options = {},
  logger = null,
  requestId = null,
}) {
  assertGitLabIntakeNormalizerEnabled(options);
  assertTaskCreationEnabled(options);
  assertIntakeDraftCreationEnabled(options);

  const normalizedAction = String(action || issueAction(payload) || '').trim().toLowerCase();
  if (!SUPPORTED_ISSUE_ACTIONS.has(normalizedAction)) {
    return intakeIgnoredResponse('unsupported_issue_action', { action: normalizedAction || null });
  }
  if (!isFactoryIntakeIssue(payload, options)) {
    return intakeIgnoredResponse('missing_opt_in_label', { requiredLabel: resolveOptInLabel(options) });
  }

  const tenantId = resolveIntakeTenantForRepository(projectPath(payload), options);
  const intakeBody = normalizeIssueIntakeBody(payload, options);
  const existing = await findExistingIntakeTaskByForgeIssueUrl(store, tenantId, intakeBody.forgeIssueUrl);
  if (existing) {
    const projectBootstrap = await maybeBootstrapIssueProject({
      taskPlatform,
      tenantId,
      taskId: existing.taskId,
      payload,
      intakeBody,
      options,
      requestId,
      logger,
    });
    const syncResult = await syncExistingIntakeTaskFromForgeIssue({
      store,
      existing,
      intakeBody,
      normalizedAction,
      deliveryId,
      intakeProvider: 'gitlab',
      projectBootstrap,
    });
    if (syncResult.synced) {
      logger?.info?.({
        feature: 'ff_gitlab_intake_normalizer',
        action: 'gitlab_issue_intake_synced',
        outcome: 'success',
        request_id: requestId,
        delivery_id: deliveryId,
        task_id: existing.taskId,
        tenant_id: tenantId,
        forge_issue_url: intakeBody.forgeIssueUrl,
      });
    }
    return syncResult.response;
  }

  return createIssueIntakeDraft({
    store, taskPlatform, createIntakeDraft, intakeBody, tenantId, payload, options, requestId, deliveryId, logger,
  });
}

module.exports = {
  DEFAULT_OPT_IN_LABEL,
  buildGitlabIssueIntakeIdempotencyKey,
  buildRawRequirementsFromIssue,
  isFactoryIntakeIssue,
  normalizeIssueIntakeBody,
  processGitLabIssueIntakeWebhook,
  resolveIntakeTenantForRepository,
  resolveOptInLabel,
};