const crypto = require('node:crypto');
const {
  assertTaskCreationEnabled,
  assertIntakeDraftCreationEnabled,
  assertGitHubIntakeNormalizerEnabled,
} = require('./feature-flags');
const { repositoryName } = require('./github');

const DEFAULT_OPT_IN_LABEL = 'factory-intake';
const PM_REFINEMENT_REQUIRED_ACTION = 'PM refinement required';

function parseRepoTenantMap(options = {}) {
  const raw = options.githubIntakeRepoTenantMap
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
    options.githubIntakeDefaultTenant
    || process.env.GITHUB_INTAKE_DEFAULT_TENANT
    || 'engineering-team',
  ).trim();
}

function resolveOptInLabel(options = {}) {
  return String(
    options.githubIntakeOptInLabel
    || process.env.GITHUB_INTAKE_OPT_IN_LABEL
    || DEFAULT_OPT_IN_LABEL,
  ).trim().toLowerCase();
}

function issueLabels(payload = {}) {
  return (payload.issue?.labels || []).map((label) => String(label?.name || label).trim().toLowerCase()).filter(Boolean);
}

function isFactoryIntakeIssue(payload = {}, options = {}) {
  const label = resolveOptInLabel(options);
  return issueLabels(payload).includes(label);
}

function buildGithubIssueIntakeIdempotencyKey(repository, issueNumber) {
  return `github-issue-intake:${repository}:${issueNumber}`;
}

function buildRawRequirementsFromIssue(issue = {}, repository = null, issueNumber = null) {
  const body = String(issue.body || '').trim();
  const title = String(issue.title || '').trim();
  const url = issue.html_url || null;
  if (body) {
    return body;
  }
  return [
    'GitHub issue intake (body empty).',
    '',
    title ? `Title: ${title}` : null,
    url ? `Issue: ${url}` : (repository && issueNumber != null ? `Issue: ${repository}#${issueNumber}` : null),
    '',
    'Operator: paste acceptance criteria into the Intake Draft or edit the linked GitHub issue and re-deliver the webhook.',
  ].filter(Boolean).join('\n');
}

function normalizeIssueIntakeBody(payload = {}, options = {}) {
  const issue = payload.issue || {};
  const repository = repositoryName(payload);
  const issueNumber = issue.number;
  const title = String(issue.title || '').trim();
  return {
    title: title || undefined,
    rawRequirements: buildRawRequirementsFromIssue(issue, repository, issueNumber),
    githubIssueUrl: issue.html_url || null,
    githubIssueNumber: issueNumber ?? null,
    githubRepository: repository,
    actorType: 'system',
    idempotencyKey: repository && issueNumber != null
      ? buildGithubIssueIntakeIdempotencyKey(repository, issueNumber)
      : undefined,
  };
}

async function findExistingIntakeTaskByIssueUrl(store, tenantId, githubIssueUrl) {
  if (!githubIssueUrl || typeof store.listTaskSummaries !== 'function') {
    return null;
  }
  const summaries = await store.listTaskSummaries({ tenantId });
  for (const summary of summaries) {
    const history = typeof store.getTaskHistory === 'function'
      ? await store.getTaskHistory(summary.task_id, { tenantId, limit: 20 })
      : [];
    const created = history.find((event) => event?.event_type === 'task.created');
    if (created?.payload?.github_issue_url === githubIssueUrl) {
      return { taskId: summary.task_id, tenantId };
    }
  }
  return null;
}

async function processGitHubIssueIntakeWebhook({
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
  assertGitHubIntakeNormalizerEnabled(options);
  assertTaskCreationEnabled(options);
  assertIntakeDraftCreationEnabled(options);

  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!['opened', 'edited', 'reopened'].includes(normalizedAction)) {
    return {
      status: 202,
      body: {
        received: true,
        ignored: true,
        reason: 'unsupported_issue_action',
        action: normalizedAction || null,
      },
    };
  }

  if (!isFactoryIntakeIssue(payload, options)) {
    return {
      status: 202,
      body: {
        received: true,
        ignored: true,
        reason: 'missing_opt_in_label',
        requiredLabel: resolveOptInLabel(options),
      },
    };
  }

  const repository = repositoryName(payload);
  const tenantId = resolveIntakeTenantForRepository(repository, options);
  const intakeBody = normalizeIssueIntakeBody(payload, options);
  const context = {
    tenantId,
    actorId: 'github-intake-normalizer',
    roles: ['admin', 'contributor'],
  };

  const existing = await findExistingIntakeTaskByIssueUrl(store, tenantId, intakeBody.githubIssueUrl);
  if (existing) {
    return {
      status: 202,
      body: {
        received: true,
        ignored: true,
        reason: 'existing_intake_task',
        taskId: existing.taskId,
        tenantId: existing.tenantId,
        githubIssueUrl: intakeBody.githubIssueUrl,
      },
    };
  }

  const result = await createIntakeDraft({
    store,
    taskPlatform,
    context,
    body: intakeBody,
    options,
    requestId,
  });

  if (result?.created?.duplicate) {
    return {
      status: 202,
      body: {
        received: true,
        ignored: true,
        reason: 'existing_intake_task',
        taskId: result.createdTaskId,
        tenantId,
        githubIssueUrl: intakeBody.githubIssueUrl,
        duplicate: true,
      },
    };
  }

  logger?.info?.({
    feature: 'ff_github_intake_normalizer',
    action: 'github_issue_intake_created',
    outcome: 'success',
    request_id: requestId,
    delivery_id: deliveryId,
    task_id: result.createdTaskId,
    tenant_id: tenantId,
    github_issue_url: intakeBody.githubIssueUrl,
  });

  return {
    status: 201,
    body: {
      received: true,
      created: true,
      deliveryId,
      taskId: result.createdTaskId,
      tenantId,
      githubIssueUrl: intakeBody.githubIssueUrl,
      githubIssueNumber: intakeBody.githubIssueNumber,
      intakeDraft: true,
      nextRequiredAction: PM_REFINEMENT_REQUIRED_ACTION,
      pmRefinement: result.pmRefinement ? { status: result.pmRefinement.status } : null,
      duplicate: Boolean(result.created?.duplicate),
    },
  };
}

module.exports = {
  DEFAULT_OPT_IN_LABEL,
  PM_REFINEMENT_REQUIRED_ACTION,
  buildGithubIssueIntakeIdempotencyKey,
  buildRawRequirementsFromIssue,
  findExistingIntakeTaskByIssueUrl,
  isFactoryIntakeIssue,
  normalizeIssueIntakeBody,
  processGitHubIssueIntakeWebhook,
  resolveIntakeTenantForRepository,
  resolveOptInLabel,
};