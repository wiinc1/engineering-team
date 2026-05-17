const fs = require('fs');
const path = require('path');
const {
  normalizeFilters,
  stableId,
} = require('./autonomous-delivery-metrics-shared');
const {
  buildRetrospectiveSignal,
} = require('./autonomous-delivery-metrics-signals');
const {
  aggregateAutonomousDeliveryMetrics,
} = require('./autonomous-delivery-metrics-aggregate');

function projectionFilePath(store, options = {}) {
  if (options.projectionFile) return options.projectionFile;
  const metricsPath = store?.files?.metrics;
  if (!metricsPath) return null;
  return path.join(path.dirname(metricsPath), 'autonomous-delivery-metrics-projection.json');
}

function readProjectionFile(store, options = {}) {
  const filePath = projectionFilePath(store, options);
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeProjectionFile(store, projection, options = {}) {
  const filePath = projectionFilePath(store, options);
  if (!filePath) return null;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(projection, null, 2)}\n`);
  return filePath;
}

function signalInsertValues(signal) {
  return [
    signal.tenant_id,
    signal.task_id,
    signal.signal_id,
    signal.schema_version,
    signal.policy_version,
    signal.generated_at,
    signal.task_class,
    signal.template_tier,
    signal.implementation_agent,
    signal.approval_mode,
    signal.final_outcome?.status || null,
    signal.classification_status,
    signal.excluded_from_thresholds,
    signal.operator_interventions?.count || 0,
    signal.qa_sre_rework?.rework_count || 0,
    !!signal.rollback?.recorded,
    signal.escaped_defects?.count || 0,
    JSON.stringify(signal),
  ];
}

async function persistSignalRows(pool, signals = []) {
  const sql = `INSERT INTO autonomous_delivery_retrospective_signals(
    tenant_id, task_id, signal_id, schema_version, policy_version, generated_at,
    task_class, template_tier, implementation_agent, approval_mode, final_outcome_status,
    classification_status, excluded_from_thresholds, operator_intervention_count,
    qa_sre_rework_count, rollback_recorded, escaped_defect_count, payload
  ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
  ON CONFLICT (tenant_id, task_id, signal_id) DO UPDATE SET
    generated_at = EXCLUDED.generated_at,
    classification_status = EXCLUDED.classification_status,
    excluded_from_thresholds = EXCLUDED.excluded_from_thresholds,
    operator_intervention_count = EXCLUDED.operator_intervention_count,
    qa_sre_rework_count = EXCLUDED.qa_sre_rework_count,
    rollback_recorded = EXCLUDED.rollback_recorded,
    escaped_defect_count = EXCLUDED.escaped_defect_count,
    payload = EXCLUDED.payload`;
  for (const signal of signals) {
    await pool.query(sql, signalInsertValues(signal));
  }
}

function snapshotValues(projection) {
  return [
    projection.rebuild_id || `adms-${stableId(projection.generated_at, JSON.stringify(projection.filters))}`,
    projection.filters?.tenantId || 'all',
    projection.schema_version,
    projection.policy_version,
    projection.generated_at,
    JSON.stringify(projection.filters || {}),
    JSON.stringify(projection.summary || {}),
    JSON.stringify(projection.breakdowns || {}),
    JSON.stringify(projection.threshold_evaluations || []),
  ];
}

async function persistSnapshot(pool, projection) {
  await pool.query(
    `INSERT INTO autonomous_delivery_metric_snapshots(
      snapshot_id, tenant_id, schema_version, policy_version, generated_at, filters, summary, breakdowns, threshold_evaluations
    ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb)
    ON CONFLICT (snapshot_id) DO NOTHING`,
    snapshotValues(projection),
  );
}

async function persistPostgresProjection(store, projection) {
  const pool = store?.pool;
  if (!pool || typeof pool.query !== 'function') return { persisted: false, backend: store?.kind || 'unknown' };
  await persistSignalRows(pool, projection.signals || []);
  await persistSnapshot(pool, projection);
  return { persisted: true, backend: 'postgres' };
}

async function updateRuntimeMetrics(store, aggregate) {
  if (!store || typeof store.updateMetrics !== 'function') return;
  await store.updateMetrics(metrics => {
    const policyBlocks = (aggregate.threshold_evaluations || [])
      .filter(row => row.evaluation?.can_expand === false || (row.evaluation?.blockers || []).length > 0)
      .length;
    metrics.feature_autonomous_delivery_signals_total = aggregate.summary.total_signals;
    metrics.feature_autonomous_delivery_known_signals_total = aggregate.summary.known_signals;
    metrics.feature_autonomous_delivery_unknown_signals_total = aggregate.summary.unknown_signals;
    metrics.feature_autonomous_delivery_rate = aggregate.summary.autonomous_delivery_rate;
    metrics.feature_operator_interventions_total = aggregate.summary.operator_interventions_total;
    metrics.feature_autonomous_delivery_rework_total = aggregate.summary.qa_sre_rework_total;
    metrics.feature_autonomous_delivery_rollback_total = aggregate.summary.rollback_total;
    metrics.feature_autonomous_delivery_escaped_defects_total = aggregate.summary.escaped_defects_total;
    metrics.feature_autonomy_policy_blocks_total = policyBlocks;
    metrics.feature_autonomous_delivery_rebuilds_total = Number(metrics.feature_autonomous_delivery_rebuilds_total || 0) + 1;
    metrics.feature_autonomous_delivery_last_rebuild_at = aggregate.generated_at;
  });
}

async function collectRetrospectiveSignalsFromStore({ store, tenantId = null, generatedAt = new Date().toISOString(), includeOpen = false } = {}) {
  if (!store || typeof store.listTaskSummaries !== 'function' || typeof store.getTaskHistory !== 'function') {
    return [];
  }
  const summaries = await Promise.resolve(store.listTaskSummaries({ tenantId }));
  const candidates = includeOpen ? summaries : summaries.filter(summary => summary.closed || String(summary.current_stage || '').toUpperCase() === 'DONE');
  const signals = [];
  for (const summary of candidates) {
    signals.push(await signalFromSummary(store, summary, tenantId, generatedAt));
  }
  return signals;
}

async function signalFromSummary(store, summary, tenantId, generatedAt) {
  const taskId = summary.task_id;
  const effectiveTenantId = summary.tenant_id || tenantId || 'engineering-team';
  const [state, history] = await Promise.all([
    typeof store.getTaskCurrentState === 'function' ? Promise.resolve(store.getTaskCurrentState(taskId, { tenantId: effectiveTenantId })) : Promise.resolve(summary),
    Promise.resolve(store.getTaskHistory(taskId, { tenantId: effectiveTenantId, limit: 1000 })),
  ]);
  return buildRetrospectiveSignal({ taskId, tenantId: effectiveTenantId, state: state || summary, history, generatedAt });
}

function rebuildFingerprint({ tenantId, filters, signals }) {
  return stableId(
    tenantId || 'all',
    JSON.stringify(normalizeFilters({ ...filters, tenantId: tenantId || filters.tenantId })),
    signals.map(signal => signal.signal_id).sort().join(','),
  );
}

async function rebuildAutonomousDeliveryMetrics({ store, tenantId = null, filters = {}, generatedAt = new Date().toISOString(), includeOpen = false, persist = true } = {}) {
  const signals = await collectRetrospectiveSignalsFromStore({ store, tenantId, generatedAt, includeOpen });
  const aggregate = aggregateAutonomousDeliveryMetrics(signals, { ...filters, tenantId: tenantId || filters.tenantId });
  const projection = {
    ...aggregate,
    generated_at: generatedAt,
    rebuild_id: `adrb-${rebuildFingerprint({ tenantId, filters, signals })}`,
    source: { backend: store?.kind || 'unknown', task_count: signals.length },
  };
  const persistence = persist ? await persistProjection(store, projection) : { persisted: false, backend: store?.kind || 'unknown' };
  await updateRuntimeMetrics(store, projection);
  return { projection, persistence };
}

async function persistProjection(store, projection) {
  if (store?.kind === 'postgres') return persistPostgresProjection(store, projection);
  const filePath = writeProjectionFile(store, projection);
  return { persisted: !!filePath, backend: store?.kind || 'unknown', path: filePath || null };
}

async function readAutonomousDeliveryMetrics({ store, tenantId = null, filters = {}, includeOpen = false } = {}) {
  const cached = readProjectionFile(store);
  const normalizedFilters = normalizeFilters({ ...filters, tenantId: tenantId || filters.tenantId });
  if (cached?.signals?.length) {
    return {
      ...aggregateAutonomousDeliveryMetrics(cached.signals, normalizedFilters),
      generated_at: cached.generated_at,
      source: { backend: store?.kind || 'unknown', cached: true },
    };
  }
  const generatedAt = new Date().toISOString();
  const signals = await collectRetrospectiveSignalsFromStore({ store, tenantId, generatedAt, includeOpen });
  return {
    ...aggregateAutonomousDeliveryMetrics(signals, normalizedFilters),
    generated_at: generatedAt,
    source: { backend: store?.kind || 'unknown', cached: false },
  };
}

module.exports = {
  collectRetrospectiveSignalsFromStore,
  readAutonomousDeliveryMetrics,
  rebuildAutonomousDeliveryMetrics,
};
