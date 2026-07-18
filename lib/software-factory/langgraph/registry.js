'use strict';

const { LangGraphRuntimeError } = require('./errors');

class ThreadRegistry {
  constructor(pool, schema) {
    this.pool = pool;
    this.schema = schema;
    this.table = `"${schema}".factory_threads`;
  }

  async register(input) {
    const result = await this.pool.query(`
      INSERT INTO ${this.table} (
        tenant_id, factory_run_id, thread_id, checkpoint_namespace, graph_version,
        state_schema_version, status, retention_expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7)
      ON CONFLICT (thread_id) DO UPDATE SET updated_at = NOW()
      WHERE ${this.table}.tenant_id = EXCLUDED.tenant_id
        AND ${this.table}.factory_run_id = EXCLUDED.factory_run_id
        AND ${this.table}.graph_version = EXCLUDED.graph_version
        AND ${this.table}.state_schema_version = EXCLUDED.state_schema_version
      RETURNING *
    `, [input.tenantId, input.factoryRunId, input.threadId, input.namespace, input.graphVersion,
      input.stateSchemaVersion, input.retentionExpiresAt]);
    if (!result.rows[0]) throw new LangGraphRuntimeError('langgraph_tenant_mismatch');
    return result.rows[0];
  }

  async get(tenantId, threadId) {
    const result = await this.pool.query(`SELECT * FROM ${this.table} WHERE tenant_id = $1 AND thread_id = $2`, [tenantId, threadId]);
    if (result.rows[0]) return result.rows[0];
    const exists = await this.pool.query(`SELECT 1 FROM ${this.table} WHERE thread_id = $1`, [threadId]);
    if (exists.rows[0]) throw new LangGraphRuntimeError('langgraph_tenant_mismatch');
    return null;
  }

  async assertBinding(tenantId, threadId) {
    const record = await this.get(tenantId, threadId);
    if (!record) throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable', { safeDetails: { reason: 'thread_not_found' } });
    return record;
  }

  async recordCheckpoint(input) {
    const result = await this.pool.query(`
      UPDATE ${this.table}
      SET last_checkpoint_id = $3, latest_node = $4, checkpoint_size_bytes = $5,
          checkpointed_at = NOW(), updated_at = NOW()
      WHERE tenant_id = $1 AND thread_id = $2
        AND ($6::uuid IS NULL OR (lease_owner = $6 AND lease_expires_at > NOW()))
      RETURNING *
    `, [input.tenantId, input.threadId, input.checkpointId, input.node || null, input.sizeBytes, input.owner || null]);
    if (!result.rows[0] && input.owner) {
      await this.assertBinding(input.tenantId, input.threadId);
      throw new LangGraphRuntimeError('langgraph_concurrency_conflict');
    }
    if (!result.rows[0]) throw new LangGraphRuntimeError('langgraph_tenant_mismatch');
    return result.rows[0];
  }

  async isAcceptedCheckpoint(input) {
    const result = await this.pool.query(`
      WITH RECURSIVE accepted_chain AS (
        SELECT checkpoint.checkpoint_id, checkpoint.parent_checkpoint_id
        FROM ${this.table} AS registry
        JOIN "${this.schema}".checkpoints AS checkpoint
          ON checkpoint.thread_id = registry.thread_id
         AND checkpoint.checkpoint_ns = $3
         AND checkpoint.checkpoint_id = registry.last_checkpoint_id
        WHERE registry.tenant_id = $1 AND registry.thread_id = $2
        UNION
        SELECT parent.checkpoint_id, parent.parent_checkpoint_id
        FROM "${this.schema}".checkpoints AS parent
        JOIN accepted_chain AS child
          ON parent.thread_id = $2 AND parent.checkpoint_ns = $3
         AND parent.checkpoint_id = child.parent_checkpoint_id
      )
      SELECT EXISTS (
        SELECT 1 FROM accepted_chain WHERE checkpoint_id = $4
      ) AS accepted
    `, [input.tenantId, input.threadId, input.namespace, input.checkpointId]);
    return result.rows[0]?.accepted === true;
  }

  async acquireLease(input) {
    const result = await this.pool.query(`
      UPDATE ${this.table}
      SET lease_owner = $3, lease_expires_at = NOW() + ($4::integer * INTERVAL '1 millisecond'), updated_at = NOW()
      WHERE tenant_id = $1 AND thread_id = $2 AND status IN ('active','paused')
        AND (lease_expires_at IS NULL OR lease_expires_at <= NOW() OR lease_owner = $3)
      RETURNING *
    `, [input.tenantId, input.threadId, input.owner, input.leaseMs]);
    if (result.rows[0]) return result.rows[0];
    await this.assertBinding(input.tenantId, input.threadId);
    throw new LangGraphRuntimeError('langgraph_concurrency_conflict');
  }

  async releaseLease(input) {
    await this.pool.query(`
      UPDATE ${this.table} SET lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW()
      WHERE tenant_id = $1 AND thread_id = $2 AND lease_owner = $3
    `, [input.tenantId, input.threadId, input.owner]);
  }

  async renewLease(input) {
    const result = await this.pool.query(`
      UPDATE ${this.table}
      SET lease_expires_at = NOW() + ($4::integer * INTERVAL '1 millisecond'), updated_at = NOW()
      WHERE tenant_id = $1 AND thread_id = $2 AND lease_owner = $3
      RETURNING *
    `, [input.tenantId, input.threadId, input.owner, input.leaseMs]);
    if (!result.rows[0]) throw new LangGraphRuntimeError('langgraph_concurrency_conflict');
    return result.rows[0];
  }

  async updateStatus(tenantId, threadId, status) {
    const result = await this.pool.query(`UPDATE ${this.table} SET status = $3, updated_at = NOW() WHERE tenant_id = $1 AND thread_id = $2 RETURNING *`, [tenantId, threadId, status]);
    if (!result.rows[0]) throw new LangGraphRuntimeError('langgraph_tenant_mismatch');
    return result.rows[0];
  }

  async updateStatusWithLease(input) {
    const result = await this.pool.query(`
      UPDATE ${this.table} SET status = $4, updated_at = NOW()
      WHERE tenant_id = $1 AND thread_id = $2 AND lease_owner = $3 AND lease_expires_at > NOW()
      RETURNING *
    `, [input.tenantId, input.threadId, input.owner, input.status]);
    if (result.rows[0]) return result.rows[0];
    await this.assertBinding(input.tenantId, input.threadId);
    throw new LangGraphRuntimeError('langgraph_concurrency_conflict');
  }

  async summaries(tenantId, input = {}) {
    const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 100);
    const result = await this.pool.query(`
      SELECT thread_id, factory_run_id, checkpoint_namespace, graph_version, state_schema_version,
             status, latest_node, checkpoint_size_bytes, checkpointed_at, retention_expires_at,
             created_at, updated_at
      FROM ${this.table}
      WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2)
      ORDER BY updated_at DESC, thread_id ASC LIMIT $3
    `, [tenantId, input.status || null, limit]);
    return result.rows;
  }

  async recordInterrupt(input) {
    const result = await this.pool.query(`
      INSERT INTO "${this.schema}".factory_interrupts (
        interrupt_id, tenant_id, thread_id, checkpoint_id, interrupt_type,
        interrupt_version, payload, authorized_roles, wait_reason, next_action
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::text[],$9,$10)
      ON CONFLICT (interrupt_id) DO UPDATE SET checkpoint_id = EXCLUDED.checkpoint_id
      WHERE "${this.schema}".factory_interrupts.tenant_id = EXCLUDED.tenant_id
        AND "${this.schema}".factory_interrupts.thread_id = EXCLUDED.thread_id
        AND "${this.schema}".factory_interrupts.state = 'pending'
      RETURNING *
    `, [input.interruptId, input.tenantId, input.threadId, input.checkpointId,
      input.type, input.version, JSON.stringify(input.payload), input.authorizedRoles,
      input.waitReason, input.nextAction]);
    if (!result.rows[0]) throw new LangGraphRuntimeError('langgraph_decision_conflict');
    return result.rows[0];
  }

  async pendingInterrupt(tenantId, threadId) {
    const result = await this.pool.query(`
      SELECT * FROM "${this.schema}".factory_interrupts
      WHERE tenant_id = $1 AND thread_id = $2 AND state IN ('pending','resolving')
      ORDER BY created_at DESC LIMIT 1
    `, [tenantId, threadId]);
    return result.rows[0] || null;
  }

  async interruptById(tenantId, threadId, interruptId) {
    const result = await this.pool.query(`
      SELECT * FROM "${this.schema}".factory_interrupts
      WHERE tenant_id = $1 AND thread_id = $2 AND interrupt_id = $3
    `, [tenantId, threadId, interruptId]);
    return result.rows[0] || null;
  }

  async interruptHistory(tenantId, threadId, limit = 25) {
    const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const result = await this.pool.query(`
      SELECT interrupt_id, thread_id, checkpoint_id, interrupt_type, interrupt_version,
             authorized_roles, wait_reason, next_action, state, resolution_action,
             resolver_actor_id, version, created_at, resolved_at
      FROM "${this.schema}".factory_interrupts
      WHERE tenant_id = $1 AND thread_id = $2
      ORDER BY created_at DESC, interrupt_id DESC LIMIT $3
    `, [tenantId, threadId, safeLimit]);
    return result.rows;
  }

  async claimInterruptDecision(input) {
    const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
    try {
      await client.query('BEGIN');
      const replay = await client.query(`
        SELECT * FROM "${this.schema}".factory_interrupts
        WHERE tenant_id = $1 AND idempotency_key = $2
      `, [input.tenantId, input.idempotencyKey]);
      if (replay.rows[0]) {
        await client.query('COMMIT');
        return { replay: true, interrupt: replay.rows[0] };
      }
      const result = await client.query(`
        UPDATE "${this.schema}".factory_interrupts
        SET state = 'resolving', resolution_action = $5, resolution_edits = $6::jsonb,
            resolver_actor_id = $7, idempotency_key = $8
        WHERE tenant_id = $1 AND thread_id = $2 AND interrupt_id = $3
          AND checkpoint_id = $4 AND version = $9 AND state = 'pending'
        RETURNING *
      `, [input.tenantId, input.threadId, input.interruptId, input.checkpointId,
        input.action, JSON.stringify(input.edits), input.actorId, input.idempotencyKey,
        input.expectedVersion]);
      if (!result.rows[0]) {
        const exists = await client.query(`
          SELECT 1 FROM "${this.schema}".factory_interrupts
          WHERE tenant_id = $1 AND thread_id = $2 AND interrupt_id = $3
        `, [input.tenantId, input.threadId, input.interruptId]);
        throw new LangGraphRuntimeError(exists.rows[0] ? 'langgraph_decision_conflict' : 'langgraph_interrupt_not_found');
      }
      await client.query('COMMIT');
      return { replay: false, interrupt: result.rows[0] };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      if (client !== this.pool && typeof client.release === 'function') client.release();
    }
  }

  async completeInterruptDecision(input) {
    const result = await this.pool.query(`
      UPDATE "${this.schema}".factory_interrupts
      SET state = $4, resolved_at = NOW(), version = version + 1
      WHERE tenant_id = $1 AND thread_id = $2 AND interrupt_id = $3
        AND state = 'resolving' AND idempotency_key = $5
      RETURNING *
    `, [input.tenantId, input.threadId, input.interruptId,
      input.cancelled ? 'cancelled' : 'resolved', input.idempotencyKey]);
    if (!result.rows[0]) throw new LangGraphRuntimeError('langgraph_decision_conflict');
    return result.rows[0];
  }

  async releaseInterruptDecision(input) {
    await this.pool.query(`
      UPDATE "${this.schema}".factory_interrupts
      SET state = 'pending', resolution_action = NULL, resolution_edits = NULL,
          resolver_actor_id = NULL, idempotency_key = NULL
      WHERE tenant_id = $1 AND thread_id = $2 AND interrupt_id = $3
        AND state = 'resolving' AND idempotency_key = $4
    `, [input.tenantId, input.threadId, input.interruptId, input.idempotencyKey]);
  }

  async claimRunAction(input) {
    const result = await this.pool.query(`
      INSERT INTO "${this.schema}".factory_run_actions (
        action_id, tenant_id, thread_id, idempotency_key, action, node, actor_id, reason
      ) SELECT $1,$2,$3,$4,$5,$6,$7,$8
      WHERE EXISTS (SELECT 1 FROM ${this.table} WHERE tenant_id = $2 AND thread_id = $3)
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING *
    `, [input.actionId, input.tenantId, input.threadId, input.idempotencyKey,
      input.action, input.node || null, input.actorId, input.reason]);
    if (result.rows[0]) return { replay: false, action: result.rows[0] };
    const prior = await this.pool.query(`
      SELECT * FROM "${this.schema}".factory_run_actions
      WHERE tenant_id = $1 AND idempotency_key = $2
    `, [input.tenantId, input.idempotencyKey]);
    if (prior.rows[0]) return { replay: true, action: prior.rows[0] };
    await this.assertBinding(input.tenantId, input.threadId);
    throw new LangGraphRuntimeError('langgraph_checkpoint_unavailable');
  }

  async completeRunAction(actionId) {
    const result = await this.pool.query(`
      UPDATE "${this.schema}".factory_run_actions
      SET outcome = 'succeeded', completed_at = NOW()
      WHERE action_id = $1 AND outcome = 'pending' RETURNING *
    `, [actionId]);
    if (!result.rows[0]) throw new LangGraphRuntimeError('langgraph_decision_conflict');
    return result.rows[0];
  }

  async failRunAction(actionId, errorCode) {
    await this.pool.query(`
      UPDATE "${this.schema}".factory_run_actions
      SET outcome = 'failed', error_code = $2, completed_at = NOW()
      WHERE action_id = $1 AND outcome = 'pending'
    `, [actionId, errorCode]);
  }

  async stats() {
    const result = await this.pool.query(`
      SELECT COUNT(*) FILTER (WHERE status IN ('active','paused'))::integer AS active,
             COUNT(*) FILTER (WHERE status IN ('active','paused') AND updated_at < NOW() - INTERVAL '15 minutes')::integer AS stale,
             COALESCE(SUM(checkpoint_size_bytes), 0)::bigint AS checkpoint_bytes,
             (SELECT COUNT(*)::integer FROM "${this.schema}".factory_interrupts WHERE state IN ('pending','resolving')) AS active_interrupts,
             (SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))), 0)::double precision
                FROM "${this.schema}".factory_interrupts WHERE state IN ('pending','resolving')) AS active_interrupt_age_seconds
      FROM ${this.table}
    `);
    return result.rows[0];
  }

  async expired(limit = 100) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 1_000);
    const result = await this.pool.query(`
      SELECT tenant_id, thread_id FROM ${this.table}
      WHERE status IN ('completed','failed','cancelled','expired') AND retention_expires_at <= NOW()
        AND lease_owner IS NULL
      ORDER BY retention_expires_at ASC LIMIT $1
    `, [safeLimit]);
    return result.rows;
  }

  async remove(tenantId, threadId) {
    const result = await this.pool.query(`DELETE FROM ${this.table} WHERE tenant_id = $1 AND thread_id = $2 RETURNING thread_id`, [tenantId, threadId]);
    return Boolean(result.rows[0]);
  }
}

function createThreadRegistry(pool, options = {}) {
  return new ThreadRegistry(pool, options.schema || 'langgraph_checkpoint');
}

module.exports = { createThreadRegistry };
