const crypto = require('node:crypto');
const {
  DEFAULT_DELIVERY_DIR,
  normalizeRequirement,
  evidencePathForItem,
  makeForgeTaskId,
} = require('./factory-delivery-shared');

const POSTGRES_QUEUE_STAGES = new Set([
  'queued',
  'intake_complete',
  'phase1_complete',
  'phase6_complete',
  'completed',
  'dead_letter',
]);
const RECOVERABLE_QUEUE_STAGES = new Set(['queued', 'intake_complete', 'phase1_complete', 'phase6_complete']);
const DEFAULT_QUEUE_MAX_ATTEMPTS = 5;

const FACTORY_QUEUE_IMPORT_SQL = `
  INSERT INTO factory_delivery_queue (
    tenant_id, queue_id, idempotency_key, title, requirements, template_tier,
    change_kind, changed_files, github_issue_url, stage, task_id, project_id, project_name,
    evidence_path, persist_dir, forge_task_id, evidence_status, last_action, last_error,
    attempts, max_attempts, available_at, dead_lettered_at, completed_at, metadata, created_at, updated_at
  )
  VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8::jsonb, $9, $10, $11, $12, $13,
    $14, $15, $16, $17, $18, $19,
    $20, $21, COALESCE($22::timestamptz, NOW()), $23::timestamptz, $24::timestamptz,
    $25::jsonb, COALESCE($26::timestamptz, NOW()), COALESCE($27::timestamptz, NOW())
  )
  ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
  SET queue_id = EXCLUDED.queue_id,
      title = EXCLUDED.title,
      requirements = EXCLUDED.requirements,
      template_tier = EXCLUDED.template_tier,
      change_kind = EXCLUDED.change_kind,
      changed_files = EXCLUDED.changed_files,
      github_issue_url = EXCLUDED.github_issue_url,
      stage = EXCLUDED.stage,
      task_id = EXCLUDED.task_id,
      project_id = EXCLUDED.project_id,
      project_name = EXCLUDED.project_name,
      evidence_path = EXCLUDED.evidence_path,
      persist_dir = EXCLUDED.persist_dir,
      forge_task_id = EXCLUDED.forge_task_id,
      evidence_status = EXCLUDED.evidence_status,
      last_action = EXCLUDED.last_action,
      last_error = EXCLUDED.last_error,
      attempts = EXCLUDED.attempts,
      max_attempts = EXCLUDED.max_attempts,
      available_at = EXCLUDED.available_at,
      dead_lettered_at = EXCLUDED.dead_lettered_at,
      completed_at = EXCLUDED.completed_at,
      metadata = factory_delivery_queue.metadata || EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at
  RETURNING *
`;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonEmptyText(value) { const text = String(value || '').trim(); return text || null; }

function buildIdempotencyKey(requirement, normalized) {
  const explicitKey = nonEmptyText(requirement.idempotencyKey) || nonEmptyText(requirement.id);
  if (explicitKey) return explicitKey;
  return crypto
    .createHash('sha256')
    .update([
      normalized.title,
      normalized.requirements,
      normalized.templateTier,
      normalized.changeKind || '',
      JSON.stringify(normalized.changedFiles || []),
      normalized.githubIssueUrl || '',
      JSON.stringify(normalized.metadata || {}),
    ].join('\n'))
    .digest('hex');
}

function normalizePostgresQueueStage(item = {}) {
  const stage = String(item.stage || 'queued');
  if (stage === 'failed') return 'dead_letter';
  if (POSTGRES_QUEUE_STAGES.has(stage)) return stage;
  throw new Error(`Unsupported factory queue stage "${stage}" for postgres import`);
}

function queueImportTiming(item, stage) {
  const updatedAt = item.updatedAt ? String(item.updatedAt) : null;
  const createdAt = item.createdAt ? String(item.createdAt) : updatedAt;
  return {
    availableAt: item.availableAt ? String(item.availableAt) : updatedAt || createdAt,
    createdAt,
    updatedAt,
    deadLetteredAt: stage === 'dead_letter'
      ? (item.deadLetteredAt ? String(item.deadLetteredAt) : updatedAt)
      : (item.deadLetteredAt ? String(item.deadLetteredAt) : null),
    completedAt: stage === 'completed'
      ? (item.completedAt ? String(item.completedAt) : updatedAt)
      : null,
  };
}

function queueImportPaths(item, normalized, deliveryDir) {
  return {
    evidencePath: item.evidencePath || evidencePathForItem({ id: normalized.id }, deliveryDir),
    forgeTaskId: item.forgeTaskId || makeForgeTaskId(normalized.id),
  };
}

function failedStageForDeadLetterImport(item = {}, metadata = {}) {
  const existing = metadata.deadLetter?.failedStage;
  if (RECOVERABLE_QUEUE_STAGES.has(existing)) return existing;
  if (RECOVERABLE_QUEUE_STAGES.has(item.stage)) return item.stage;
  const evidenceStatus = String(item.evidenceStatus || '').trim();
  if (evidenceStatus === 'phase6_complete') return 'phase6_complete';
  if (evidenceStatus === 'phase1_complete' || /^phase[2-6]_/.test(evidenceStatus)) {
    return 'phase1_complete';
  }
  if (item.taskId && item.projectId) return 'intake_complete';
  return 'queued';
}

function queueImportMetadata(normalized = {}, item = {}, stage = 'queued', attempts = 0) {
  const metadata = { ...(normalized.metadata || {}) };
  if (metadata.realDelivery && Object.keys(metadata.realDelivery).length === 0) {
    delete metadata.realDelivery;
  }
  if (stage === 'dead_letter') {
    metadata.deadLetter = {
      ...(metadata.deadLetter || {}),
      failedStage: failedStageForDeadLetterImport(item, metadata),
      failedAction: metadata.deadLetter?.failedAction || item.lastAction || 'legacy_queue_import',
      failureAttempts: Number(metadata.deadLetter?.failureAttempts || attempts || 1),
    };
  }
  return metadata;
}

function buildFactoryQueueImport(item, index, config = {}) {
  const normalized = normalizeRequirement(item, index);
  const stage = normalizePostgresQueueStage(item);
  const timing = queueImportTiming(item, stage);
  const paths = queueImportPaths(item, normalized, config.deliveryDir || DEFAULT_DELIVERY_DIR);
  const attempts = positiveInteger(item.attempts, stage === 'dead_letter' && item.lastError ? 1 : 0);
  const metadata = queueImportMetadata(normalized, item, stage, attempts);
  return {
    item: { ...item, ...normalized, stage, ...paths, attempts },
    params: [
      config.tenantId, normalized.id, buildIdempotencyKey(item, normalized),
      normalized.title, normalized.requirements, normalized.templateTier,
      normalized.changeKind, JSON.stringify(normalized.changedFiles || []),
      normalized.githubIssueUrl, stage, item.taskId || null, item.projectId || null,
      item.projectName || null, paths.evidencePath, item.persistDir || null, paths.forgeTaskId,
      item.evidenceStatus || null, item.lastAction || null, item.lastError || null,
      attempts, positiveInteger(item.maxAttempts || config.factoryQueueMaxAttempts, DEFAULT_QUEUE_MAX_ATTEMPTS),
      timing.availableAt, timing.deadLetteredAt, timing.completedAt, JSON.stringify(metadata),
      timing.createdAt, timing.updatedAt,
    ],
  };
}

module.exports = {
  FACTORY_QUEUE_IMPORT_SQL,
  buildFactoryQueueImport,
  queueImportMetadata,
};
