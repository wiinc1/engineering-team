const { evaluateAutonomyExpansion } = require('./control-plane');
const {
  METRICS_POLICY_VERSION,
  METRICS_PROJECTION_SCHEMA_VERSION,
  normalizeFilters,
} = require('./autonomous-delivery-metrics-shared');

function signalMatchesFilters(signal, filters = {}) {
  if (filters.tenantId && signal.tenant_id !== filters.tenantId) return false;
  if (filters.taskClass && signal.task_class !== filters.taskClass) return false;
  if (filters.tier && signal.template_tier !== filters.tier) return false;
  if (filters.agent && signal.implementation_agent !== filters.agent) return false;
  const basis = signal.final_outcome?.closed_at || signal.generated_at;
  if (filters.dateFrom && basis && basis < filters.dateFrom) return false;
  if (filters.dateTo && basis && basis > filters.dateTo) return false;
  return true;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function emptyBreakdown(key) {
  return { key, total: 0, included: 0, autonomous: 0, intervention_count: 0, rework_count: 0, unknown: 0 };
}

function addToBreakdown(map, key, signal, included) {
  const normalizedKey = key || 'unknown';
  const row = map.get(normalizedKey) || emptyBreakdown(normalizedKey);
  row.total += 1;
  if (!included) row.unknown += 1;
  if (included) {
    row.included += 1;
    row.intervention_count += signal.operator_interventions?.count || 0;
    row.rework_count += signal.qa_sre_rework?.rework_count || 0;
    if (isAutonomousDelivery(signal)) row.autonomous += 1;
  }
  map.set(normalizedKey, row);
}

function finalizeBreakdown(map) {
  return [...map.values()].map(row => ({
    ...row,
    autonomous_delivery_rate: ratio(row.autonomous, row.included),
    operator_intervention_rate: ratio(row.intervention_count, row.included),
    rework_rate: ratio(row.rework_count, row.included),
  })).sort((left, right) => right.included - left.included || left.key.localeCompare(right.key));
}

function isAutonomousDelivery(signal = {}) {
  return signal.final_outcome?.closed === true &&
    !signal.excluded_from_thresholds &&
    (signal.operator_interventions?.count || 0) === 0 &&
    (signal.qa_sre_rework?.rework_count || 0) === 0 &&
    !signal.rollback?.recorded &&
    (signal.escaped_defects?.count || 0) === 0;
}

function buildSummary({ matching, thresholdSignals, known, autonomous }) {
  const qaSreReworkCount = sumMetric(thresholdSignals, signal => signal.qa_sre_rework?.rework_count || 0);
  const operatorInterventionCount = sumMetric(thresholdSignals, signal => signal.operator_interventions?.count || 0);
  const rollbackCount = thresholdSignals.filter(signal => signal.rollback?.recorded).length;
  const escapedDefectCount = sumMetric(thresholdSignals, signal => signal.escaped_defects?.count || 0);
  const policyAutoApprovedCount = thresholdSignals.filter(signal => signal.approval_mode === 'policy_auto_approved').length;
  return {
    total_signals: matching.length,
    included_signals: thresholdSignals.length,
    known_signals: known.length,
    unknown_signals: matching.length - known.length,
    closed_signals: thresholdSignals.filter(signal => signal.final_outcome?.closed).length,
    autonomous_deliveries: autonomous.length,
    autonomous_delivery_rate: ratio(autonomous.length, thresholdSignals.length),
    operator_interventions_total: operatorInterventionCount,
    operator_intervention_rate: ratio(operatorInterventionCount, thresholdSignals.length),
    qa_sre_rework_total: qaSreReworkCount,
    qa_sre_rework_rate: ratio(qaSreReworkCount, thresholdSignals.length),
    rollback_total: rollbackCount,
    rollback_rate: ratio(rollbackCount, thresholdSignals.length),
    escaped_defects_total: escapedDefectCount,
    escaped_defect_rate: ratio(escapedDefectCount, thresholdSignals.length),
    policy_auto_approved_total: policyAutoApprovedCount,
    policy_auto_approval_rate: ratio(policyAutoApprovedCount, thresholdSignals.length),
  };
}

function sumMetric(signals, selector) {
  return signals.reduce((total, signal) => total + selector(signal), 0);
}

function buildBreakdowns(matching, filters) {
  const byTaskClass = new Map();
  const byTier = new Map();
  const byAgent = new Map();
  for (const signal of matching) {
    const included = (filters.includeUnknown || !signal.excluded_from_thresholds) && !signal.excluded_from_thresholds;
    addToBreakdown(byTaskClass, signal.task_class, signal, included);
    addToBreakdown(byTier, signal.template_tier, signal, included);
    addToBreakdown(byAgent, signal.implementation_agent, signal, included);
  }
  return {
    by_task_class: finalizeBreakdown(byTaskClass),
    by_template_tier: finalizeBreakdown(byTier),
    by_implementation_agent: finalizeBreakdown(byAgent),
  };
}

function buildThresholdEvaluations(thresholdSignals) {
  const taskClasses = [...new Set(thresholdSignals.map(signal => signal.task_class).filter(Boolean))];
  return taskClasses.map(taskClass => ({
    task_class: taskClass,
    evaluation: evaluateAutonomyExpansion({
      taskClass,
      retrospectiveSignals: thresholdSignals.filter(signal => signal.task_class === taskClass),
    }),
  }));
}

function aggregateAutonomousDeliveryMetrics(signals = [], rawFilters = {}) {
  const filters = normalizeFilters(rawFilters);
  const matching = signals.filter(signal => signalMatchesFilters(signal, filters));
  const included = matching.filter(signal => filters.includeUnknown || !signal.excluded_from_thresholds);
  const known = matching.filter(signal => !signal.excluded_from_thresholds);
  const thresholdSignals = filters.includeUnknown ? included.filter(signal => !signal.excluded_from_thresholds) : included;
  const autonomous = thresholdSignals.filter(isAutonomousDelivery);
  return {
    schema_version: METRICS_PROJECTION_SCHEMA_VERSION,
    policy_version: METRICS_POLICY_VERSION,
    generated_at: new Date().toISOString(),
    filters,
    summary: buildSummary({ matching, thresholdSignals, known, autonomous }),
    breakdowns: buildBreakdowns(matching, filters),
    threshold_evaluations: buildThresholdEvaluations(thresholdSignals),
    signals: included,
    excluded_signals: filters.includeUnknown ? [] : matching.filter(signal => signal.excluded_from_thresholds),
  };
}

module.exports = {
  aggregateAutonomousDeliveryMetrics,
  isAutonomousDelivery,
};
