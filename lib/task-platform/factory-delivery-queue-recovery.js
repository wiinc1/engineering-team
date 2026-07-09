const DEFAULT_QUEUE_RETRY_BASE_SECONDS = 30;
const DEFAULT_TERMINAL_QUEUE_STAGES = Object.freeze(['completed', 'dead_letter']);

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function recoverExpiredFactoryQueueLeases(client, options = {}) {
  const retryBaseSeconds = positiveInteger(options.retryBaseSeconds, DEFAULT_QUEUE_RETRY_BASE_SECONDS);
  const result = await client.query(`
    UPDATE factory_delivery_queue
    SET attempts = attempts + 1,
        stage = CASE WHEN attempts + 1 >= max_attempts THEN 'dead_letter' ELSE stage END,
        available_at = CASE
          WHEN attempts + 1 >= max_attempts THEN NOW()
          ELSE NOW() + make_interval(secs => LEAST(15 * 60, $3::integer * (attempts + 1)))
        END,
        locked_by = NULL,
        locked_at = NULL,
        lease_expires_at = NULL,
        last_action = 'lease_expired',
        last_error = 'factory queue lease expired before release',
        dead_lettered_at = CASE WHEN attempts + 1 >= max_attempts THEN NOW() ELSE dead_lettered_at END,
        metadata = CASE
          WHEN attempts + 1 >= max_attempts THEN COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'lastOutcomeAction', 'lease_expired',
            'deadLetter', COALESCE(metadata->'deadLetter', '{}'::jsonb) || jsonb_build_object(
              'failedStage', stage,
              'failedAction', 'lease_expired',
              'failureAttempts', attempts + 1
            )
          )
          ELSE metadata
        END,
        updated_at = NOW()
    WHERE tenant_id = $1
      AND locked_by IS NOT NULL
      AND lease_expires_at <= NOW()
      AND stage <> ALL($2::text[])
    RETURNING stage
  `, [options.tenantId, options.terminalStages || DEFAULT_TERMINAL_QUEUE_STAGES, retryBaseSeconds]);
  const rows = result.rows || [];
  return {
    recovered: Number(result.rowCount ?? rows.length ?? 0),
    deadLettered: rows.filter((row) => row.stage === 'dead_letter').length,
  };
}

module.exports = {
  DEFAULT_TERMINAL_QUEUE_STAGES,
  recoverExpiredFactoryQueueLeases,
};
