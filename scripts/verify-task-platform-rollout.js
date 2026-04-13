#!/usr/bin/env node
const { URL } = require('url');
const { createPgPoolFromEnv } = require('../lib/audit');

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

  return {
    migrationApplied: migrationResult.rowCount === 1,
    canonicalTaskCount: taskCountResult.rows[0]?.task_count || 0,
    checkpointStatusCounts: checkpointStatusResult.rows,
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
  const firstTask = Array.isArray(tasks.items) ? tasks.items[0] : Array.isArray(tasks) ? tasks[0] : null;
  const taskDetail = firstTask?.taskId
    ? await fetchJson(new URL(`/api/v1/tasks/${encodeURIComponent(firstTask.taskId)}`, baseUrl).toString(), token)
    : null;

  return {
    skipped: false,
    tenantId: currentTenantId,
    agentCount: Array.isArray(agents.items) ? agents.items.length : Array.isArray(agents) ? agents.length : null,
    taskCount: Array.isArray(tasks.items) ? tasks.items.length : Array.isArray(tasks) ? tasks.length : null,
    sampledTaskId: firstTask?.taskId || null,
    sampledTaskVersion: taskDetail?.version || null,
  };
}

async function main() {
  const currentTenantId = tenantId();
  const pool = createPgPoolFromEnv(process.env.DATABASE_URL);

  try {
    const database = await verifyDatabase(pool, currentTenantId);
    const api = await verifyApi(currentTenantId);
    process.stdout.write(`${JSON.stringify({ tenantId: currentTenantId, database, api }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
