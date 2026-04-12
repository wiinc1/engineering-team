const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  defaultMetrics,
  matchesFilters,
  summarizeEvent,
  buildCurrentState,
  buildRelationshipState,
  createCanonicalEvent,
} = require('./core');
const { createAuditLogger } = require('./logger');
const { assertAuditFoundationEnabled } = require('./feature-flags');

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function createPgPoolFromEnv(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required for postgres backend');

  const rejectUnauthorized = !parseBooleanEnv(process.env.PGSSL_ACCEPT_SELF_SIGNED, false);
  const sslMode = String(process.env.PGSSLMODE || '').trim().toLowerCase();
  const sslDisabled = ['disable', 'false', 'off', '0'].includes(sslMode);
  const useSsl = !sslDisabled && (connectionString.includes('sslmode=') || parseBooleanEnv(process.env.PGSSLMODE_REQUIRE, true));

  return new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized } : undefined,
  });
}

async function runMigrations(pool, options = {}) {
  const migrationsDir = options.migrationsDir || path.join(options.baseDir || process.cwd(), 'db', 'migrations');
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const applied = new Set((await pool.query('SELECT version FROM schema_migrations')).rows.map(row => row.version));
  const files = fs.readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
}

async function claimQueueRows(client, tableName, limit) {
  const result = await client.query(`
    WITH claimed AS (
      SELECT ${tableName === 'audit_outbox' ? 'outbox_id' : 'queue_id'} AS id
      FROM ${tableName}
      WHERE status = 'pending' AND available_at <= NOW()
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    )
    UPDATE ${tableName}
    SET status = 'processing', locked_at = NOW(), updated_at = NOW()
    WHERE ${tableName === 'audit_outbox' ? 'outbox_id' : 'queue_id'} IN (SELECT id FROM claimed)
    RETURNING *
  `, [limit]);
  return result.rows;
}

function createPostgresAuditStore(options = {}) {
  const logger = options.logger || createAuditLogger(options.baseDir || process.cwd());
  const pool = options.pool || createPgPoolFromEnv(options.connectionString);
  const maxAttempts = Number(options.maxAttempts || 5);
  const historyLatencyRegressionThresholdMs = Number(options.historyLatencyRegressionThresholdMs || process.env.AUDIT_HISTORY_LATENCY_REGRESSION_MS || 250);

  async function readMetrics(client = pool) {
    const rows = await client.query('SELECT metric_key, metric_value, metric_json FROM audit_metrics');
    const metrics = defaultMetrics();
    for (const row of rows.rows) {
      metrics[row.metric_key] = row.metric_json ?? row.metric_value;
    }
    return metrics;
  }

  async function updateMetric(key, value, client = pool) {
    await client.query(
      'INSERT INTO audit_metrics(metric_key, metric_value, metric_json, updated_at) VALUES ($1, $2, $3::jsonb, NOW()) ON CONFLICT (metric_key) DO UPDATE SET metric_value = EXCLUDED.metric_value, metric_json = EXCLUDED.metric_json, updated_at = NOW()',
      [key, typeof value === 'number' ? value : null, typeof value === 'number' ? null : JSON.stringify(value)],
    );
  }

  async function updateDerivedMetrics(client = pool) {
    const metrics = await readMetrics(client);
    const lagResult = await client.query(`
      SELECT MIN(EXTRACT(EPOCH FROM NOW() - e.occurred_at)) AS lag_seconds,
             COUNT(*) FILTER (WHERE q.status = 'processed') AS processed_count
      FROM audit_projection_queue q
      JOIN audit_events e ON e.event_id = q.event_id
      WHERE q.status IN ('pending', 'processing')
    `);
    const outboxResult = await client.query(`
      SELECT COUNT(*) FILTER (WHERE status IN ('published', 'processed')) AS published_count
      FROM audit_outbox
    `);
    metrics.workflow_projection_lag_seconds = Math.max(0, Number(lagResult.rows[0]?.lag_seconds || 0));
    metrics.projection_checkpoint = Number(lagResult.rows[0]?.processed_count || 0);
    metrics.outbox_checkpoint = Number(outboxResult.rows[0]?.published_count || 0);
    await writeMetrics(metrics, client);
    return metrics;
  }

  async function writeMetrics(metrics, client = pool) {
    for (const [key, value] of Object.entries(metrics)) {
      await updateMetric(key, value, client);
    }
  }

  async function bumpMetric(key, amount = 1, client = null) {
    const localClient = client || await pool.connect();
    try {
      const metrics = await readMetrics(localClient);
      metrics[key] = Number(metrics[key] || 0) + amount;
      await writeMetrics(metrics, localClient);
    } finally {
      if (!client) localClient.release();
    }
  }

  async function appendEvent(input) {
    assertAuditFoundationEnabled(options);
    const client = await pool.connect();
    const startedAt = Date.now();
    try {
      await client.query('BEGIN');
      const tenantId = input.tenantId || 'engineering-team';
      const duplicate = await client.query('SELECT * FROM audit_events WHERE tenant_id = $1 AND idempotency_key = $2', [tenantId, input.idempotencyKey]);
      if (duplicate.rows[0]) {
        await client.query('COMMIT');
        return { event: duplicate.rows[0], duplicate: true };
      }
      const sequenceResult = await client.query(
        'SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence FROM audit_events WHERE tenant_id = $1 AND task_id = $2',
        [tenantId, input.taskId],
      );
      const event = createCanonicalEvent(input, Number(sequenceResult.rows[0].next_sequence));
      await client.query(
        `INSERT INTO audit_events(event_id, tenant_id, task_id, event_type, occurred_at, recorded_at, actor_type, actor_id, correlation_id, causation_id, sequence_number, schema_version, idempotency_key, trace_id, source, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
        [event.event_id, event.tenant_id, event.task_id, event.event_type, event.occurred_at, event.recorded_at, event.actor_type, event.actor_id, event.correlation_id, event.causation_id, event.sequence_number, event.schema_version, event.idempotency_key, event.trace_id, event.source, JSON.stringify(event.payload)],
      );
      await client.query('INSERT INTO audit_projection_queue(event_id, tenant_id, task_id) VALUES ($1, $2, $3)', [event.event_id, event.tenant_id, event.task_id]);
      await client.query('INSERT INTO audit_outbox(event_id, tenant_id, task_id, payload) VALUES ($1, $2, $3, $4::jsonb)', [event.event_id, event.tenant_id, event.task_id, JSON.stringify({ event_type: event.event_type })]);
      const currentMetrics = await readMetrics(client);
      currentMetrics.workflow_audit_events_written_total += 1;
      currentMetrics.last_write_duration_ms = Date.now() - startedAt;
      await writeMetrics(currentMetrics, client);
      await updateDerivedMetrics(client);
      logger.info({ feature: 'ff_audit_foundation', action: 'audit_ingest', outcome: 'accepted', tenant_id: event.tenant_id, task_id: event.task_id, event_id: event.event_id, event_type: event.event_type, correlation_id: event.correlation_id, trace_id: event.trace_id, duration_ms: currentMetrics.last_write_duration_ms });
      await client.query('COMMIT');
      return { event, duplicate: false };
    } catch (error) {
      await client.query('ROLLBACK');
      try {
        await bumpMetric('workflow_audit_write_failures_total', 1);
      } catch {}
      logger.error({ feature: 'ff_audit_foundation', action: 'audit_write', outcome: 'error', tenant_id: input.tenantId || 'engineering-team', task_id: input.taskId, idempotency_key: input.idempotencyKey, error_message: error.message, duration_ms: Date.now() - startedAt });
      throw error;
    } finally {
      client.release();
    }
  }

  async function getTaskHistory(taskId, filters = {}) {
    assertAuditFoundationEnabled(options);
    const client = await pool.connect();
    const startedAt = Date.now();
    try {
      await bumpMetric('workflow_history_queries_total', 1, client);
      const result = await client.query(
        `SELECT * FROM audit_task_history
         WHERE task_id = $1 AND ($2::text IS NULL OR tenant_id = $2)
           AND ($3::integer IS NULL OR sequence_number < $3)
         ORDER BY sequence_number DESC`,
        [taskId, filters.tenantId || null, Number.isFinite(Number(filters.cursor)) ? Number(filters.cursor) : null],
      );
      let events = result.rows.filter(event => matchesFilters(event, filters));
      const limit = Number(filters.limit);
      if (Number.isFinite(limit)) events = events.slice(0, limit);
      return events;
    } catch (error) {
      await bumpMetric('workflow_history_errors_total', 1, client);
      logger.error({ feature: 'ff_audit_foundation', action: 'history_query', outcome: 'error', task_id: taskId, error_message: error.message });
      throw error;
    } finally {
      const durationMs = Date.now() - startedAt;
      try {
        await updateMetric('last_history_query_duration_ms', durationMs, client);
        if (durationMs > historyLatencyRegressionThresholdMs) {
          await bumpMetric('workflow_history_query_latency_regressions_total', 1, client);
          logger.error({ feature: 'ff_audit_foundation', action: 'history_query_latency', outcome: 'regression', task_id: taskId, tenant_id: filters.tenantId || null, duration_ms: durationMs, threshold_ms: historyLatencyRegressionThresholdMs });
        }
      } catch {}
      client.release();
    }
  }

  async function getTaskCurrentState(taskId, filters = {}) {
    assertAuditFoundationEnabled(options);
    const client = await pool.connect();
    try {
      await bumpMetric('workflow_current_state_queries_total', 1, client);
      const result = await client.query('SELECT * FROM audit_task_current_state WHERE task_id = $1 AND ($2::text IS NULL OR tenant_id = $2)', [taskId, filters.tenantId || null]);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async function getTaskCurrentStates(taskIds = [], filters = {}) {
    assertAuditFoundationEnabled(options);
    if (!taskIds.length) return {};
    const client = await pool.connect();
    try {
      await bumpMetric('workflow_current_state_queries_total', 1, client);
      const result = await client.query(
        'SELECT * FROM audit_task_current_state WHERE task_id = ANY($1::text[]) AND ($2::text IS NULL OR tenant_id = $2)',
        [taskIds, filters.tenantId || null],
      );
      const rows = new Map(result.rows.map((row) => [row.task_id, row]));
      return taskIds.reduce((acc, taskId) => {
        acc[taskId] = rows.get(taskId) || null;
        return acc;
      }, {});
    } finally {
      client.release();
    }
  }

  async function listTaskSummaries(filters = {}) {
    assertAuditFoundationEnabled(options);
    const client = await pool.connect();
    try {
      await bumpMetric('workflow_current_state_queries_total', 1, client);
      const result = await client.query(
        `SELECT state.*, created.payload->>'title' AS created_title
         FROM audit_task_current_state state
         LEFT JOIN LATERAL (
           SELECT payload
           FROM audit_task_history history
           WHERE history.tenant_id = state.tenant_id
             AND history.task_id = state.task_id
             AND history.event_type = 'task.created'
           ORDER BY history.sequence_number ASC
           LIMIT 1
         ) created ON TRUE
         WHERE ($1::text IS NULL OR state.tenant_id = $1)
         ORDER BY state.last_occurred_at DESC NULLS LAST, state.task_id ASC`,
        [filters.tenantId || null],
      );

      return result.rows.map((state) => ({
        task_id: state.task_id,
        tenant_id: state.tenant_id,
        title: state.created_title || state.task_id,
        priority: state.priority,
        current_stage: state.current_stage,
        current_owner: state.assignee,
        owner: state.assignee
          ? {
              actor_id: state.assignee,
              display_name: state.assignee,
            }
          : null,
        blocked: Boolean(state.blocked),
        closed: Boolean(state.closed),
        waiting_state: state.waiting_state || null,
        next_required_action: state.next_required_action || null,
        queue_entered_at: state.queue_entered_at || state.last_occurred_at,
        wip_owner: state.wip_owner || null,
        wip_started_at: state.wip_started_at || null,
        freshness: {
          status: state.last_occurred_at && (Date.now() - Date.parse(state.last_occurred_at)) > 5 * 60 * 1000 ? 'stale' : 'fresh',
          last_updated_at: state.last_occurred_at,
        },
      }));
    } finally {
      client.release();
    }
  }

  async function getTaskRelationships(taskId, filters = {}) {
    assertAuditFoundationEnabled(options);
    const client = await pool.connect();
    try {
      await bumpMetric('workflow_relationship_queries_total', 1, client);
      const result = await client.query('SELECT * FROM audit_task_relationships WHERE task_id = $1 AND ($2::text IS NULL OR tenant_id = $2)', [taskId, filters.tenantId || null]);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async function getTaskObservabilitySummary(taskId, filters = {}) {
    assertAuditFoundationEnabled(options);
    await bumpMetric('workflow_observability_queries_total', 1);
    const [history, state, metrics] = await Promise.all([getTaskHistory(taskId, filters), getTaskCurrentState(taskId, filters), updateDerivedMetrics()]);
    if (!state) return null;
    return {
      task_id: taskId,
      tenant_id: state.tenant_id,
      status: state.last_occurred_at && (Date.now() - Date.parse(state.last_occurred_at)) > 5 * 60 * 1000 ? 'degraded' : 'ok',
      last_updated_at: state.last_occurred_at,
      freshness: {
        status: state.last_occurred_at && (Date.now() - Date.parse(state.last_occurred_at)) > 5 * 60 * 1000 ? 'stale' : 'fresh',
        last_updated_at: state.last_occurred_at,
      },
      degraded: Boolean(state.last_occurred_at && (Date.now() - Date.parse(state.last_occurred_at)) > 5 * 60 * 1000),
      event_count: history.length,
      last_event_id: state.last_event_id,
      last_event_type: state.last_event_type,
      last_occurred_at: state.last_occurred_at,
      current_stage: state.current_stage,
      closed: state.closed,
      key_signals: {
        projection_lag_seconds: Number(metrics.workflow_projection_lag_seconds || 0),
        blocked: Boolean(state.blocked),
        closed: Boolean(state.closed),
      },
      approved_correlation_ids: [...new Set(history.map(event => event.correlation_id).filter(Boolean))].slice(0, 10),
      approved_links: [],
      privileged_links: [],
      correlation_ids: [...new Set(history.map(event => event.correlation_id).filter(Boolean))],
      trace_ids: [...new Set(history.map(event => event.trace_id).filter(Boolean))],
      metrics,
    };
  }

  async function applyEventToReadModels(event, client = pool) {
    const stateResult = await client.query('SELECT * FROM audit_task_current_state WHERE tenant_id = $1 AND task_id = $2', [event.tenant_id, event.task_id]);
    const relationshipResult = await client.query('SELECT * FROM audit_task_relationships WHERE tenant_id = $1 AND task_id = $2', [event.tenant_id, event.task_id]);
    const nextState = buildCurrentState(stateResult.rows[0], event);
    const nextRelationships = buildRelationshipState(relationshipResult.rows[0], event);
    await client.query(
      `INSERT INTO audit_task_history(event_id, tenant_id, task_id, event_type, occurred_at, recorded_at, actor_id, actor_type, sequence_number, correlation_id, trace_id, summary, payload, source)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.event_id, event.tenant_id, event.task_id, event.event_type, event.occurred_at, event.recorded_at, event.actor_id, event.actor_type, event.sequence_number, event.correlation_id, event.trace_id, summarizeEvent(event), JSON.stringify(event.payload), event.source],
    );
    await client.query(
      `INSERT INTO audit_task_current_state(
         tenant_id, task_id, last_event_id, last_event_type, last_occurred_at, last_actor_id,
         current_stage, assignee, priority, engineer_tier, engineer_tier_rationale,
         architect_handoff_version, ready_for_engineering,
         implementation_commit_sha, implementation_pr_url, implementation_primary_reference, implementation_submission_version,
         lock_owner, lock_acquired_at, lock_expires_at, lock_reason, lock_action,
         latest_qa_outcome, latest_qa_run_id, latest_qa_actor_id, latest_qa_retest_scope, latest_qa_submission_version, latest_qa_routed_stage,
         blocked, closed, waiting_state, next_required_action, queue_entered_at, wip_owner, wip_started_at
       )
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb,$27,$28,$29,$30,$31,$32,$33,$34,$35)
       ON CONFLICT (tenant_id, task_id) DO UPDATE SET
         last_event_id=EXCLUDED.last_event_id,
         last_event_type=EXCLUDED.last_event_type,
         last_occurred_at=EXCLUDED.last_occurred_at,
         last_actor_id=EXCLUDED.last_actor_id,
         current_stage=EXCLUDED.current_stage,
         assignee=EXCLUDED.assignee,
         priority=EXCLUDED.priority,
         engineer_tier=EXCLUDED.engineer_tier,
         engineer_tier_rationale=EXCLUDED.engineer_tier_rationale,
         architect_handoff_version=EXCLUDED.architect_handoff_version,
         ready_for_engineering=EXCLUDED.ready_for_engineering,
         implementation_commit_sha=EXCLUDED.implementation_commit_sha,
         implementation_pr_url=EXCLUDED.implementation_pr_url,
         implementation_primary_reference=EXCLUDED.implementation_primary_reference,
         implementation_submission_version=EXCLUDED.implementation_submission_version,
         lock_owner=EXCLUDED.lock_owner,
         lock_acquired_at=EXCLUDED.lock_acquired_at,
         lock_expires_at=EXCLUDED.lock_expires_at,
         lock_reason=EXCLUDED.lock_reason,
         lock_action=EXCLUDED.lock_action,
         latest_qa_outcome=EXCLUDED.latest_qa_outcome,
         latest_qa_run_id=EXCLUDED.latest_qa_run_id,
         latest_qa_actor_id=EXCLUDED.latest_qa_actor_id,
         latest_qa_retest_scope=EXCLUDED.latest_qa_retest_scope,
         latest_qa_submission_version=EXCLUDED.latest_qa_submission_version,
         latest_qa_routed_stage=EXCLUDED.latest_qa_routed_stage,
         blocked=EXCLUDED.blocked,
         closed=EXCLUDED.closed,
         waiting_state=EXCLUDED.waiting_state,
         next_required_action=EXCLUDED.next_required_action,
         queue_entered_at=EXCLUDED.queue_entered_at,
         wip_owner=EXCLUDED.wip_owner,
         wip_started_at=EXCLUDED.wip_started_at`,
      [
        nextState.tenant_id,
        nextState.task_id,
        nextState.last_event_id,
        nextState.last_event_type,
        nextState.last_occurred_at,
        nextState.last_actor_id,
        nextState.current_stage,
        nextState.assignee,
        nextState.priority,
        nextState.engineer_tier,
        nextState.engineer_tier_rationale,
        nextState.architect_handoff_version,
        nextState.ready_for_engineering,
        nextState.implementation_commit_sha,
        nextState.implementation_pr_url,
        JSON.stringify(nextState.implementation_primary_reference || null),
        nextState.implementation_submission_version,
        nextState.lock_owner,
        nextState.lock_acquired_at,
        nextState.lock_expires_at,
        nextState.lock_reason,
        nextState.lock_action,
        nextState.latest_qa_outcome,
        nextState.latest_qa_run_id,
        nextState.latest_qa_actor_id,
        JSON.stringify(nextState.latest_qa_retest_scope || []),
        nextState.latest_qa_submission_version,
        nextState.latest_qa_routed_stage,
        nextState.blocked,
        nextState.closed,
        nextState.waiting_state,
        nextState.next_required_action,
        nextState.queue_entered_at,
        nextState.wip_owner,
        nextState.wip_started_at,
      ],
    );
    await client.query(
      `INSERT INTO audit_task_relationships(tenant_id, task_id, child_task_ids, escalations, decisions)
       VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)
       ON CONFLICT (tenant_id, task_id) DO UPDATE SET child_task_ids=EXCLUDED.child_task_ids, escalations=EXCLUDED.escalations, decisions=EXCLUDED.decisions`,
      [event.tenant_id, event.task_id, JSON.stringify(nextRelationships.child_task_ids), JSON.stringify(nextRelationships.escalations), JSON.stringify(nextRelationships.decisions)],
    );
  }

  async function processProjectionQueue(limit = 100) {
    assertAuditFoundationEnabled(options);
    const client = await pool.connect();
    let processed = 0;
    let failures = 0;
    try {
      await client.query('BEGIN');
      const rows = await claimQueueRows(client, 'audit_projection_queue', limit);
      for (const row of rows) {
        try {
          const eventResult = await client.query('SELECT * FROM audit_events WHERE event_id = $1', [row.event_id]);
          await applyEventToReadModels(eventResult.rows[0], client);
          processed += 1;
          await client.query("UPDATE audit_projection_queue SET status='processed', updated_at=NOW() WHERE queue_id = $1", [row.queue_id]);
        } catch (error) {
          failures += 1;
          const attempts = row.attempts + 1;
          const nextStatus = attempts >= maxAttempts ? 'dead_letter' : 'pending';
          await client.query(
            'UPDATE audit_projection_queue SET status = $2, attempts = $3, available_at = NOW() + make_interval(secs => $4), last_error = $5, updated_at = NOW() WHERE queue_id = $1',
            [row.queue_id, nextStatus, attempts, Math.min(300, attempts * 15), error.message],
          );
          logger.error({ feature: 'ff_audit_foundation', action: 'projection_apply', outcome: nextStatus, queue_id: row.queue_id, error_message: error.message });
        }
      }
      const metrics = await readMetrics(client);
      metrics.workflow_projection_events_processed_total += processed;
      metrics.workflow_projection_failures_total += failures;
      await writeMetrics(metrics, client);
      await updateDerivedMetrics(client);
      await client.query('COMMIT');
      return { processed, failed: failures };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function processOutbox(publisher, limit = 100) {
    assertAuditFoundationEnabled(options);
    const client = await pool.connect();
    let processed = 0;
    let failures = 0;
    try {
      await client.query('BEGIN');
      const rows = await claimQueueRows(client, 'audit_outbox', limit);
      for (const row of rows) {
        const eventResult = await client.query('SELECT * FROM audit_events WHERE event_id = $1', [row.event_id]);
        const event = eventResult.rows[0];
        try {
          await Promise.resolve(publisher(event));
          processed += 1;
          await client.query("UPDATE audit_outbox SET status='published', published_at=NOW(), updated_at=NOW() WHERE outbox_id = $1", [row.outbox_id]);
        } catch (error) {
          failures += 1;
          const attempts = row.attempts + 1;
          const nextStatus = attempts >= maxAttempts ? 'dead_letter' : 'pending';
          await client.query(
            'UPDATE audit_outbox SET status = $2, attempts = $3, available_at = NOW() + make_interval(secs => $4), last_error = $5, updated_at = NOW() WHERE outbox_id = $1',
            [row.outbox_id, nextStatus, attempts, Math.min(300, attempts * 15), error.message],
          );
          logger.error({ feature: 'ff_audit_foundation', action: 'outbox_publish', outcome: nextStatus, outbox_id: row.outbox_id, error_message: error.message });
        }
      }
      const metrics = await readMetrics(client);
      metrics.workflow_outbox_events_published_total += processed;
      metrics.workflow_outbox_publish_failures_total += failures;
      await writeMetrics(metrics, client);
      await updateDerivedMetrics(client);
      await client.query('COMMIT');
      return { processed, failed: failures };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function rebuildProjections() {
    assertAuditFoundationEnabled(options);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE audit_task_history, audit_task_current_state, audit_task_relationships');
      const events = await client.query('SELECT * FROM audit_events ORDER BY tenant_id, task_id, sequence_number ASC');
      for (const event of events.rows) {
        await applyEventToReadModels(event, client);
      }
      const metrics = await readMetrics(client);
      metrics.workflow_projection_rebuilds_total += 1;
      metrics.last_rebuild_at = new Date().toISOString();
      await writeMetrics(metrics, client);
      await updateDerivedMetrics(client);
      await client.query('COMMIT');
      return { rebuiltEvents: events.rows.length, rebuiltTasks: new Set(events.rows.map(event => `${event.tenant_id}:${event.task_id}`)).size };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    kind: 'postgres',
    pool,
    runMigrations: migrationOptions => runMigrations(pool, { ...migrationOptions, baseDir: options.baseDir }),
    appendEvent,
    getTaskHistory,
    getTaskCurrentState,
    getTaskCurrentStates,
    listTaskSummaries,
    getTaskRelationships,
    getTaskObservabilitySummary,
    processProjectionQueue,
    processOutbox,
    rebuildProjections,
    readMetrics: () => updateDerivedMetrics(),
  };
}

module.exports = {
  createPgPoolFromEnv,
  runMigrations,
  createPostgresAuditStore,
};
