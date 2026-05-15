const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createTaskPlatformError } = require('./service');
const { createPostgresProjectAdapter } = require('./projects-postgres');

const PROJECT_STATUSES = Object.freeze(['PLANNING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']);
const PROJECT_ID_PATTERN = /^PRJ-[A-Z0-9]{8}$/;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

function writeJson(file, payload) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function makeProjectId() {
  return `PRJ-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function key(tenantId, id) {
  return `${tenantId}::${id}`;
}

function normalizeProjectId(value, field = 'projectId') {
  const projectId = String(value || '').trim().toUpperCase();
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw createTaskPlatformError(400, 'invalid_project_id', `${field} must match ${PROJECT_ID_PATTERN.source}`, { field });
  }
  return projectId;
}

function normalizeProjectStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (!PROJECT_STATUSES.includes(status)) {
    throw createTaskPlatformError(400, 'invalid_project_status', 'Project status is invalid', { status, allowedStatuses: PROJECT_STATUSES });
  }
  return status;
}

function normalizeProjectName(value) {
  const name = String(value || '').trim();
  if (!name) throw createTaskPlatformError(400, 'invalid_project_name', 'Project name is required', { field: 'name' });
  if (name.length > 120) throw createTaskPlatformError(400, 'invalid_project_name', 'Project name must be 120 characters or fewer', { field: 'name' });
  return name;
}

function normalizeOptionalText(value, field) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  if (text.length > 2000) throw createTaskPlatformError(400, `invalid_${field}`, `${field} must be 2000 characters or fewer`, { field });
  return text;
}

function normalizeMetadata(value) {
  if (value === undefined) return undefined;
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createTaskPlatformError(400, 'invalid_project_metadata', 'metadata must be an object', { field: 'metadata' });
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeCreateInput(input = {}) {
  return {
    tenantId: String(input.tenantId || input.tenant_id || '').trim(),
    actorId: String(input.actorId || input.actor_id || '').trim() || 'system',
    projectId: input.projectId || input.project_id ? normalizeProjectId(input.projectId || input.project_id) : makeProjectId(),
    name: normalizeProjectName(input.name),
    summary: normalizeOptionalText(input.summary, 'summary') ?? '',
    status: normalizeProjectStatus(input.status || 'PLANNING'),
    ownerActorId: normalizeOptionalText(input.ownerActorId ?? input.owner_actor_id, 'ownerActorId') || null,
    metadata: normalizeMetadata(input.metadata) || {},
    idempotencyKey: input.idempotencyKey || input.idempotency_key || null,
    requestId: input.requestId || input.request_id || null,
  };
}

function normalizeUpdateInput(input = {}) {
  const update = {
    tenantId: String(input.tenantId || input.tenant_id || '').trim(),
    actorId: String(input.actorId || input.actor_id || '').trim() || 'system',
    projectId: normalizeProjectId(input.projectId || input.project_id),
    version: Number(input.version),
    idempotencyKey: input.idempotencyKey || input.idempotency_key || null,
    requestId: input.requestId || input.request_id || null,
  };
  if (!Number.isSafeInteger(update.version) || update.version < 1) {
    throw createTaskPlatformError(400, 'invalid_project_version', 'version must be a positive integer', { field: 'version' });
  }
  if (input.name !== undefined) update.name = normalizeProjectName(input.name);
  if (input.summary !== undefined) update.summary = normalizeOptionalText(input.summary, 'summary') || '';
  if (input.status !== undefined) update.status = normalizeProjectStatus(input.status);
  if (input.ownerActorId !== undefined || input.owner_actor_id !== undefined) update.ownerActorId = normalizeOptionalText(input.ownerActorId ?? input.owner_actor_id, 'ownerActorId') || null;
  if (input.metadata !== undefined) update.metadata = normalizeMetadata(input.metadata);
  return update;
}

function toProject(record, taskCount = 0) {
  if (!record) return null;
  return {
    projectId: record.project_id,
    name: record.name,
    summary: record.summary || '',
    status: record.status,
    ownerActorId: record.owner_actor_id || null,
    taskCount,
    version: Number(record.version || 1),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    archivedAt: record.archived_at || null,
    metadata: record.metadata || {},
  };
}

function projectLabel(project) {
  return project ? { projectId: project.projectId, name: project.name, status: project.status, href: `/projects/${encodeURIComponent(project.projectId)}` } : null;
}

function withTenantFromInput(input, task) {
  if (!task) return task;
  const tenantId = task.tenantId || task.tenant_id || input.tenantId || input.tenant_id;
  return tenantId ? { ...task, tenantId } : task;
}

function isPromiseLike(value) {
  return value && typeof value.then === 'function';
}

function maybeThen(value, fn) {
  return isPromiseLike(value) ? value.then(fn) : fn(value);
}

function maybeAll(values) {
  return values.some(isPromiseLike) ? Promise.all(values) : values;
}

function hydrateTaskResult(projects, input, result) {
  return maybeThen(result, task => projects.hydrateTask(withTenantFromInput(input, task)));
}

function createFileProjectContext(service, options = {}) {
  return {
    service,
    file: path.join(options.baseDir || process.cwd(), 'data', 'task-platform-projects.json'),
    empty: () => ({ projects: {}, memberships: {}, project_mutations: [], idempotency: {} }),
  };
}

function fileRead(ctx) {
  const state = readJson(ctx.file, ctx.empty());
  state.projects ||= {};
  state.memberships ||= {};
  state.project_mutations ||= [];
  state.idempotency ||= {};
  return state;
}

function fileWrite(ctx, state) {
  writeJson(ctx.file, state);
}

function fileMutation(state, payload) {
  state.project_mutations.push({ mutation_id: state.project_mutations.length + 1, created_at: new Date().toISOString(), ...payload });
}

function fileTaskCount(state, tenantId, projectId) {
  return Object.entries(state.memberships).filter(([membershipKey, value]) => membershipKey.startsWith(`${tenantId}::`) && value.project_id === projectId).length;
}

function fileEnsureUniqueName(state, tenantId, name, projectId = null) {
  const normalized = name.trim().toLowerCase();
  const duplicate = Object.values(state.projects).find(project => project.tenant_id === tenantId && project.project_id !== projectId && project.name.trim().toLowerCase() === normalized);
  if (duplicate) throw createTaskPlatformError(409, 'duplicate_project_name', 'Project name already exists in this tenant', { name });
}

function fileHydrateTask(state, task) {
  if (!task) return task;
  const taskId = task.taskId || task.task_id;
  const tenantId = task.tenantId || task.tenant_id;
  const membership = state.memberships[key(tenantId, taskId)] || null;
  const project = membership?.project_id ? toProject(state.projects[key(tenantId, membership.project_id)], fileTaskCount(state, tenantId, membership.project_id)) : null;
  return { ...task, projectId: project?.projectId || null, project: projectLabel(project), project_id: project?.projectId || null };
}

async function fileCurrentTaskVersion(ctx, state, tenantId, taskId) {
  const task = await ctx.service.getTask({ tenantId, taskId });
  if (!task) throw createTaskPlatformError(404, 'task_not_found', 'Task not found', { taskId });
  const membership = state.memberships[key(tenantId, taskId)];
  return { task, version: Math.max(Number(task.version || 1), Number(membership?.version || task.version || 1)) };
}

async function fileListProjects(ctx, { tenantId, status, includeArchived = false }) {
  const state = fileRead(ctx);
  return Object.values(state.projects)
    .filter(project => project.tenant_id === tenantId)
    .filter(project => includeArchived || project.status !== 'ARCHIVED')
    .filter(project => !status || project.status === normalizeProjectStatus(status))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || a.name.localeCompare(b.name))
    .map(project => toProject(project, fileTaskCount(state, tenantId, project.project_id)));
}

async function fileGetProject(ctx, { tenantId, projectId, includeTasks = false }) {
  const state = fileRead(ctx);
  const normalizedId = normalizeProjectId(projectId);
  const record = state.projects[key(tenantId, normalizedId)] || null;
  if (!record) return null;
  const project = toProject(record, fileTaskCount(state, tenantId, normalizedId));
  if (!includeTasks) return project;
  const tasks = (await ctx.service.listTasks({ tenantId })).map(task => fileHydrateTask(state, { tenantId, ...task })).filter(task => task.projectId === normalizedId);
  return { ...project, tasks };
}

async function fileCreateProject(ctx, input = {}) {
  const next = normalizeCreateInput(input);
  const state = fileRead(ctx);
  const idempotencyKey = next.idempotencyKey ? key(next.tenantId, next.idempotencyKey) : null;
  if (idempotencyKey && state.idempotency[idempotencyKey]) return state.idempotency[idempotencyKey];
  fileEnsureUniqueName(state, next.tenantId, next.name);
  const now = new Date().toISOString();
  const record = { tenant_id: next.tenantId, project_id: next.projectId, name: next.name, summary: next.summary, status: next.status, owner_actor_id: next.ownerActorId, version: 1, created_at: now, updated_at: now, archived_at: next.status === 'ARCHIVED' ? now : null, metadata: next.metadata };
  state.projects[key(next.tenantId, next.projectId)] = record;
  const result = toProject(record, 0);
  fileMutation(state, { tenant_id: next.tenantId, project_id: next.projectId, project_version: 1, mutation_type: 'project_created', actor_id: next.actorId, request_id: next.requestId, idempotency_key: next.idempotencyKey, payload: result });
  if (idempotencyKey) state.idempotency[idempotencyKey] = result;
  fileWrite(ctx, state);
  return result;
}

async function fileUpdateProject(ctx, input = {}) {
  const update = normalizeUpdateInput(input);
  const state = fileRead(ctx);
  const record = state.projects[key(update.tenantId, update.projectId)];
  if (!record) throw createTaskPlatformError(404, 'project_not_found', 'Project not found', { projectId: update.projectId });
  if (Number(record.version) !== update.version) throw createTaskPlatformError(409, 'version_conflict', `Project version ${update.version} is stale; current version is ${record.version}`, { projectId: update.projectId, expectedVersion: record.version });
  if (update.name !== undefined) fileEnsureUniqueName(state, update.tenantId, update.name, update.projectId);
  for (const [field, recordField] of [['name', 'name'], ['summary', 'summary'], ['status', 'status'], ['ownerActorId', 'owner_actor_id'], ['metadata', 'metadata']]) if (Object.prototype.hasOwnProperty.call(update, field)) record[recordField] = update[field];
  record.version += 1;
  record.updated_at = new Date().toISOString();
  record.archived_at = record.status === 'ARCHIVED' ? record.archived_at || record.updated_at : null;
  const result = toProject(record, fileTaskCount(state, update.tenantId, update.projectId));
  fileMutation(state, { tenant_id: update.tenantId, project_id: update.projectId, project_version: record.version, mutation_type: 'project_updated', actor_id: update.actorId, request_id: update.requestId, idempotency_key: update.idempotencyKey, payload: result });
  fileWrite(ctx, state);
  return result;
}

async function fileUpdateTaskProject(ctx, input = {}) {
  const tenantId = String(input.tenantId || input.tenant_id || '').trim();
  const taskId = String(input.taskId || input.task_id || '').trim();
  const projectId = input.projectId === null || input.project_id === null ? null : normalizeProjectId(input.projectId || input.project_id);
  const state = fileRead(ctx);
  const { task, version } = await fileCurrentTaskVersion(ctx, state, tenantId, taskId);
  const requestedVersion = Number(input.version);
  if (!Number.isSafeInteger(requestedVersion) || requestedVersion < 1) throw createTaskPlatformError(400, 'invalid_task_version', 'version must be a positive integer', { field: 'version' });
  if (requestedVersion !== version) throw createTaskPlatformError(409, 'version_conflict', `Task version ${requestedVersion} is stale; current version is ${version}`, { taskId, expectedVersion: version });
  if (projectId) fileAssertAssignableProject(state, tenantId, projectId);
  const nextVersion = version + 1;
  state.memberships[key(tenantId, taskId)] = { tenant_id: tenantId, task_id: taskId, project_id: projectId, version: nextVersion, updated_at: new Date().toISOString() };
  fileMutation(state, { tenant_id: tenantId, task_id: taskId, task_version: nextVersion, project_id: projectId, mutation_type: projectId ? 'task_project_attached' : 'task_project_detached', actor_id: input.actorId || input.actor_id || 'system', request_id: input.requestId || input.request_id || null, idempotency_key: input.idempotencyKey || input.idempotency_key || null, payload: { projectId } });
  fileWrite(ctx, state);
  return { ...fileHydrateTask(state, { tenantId, ...task }), version: nextVersion };
}

function callTaskMutationWithBaseVersion(service, projects, input, methodName) {
  if (input.version === undefined || input.version === null) return hydrateTaskResult(projects, input, service[methodName](input));
  return maybeThen(service.getTask(input), currentTask => {
    const task = withTenantFromInput(input, currentTask);
    if (!task) throw createTaskPlatformError(404, 'task_not_found', 'Task not found', { taskId: input.taskId || input.task_id });
    return maybeThen(projects.hydrateTask(task), hydrated => {
      const expected = Number(hydrated?.version || task.version);
      if (Number(input.version) !== expected) {
        throw createTaskPlatformError(409, 'version_conflict', `Task version ${input.version} is stale; current version is ${expected}`, {
          taskId: input.taskId || input.task_id,
          expectedVersion: expected,
        });
      }
      return hydrateTaskResult(projects, input, service[methodName]({ ...input, version: task.version }));
    });
  });
}

function fileAssertAssignableProject(state, tenantId, projectId) {
  const project = state.projects[key(tenantId, projectId)];
  if (!project) throw createTaskPlatformError(404, 'project_not_found', 'Project not found', { projectId });
  if (project.status === 'ARCHIVED') throw createTaskPlatformError(409, 'project_archived', 'Archived Projects are read-only for task attachment', { projectId });
}

function createFileProjectAdapter(service, options = {}) {
  const ctx = createFileProjectContext(service, options);
  return {
    listProjects: input => fileListProjects(ctx, input),
    getProject: input => fileGetProject(ctx, input),
    createProject: input => fileCreateProject(ctx, input),
    updateProject: input => fileUpdateProject(ctx, input),
    updateTaskProject: input => fileUpdateTaskProject(ctx, input),
    hydrateTask: task => fileHydrateTask(fileRead(ctx), task),
    listProjectMutations: ({ tenantId }) => fileRead(ctx).project_mutations.filter(entry => entry.tenant_id === tenantId),
  };
}

function createProjectAdapter(service, options = {}) {
  if (service.kind === 'postgres') {
    return createPostgresProjectAdapter(service, options, {
      normalizeCreateInput,
      normalizeProjectId,
      normalizeProjectStatus,
      normalizeUpdateInput,
      projectLabel,
      toProject,
    });
  }
  return createFileProjectAdapter(service, options);
}

function withProjects(service, options = {}) {
  const projects = createProjectAdapter(service, options);
  return {
    ...service,
    projectStatuses: PROJECT_STATUSES,
    listProjects: projects.listProjects,
    getProject: projects.getProject,
    createProject: projects.createProject,
    updateProject: projects.updateProject,
    updateTaskProject: projects.updateTaskProject,
    listProjectMutations: projects.listProjectMutations,
    listTasks(input = {}) {
      return maybeThen(service.listTasks(input), tasks => maybeAll(tasks.map(task => projects.hydrateTask(withTenantFromInput(input, task)))));
    },
    getTask(input = {}) {
      return hydrateTaskResult(projects, input, service.getTask(input));
    },
    createTask(input = {}) {
      return hydrateTaskResult(projects, input, service.createTask(input));
    },
    updateTask(input = {}) {
      return callTaskMutationWithBaseVersion(service, projects, input, 'updateTask');
    },
    updateTaskOwner(input = {}) {
      return callTaskMutationWithBaseVersion(service, projects, input, 'updateTaskOwner');
    },
    syncTaskFromProjection(input = {}) {
      return hydrateTaskResult(projects, input, service.syncTaskFromProjection(input));
    },
  };
}

module.exports = {
  PROJECT_ID_PATTERN,
  PROJECT_STATUSES,
  makeProjectId,
  normalizeProjectId,
  normalizeProjectStatus,
  withProjects,
};
