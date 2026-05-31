function normalizeCanonicalTaskStatus(status = '') {
  const normalized = String(status || '').trim();
  return normalized || 'BACKLOG';
}

function isClosedCanonicalTask(task = {}) {
  const status = normalizeCanonicalTaskStatus(task.status).toUpperCase();
  return Boolean(task.closedAt || task.closed_at || ['DONE', 'CLOSED'].includes(status));
}

function isLegacyTaskListItem(task = {}) {
  return Boolean(task.task_id || task.current_stage || task.next_required_action || task.waiting_state);
}

function passthroughLegacyTaskListItem(task = {}) {
  return {
    ...task,
    current_stage: task.current_stage || task.status || 'BACKLOG',
    current_owner: task.current_owner || task.assignee || task.owner?.actor_id || null,
    owner: task.owner || null,
    blocked: Boolean(task.blocked),
    closed: Boolean(task.closed),
    intake_draft: Boolean(task.intake_draft),
  };
}

export function canonicalTaskToListItem(task = {}) {
  if (isLegacyTaskListItem(task)) return passthroughLegacyTaskListItem(task);

  const taskId = task.taskId || task.id || null;
  const status = normalizeCanonicalTaskStatus(task.status);
  const ownerAgentId = task.owner?.agentId || task.owner_agent_id || null;
  const updatedAt = task.updatedAt || task.createdAt || null;
  const projectId = task.projectId || task.project?.projectId || null;

  return {
    task_id: taskId,
    tenant_id: task.tenantId || null,
    title: task.title || taskId || 'Untitled task',
    task_type: task.taskType || null,
    priority: task.priority || null,
    current_stage: status,
    current_owner: ownerAgentId,
    owner: ownerAgentId ? {
      actor_id: ownerAgentId,
      display_name: task.owner?.displayName || ownerAgentId,
      role: task.owner?.role || null,
    } : null,
    blocked: status.toUpperCase() === 'BLOCKED',
    closed: isClosedCanonicalTask(task),
    waiting_state: task.waitingState || null,
    next_required_action: task.nextRequiredAction || null,
    queue_entered_at: task.createdAt || null,
    wip_owner: ownerAgentId,
    wip_started_at: null,
    freshness: {
      status: updatedAt ? 'fresh' : 'unknown',
      last_updated_at: updatedAt,
    },
    status_indicator: status.toLowerCase(),
    intake_draft: Boolean(task.intakeDraft || status.toUpperCase() === 'DRAFT'),
    project: task.project || null,
    project_id: projectId,
  };
}

export function normalizeCanonicalTaskList(payload = {}) {
  return {
    items: (payload.data || payload.items || []).map(canonicalTaskToListItem),
  };
}
