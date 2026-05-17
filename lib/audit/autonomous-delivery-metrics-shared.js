const crypto = require('crypto');

const RETROSPECTIVE_SIGNAL_SCHEMA_VERSION = 'delivery-retrospective-signal.v1';
const METRICS_PROJECTION_SCHEMA_VERSION = 'autonomous-delivery-metrics-mvp.v1';
const OPERATOR_INTERVENTION_TAXONOMY_VERSION = 'operator-intervention-taxonomy.v1';
const METRICS_POLICY_VERSION = 'autonomous-delivery-metrics-policy.v1';

function sortHistory(history = []) {
  return [...history].sort((left, right) => {
    const sequenceDelta = Number(left?.sequence_number || 0) - Number(right?.sequence_number || 0);
    if (sequenceDelta) return sequenceDelta;
    return String(left?.occurred_at || '').localeCompare(String(right?.occurred_at || ''));
  });
}

function stableId(...parts) {
  return crypto
    .createHash('sha256')
    .update(parts.map(part => String(part ?? '')).join('|'))
    .digest('hex')
    .slice(0, 16);
}

function normalizeDate(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeFilters(filters = {}) {
  const truthy = ['1', 'true', 'yes', 'on'];
  return {
    tenantId: String(filters.tenantId || filters.tenant_id || '').trim() || null,
    dateFrom: normalizeDate(filters.dateFrom || filters.date_from || filters.from),
    dateTo: normalizeDate(filters.dateTo || filters.date_to || filters.to),
    taskClass: String(filters.taskClass || filters.task_class || '').trim() || null,
    tier: String(filters.tier || filters.templateTier || filters.template_tier || '').trim() || null,
    agent: String(filters.agent || filters.implementationAgent || filters.implementation_agent || '').trim() || null,
    includeUnknown: filters.includeUnknown === true ||
      truthy.includes(String(filters.includeUnknown || filters.include_unknown || '').toLowerCase()),
  };
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function includesAny(value, needles = []) {
  const normalized = lower(value);
  return needles.some(needle => normalized.includes(needle));
}

function actorLooksOperator(event = {}) {
  const actorType = lower(event.actor_type);
  const actorId = lower(event.actor_id);
  return ['operator', 'human', 'user', 'admin'].includes(actorType) ||
    includesAny(actorId, ['operator', 'human', 'pm-', 'admin']);
}

function findLatest(history, eventType) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.event_type === eventType) return history[index];
  }
  return null;
}

function firstOccurredAt(history, eventType) {
  return history.find(event => event?.event_type === eventType)?.occurred_at || null;
}

function afterApproval(event = {}, approvalOccurredAt = null) {
  if (!approvalOccurredAt) return false;
  const eventTime = Date.parse(event.occurred_at || '');
  const approvalTime = Date.parse(approvalOccurredAt);
  return Number.isFinite(eventTime) && Number.isFinite(approvalTime) && eventTime >= approvalTime;
}

module.exports = {
  METRICS_POLICY_VERSION,
  METRICS_PROJECTION_SCHEMA_VERSION,
  OPERATOR_INTERVENTION_TAXONOMY_VERSION,
  RETROSPECTIVE_SIGNAL_SCHEMA_VERSION,
  actorLooksOperator,
  afterApproval,
  findLatest,
  firstOccurredAt,
  includesAny,
  lower,
  normalizeFilters,
  normalizeNumber,
  sortHistory,
  stableId,
};
