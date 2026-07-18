'use strict';

const { DELIVERY_STATUS, JOB_RUNTIME_SCHEMA } = require('./constants');
const { JobRuntimeError } = require('./errors');

const TABLE = `${JOB_RUNTIME_SCHEMA}.job_delivery_registry`;

function normalizeRecord(row) {
  if (!row) return null;
  const record = {
    deliveryId: row.delivery_id,
    tenantId: row.tenant_id,
    workloadId: row.workload_id,
    semanticJobKey: row.semantic_job_key,
    taskIdentifier: row.task_identifier,
    task: row.task_name,
    version: Number(row.payload_version),
    handlerVersion: Number(row.handler_version || 1),
    graphileJobId: row.graphile_job_id,
    queue: row.named_queue,
    orderingKey: row.ordering_key,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    scheduledFor: new Date(row.scheduled_for).toISOString(),
    correlationId: row.correlation_id,
    traceId: row.trace_id,
  };
  if (row.max_attempts !== undefined) record.maxAttempts = Number(row.max_attempts);
  if (row.last_error_code !== undefined) record.lastErrorCode = row.last_error_code || null;
  if (row.canonical_resource_type !== undefined) record.canonicalResourceType = row.canonical_resource_type || null;
  if (row.canonical_resource_id !== undefined) record.canonicalResourceId = row.canonical_resource_id || null;
  if (row.operator_version !== undefined) record.operatorVersion = Number(row.operator_version);
  if (row.created_at !== undefined) record.createdAt = row.created_at ? new Date(row.created_at).toISOString() : null;
  if (row.updated_at !== undefined) record.updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : null;
  return Object.freeze(record);
}

function pendingValues(input) {
  return [
    input.deliveryId, input.tenantId, input.workloadId, input.semanticJobKey,
    input.taskIdentifier, input.task, input.version, input.catalogVersion,
    input.handlerVersion, input.queue, input.orderingKey, input.maxAttempts, input.priority, input.canonicalResourceType,
    input.canonicalResourceId, input.correlationId, input.requestId || null,
    input.traceId || null, input.payloadSizeBytes, input.scheduledFor,
  ];
}

class DeliveryRegistry {
  constructor(pool) {
    this.pool = pool;
  }

  async findBySemanticKey(tenantId, semanticJobKey) {
    const result = await this.pool.query(
      `SELECT * FROM ${TABLE} WHERE tenant_id = $1 AND semantic_job_key = $2`,
      [tenantId, semanticJobKey],
    );
    return normalizeRecord(result.rows[0]);
  }

  async findByDeliveryId(deliveryId) {
    const result = await this.pool.query(
      `SELECT * FROM ${TABLE} WHERE delivery_id = $1`,
      [deliveryId],
    );
    return normalizeRecord(result.rows[0]);
  }

  async findForTenant(tenantId, deliveryId) {
    const result = await this.pool.query(
      `SELECT * FROM ${TABLE} WHERE tenant_id = $1 AND delivery_id = $2`,
      [tenantId, deliveryId],
    );
    return normalizeRecord(result.rows[0]);
  }

  async listOperatorHistory(tenantId, deliveryId, limit = 50) {
    const result = await this.pool.query(
      `SELECT action_id, delivery_id, action, actor_id, reason, request_id,
              expected_version, resulting_version, outcome, error_code, created_at
       FROM ${JOB_RUNTIME_SCHEMA}.job_operator_actions
       WHERE tenant_id = $1 AND delivery_id = $2
       ORDER BY created_at DESC, action_id DESC LIMIT $3`,
      [tenantId, deliveryId, limit],
    );
    return Object.freeze(result.rows.map((row) => Object.freeze({
      actionId: row.action_id,
      deliveryId: row.delivery_id,
      action: row.action,
      actorId: row.actor_id,
      reason: row.reason,
      requestId: row.request_id,
      expectedVersion: Number(row.expected_version),
      resultingVersion: row.resulting_version == null ? null : Number(row.resulting_version),
      outcome: row.outcome,
      errorCode: row.error_code || null,
      createdAt: new Date(row.created_at).toISOString(),
    })));
  }

  async claimOperatorAction(input) {
    const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
    try {
      await client.query('BEGIN');
      const prior = await client.query(
        `SELECT * FROM ${JOB_RUNTIME_SCHEMA}.job_operator_actions
         WHERE tenant_id = $1 AND idempotency_key = $2`,
        [input.tenantId, input.idempotencyKey],
      );
      if (prior.rows[0]) {
        await client.query('COMMIT');
        return Object.freeze({ replay: true, action: prior.rows[0] });
      }
      const delivery = await client.query(
        `SELECT * FROM ${TABLE} WHERE tenant_id = $1 AND delivery_id = $2 FOR UPDATE`,
        [input.tenantId, input.deliveryId],
      );
      if (!delivery.rows[0]) throw new JobRuntimeError('job_not_found');
      if (Number(delivery.rows[0].operator_version || 0) !== input.expectedVersion) {
        throw new JobRuntimeError('job_action_conflict', { safeDetails: { reason: 'stale_version' } });
      }
      const inserted = await client.query(
        `INSERT INTO ${JOB_RUNTIME_SCHEMA}.job_operator_actions (
           action_id, tenant_id, delivery_id, idempotency_key, action, actor_id,
           reason, request_id, expected_version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [input.actionId, input.tenantId, input.deliveryId, input.idempotencyKey,
          input.action, input.actorId, input.reason, input.requestId, input.expectedVersion],
      );
      await client.query('COMMIT');
      return Object.freeze({ replay: false, action: inserted.rows[0], delivery: normalizeRecord(delivery.rows[0]) });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      if (client !== this.pool && typeof client.release === 'function') client.release();
    }
  }

  async completeOperatorAction(input) {
    const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
    try {
      await client.query('BEGIN');
      const delivery = await client.query(
        `UPDATE ${TABLE} SET status = $4, operator_version = operator_version + 1,
           last_error_code = CASE WHEN $4 = $5 THEN last_error_code ELSE NULL END,
           cancelled_at = CASE WHEN $4 = $6 THEN NOW() ELSE cancelled_at END,
           scheduled_for = CASE WHEN $4 = $7 THEN NOW() ELSE scheduled_for END,
           updated_at = NOW()
         WHERE tenant_id = $1 AND delivery_id = $2 AND operator_version = $3 RETURNING *`,
        [input.tenantId, input.deliveryId, input.expectedVersion, input.status,
          DELIVERY_STATUS.FAILED, DELIVERY_STATUS.CANCELLED, DELIVERY_STATUS.RETRYING],
      );
      if (!delivery.rows[0]) throw new JobRuntimeError('job_action_conflict');
      await client.query(
        `UPDATE ${JOB_RUNTIME_SCHEMA}.job_operator_actions
         SET outcome = 'succeeded', resulting_version = $2
         WHERE action_id = $1 AND outcome = 'pending'`,
        [input.actionId, Number(delivery.rows[0].operator_version)],
      );
      await client.query('COMMIT');
      return normalizeRecord(delivery.rows[0]);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      if (client !== this.pool && typeof client.release === 'function') client.release();
    }
  }

  async failOperatorAction(actionId, errorCode) {
    await this.pool.query(
      `UPDATE ${JOB_RUNTIME_SCHEMA}.job_operator_actions
       SET outcome = 'failed', error_code = $2 WHERE action_id = $1 AND outcome = 'pending'`,
      [actionId, errorCode],
    );
  }

  async createPending(input) {
    const result = await this.pool.query(
      `INSERT INTO ${TABLE} (
        delivery_id, tenant_id, workload_id, semantic_job_key, task_identifier,
        task_name, payload_version, catalog_version, handler_version, named_queue, ordering_key, max_attempts,
        priority, canonical_resource_type, canonical_resource_id, correlation_id,
        request_id, trace_id, payload_size_bytes, scheduled_for
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
      ) ON CONFLICT (tenant_id, semantic_job_key) DO NOTHING RETURNING *`,
      pendingValues(input),
    );
    if (result.rows[0]) return Object.freeze({ created: true, record: normalizeRecord(result.rows[0]) });
    return Object.freeze({ created: false, record: await this.findBySemanticKey(input.tenantId, input.semanticJobKey) });
  }

  async attachGraphileJob(deliveryId, graphileJobId) {
    const result = await this.pool.query(
      `UPDATE ${TABLE} SET graphile_job_id = $2, status = $3, enqueued_at = NOW(), updated_at = NOW()
       WHERE delivery_id = $1 AND status = $4 RETURNING *`,
      [deliveryId, String(graphileJobId), DELIVERY_STATUS.QUEUED, DELIVERY_STATUS.PENDING],
    );
    if (!result.rows[0]) throw new JobRuntimeError('job_schedule_conflict');
    return normalizeRecord(result.rows[0]);
  }

  async markRunning(input) {
    const result = await this.pool.query(
      `UPDATE ${TABLE} SET status = $4, attempt_count = $5, started_at = NOW(), updated_at = NOW()
       WHERE delivery_id = $1 AND tenant_id = $2 AND graphile_job_id = $3
         AND status IN ($6, $7) RETURNING *`,
      [input.deliveryId, input.tenantId, String(input.graphileJobId), DELIVERY_STATUS.RUNNING,
        input.attemptCount, DELIVERY_STATUS.QUEUED, DELIVERY_STATUS.RETRYING],
    );
    if (!result.rows[0]) throw new JobRuntimeError('job_schedule_conflict');
    return normalizeRecord(result.rows[0]);
  }

  async markAcknowledged(deliveryId) {
    const result = await this.pool.query(
      `UPDATE ${TABLE} SET status = $2, acknowledged_at = NOW(), last_error_code = NULL, updated_at = NOW()
       WHERE delivery_id = $1 AND status = $3 RETURNING *`,
      [deliveryId, DELIVERY_STATUS.ACKNOWLEDGED, DELIVERY_STATUS.RUNNING],
    );
    if (!result.rows[0]) throw new JobRuntimeError('job_schedule_conflict');
    return normalizeRecord(result.rows[0]);
  }

  async markFailed(deliveryId, { retrying, errorCode }) {
    const status = retrying ? DELIVERY_STATUS.RETRYING : DELIVERY_STATUS.FAILED;
    const result = await this.pool.query(
      `UPDATE ${TABLE} SET status = $2::varchar, last_error_code = $3,
         failed_at = CASE WHEN $2::varchar = 'delivery_failed' THEN NOW() ELSE failed_at END,
         updated_at = NOW()
       WHERE delivery_id = $1 AND status IN ($4::varchar, $5::varchar, $6::varchar) RETURNING *`,
      [deliveryId, status, errorCode, DELIVERY_STATUS.PENDING, DELIVERY_STATUS.QUEUED, DELIVERY_STATUS.RUNNING],
    );
    return normalizeRecord(result.rows[0]);
  }

  async markRunningForRedelivery(errorCode = 'job_runtime_unavailable') {
    const result = await this.pool.query(
      `UPDATE ${TABLE} SET status = $1, last_error_code = $2, updated_at = NOW()
       WHERE status = $3 RETURNING delivery_id`,
      [DELIVERY_STATUS.RETRYING, errorCode, DELIVERY_STATUS.RUNNING],
    );
    return result.rows.length;
  }

  async summarizeCorrelationPrefix(prefix) {
    const result = await this.pool.query(
      `SELECT status, COUNT(*)::integer AS count FROM ${TABLE}
       WHERE correlation_id LIKE $1 ESCAPE '\\' GROUP BY status ORDER BY status`,
      [`${String(prefix).replace(/[\\%_]/g, '\\$&')}%`],
    );
    return Object.freeze(Object.fromEntries(result.rows.map((row) => [row.status, Number(row.count)])));
  }

  async operationalMetrics() {
    const result = await this.pool.query(
      `WITH queued AS (
         SELECT named_queue, scheduled_for FROM ${TABLE}
         WHERE status IN ($1, $2, $3)
       ), per_queue AS (
         SELECT named_queue, COUNT(*)::integer AS queue_depth,
           COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(scheduled_for))), 0)::double precision AS oldest_age_seconds
         FROM queued GROUP BY named_queue
       )
       SELECT
         (SELECT COUNT(*)::integer FROM queued) AS queue_depth,
         COALESCE((SELECT MAX(oldest_age_seconds) FROM per_queue), 0)::double precision AS oldest_age_seconds,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'queue', named_queue, 'queueDepth', queue_depth, 'oldestAgeSeconds', oldest_age_seconds
         ) ORDER BY named_queue) FROM per_queue), '[]'::jsonb) AS queue_metrics`,
      [DELIVERY_STATUS.PENDING, DELIVERY_STATUS.QUEUED, DELIVERY_STATUS.RETRYING],
    );
    const queues = Array.isArray(result.rows[0]?.queue_metrics) ? result.rows[0].queue_metrics : [];
    return Object.freeze({
      queueDepth: Number(result.rows[0]?.queue_depth || 0),
      oldestAgeSeconds: Math.max(0, Number(result.rows[0]?.oldest_age_seconds || 0)),
      queues: Object.freeze(queues.map((queue) => Object.freeze({
        queue: String(queue.queue),
        queueDepth: Number(queue.queueDepth || 0),
        oldestAgeSeconds: Math.max(0, Number(queue.oldestAgeSeconds || 0)),
      }))),
    });
  }

  async pruneTerminalBefore(cutoff, limit) {
    if (!(cutoff instanceof Date) || !Number.isFinite(cutoff.getTime()) || !Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'retention_policy' } });
    }
    const result = await this.pool.query(
      `WITH expired AS (
         SELECT delivery_id FROM ${TABLE}
         WHERE status IN ($1, $2) AND updated_at < $3
         ORDER BY updated_at ASC LIMIT $4 FOR UPDATE SKIP LOCKED
       )
       DELETE FROM ${TABLE} registry USING expired
       WHERE registry.delivery_id = expired.delivery_id
       RETURNING registry.delivery_id`,
      [DELIVERY_STATUS.ACKNOWLEDGED, DELIVERY_STATUS.FAILED, cutoff, limit],
    );
    return result.rows.length;
  }

  async verifySchema() {
    const result = await this.pool.query(
      "SELECT to_regclass('job_runtime.job_delivery_registry') IS NOT NULL AS present",
    );
    if (!result.rows[0]?.present) throw new JobRuntimeError('job_runtime_unavailable');
    return true;
  }
}

function createDeliveryRegistry(pool) {
  return new DeliveryRegistry(pool);
}

module.exports = {
  TABLE,
  DeliveryRegistry,
  createDeliveryRegistry,
  normalizeRecord,
};
