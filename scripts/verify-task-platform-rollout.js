#!/usr/bin/env node
const { URL } = require('url');
const { createPgPoolFromEnv } = require('../lib/audit');
const { detectTaskPlatformDrift } = require('../lib/task-platform/drift');

function tenantId() {
  return process.env.TENANT_ID || 'engineering-team';
}

function bearerToken() {
  return process.env.TASK_PLATFORM_SMOKE_BEARER_TOKEN || process.env.AUTH_BEARER_TOKEN || null;
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function verifyTaskPlatformDrift(pool, currentTenantId) {
  const driftRowsResult = await pool.query(
    `SELECT
       t.task_id,
       t.version,
       t.last_audit_sequence_number,
       c.canonical_version,
       c.last_projected_sequence_number,
       c.sync_status,
       c.last_error
     FROM tasks t
     LEFT JOIN task_sync_checkpoints c
       ON c.tenant_id = t.tenant_id
      AND c.task_id = t.task_id
     WHERE t.tenant_id = $1
     ORDER BY t.updated_at DESC`,
    [currentTenantId],
  );

  return detectTaskPlatformDrift(driftRowsResult.rows);
}

async function verifyDatabase(pool, currentTenantId) {
  const migrationResult = await pool.query(
    `SELECT version
     FROM schema_migrations
     WHERE version = '006_canonical_task_persistence.sql'`,
  );
  const taskCountResult = await pool.query(
    `SELECT count(*)::int AS task_count
     FROM tasks
     WHERE tenant_id = $1`,
    [currentTenantId],
  );
  const checkpointStatusResult = await pool.query(
    `SELECT sync_status, count(*)::int AS task_count
     FROM task_sync_checkpoints
     WHERE tenant_id = $1
     GROUP BY sync_status
     ORDER BY sync_status`,
    [currentTenantId],
  );
  const recentTasksResult = await pool.query(
    `SELECT task_id, owner_agent_id, migration_state, last_audit_sequence_number, updated_at
     FROM tasks
     WHERE tenant_id = $1
     ORDER BY updated_at DESC
     LIMIT 20`,
    [currentTenantId],
  );
  const drift = await verifyTaskPlatformDrift(pool, currentTenantId);

  return {
    migrationApplied: migrationResult.rowCount === 1,
    canonicalTaskCount: taskCountResult.rows[0]?.task_count || 0,
    checkpointStatusCounts: checkpointStatusResult.rows,
    drift,
    recentTasks: recentTasksResult.rows.map((row) => ({
      taskId: row.task_id,
      ownerAgentId: row.owner_agent_id,
      migrationState: row.migration_state,
      lastAuditSequenceNumber: row.last_audit_sequence_number,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    })),
  };
}

async function verifyApi(currentTenantId) {
  const baseUrl = process.env.TASK_API_BASE_URL;
  const token = bearerToken();
  if (!baseUrl || !token) {
    return {
      skipped: true,
      reason: 'Set TASK_API_BASE_URL and TASK_PLATFORM_SMOKE_BEARER_TOKEN (or AUTH_BEARER_TOKEN) to enable API smoke verification.',
    };
  }

  const agentsUrl = new URL('/api/v1/ai-agents', baseUrl).toString();
  const tasksUrl = new URL('/api/v1/tasks', baseUrl).toString();

  const agents = await fetchJson(agentsUrl, token);
  const tasks = await fetchJson(tasksUrl, token);
  const agentItems = Array.isArray(agents.data) ? agents.data : Array.isArray(agents.items) ? agents.items : agents;
  const taskItems = Array.isArray(tasks.data) ? tasks.data : Array.isArray(tasks.items) ? tasks.items : tasks;
  const firstTask = Array.isArray(taskItems) ? taskItems[0] : null;
  const taskDetail = firstTask?.taskId
    ? await fetchJson(new URL(`/api/v1/tasks/${encodeURIComponent(firstTask.taskId)}`, baseUrl).toString(), token)
    : null;
  const taskDetailData = taskDetail?.data || taskDetail;

  return {
    skipped: false,
    tenantId: currentTenantId,
    agentCount: Array.isArray(agentItems) ? agentItems.length : null,
    taskCount: Array.isArray(taskItems) ? taskItems.length : null,
    sampledTaskId: firstTask?.taskId || null,
    sampledTaskVersion: taskDetailData?.version || null,
  };
}

async function main() {
  const currentTenantId = tenantId();
  const pool = createPgPoolFromEnv(process.env.DATABASE_URL);

  try {
    const database = await verifyDatabase(pool, currentTenantId);
    const api = await verifyApi(currentTenantId);
    process.stdout.write(`${JSON.stringify({ tenantId: currentTenantId, database, api }, null, 2)}\n`);
    if (!database.drift.ok) {
      process.stderr.write(`Task platform drift detected: ${JSON.stringify(database.drift, null, 2)}\n`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
