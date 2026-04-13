const { createPgPoolFromEnv } = require('../audit/postgres');
const { createTaskPlatformError } = require('./service');

function normalizeOwnerRow(row) {
  if (!row || !row.owner_agent_id) return null;
  return {
    agentId: row.owner_agent_id,
    displayName: row.owner_display_name,
    role: row.owner_role || null,
    active: Boolean(row.owner_active),
    assignable: Boolean(row.owner_assignable),
  };
}

function normalizeTaskRow(row) {
  return {
    taskId: row.task_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    version: Number(row.version),
    owner: normalizeOwnerRow(row),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    closedAt: row.closed_at ? (row.closed_at instanceof Date ? row.closed_at.toISOString() : row.closed_at) : null,
  };
}

function createPostgresTaskPlatformService(options = {}) {
  const pool = options.pool || createPgPoolFromEnv(options.connectionString);
  const agentRegistry = options.agentRegistry || [];

  async function ensureTenantAgents(tenantId, client = pool) {
    for (const agent of agentRegistry) {
      await client.query(`
        INSERT INTO ai_agents (
          tenant_id, agent_id, display_name, role, execution_kind, active, assignable, environment_scope, metadata
        ) VALUES ($1,$2,$3,$4,'software-factory',$5,$6,'default','{}'::jsonb)
        ON CONFLICT (tenant_id, agent_id) DO NOTHING
      `, [tenantId, agent.id, agent.display_name, agent.role || null, agent.active !== false, agent.active !== false]);
    }
  }

  async function requireAgent(tenantId, ownerAgentId, client = pool) {
    if (ownerAgentId == null) return null;
    await ensureTenantAgents(tenantId, client);
    const result = await client.query(
      'SELECT * FROM ai_agents WHERE tenant_id = $1 AND agent_id = $2',
      [tenantId, ownerAgentId],
    );
    const agent = result.rows[0] || null;
    if (!agent) throw createTaskPlatformError(404, 'agent_not_found', 'AI agent not found', { ownerAgentId });
    if (!agent.active || !agent.assignable) {
      throw createTaskPlatformError(400, 'invalid_owner_agent', 'AI agent is not assignable', { ownerAgentId });
    }
    return agent;
  }

  async function ensureSyncAgent(tenantId, ownerAgentId, client = pool) {
    if (ownerAgentId == null) return null;
    await ensureTenantAgents(tenantId, client);
    await client.query(`
      INSERT INTO ai_agents (
        tenant_id, agent_id, display_name, role, execution_kind, active, assignable, environment_scope, metadata
      ) VALUES ($1,$2,$3,'imported','legacy-import',true,false,'imported',$4::jsonb)
      ON CONFLICT (tenant_id, agent_id) DO NOTHING
    `, [tenantId, ownerAgentId, ownerAgentId, JSON.stringify({ imported: true })]);
    const result = await client.query(
      'SELECT * FROM ai_agents WHERE tenant_id = $1 AND agent_id = $2',
      [tenantId, ownerAgentId],
    );
    return result.rows[0] || null;
  }

  async function listAiAgents({ tenantId, includeInactive = false }) {
    await ensureTenantAgents(tenantId);
    const result = await pool.query(
      `SELECT agent_id, display_name, role, execution_kind, active, assignable, environment_scope
       FROM ai_agents
       WHERE tenant_id = $1
         AND ($2::boolean = true OR active = true)
       ORDER BY display_name ASC`,
      [tenantId, includeInactive],
    );
    return result.rows.map((row) => ({
      agentId: row.agent_id,
      displayName: row.display_name,
      role: row.role || null,
      executionKind: row.execution_kind,
      active: Boolean(row.active),
      assignable: Boolean(row.assignable),
      environmentScope: row.environment_scope,
    }));
  }

  async function listTasks({ tenantId, ownerAgentId, status }) {
    const result = await pool.query(`
      SELECT t.*, a.display_name AS owner_display_name, a.role AS owner_role, a.active AS owner_active, a.assignable AS owner_assignable
      FROM tasks t
      LEFT JOIN ai_agents a
        ON a.tenant_id = t.tenant_id
       AND a.agent_id = t.owner_agent_id
      WHERE t.tenant_id = $1
        AND ($2::text IS NULL OR t.owner_agent_id = $2)
        AND ($3::text IS NULL OR t.status = $3)
      ORDER BY t.created_at ASC
    `, [tenantId, ownerAgentId ?? null, status ?? null]);
    return result.rows.map(normalizeTaskRow);
  }

  async function getTask({ tenantId, taskId }) {
    const result = await pool.query(`
      SELECT t.*, a.display_name AS owner_display_name, a.role AS owner_role, a.active AS owner_active, a.assignable AS owner_assignable
      FROM tasks t
      LEFT JOIN ai_agents a
        ON a.tenant_id = t.tenant_id
       AND a.agent_id = t.owner_agent_id
      WHERE t.tenant_id = $1 AND t.task_id = $2
    `, [tenantId, taskId]);
    return result.rows[0] ? normalizeTaskRow(result.rows[0]) : null;
  }

  async function createTask({ tenantId, actorId, taskId, title, description = '', status, priority = null, ownerAgentId = null, idempotencyKey = null, requestId = null }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureTenantAgents(tenantId, client);
      await requireAgent(tenantId, ownerAgentId, client);
      const nextTaskId = taskId || `TSK-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
      await client.query(`
        INSERT INTO tasks (
          tenant_id, task_id, title, description, status, priority, owner_agent_id, source_system, source_of_truth_version, version, migration_state
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'canonical',1,1,'active')
        ON CONFLICT (tenant_id, task_id) DO NOTHING
      `, [tenantId, nextTaskId, title, description, status, priority, ownerAgentId]);
      await client.query(`
        INSERT INTO task_sync_checkpoints (
          tenant_id, task_id, canonical_version, sync_status, last_synced_at
        ) VALUES ($1,$2,1,'active',NOW())
        ON CONFLICT (tenant_id, task_id) DO UPDATE
        SET canonical_version = EXCLUDED.canonical_version,
            sync_status = EXCLUDED.sync_status,
            last_synced_at = EXCLUDED.last_synced_at,
            last_error = NULL
      `, [tenantId, nextTaskId]);
      await client.query(`
        INSERT INTO task_mutations (
          tenant_id, task_id, task_version, mutation_type, actor_id, actor_type, request_id, idempotency_key, payload
        ) VALUES ($1,$2,1,'task_created',$3,'user',$4,$5,$6::jsonb)
        ON CONFLICT DO NOTHING
      `, [tenantId, nextTaskId, actorId, requestId, idempotencyKey, JSON.stringify({ title, description, status, priority, ownerAgentId })]);
      await client.query('COMMIT');
      return getTask({ tenantId, taskId: nextTaskId });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function updateTask({ tenantId, taskId, actorId, version, idempotencyKey = null, requestId = null, title, description, status, priority }) {
    const existing = await getTask({ tenantId, taskId });
    if (!existing) throw createTaskPlatformError(404, 'task_not_found', 'Task not found', { taskId });
    if (Number(version) !== Number(existing.version)) {
      throw createTaskPlatformError(409, 'version_conflict', `Task version ${version} is stale; current version is ${existing.version}`, { taskId, expectedVersion: existing.version });
    }
    const nextVersion = existing.version + 1;
    await pool.query(`
      UPDATE tasks
      SET title = COALESCE($3, title),
          description = COALESCE($4, description),
          status = COALESCE($5, status),
          priority = COALESCE($6, priority),
          version = $7,
          updated_at = NOW()
      WHERE tenant_id = $1 AND task_id = $2
    `, [tenantId, taskId, title ?? null, description ?? null, status ?? null, priority ?? null, nextVersion]);
    await pool.query(`
      INSERT INTO task_sync_checkpoints (
        tenant_id, task_id, canonical_version, sync_status, last_synced_at
      ) VALUES ($1,$2,$3,'active',NOW())
      ON CONFLICT (tenant_id, task_id) DO UPDATE
      SET canonical_version = EXCLUDED.canonical_version,
          sync_status = EXCLUDED.sync_status,
          last_synced_at = EXCLUDED.last_synced_at,
          last_error = NULL
    `, [tenantId, taskId, nextVersion]);
    await pool.query(`
      INSERT INTO task_mutations (
        tenant_id, task_id, task_version, mutation_type, actor_id, actor_type, request_id, idempotency_key, payload
      ) VALUES ($1,$2,$3,'task_updated',$4,'user',$5,$6,$7::jsonb)
    `, [tenantId, taskId, nextVersion, actorId, requestId, idempotencyKey, JSON.stringify({ title, description, status, priority })]);
    return getTask({ tenantId, taskId });
  }

  async function updateTaskOwner({ tenantId, taskId, actorId, version, ownerAgentId, idempotencyKey = null, requestId = null }) {
    const existing = await getTask({ tenantId, taskId });
    if (!existing) throw createTaskPlatformError(404, 'task_not_found', 'Task not found', { taskId });
    if (Number(version) !== Number(existing.version)) {
      throw createTaskPlatformError(409, 'version_conflict', `Task version ${version} is stale; current version is ${existing.version}`, { taskId, expectedVersion: existing.version });
    }
    await requireAgent(tenantId, ownerAgentId, pool);
    const nextVersion = existing.version + 1;
    await pool.query(`
      UPDATE tasks
      SET owner_agent_id = $3,
          version = $4,
          updated_at = NOW()
      WHERE tenant_id = $1 AND task_id = $2
    `, [tenantId, taskId, ownerAgentId ?? null, nextVersion]);
    await pool.query(`
      INSERT INTO task_sync_checkpoints (
        tenant_id, task_id, canonical_version, sync_status, last_synced_at
      ) VALUES ($1,$2,$3,'active',NOW())
      ON CONFLICT (tenant_id, task_id) DO UPDATE
      SET canonical_version = EXCLUDED.canonical_version,
          sync_status = EXCLUDED.sync_status,
          last_synced_at = EXCLUDED.last_synced_at,
          last_error = NULL
    `, [tenantId, taskId, nextVersion]);
    await pool.query(`
      INSERT INTO task_mutations (
        tenant_id, task_id, task_version, mutation_type, actor_id, actor_type, request_id, idempotency_key, payload
      ) VALUES ($1,$2,$3,'task_owner_updated',$4,'user',$5,$6,$7::jsonb)
    `, [tenantId, taskId, nextVersion, actorId, requestId, idempotencyKey, JSON.stringify({ ownerAgentId: ownerAgentId ?? null })]);
    return getTask({ tenantId, taskId });
  }

  async function syncTaskFromProjection({
    tenantId,
    taskId,
    title,
    description = '',
    status,
    priority = null,
    ownerAgentId = null,
    sourceSystem = 'audit_projection_sync',
    lastAuditEventId = null,
    lastAuditSequenceNumber = null,
    migrationState = 'backfilled',
    metadata = {},
  }) {
    await ensureTenantAgents(tenantId);
    await ensureSyncAgent(tenantId, ownerAgentId, pool);
    await pool.query(`
      INSERT INTO tasks (
        tenant_id, task_id, title, description, status, priority, owner_agent_id, source_system, source_of_truth_version, version, last_audit_event_id, last_audit_sequence_number, migration_state, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,1,$9,$10,$11,$12::jsonb)
      ON CONFLICT (tenant_id, task_id) DO UPDATE
      SET title = EXCLUDED.title,
          description = EXCLUDED.description,
          status = EXCLUDED.status,
          priority = EXCLUDED.priority,
          owner_agent_id = EXCLUDED.owner_agent_id,
          source_system = EXCLUDED.source_system,
          last_audit_event_id = EXCLUDED.last_audit_event_id,
          last_audit_sequence_number = EXCLUDED.last_audit_sequence_number,
          migration_state = EXCLUDED.migration_state,
          metadata = tasks.metadata || EXCLUDED.metadata,
          version = CASE
            WHEN tasks.title IS DISTINCT FROM EXCLUDED.title
              OR tasks.description IS DISTINCT FROM EXCLUDED.description
              OR tasks.status IS DISTINCT FROM EXCLUDED.status
              OR tasks.priority IS DISTINCT FROM EXCLUDED.priority
              OR tasks.owner_agent_id IS DISTINCT FROM EXCLUDED.owner_agent_id
              OR tasks.last_audit_event_id IS DISTINCT FROM EXCLUDED.last_audit_event_id
              OR tasks.last_audit_sequence_number IS DISTINCT FROM EXCLUDED.last_audit_sequence_number
            THEN tasks.version + 1
            ELSE tasks.version
          END,
          updated_at = NOW()
    `, [tenantId, taskId, title, description, status, priority, ownerAgentId, sourceSystem, lastAuditEventId, lastAuditSequenceNumber, migrationState, JSON.stringify(metadata)]);
    await pool.query(`
      INSERT INTO task_sync_checkpoints (
        tenant_id, task_id, canonical_version, last_projected_audit_event_id, last_projected_sequence_number, sync_status, last_synced_at
      )
      SELECT tenant_id, task_id, version, last_audit_event_id, last_audit_sequence_number, 'synced', NOW()
      FROM tasks
      WHERE tenant_id = $1 AND task_id = $2
      ON CONFLICT (tenant_id, task_id) DO UPDATE
      SET canonical_version = EXCLUDED.canonical_version,
          last_projected_audit_event_id = EXCLUDED.last_projected_audit_event_id,
          last_projected_sequence_number = EXCLUDED.last_projected_sequence_number,
          sync_status = EXCLUDED.sync_status,
          last_synced_at = EXCLUDED.last_synced_at,
          last_error = NULL
    `, [tenantId, taskId]);
    return getTask({ tenantId, taskId });
  }

  return {
    kind: 'postgres',
    listAiAgents,
    listTasks,
    getTask,
    createTask,
    updateTask,
    updateTaskOwner,
    syncTaskFromProjection,
  };
}

module.exports = {
  createPostgresTaskPlatformService,
};
