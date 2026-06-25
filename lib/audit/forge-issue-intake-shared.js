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
  createdIntakeResponse,
  taskCreatedForgeIssueUrls,
  findExistingIntakeTaskByForgeIssueUrl,
};