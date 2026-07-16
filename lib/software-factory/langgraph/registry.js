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

  async stats() {
    const result = await this.pool.query(`
      SELECT COUNT(*) FILTER (WHERE status IN ('active','paused'))::integer AS active,
             COUNT(*) FILTER (WHERE status IN ('active','paused') AND updated_at < NOW() - INTERVAL '15 minutes')::integer AS stale,
             COALESCE(SUM(checkpoint_size_bytes), 0)::bigint AS checkpoint_bytes
      FROM ${this.table}
    `);
    return result.rows[0];
  }

  async expired(limit = 100) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 1_000);
    const result = await this.pool.query(`
      SELECT tenant_id, thread_id FROM ${this.table}
      WHERE status IN ('completed','failed','expired') AND retention_expires_at <= NOW()
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
