const { createPgPoolFromEnv } = require('../audit/postgres');
const {
  createTaskPlatformError,
  MERGE_READINESS_JSON_FIELDS,
  normalizeCreateMergeReadinessReviewInput,
  normalizeMergeReadinessReviewRecord,
  normalizeUpdateMergeReadinessReviewInput,
} = require('./service');

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

function normalizePullRequestFilter(value) {
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw createTaskPlatformError(400, 'invalid_pull_request_number', 'pull_request_number must be a positive integer', { value });
  }
  return normalized;
}

function normalizeCommitShaFilter(value) {
  const normalized = String(value || '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(normalized)) {
    throw createTaskPlatformError(400, 'invalid_commit_sha', 'commit_sha must be a 7 to 40 character Git SHA', { value });
  }
  return normalized;
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

  async function requireTask(tenantId, taskId, client = pool, { lock = false } = {}) {
    const result = await client.query(
      `SELECT task_id FROM tasks WHERE tenant_id = $1 AND task_id = $2${lock ? ' FOR UPDATE' : ''}`,
      [tenantId, taskId],
    );
    if (!result.rows[0]) throw createTaskPlatformError(404, 'task_not_found', 'Task not found', { taskId });
    return result.rows[0];
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

  async function createMergeReadinessReview(input = {}) {
    const review = normalizeCreateMergeReadinessReviewInput(input);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireTask(review.tenant_id, review.task_id, client, { lock: true });
      if (review.is_current) {
        await client.query(`
          UPDATE merge_readiness_reviews
          SET is_current = false,
              record_version = record_version + 1,
              updated_at = NOW()
          WHERE tenant_id = $1
            AND task_id = $2
            AND repository = $3
            AND pull_request_number = $4
            AND commit_sha = $5
            AND is_current = true
        `, [review.tenant_id, review.task_id, review.repository, review.pull_request_number, review.commit_sha]);
      }
      const result = await client.query(`
        INSERT INTO merge_readiness_reviews (
          tenant_id,
          review_id,
          task_id,
          repository,
          pull_request_number,
          commit_sha,
          review_status,
          is_current,
          policy_version,
          record_version,
          github_check_run_id,
          source_inventory,
          required_check_inventory,
          reviewed_log_sources,
          findings,
          classification,
          owner,
          rationale,
          follow_up_links,
          approvals,
          metadata,
          reviewer_actor_id,
          reviewer_actor_type
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
          $12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb,
          $22,$23
        )
        RETURNING *
      `, [
        review.tenant_id,
        review.review_id,
        review.task_id,
        review.repository,
        review.pull_request_number,
        review.commit_sha,
        review.review_status,
        review.is_current,
        review.policy_version,
        review.record_version,
        review.github_check_run_id,
        JSON.stringify(review.source_inventory),
        JSON.stringify(review.required_check_inventory),
        JSON.stringify(review.reviewed_log_sources),
        JSON.stringify(review.findings),
        JSON.stringify(review.classification),
        JSON.stringify(review.owner),
        JSON.stringify(review.rationale),
        JSON.stringify(review.follow_up_links),
        JSON.stringify(review.approvals),
        JSON.stringify(review.metadata),
        review.reviewer_actor_id,
        review.reviewer_actor_type,
      ]);
      await client.query('COMMIT');
      return normalizeMergeReadinessReviewRecord(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function listMergeReadinessReviews({ tenantId, taskId, repository, pullRequestNumber, commitSha, currentOnly = true }) {
    await requireTask(tenantId, taskId);
    const params = [tenantId, taskId];
    const conditions = ['tenant_id = $1', 'task_id = $2'];
    if (repository != null) {
      params.push(repository);
      conditions.push(`repository = $${params.length}`);
    }
    if (pullRequestNumber != null) {
      params.push(normalizePullRequestFilter(pullRequestNumber));
      conditions.push(`pull_request_number = $${params.length}`);
    }
    if (commitSha != null) {
      params.push(normalizeCommitShaFilter(commitSha));
      conditions.push(`commit_sha = $${params.length}`);
    }
    if (currentOnly !== false) {
      conditions.push('is_current = true');
    }
    const result = await pool.query(`
      SELECT *
      FROM merge_readiness_reviews
      WHERE ${conditions.join(' AND ')}
      ORDER BY is_current DESC, repository ASC, pull_request_number ASC, commit_sha ASC, updated_at DESC, review_id ASC
    `, params);
    return result.rows.map(normalizeMergeReadinessReviewRecord);
  }

  async function updateMergeReadinessReview(input = {}) {
    const update = normalizeUpdateMergeReadinessReviewInput(input);
    const assignments = [];
    const params = [update.tenant_id, update.task_id, update.review_id, update.record_version];
    for (const column of [
      'review_status',
      'policy_version',
      'github_check_run_id',
      'reviewer_actor_id',
      'reviewer_actor_type',
    ]) {
      if (Object.prototype.hasOwnProperty.call(update, column)) {
        params.push(update[column]);
        assignments.push(`${column} = $${params.length}`);
      }
    }
    for (const [, column] of MERGE_READINESS_JSON_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(update, column)) {
        params.push(JSON.stringify(update[column]));
        assignments.push(`${column} = $${params.length}::jsonb`);
      }
    }

    const setClause = assignments.length ? `${assignments.join(', ')}, ` : '';
    const result = await pool.query(`
      UPDATE merge_readiness_reviews
      SET ${setClause}
          record_version = record_version + 1,
          updated_at = NOW()
      WHERE tenant_id = $1
        AND task_id = $2
        AND review_id = $3
        AND record_version = $4
      RETURNING *
    `, params);
    if (result.rows[0]) return normalizeMergeReadinessReviewRecord(result.rows[0]);

    const existing = await pool.query(`
      SELECT record_version
      FROM merge_readiness_reviews
      WHERE tenant_id = $1 AND task_id = $2 AND review_id = $3
    `, [update.tenant_id, update.task_id, update.review_id]);
    if (!existing.rows[0]) {
      throw createTaskPlatformError(404, 'merge_readiness_review_not_found', 'Merge readiness review not found', { reviewId: update.review_id });
    }
    throw createTaskPlatformError(409, 'merge_readiness_review_version_conflict', `Merge readiness review version ${update.record_version} is stale; current version is ${existing.rows[0].record_version}`, {
      reviewId: update.review_id,
      expectedVersion: existing.rows[0].record_version,
    });
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
    createMergeReadinessReview,
    listMergeReadinessReviews,
    updateMergeReadinessReview,
    syncTaskFromProjection,
  };
}

module.exports = {
  createPostgresTaskPlatformService,
};
