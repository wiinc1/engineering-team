const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createPgPoolFromEnv } = require('../audit/postgres');
const { signHmacJwt } = require('../auth/jwt');

const DEFAULT_EVIDENCE_PATH = 'observability/projects-production-smoke.json';
const REQUIRED_PROJECT_COLUMNS = [
  'project_mutations.mutation_type',
  'project_mutations.tenant_id',
  'projects.project_id',
  'projects.status',
  'projects.tenant_id',
  'projects.version',
  'tasks.project_id',
];

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function buildUrl(baseUrl, route) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}${route}`;
}

function assertHttps(baseUrl, allowHttp = false) {
  const parsed = new URL(baseUrl);
  if (!allowHttp && parsed.protocol !== 'https:') {
    throw new Error('Production Projects smoke requires an HTTPS base URL');
  }
}

function makeBearerToken({ jwtSecret, tenantId, actorId, roles }) {
  if (!jwtSecret) throw new Error('AUTH_JWT_SECRET or PROJECTS_PROD_JWT_SECRET is required');
  const now = Math.floor(Date.now() / 1000);
  return signHmacJwt({ sub: actorId, tenant_id: tenantId, roles, iat: now, exp: now + 300 }, jwtSecret);
}

function authHeaders(context, roles) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${makeBearerToken({ ...context, roles })}`,
  };
}

async function parseJson(response) {
  return response.json().catch(() => ({}));
}

async function fetchJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  return { status: response.status, ok: response.ok, body: await parseJson(response) };
}

async function verifyDatabase(pool, tenantId) {
  const migration = await pool.query(
    "SELECT version FROM schema_migrations WHERE version = '012_projects.sql'",
  );
  const columns = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'projects' AND column_name IN ('tenant_id', 'project_id', 'status', 'version'))
        OR (table_name = 'project_mutations' AND column_name IN ('tenant_id', 'mutation_type'))
        OR (table_name = 'tasks' AND column_name = 'project_id')
      )
    ORDER BY table_name, column_name
  `);
  const projectCount = await pool.query(
    'SELECT COUNT(*)::int AS project_count FROM projects WHERE tenant_id = $1',
    [tenantId],
  );
  const mutationCount = await pool.query(
    'SELECT COUNT(*)::int AS mutation_count FROM project_mutations WHERE tenant_id = $1',
    [tenantId],
  );
  const columnKeys = new Set(columns.rows.map(row => `${row.table_name}.${row.column_name}`));
  return {
    migration012Applied: migration.rowCount === 1,
    requiredColumnsPresent: REQUIRED_PROJECT_COLUMNS.every(key => columnKeys.has(key)),
    projectCount: projectCount.rows[0]?.project_count ?? null,
    mutationCount: mutationCount.rows[0]?.mutation_count ?? null,
  };
}

function responseOk(result, status = null) {
  if (!result) return false;
  return status == null ? result.ok : result.status === status;
}

function data(result) {
  return result?.body?.data;
}

function listData(result) {
  return Array.isArray(data(result)) ? data(result) : [];
}

function projectRoute(projectId) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}`;
}

function taskProjectRoute(taskId) {
  return `/api/v1/tasks/${encodeURIComponent(taskId)}/project`;
}

function apiGet(ctx, route, roles = ['reader'], tenant = ctx.primary) {
  return fetchJson(ctx.fetchImpl, buildUrl(ctx.baseUrl, route), {
    headers: authHeaders(tenant, roles),
  });
}

function apiSend(ctx, route, method, roles, body) {
  return fetchJson(ctx.fetchImpl, buildUrl(ctx.baseUrl, route), {
    method,
    headers: { 'content-type': 'application/json', ...authHeaders(ctx.primary, roles) },
    body: JSON.stringify(body),
  });
}

function createSmokeContext({ fetchImpl, baseUrl, tenantId, isolationTenantId, actorId, jwtSecret }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    fetchImpl,
    baseUrl,
    projectName: `Pilot readiness smoke ${timestamp}`,
    primary: { jwtSecret, tenantId, actorId },
    isolation: { jwtSecret, tenantId: isolationTenantId, actorId: `${actorId}-isolation` },
  };
}

function createProject(ctx) {
  return apiSend(ctx, '/api/v1/projects', 'POST', ['pm'], {
    name: ctx.projectName,
    summary: 'Issue 208 production readiness smoke. Safe to archive.',
    status: 'ACTIVE',
    metadata: { issue: 208, smoke: true },
  });
}

function createSmokeTask(ctx) {
  return apiSend(ctx, '/api/v1/tasks', 'POST', ['admin'], {
    title: `${ctx.projectName} task fixture`,
    description: 'Issue 232 Projects production smoke task fixture. Safe to leave unassigned after smoke.',
    status: 'BACKLOG',
    priority: 'P3',
    metadata: { issue: 232, smoke: true },
  });
}

function updateProject(ctx, projectId, project) {
  return apiSend(ctx, projectRoute(projectId), 'PATCH', ['admin'], {
    name: `${ctx.projectName} updated`,
    status: 'PAUSED',
    version: project.version,
  });
}

function archiveProject(ctx, projectId, project) {
  return apiSend(ctx, projectRoute(projectId), 'PATCH', ['admin'], {
    status: 'ARCHIVED',
    version: project.version,
  });
}

function updateTaskProject(ctx, taskId, projectId, version) {
  return apiSend(ctx, taskProjectRoute(taskId), 'PATCH', ['pm'], { projectId, version });
}

async function runProjectCrud(ctx) {
  const api = { listBefore: await apiGet(ctx, '/api/v1/projects') };
  api.createProject = await createProject(ctx);
  const project = data(api.createProject);
  const projectId = project?.projectId || null;
  api.readProject = projectId ? await apiGet(ctx, projectRoute(projectId)) : null;
  api.updateProject = projectId ? await updateProject(ctx, projectId, data(api.readProject) || project) : null;
  return { api, project, projectId };
}

async function runTaskMembership(ctx, projectId) {
  const api = {
    listTasks: await apiGet(ctx, '/api/v1/tasks'),
    createTask: await createSmokeTask(ctx),
  };
  const createdTask = data(api.createTask);
  const task = createdTask || listData(api.listTasks).find(item => !item.projectId && !item.project_id) || null;
  const taskId = task?.taskId || null;
  api.attachTask = taskId && projectId ? await updateTaskProject(ctx, taskId, projectId, task.version) : null;
  const attachedTask = data(api.attachTask);
  api.detachTask = taskId && attachedTask ? await updateTaskProject(ctx, taskId, null, attachedTask.version) : null;
  return { api, taskId, attachedTask, createdTask };
}

async function runArchiveAndIsolation(ctx, projectId, updatedProject) {
  const api = {};
  api.archiveProject = projectId && updatedProject ? await archiveProject(ctx, projectId, updatedProject) : null;
  api.listAfterArchive = await apiGet(ctx, '/api/v1/projects');
  api.isolationRead = projectId ? await apiGet(ctx, projectRoute(projectId), ['reader'], ctx.isolation) : null;
  api.isolationList = await apiGet(ctx, '/api/v1/projects', ['reader'], ctx.isolation);
  return api;
}

function summarizeApi(api, project, projectId) {
  return {
    listProjectsLoaded: responseOk(api.listBefore),
    projectCreated: responseOk(api.createProject, 201) && !!projectId,
    projectRead: responseOk(api.readProject, 200),
    projectUpdated: responseOk(api.updateProject, 200) && data(api.updateProject)?.version > project?.version,
    taskFixtureCreated: responseOk(api.createTask, 201) && !!data(api.createTask)?.taskId,
    taskAttached: responseOk(api.attachTask, 200) && data(api.attachTask)?.project?.projectId === projectId,
    taskDetached: responseOk(api.detachTask, 200) && (data(api.detachTask)?.projectId ?? data(api.detachTask)?.project_id ?? null) === null,
    archiveDeleteEquivalent: responseOk(api.archiveProject, 200) && data(api.archiveProject)?.status === 'ARCHIVED',
    tenantIsolationPassed: responseOk(api.isolationRead, 404) && !listData(api.isolationList).some(item => item.projectId === projectId),
  };
}

function formatApiEvidence(api, project, projectId, taskId, attachedTask, createdTask) {
  return {
    listBeforeStatus: api.listBefore.status,
    projectId,
    taskId,
    createStatus: api.createProject.status,
    readStatus: api.readProject?.status || null,
    updateStatus: api.updateProject?.status || null,
    createTaskStatus: api.createTask?.status || null,
    attachStatus: api.attachTask?.status || null,
    detachStatus: api.detachTask?.status || null,
    archiveStatus: api.archiveProject?.status || null,
    isolationReadStatus: api.isolationRead?.status || null,
    isolationListStatus: api.isolationList.status,
    createdProjectHiddenAfterArchive: !listData(api.listAfterArchive).some(item => item.projectId === projectId),
    updatedProjectVersion: data(api.updateProject)?.version || null,
    attachedTaskVersion: attachedTask?.version || null,
    detachedTaskProjectId: data(api.detachTask)?.projectId ?? data(api.detachTask)?.project_id ?? null,
    isolationListContainsProject: listData(api.isolationList).some(item => item.projectId === projectId),
    taskFixtureCreated: !!createdTask,
    summary: summarizeApi(api, project, projectId),
  };
}

async function runProjectsApiSmoke(options) {
  const ctx = createSmokeContext(options);
  const crud = await runProjectCrud(ctx);
  const membership = await runTaskMembership(ctx, crud.projectId);
  const archived = await runArchiveAndIsolation(ctx, crud.projectId, data(crud.api.updateProject));
  return formatApiEvidence(
    { ...crud.api, ...membership.api, ...archived },
    crud.project,
    crud.projectId,
    membership.taskId,
    membership.attachedTask,
    membership.createdTask,
  );
}

function resolveOptions(options) {
  const baseUrl = String(options.baseUrl || process.env.PROJECTS_PROD_BASE_URL || process.env.AUTH_PROD_BASE_URL || process.env.AUTH_PUBLIC_APP_URL || '').trim();
  if (!baseUrl) throw new Error('PROJECTS_PROD_BASE_URL, AUTH_PROD_BASE_URL, or AUTH_PUBLIC_APP_URL is required');
  const tenantId = String(options.tenantId || process.env.PROJECTS_PROD_TENANT_ID || process.env.AUTH_REGISTRATION_DEFAULT_TENANT || process.env.TENANT_ID || 'engineering-team').trim();
  return {
    ...options,
    baseUrl,
    tenantId,
    isolationTenantId: String(options.isolationTenantId || process.env.PROJECTS_PROD_ISOLATION_TENANT_ID || `${tenantId}-isolation-smoke`).trim(),
    actorId: String(options.actorId || process.env.PROJECTS_PROD_ACTOR_ID || 'projects-production-smoke').trim(),
    jwtSecret: options.jwtSecret || process.env.PROJECTS_PROD_JWT_SECRET || process.env.AUTH_JWT_SECRET,
  };
}

function buildEvidence(options) {
  return {
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    deployment: {
      id: options.deploymentId || process.env.VERCEL_DEPLOYMENT_ID || null,
      commitSha: options.commitSha || process.env.VERCEL_GIT_COMMIT_SHA || null,
      rollbackTarget: options.rollbackTarget || process.env.AUTH_PROD_ROLLBACK_TARGET || null,
    },
    tenantId: options.tenantId,
    isolationTenantHash: sha256(options.isolationTenantId),
    database: null,
    api: null,
  };
}

async function addDatabaseEvidence(evidence, options) {
  if (options.skipDatabase) {
    evidence.database = { skipped: true, reason: 'skipDatabase option was set.' };
    return null;
  }
  const pool = options.pool || createPgPoolFromEnv(options.connectionString || process.env.DATABASE_URL);
  evidence.database = await verifyDatabase(pool, options.tenantId);
  return options.pool ? null : pool;
}

function buildSummary(evidence) {
  return {
    migration012Applied: evidence.database?.migration012Applied === true,
    requiredColumnsPresent: evidence.database?.requiredColumnsPresent === true,
    listProjectsLoaded: evidence.api.summary.listProjectsLoaded,
    projectCreated: evidence.api.summary.projectCreated,
    projectRead: evidence.api.summary.projectRead,
    projectUpdated: evidence.api.summary.projectUpdated,
    taskFixtureCreated: evidence.api.summary.taskFixtureCreated,
    taskAttached: evidence.api.summary.taskAttached,
    taskDetached: evidence.api.summary.taskDetached,
    archiveDeleteEquivalent: evidence.api.summary.archiveDeleteEquivalent,
    tenantIsolationPassed: evidence.api.summary.tenantIsolationPassed,
    rollbackTargetPresent: !!evidence.deployment.rollbackTarget,
    evidenceRedacted: true,
    passed: false,
  };
}

function assertNoRawSecrets(evidence) {
  const serialized = JSON.stringify(evidence);
  for (const pattern of [/Bearer\s+[A-Za-z0-9._~+/=-]+/i, /AUTH_JWT_SECRET/i, /PROJECTS_PROD_JWT_SECRET/i, /"authorization"\s*:/i]) {
    if (pattern.test(serialized)) throw new Error(`Projects smoke evidence is not redacted: ${pattern}`);
  }
  return true;
}

function finalizeEvidence(evidence, options) {
  evidence.summary = buildSummary(evidence);
  evidence.summary.passed = Object.entries(evidence.summary)
    .filter(([key]) => key !== 'passed')
    .every(([, value]) => value === true);
  evidence.summary.evidenceRedacted = assertNoRawSecrets(evidence);
  if (options.writeEvidence === false) return;
  const outputPath = options.outputPath || process.env.PROJECTS_PROD_EVIDENCE_OUT || DEFAULT_EVIDENCE_PATH;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function runProjectsProductionSmoke(options = {}) {
  const resolved = resolveOptions({ fetchImpl: globalThis.fetch, ...options });
  if (typeof resolved.fetchImpl !== 'function') throw new Error('fetch is required to run Projects production smoke');
  assertHttps(resolved.baseUrl, !!resolved.allowHttp);
  const evidence = buildEvidence(resolved);
  const pool = await addDatabaseEvidence(evidence, resolved);
  try {
    evidence.api = await runProjectsApiSmoke(resolved);
  } finally {
    if (pool) await pool.end();
  }
  finalizeEvidence(evidence, resolved);
  return evidence;
}

module.exports = {
  DEFAULT_EVIDENCE_PATH,
  runProjectsProductionSmoke,
  verifyDatabase,
};
