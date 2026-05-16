const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runProjectsProductionSmoke } = require('../../lib/task-platform/projects-production-smoke');

function claimsFromAuth(headers = {}) {
  const value = headers.authorization || headers.Authorization || '';
  const token = value.split(' ')[1] || '';
  return JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8') || '{}');
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createPool() {
  return {
    async query(sql) {
      if (sql.includes('012_projects.sql')) return { rowCount: 1, rows: [{ version: '012_projects.sql' }] };
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { table_name: 'project_mutations', column_name: 'mutation_type' },
            { table_name: 'project_mutations', column_name: 'tenant_id' },
            { table_name: 'projects', column_name: 'project_id' },
            { table_name: 'projects', column_name: 'status' },
            { table_name: 'projects', column_name: 'tenant_id' },
            { table_name: 'projects', column_name: 'version' },
            { table_name: 'tasks', column_name: 'project_id' },
          ],
        };
      }
      if (sql.includes('FROM projects')) return { rows: [{ project_count: 0 }] };
      if (sql.includes('FROM project_mutations')) return { rows: [{ mutation_count: 0 }] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

function createFetch() {
  const state = {
    project: null,
    task: { taskId: 'TSK-SMOKE', version: 1, projectId: null, project: null },
  };
  return async function fetchImpl(url, options = {}) {
    const parsed = new URL(url);
    const claims = claimsFromAuth(options.headers);
    const isPrimaryTenant = claims.tenant_id === 'tenant-int';
    if (parsed.pathname === '/api/v1/projects' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      state.project = {
        projectId: 'PRJ-SMOKE123',
        name: body.name,
        summary: body.summary,
        status: body.status,
        version: 1,
      };
      return jsonResponse(201, { data: state.project });
    }
    if (parsed.pathname === '/api/v1/projects' && !options.method) {
      return jsonResponse(200, { data: isPrimaryTenant && state.project?.status !== 'ARCHIVED' ? [state.project] : [] });
    }
    if (parsed.pathname === '/api/v1/tasks' && !options.method) {
      return jsonResponse(200, { data: [state.task] });
    }
    if (parsed.pathname === '/api/v1/projects/PRJ-SMOKE123' && !options.method) {
      return isPrimaryTenant ? jsonResponse(200, { data: { ...state.project, tasks: state.task.projectId ? [state.task] : [] } }) : jsonResponse(404, { error: { code: 'project_not_found' } });
    }
    if (parsed.pathname === '/api/v1/projects/PRJ-SMOKE123' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      state.project = { ...state.project, ...body, version: state.project.version + 1 };
      return jsonResponse(200, { data: state.project });
    }
    if (parsed.pathname === '/api/v1/tasks/TSK-SMOKE/project' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      state.task = {
        ...state.task,
        version: state.task.version + 1,
        projectId: body.projectId,
        project: body.projectId ? { projectId: body.projectId, name: state.project.name, status: state.project.status } : null,
      };
      return jsonResponse(200, { data: state.task });
    }
    return jsonResponse(404, { error: { code: 'not_found' } });
  };
}

test('Projects production smoke records redacted migration, CRUD, membership, archive, and isolation evidence', async () => {
  const outputPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'projects-smoke-')), 'evidence.json');
  const evidence = await runProjectsProductionSmoke({
    baseUrl: 'https://engineering-team.example',
    jwtSecret: 'test-secret',
    tenantId: 'tenant-int',
    isolationTenantId: 'tenant-other',
    actorId: 'projects-smoke-test',
    rollbackTarget: 'https://rollback.example',
    pool: createPool(),
    fetchImpl: createFetch(),
    outputPath,
  });

  assert.equal(evidence.summary.passed, true);
  assert.equal(evidence.summary.migration012Applied, true);
  assert.equal(evidence.summary.projectCreated, true);
  assert.equal(evidence.summary.taskAttached, true);
  assert.equal(evidence.summary.taskDetached, true);
  assert.equal(evidence.summary.archiveDeleteEquivalent, true);
  assert.equal(evidence.summary.tenantIsolationPassed, true);
  assert.equal(evidence.api.projectId, 'PRJ-SMOKE123');
  assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).summary.evidenceRedacted, true);
  assert.doesNotMatch(fs.readFileSync(outputPath, 'utf8'), /Bearer|test-secret|authorization/i);
});
