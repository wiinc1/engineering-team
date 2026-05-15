const { createPgPoolFromEnv } = require('../audit/postgres');
const { createTaskPlatformError } = require('./service');

function projectRow(row, taskCount, toProject) {
  return toProject({
    ...row,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    archived_at: row.archived_at instanceof Date ? row.archived_at.toISOString() : row.archived_at,
  }, Number(taskCount || row.task_count || 0));
}

function idempotencyKey(tenantId, value) {
  return value ? `${tenantId}::${value}` : null;
}

function duplicateProjectError(error, name) {
  if (error?.code === '23505') {
    return createTaskPlatformError(409, 'duplicate_project_name', 'Project name already exists in this tenant', { name });
  }
  return error;
}

async function recordMutation(pool, payload) {
  await pool.query(`
    INSERT INTO project_mutations (
      tenant_id, project_id, task_id, project_version, task_version, mutation_type,
      actor_id, request_id, idempotency_key, payload
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
  `, [
    payload.tenant_id,
    payload.project_id || null,
    payload.task_id || null,
    payload.project_version || null,
    payload.task_version || null,
    payload.mutation_type,
    payload.actor_id || 'system',
    payload.request_id || null,
    payload.idempotency_key || null,
    JSON.stringify(payload.payload || {}),
  ]);
}

async function getProjectTaskCount(pool, tenantId, projectId) {
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM tasks WHERE tenant_id = $1 AND project_id = $2', [tenantId, projectId]);
  return Number(result.rows[0]?.count || 0);
}

async function hydrateTask(pool, service, deps, task) {
  if (!task) return task;
  const taskId = task.taskId || task.task_id;
  const tenantId = task.tenantId || task.tenant_id;
  const result = await pool.query(`
    SELECT p.*
    FROM tasks t
    LEFT JOIN projects p
      ON p.tenant_id = t.tenant_id
     AND p.project_id = t.project_id
    WHERE t.tenant_id = $1 AND t.task_id = $2
  `, [tenantId, taskId]);
  const row = result.rows[0] || null;
  const count = row?.project_id ? await getProjectTaskCount(pool, tenantId, row.project_id) : 0;
  const project = row?.project_id ? projectRow(row, count, deps.toProject) : null;
  return { ...task, projectId: project?.projectId || null, project: deps.projectLabel(project), project_id: project?.projectId || null };
}

async function listProjects(pool, deps, { tenantId, status, includeArchived = false }) {
  const normalizedStatus = status ? deps.normalizeProjectStatus(status) : null;
  const result = await pool.query(`
    SELECT p.*, COUNT(t.task_id)::int AS task_count
    FROM projects p
    LEFT JOIN tasks t
      ON t.tenant_id = p.tenant_id
     AND t.project_id = p.project_id
    WHERE p.tenant_id = $1
      AND ($2::text IS NULL OR p.status = $2)
      AND ($3::boolean = true OR p.status <> 'ARCHIVED')
    GROUP BY p.tenant_id, p.project_id
    ORDER BY p.updated_at DESC, p.name ASC
  `, [tenantId, normalizedStatus, !!includeArchived]);
  return result.rows.map(row => projectRow(row, row.task_count, deps.toProject));
}

async function getProject(pool, service, deps, { tenantId, projectId, includeTasks = false }) {
  const normalizedId = deps.normalizeProjectId(projectId);
  const result = await pool.query(`
    SELECT p.*, COUNT(t.task_id)::int AS task_count
    FROM projects p
    LEFT JOIN tasks t
      ON t.tenant_id = p.tenant_id
     AND t.project_id = p.project_id
    WHERE p.tenant_id = $1 AND p.project_id = $2
    GROUP BY p.tenant_id, p.project_id
  `, [tenantId, normalizedId]);
  if (!result.rows[0]) return null;
  const project = projectRow(result.rows[0], result.rows[0].task_count, deps.toProject);
  if (!includeTasks) return project;
  const taskRows = await pool.query('SELECT task_id FROM tasks WHERE tenant_id = $1 AND project_id = $2 ORDER BY updated_at DESC', [tenantId, normalizedId]);
  const tasks = await Promise.all(taskRows.rows.map(async row => hydrateTask(pool, service, deps, await service.getTask({ tenantId, taskId: row.task_id }))));
  return { ...project, tasks };
}

async function createProject(pool, deps, input = {}) {
  const next = deps.normalizeCreateInput(input);
  const cached = await mutationResult(pool, next.tenantId, next.idempotencyKey);
  if (cached) return cached;
  try {
    const result = await pool.query(`
      INSERT INTO projects (tenant_id, project_id, name, summary, status, owner_actor_id, metadata, archived_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb, CASE WHEN $5 = 'ARCHIVED' THEN NOW() ELSE NULL END)
      RETURNING *
    `, [next.tenantId, next.projectId, next.name, next.summary, next.status, next.ownerActorId, JSON.stringify(next.metadata)]);
    const project = projectRow(result.rows[0], 0, deps.toProject);
    await recordMutation(pool, { tenant_id: next.tenantId, project_id: next.projectId, project_version: 1, mutation_type: 'project_created', actor_id: next.actorId, request_id: next.requestId, idempotency_key: idempotencyKey(next.tenantId, next.idempotencyKey), payload: project });
    return project;
  } catch (error) {
    throw duplicateProjectError(error, next.name);
  }
}

async function updateProject(pool, deps, input = {}) {
  const update = deps.normalizeUpdateInput(input);
  try {
    const result = await pool.query(`
      UPDATE projects
      SET name = COALESCE($4, name),
          summary = COALESCE($5, summary),
          status = COALESCE($6, status),
          owner_actor_id = CASE WHEN $7::boolean THEN $8 ELSE owner_actor_id END,
          metadata = COALESCE($9::jsonb, metadata),
          version = version + 1,
          updated_at = NOW(),
          archived_at = CASE WHEN COALESCE($6, status) = 'ARCHIVED' THEN COALESCE(archived_at, NOW()) ELSE NULL END
      WHERE tenant_id = $1 AND project_id = $2 AND version = $3
      RETURNING *
    `, [update.tenantId, update.projectId, update.version, update.name ?? null, update.summary ?? null, update.status ?? null, Object.prototype.hasOwnProperty.call(update, 'ownerActorId'), update.ownerActorId ?? null, update.metadata === undefined ? null : JSON.stringify(update.metadata)]);
    if (!result.rows[0]) await assertProjectVersion(pool, update);
    const project = projectRow(result.rows[0], await getProjectTaskCount(pool, update.tenantId, update.projectId), deps.toProject);
    await recordMutation(pool, { tenant_id: update.tenantId, project_id: update.projectId, project_version: project.version, mutation_type: 'project_updated', actor_id: update.actorId, request_id: update.requestId, idempotency_key: idempotencyKey(update.tenantId, update.idempotencyKey), payload: project });
    return project;
  } catch (error) {
    throw duplicateProjectError(error, update.name);
  }
}

async function assertProjectVersion(pool, update) {
  const current = await pool.query('SELECT version FROM projects WHERE tenant_id = $1 AND project_id = $2', [update.tenantId, update.projectId]);
  if (!current.rows[0]) throw createTaskPlatformError(404, 'project_not_found', 'Project not found', { projectId: update.projectId });
  throw createTaskPlatformError(409, 'version_conflict', `Project version ${update.version} is stale; current version is ${current.rows[0].version}`, { projectId: update.projectId, expectedVersion: Number(current.rows[0].version) });
}

async function assertAssignableProject(client, tenantId, projectId) {
  if (!projectId) return;
  const result = await client.query('SELECT status FROM projects WHERE tenant_id = $1 AND project_id = $2 FOR SHARE', [tenantId, projectId]);
  const project = result.rows[0] || null;
  if (!project) throw createTaskPlatformError(404, 'project_not_found', 'Project not found', { projectId });
  if (project.status === 'ARCHIVED') throw createTaskPlatformError(409, 'project_archived', 'Archived Projects are read-only for task attachment', { projectId });
}

async function updateTaskProject(pool, service, deps, input = {}) {
  const tenantId = String(input.tenantId || input.tenant_id || '').trim();
  const taskId = String(input.taskId || input.task_id || '').trim();
  const projectId = input.projectId === null || input.project_id === null ? null : deps.normalizeProjectId(input.projectId || input.project_id);
  const requestedVersion = Number(input.version);
  if (!Number.isSafeInteger(requestedVersion) || requestedVersion < 1) throw createTaskPlatformError(400, 'invalid_task_version', 'version must be a positive integer', { field: 'version' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertAssignableProject(client, tenantId, projectId);
    const current = await client.query('SELECT version FROM tasks WHERE tenant_id = $1 AND task_id = $2 FOR UPDATE', [tenantId, taskId]);
    if (!current.rows[0]) throw createTaskPlatformError(404, 'task_not_found', 'Task not found', { taskId });
    if (Number(current.rows[0].version) !== requestedVersion) throw createTaskPlatformError(409, 'version_conflict', `Task version ${requestedVersion} is stale; current version is ${current.rows[0].version}`, { taskId, expectedVersion: Number(current.rows[0].version) });
    const updated = await client.query('UPDATE tasks SET project_id = $3, version = version + 1, updated_at = NOW() WHERE tenant_id = $1 AND task_id = $2 RETURNING version', [tenantId, taskId, projectId]);
    await recordMutation(client, { tenant_id: tenantId, task_id: taskId, task_version: Number(updated.rows[0].version), project_id: projectId, mutation_type: projectId ? 'task_project_attached' : 'task_project_detached', actor_id: input.actorId || input.actor_id || 'system', request_id: input.requestId || input.request_id || null, idempotency_key: idempotencyKey(tenantId, input.idempotencyKey || input.idempotency_key), payload: { projectId } });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return hydrateTask(pool, service, deps, await service.getTask({ tenantId, taskId }));
}

async function mutationResult(pool, tenantId, value) {
  const key = idempotencyKey(tenantId, value);
  if (!key) return null;
  const result = await pool.query('SELECT payload FROM project_mutations WHERE tenant_id = $1 AND idempotency_key = $2 ORDER BY mutation_id DESC LIMIT 1', [tenantId, key]);
  return result.rows[0]?.payload || null;
}

function createPostgresProjectAdapter(service, options = {}, deps) {
  const pool = options.pool || createPgPoolFromEnv(options.connectionString);
  return {
    listProjects: input => listProjects(pool, deps, input),
    getProject: input => getProject(pool, service, deps, input),
    createProject: input => createProject(pool, deps, input),
    updateProject: input => updateProject(pool, deps, input),
    updateTaskProject: input => updateTaskProject(pool, service, deps, input),
    hydrateTask: task => hydrateTask(pool, service, deps, task),
    listProjectMutations: async ({ tenantId }) => (await pool.query('SELECT * FROM project_mutations WHERE tenant_id = $1 ORDER BY mutation_id ASC', [tenantId])).rows,
  };
}

module.exports = {
  createPostgresProjectAdapter,
};
