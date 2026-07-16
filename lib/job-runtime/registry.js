'use strict';

const { DELIVERY_STATUS, JOB_RUNTIME_SCHEMA } = require('./constants');
const { JobRuntimeError } = require('./errors');

const TABLE = `${JOB_RUNTIME_SCHEMA}.job_delivery_registry`;

function normalizeRecord(row) {
  if (!row) return null;
  return Object.freeze({
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
  });
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
