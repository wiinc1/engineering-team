const { createPgPoolFromEnv } = require('../audit/postgres');
const { RECOVERABLE_QUEUE_STAGES } = require('./factory-delivery-queue-release');
const {
  factoryRealDeliveryPreflightSummary,
} = require('./factory-delivery-submit-preflight');

const SELECT_DEAD_LETTER_FOR_REQUEUE_SQL = `
  SELECT *,
         CASE
           WHEN COALESCE(NULLIF(metadata #>> '{deadLetter,failedStage}', ''), '') = ANY($3::text[])
             THEN metadata #>> '{deadLetter,failedStage}'
           ELSE 'queued'
         END AS target_stage
  FROM factory_delivery_queue
  WHERE tenant_id = $1
    AND queue_id = $2
    AND stage = 'dead_letter'
  FOR UPDATE
`;

const REQUEUE_DEAD_LETTER_SQL = `
  WITH selected AS (
    SELECT tenant_id,
           queue_id,
           CASE
             WHEN COALESCE(NULLIF(metadata #>> '{deadLetter,failedStage}', ''), '') = ANY($3::text[])
               THEN metadata #>> '{deadLetter,failedStage}'
             ELSE 'queued'
           END AS target_stage
    FROM factory_delivery_queue
    WHERE tenant_id = $1
      AND queue_id = $2
      AND stage = 'dead_letter'
    FOR UPDATE
  )
  UPDATE factory_delivery_queue queue
  SET stage = selected.target_stage,
      attempts = 0,
      available_at = date_trunc('milliseconds', NOW()),
      locked_by = NULL,
      locked_at = NULL,
      lease_expires_at = NULL,
      dead_lettered_at = NULL,
      last_action = 'operator_requeued',
      last_error = NULL,
      metadata = (COALESCE(queue.metadata, '{}'::jsonb) - 'deadLetter') || jsonb_build_object(
        'lastOutcomeAction', 'operator_requeued',
        'deadLetterRecovery', jsonb_build_object(
          'actorId', $4::text,
          'reason', NULLIF($5::text, ''),
          'fromStage', 'dead_letter',
          'toStage', selected.target_stage,
          'recoveredDeadLetter', COALESCE(queue.metadata->'deadLetter', '{}'::jsonb),
          'requeuedAt', date_trunc('milliseconds', NOW())
        )
      ),
      updated_at = NOW()
  FROM selected
  WHERE queue.tenant_id = selected.tenant_id
    AND queue.queue_id = selected.queue_id
  RETURNING queue.*
`;

function factoryQueueError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeRequeueReason(value) {
  return String(value || '').trim().slice(0, 500);
}

function requeueParams(options = {}) {
  const tenantId = String(options.tenantId || '').trim();
  const queueId = String(options.queueId || options.id || '').trim();
  const reason = normalizeRequeueReason(options.reason || options.recoveryReason);
  if (!tenantId) throw factoryQueueError(400, 'missing_tenant_id', 'Factory queue requeue requires a tenant id.');
  if (!queueId) throw factoryQueueError(400, 'missing_factory_queue_id', 'Factory queue requeue requires an item id.');
  if (!reason) throw factoryQueueError(400, 'missing_requeue_reason', 'Factory queue requeue requires a recovery reason.');
  return [
    tenantId,
    queueId,
    RECOVERABLE_QUEUE_STAGES,
    String(options.actorId || 'system:factory-queue').trim(),
    reason,
  ];
}

async function withOptionalTransaction(pool, callback) {
  if (typeof pool.connect !== 'function') return callback(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function selectDeadLetterForRequeue(client, params) {
  const result = await client.query(SELECT_DEAD_LETTER_FOR_REQUEUE_SQL, [
    params[0],
    params[1],
    params[2],
  ]);
  if (!result.rows[0]) {
    throw factoryQueueError(404, 'factory_queue_item_not_requeueable', 'Factory queue item was not found in dead-letter state.', {
      queueId: params[1],
    });
  }
  return result.rows[0];
}

function assertRealDeliveryReadyToRequeue(item, targetStage, options = {}) {
  const summary = factoryRealDeliveryPreflightSummary(item, options, targetStage);
  if (!summary || summary.ok === true) return;
  throw factoryQueueError(409, 'factory_queue_requeue_preflight_failed', 'Factory queue real-delivery item is not ready to requeue.', {
    queueId: item.id,
    targetStage,
    failures: summary.failures,
  });
}

async function requeueDeadLetterPostgresFactoryQueueItem(pool, options = {}) {
  const params = requeueParams(options);
  const { normalizeFactoryQueueRow } = require('./factory-delivery-queue-postgres');
  return withOptionalTransaction(pool, async (client) => {
    const selectedRow = await selectDeadLetterForRequeue(client, params);
    const targetStage = selectedRow.target_stage || 'queued';
    assertRealDeliveryReadyToRequeue(normalizeFactoryQueueRow(selectedRow), targetStage, options);
    const result = await client.query(REQUEUE_DEAD_LETTER_SQL, params);
    return {
      item: normalizeFactoryQueueRow(result.rows[0]),
      action: 'operator_requeued',
    };
  });
}

async function requeuePostgresFactoryQueueItem(options = {}) {
  requeueParams(options);
  const { resolveFactoryQueueConnectionString } = require('./factory-delivery-queue-postgres');
  const pool = options.pool || createPgPoolFromEnv(resolveFactoryQueueConnectionString(options));
  const ownsPool = !options.pool;
  try {
    return await requeueDeadLetterPostgresFactoryQueueItem(pool, options);
  } finally {
    if (ownsPool && typeof pool.end === 'function') await pool.end();
  }
}

module.exports = {
  REQUEUE_DEAD_LETTER_SQL,
  SELECT_DEAD_LETTER_FOR_REQUEUE_SQL,
  requeueDeadLetterPostgresFactoryQueueItem,
  requeuePostgresFactoryQueueItem,
};
