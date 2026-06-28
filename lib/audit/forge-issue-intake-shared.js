const PM_REFINEMENT_REQUIRED_ACTION = 'PM refinement required';

function intakeIgnoredResponse(reason, extra = {}) {
  return {
    status: 202,
    body: {
      received: true,
      ignored: true,
      reason,
      ...extra,
    },
  };
}

function projectBootstrapFields(projectBootstrap = null) {
  if (!projectBootstrap || projectBootstrap.skipped) return {};
  return {
    projectId: projectBootstrap.projectId || null,
    projectName: projectBootstrap.projectName || null,
    projectBootstrap: {
      skipped: false,
      created: projectBootstrap.created === true,
      existing: projectBootstrap.existing === true,
      attached: projectBootstrap.attached === true,
      projectId: projectBootstrap.projectId || null,
    },
  };
}

function forgeIssueResponseFields(intakeBody = {}) {
  return {
    forgeIssueUrl: intakeBody.forgeIssueUrl || null,
    gitlabIssueUrl: intakeBody.gitlabIssueUrl || null,
    gitlabIssueIid: intakeBody.gitlabIssueIid ?? null,
    githubIssueUrl: intakeBody.githubIssueUrl || null,
    githubIssueNumber: intakeBody.githubIssueNumber ?? null,
  };
}

function existingIntakeResponse(existing, intakeBody, duplicate = false, projectBootstrap = null) {
  return intakeIgnoredResponse('existing_intake_task', {
    taskId: existing.taskId,
    tenantId: existing.tenantId,
    duplicate,
    ...forgeIssueResponseFields(intakeBody),
    ...projectBootstrapFields(projectBootstrap),
  });
}

function intakeRequirementsSyncedResponse(existing, intakeBody, projectBootstrap = null, extra = {}) {
  return {
    status: 200,
    body: {
      received: true,
      synced: true,
      taskId: existing.taskId,
      tenantId: existing.tenantId,
      ...extra,
      ...forgeIssueResponseFields(intakeBody),
      ...projectBootstrapFields(projectBootstrap),
    },
  };
}

function resolveOperatorIntakeRequirements(history = []) {
  const updated = history.find((event) => event?.event_type === 'task.intake_requirements_updated');
  if (typeof updated?.payload?.raw_requirements === 'string') {
    return updated.payload.raw_requirements;
  }
  const refinement = history.find((event) => event?.event_type === 'task.refinement_requested');
  if (typeof refinement?.payload?.raw_requirements === 'string') {
    return refinement.payload.raw_requirements;
  }
  const created = history.find((event) => event?.event_type === 'task.created');
  if (typeof created?.payload?.raw_requirements === 'string') {
    return created.payload.raw_requirements;
  }
  return null;
}

function resolveIntakeDraftTitle(history = [], taskId = '') {
  const updated = history.find((event) => event?.event_type === 'task.intake_requirements_updated');
  const created = history.find((event) => event?.event_type === 'task.created');
  const latestPayload = history[0]?.payload || {};
  return updated?.payload?.title || created?.payload?.title || latestPayload.title || taskId;
}

async function syncExistingIntakeTaskFromForgeIssue({
  store,
  existing,
  intakeBody,
  normalizedAction,
  deliveryId = '',
  intakeProvider = 'gitlab',
  projectBootstrap = null,
}) {
  const history = typeof store.getTaskHistory === 'function'
    ? await store.getTaskHistory(existing.taskId, { tenantId: existing.tenantId, limit: 50 })
    : [];
  const currentRequirements = String(resolveOperatorIntakeRequirements(history) || '').trim();
  const incomingRequirements = String(intakeBody.rawRequirements || '').trim();
  const currentTitle = resolveIntakeDraftTitle(history, existing.taskId);
  const incomingTitle = String(intakeBody.title || '').trim();
  const requirementsChanged = incomingRequirements !== currentRequirements;
  const titleChanged = incomingTitle.length > 0 && incomingTitle !== currentTitle;

  if (normalizedAction !== 'update' && normalizedAction !== 'reopen') {
    return {
      response: existingIntakeResponse(existing, intakeBody, false, projectBootstrap),
      synced: false,
    };
  }

  if (!requirementsChanged && !titleChanged) {
    return {
      response: existingIntakeResponse(existing, intakeBody, false, projectBootstrap),
      synced: false,
    };
  }

  const idempotencyKey = [
    `${intakeProvider}-issue-intake-sync`,
    intakeBody.forgeIssueUrl || intakeBody.gitlabIssueUrl || intakeBody.githubIssueUrl || existing.taskId,
    deliveryId || `${incomingRequirements.length}:${incomingTitle}`,
  ].join(':');

  await store.appendEvent({
    taskId: existing.taskId,
    tenantId: existing.tenantId,
    eventType: 'task.intake_requirements_updated',
    actorId: `${intakeProvider}-intake-normalizer`,
    actorType: 'system',
    idempotencyKey,
    payload: {
      intake_draft: true,
      raw_requirements: incomingRequirements || currentRequirements,
      title: incomingTitle || currentTitle,
      forge_issue_url: intakeBody.forgeIssueUrl || intakeBody.gitlabIssueUrl || intakeBody.githubIssueUrl || null,
      gitlab_issue_url: intakeBody.gitlabIssueUrl || null,
      gitlab_issue_iid: intakeBody.gitlabIssueIid ?? null,
      github_issue_url: intakeBody.githubIssueUrl || null,
      github_issue_number: intakeBody.githubIssueNumber ?? null,
      intake_provider: intakeProvider,
      source_action: normalizedAction,
      previous_raw_requirements: currentRequirements || null,
    },
    source: `${intakeProvider}_intake`,
  });

  return {
    response: intakeRequirementsSyncedResponse(existing, intakeBody, projectBootstrap, {
      requirementsChanged,
      titleChanged,
    }),
    synced: true,
  };
}

function createdIntakeResponse({
  deliveryId,
  result,
  tenantId,
  intakeBody,
  projectBootstrap = null,
  intakeProvider = null,
}) {
  return {
    status: 201,
    body: {
      received: true,
      created: true,
      deliveryId,
      taskId: result.createdTaskId,
      tenantId,
      intakeDraft: true,
      intakeProvider: intakeProvider || null,
      nextRequiredAction: PM_REFINEMENT_REQUIRED_ACTION,
      pmRefinement: result.pmRefinement ? { status: result.pmRefinement.status } : null,
      duplicate: Boolean(result.created?.duplicate),
      ...forgeIssueResponseFields(intakeBody),
      ...projectBootstrapFields(projectBootstrap),
    },
  };
}

function taskCreatedForgeIssueUrls(payload = {}) {
  return [
    payload.forge_issue_url,
    payload.github_issue_url,
    payload.gitlab_issue_url,
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

async function findExistingIntakeTaskByForgeIssueUrl(store, tenantId, forgeIssueUrl) {
  const normalized = String(forgeIssueUrl || '').trim();
  if (!normalized || typeof store.listTaskSummaries !== 'function') {
    return null;
  }
  const summaries = await store.listTaskSummaries({ tenantId });
  for (const summary of summaries) {
    const history = typeof store.getTaskHistory === 'function'
      ? await store.getTaskHistory(summary.task_id, { tenantId, limit: 20 })
      : [];
    const created = history.find((event) => event?.event_type === 'task.created');
    const urls = taskCreatedForgeIssueUrls(created?.payload || {});
    if (urls.includes(normalized)) {
      return { taskId: summary.task_id, tenantId };
    }
  }
  return null;
}

module.exports = {
  PM_REFINEMENT_REQUIRED_ACTION,
  intakeIgnoredResponse,
  projectBootstrapFields,
  forgeIssueResponseFields,
  existingIntakeResponse,
  intakeRequirementsSyncedResponse,
  createdIntakeResponse,
  taskCreatedForgeIssueUrls,
  findExistingIntakeTaskByForgeIssueUrl,
  resolveOperatorIntakeRequirements,
  resolveIntakeDraftTitle,
  syncExistingIntakeTaskFromForgeIssue,
};