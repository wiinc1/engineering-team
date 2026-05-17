const LIVE_TASK_UPDATES_FEATURE = 'ff_live_task_freshness_polling';
const CURSOR_VERSION = 1;

function isDisabled(value) {
  return ['0', 'false', 'off', 'disabled', 'no'].includes(String(value || '').trim().toLowerCase());
}

function isLiveTaskUpdatesEnabled(options = {}) {
  if (typeof options.liveTaskUpdatesEnabled === 'boolean') return options.liveTaskUpdatesEnabled;
  const configured = options.ffLiveTaskFreshnessPolling
    ?? options.ff_live_task_freshness_polling
    ?? process.env.FF_LIVE_TASK_FRESHNESS_POLLING;
  return configured == null || configured === '' ? true : !isDisabled(configured);
}

function createLiveTaskUpdateError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function assertLiveTaskUpdatesEnabled(options = {}) {
  if (!isLiveTaskUpdatesEnabled(options)) {
    throw createLiveTaskUpdateError(
      503,
      'feature_disabled',
      'Live task freshness polling is disabled by FF_LIVE_TASK_FRESHNESS_POLLING.',
      { feature: LIVE_TASK_UPDATES_FEATURE },
    );
  }
}

function sanitizeCursor(raw = '') {
  return String(raw || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64);
}

function normalizePosition(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function encodeUpdateCursor(cursor = {}) {
  const body = JSON.stringify({ v: CURSOR_VERSION, position: normalizePosition(cursor.position) });
  return Buffer.from(body, 'utf8').toString('base64url');
}

function parseUpdateCursor(rawCursor = '') {
  const raw = String(rawCursor || '').trim();
  if (!raw) return { position: 0 };
  if (/^\d+$/.test(raw)) return { position: normalizePosition(raw) };
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (decoded?.v !== CURSOR_VERSION) throw new Error('unsupported cursor version');
    return { position: normalizePosition(decoded.position) };
  } catch {
    throw createLiveTaskUpdateError(400, 'invalid_cursor', 'cursor is invalid', {
      cursor: sanitizeCursor(raw),
    });
  }
}

function timestampMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function updatePosition(updatedAt, version) {
  return timestampMs(updatedAt) * 1000 + Number(version || 0);
}

function latestIso(...values) {
  const latest = values
    .filter(Boolean)
    .sort((a, b) => timestampMs(b) - timestampMs(a))[0];
  return latest || null;
}

function compactOwner(owner) {
  if (!owner || owner.redacted) return owner || null;
  if (owner.actor_id || owner.display_name) {
    return {
      actor_id: owner.actor_id || null,
      display_name: owner.display_name || owner.actor_id || null,
      redacted: owner.redacted === true || undefined,
    };
  }
  return {
    actor_id: owner.agentId || null,
    display_name: owner.displayName || owner.agentId || null,
    role: owner.role || null,
  };
}

function hasField(record, field) {
  return Object.prototype.hasOwnProperty.call(record || {}, field);
}

function firstField(record, fields) {
  for (const field of fields) {
    if (hasField(record, field)) return record[field];
  }
  return undefined;
}

function canonicalTaskFields(task = {}) {
  const ownerId = task.owner?.agentId || null;
  return {
    task_id: task.taskId,
    tenant_id: task.tenantId || null,
    title: task.title,
    priority: task.priority || null,
    current_stage: task.status,
    current_owner: ownerId,
    owner: compactOwner(task.owner),
    blocked: false,
    closed: !!task.closedAt,
    freshness: { status: 'fresh', last_updated_at: task.updatedAt || task.createdAt || null },
    project_id: task.projectId || task.project_id || null,
    project: task.project || null,
  };
}

function summaryTaskFields(summary = {}) {
  const taskId = firstField(summary, ['task_id', 'taskId']);
  if (!taskId) return {};
  const fields = { task_id: taskId, title: summary.title || taskId };
  for (const [target, sources] of [
    ['tenant_id', ['tenant_id', 'tenantId']],
    ['task_type', ['task_type', 'taskType']],
    ['priority', ['priority']],
    ['current_stage', ['current_stage', 'currentStage']],
    ['current_owner', ['current_owner', 'currentOwner']],
    ['waiting_state', ['waiting_state', 'waitingState']],
    ['next_required_action', ['next_required_action', 'nextRequiredAction']],
    ['queue_entered_at', ['queue_entered_at', 'queueEnteredAt']],
    ['wip_owner', ['wip_owner', 'wipOwner']],
    ['wip_started_at', ['wip_started_at', 'wipStartedAt']],
    ['freshness', ['freshness']],
    ['project_id', ['project_id', 'projectId']],
    ['project', ['project']],
  ]) {
    const value = firstField(summary, sources);
    if (value !== undefined) fields[target] = value;
  }
  if (summary.project?.projectId && fields.project_id === undefined) fields.project_id = summary.project.projectId;
  if (hasField(summary, 'owner')) fields.owner = compactOwner(summary.owner);
  if (hasField(summary, 'blocked')) fields.blocked = !!summary.blocked;
  if (hasField(summary, 'closed')) fields.closed = !!summary.closed;
  return fields;
}

function taskUpdateFromRecords(summary, canonical, projectMutation) {
  const task = { ...canonicalTaskFields(canonical || {}), ...summaryTaskFields(summary || {}) };
  const updatedAt = latestIso(
    task.freshness?.last_updated_at,
    canonical?.updatedAt,
    canonical?.createdAt,
    projectMutation?.created_at || projectMutation?.createdAt,
  );
  const version = Math.max(Number(canonical?.version || 0), Number(projectMutation?.task_version || projectMutation?.taskVersion || 0)) || timestampMs(updatedAt);
  const position = updatePosition(updatedAt, version);
  return {
    entityType: 'task',
    entityId: task.task_id,
    updateType: 'task_snapshot',
    version,
    updatedAt,
    position,
    payload: { task },
  };
}

function projectUpdate(project = {}, projectMutation) {
  const updatedAt = latestIso(
    project.updatedAt || project.updated_at,
    project.createdAt || project.created_at,
    projectMutation?.created_at || projectMutation?.createdAt,
  );
  const version = Math.max(Number(project.version || 0), Number(projectMutation?.project_version || projectMutation?.projectVersion || projectMutation?.task_version || projectMutation?.taskVersion || 0)) || timestampMs(updatedAt);
  return {
    entityType: 'project',
    entityId: project.projectId || project.project_id,
    updateType: 'project_snapshot',
    version,
    updatedAt,
    position: updatePosition(updatedAt, version),
    payload: {
      project: {
        projectId: project.projectId || project.project_id,
        name: project.name,
        status: project.status,
        ownerActorId: project.ownerActorId || project.owner_actor_id || null,
        taskCount: Number(project.taskCount || project.task_count || 0),
        version: Number(project.version || 0),
        updatedAt,
      },
    },
  };
}

function sortUpdates(updates = []) {
  return [...updates].sort((a, b) => (
    a.position - b.position
    || String(a.entityType).localeCompare(String(b.entityType))
    || String(a.entityId).localeCompare(String(b.entityId))
  ));
}

async function readAllUpdates({ store, taskPlatform, tenantId }) {
  const [summaries, canonicalTasks, projects, projectMutations] = await Promise.all([
    store?.listTaskSummaries ? Promise.resolve(store.listTaskSummaries({ tenantId })) : [],
    taskPlatform?.listTasks ? Promise.resolve(taskPlatform.listTasks({ tenantId })) : [],
    taskPlatform?.listProjects ? Promise.resolve(taskPlatform.listProjects({ tenantId })) : [],
    taskPlatform?.listProjectMutations ? Promise.resolve(taskPlatform.listProjectMutations({ tenantId })) : [],
  ]);
  const canonicalById = new Map((canonicalTasks || []).map(task => [task.taskId || task.task_id, task]));
  const summaryById = new Map((summaries || []).map(task => [task.task_id || task.taskId, task]));
  const latestProjectMutationByTaskId = new Map();
  const latestProjectMutationByProjectId = new Map();
  for (const mutation of projectMutations || []) {
    const taskId = mutation.task_id || mutation.taskId;
    const projectId = mutation.project_id || mutation.projectId;
    const currentTaskMutation = taskId ? latestProjectMutationByTaskId.get(taskId) : null;
    if (taskId && (!currentTaskMutation || updatePosition(mutation.created_at || mutation.createdAt, mutation.task_version || mutation.taskVersion) > updatePosition(currentTaskMutation.created_at || currentTaskMutation.createdAt, currentTaskMutation.task_version || currentTaskMutation.taskVersion))) {
      latestProjectMutationByTaskId.set(taskId, mutation);
    }
    const currentProjectMutation = projectId ? latestProjectMutationByProjectId.get(projectId) : null;
    if (projectId && (!currentProjectMutation || updatePosition(mutation.created_at || mutation.createdAt, mutation.project_version || mutation.projectVersion || mutation.task_version || mutation.taskVersion) > updatePosition(currentProjectMutation.created_at || currentProjectMutation.createdAt, currentProjectMutation.project_version || currentProjectMutation.projectVersion || currentProjectMutation.task_version || currentProjectMutation.taskVersion))) {
      latestProjectMutationByProjectId.set(projectId, mutation);
    }
  }
  const taskIds = new Set([...canonicalById.keys(), ...summaryById.keys()].filter(Boolean));
  const taskUpdates = [...taskIds].map(taskId => taskUpdateFromRecords(summaryById.get(taskId), canonicalById.get(taskId), latestProjectMutationByTaskId.get(taskId)));
  return sortUpdates([...taskUpdates, ...(projects || []).map(project => projectUpdate(project, latestProjectMutationByProjectId.get(project.projectId || project.project_id)))].filter(update => update.entityId));
}

async function buildLiveTaskUpdateResponse({ store, taskPlatform, tenantId, cursor }) {
  const parsedCursor = parseUpdateCursor(cursor);
  const updates = await readAllUpdates({ store, taskPlatform, tenantId });
  const maxPosition = updates.reduce((max, update) => Math.max(max, update.position), parsedCursor.position);
  const filtered = updates.filter(update => update.position > parsedCursor.position);
  return {
    data: {
      cursor: encodeUpdateCursor({ position: maxPosition }),
      position: maxPosition,
      pollAfterMs: 8000,
      serverTime: new Date().toISOString(),
      updates: filtered,
    },
  };
}

module.exports = {
  LIVE_TASK_UPDATES_FEATURE,
  assertLiveTaskUpdatesEnabled,
  buildLiveTaskUpdateResponse,
  createLiveTaskUpdateError,
  encodeUpdateCursor,
  isLiveTaskUpdatesEnabled,
  parseUpdateCursor,
  readAllUpdates,
  sanitizeCursor,
  taskUpdateFromRecords,
};
