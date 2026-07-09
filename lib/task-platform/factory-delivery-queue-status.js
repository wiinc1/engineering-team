const { createPgPoolFromEnv } = require('../audit/postgres');
const {
  TERMINAL_QUEUE_STAGES,
  normalizeFactoryQueueRow,
  resolveFactoryQueueConnectionString,
} = require('./factory-delivery-queue-postgres');
const { hasFactoryItemRealDeliveryIntent, itemRealDelivery } = require('./factory-delivery-shared');
const { defaultFactoryCandidateProofPath } = require('./factory-phase-runner-options');
const { factoryCompletionFinalEvidencePath } = require('./factory-real-delivery-completion');
const { factoryRealDeliveryPreflightSummary } = require('./factory-delivery-submit-preflight');

const FACTORY_QUEUE_STATUS_SCHEMA_VERSION = 'factory-queue-status.v1';
const FACTORY_QUEUE_STAGES = Object.freeze([
  'queued',
  'intake_complete',
  'phase1_complete',
  'phase6_complete',
  'completed',
  'dead_letter',
]);

function createFactoryQueueStatusError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function positiveInteger(value, fallback, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeStageFilter(stage) {
  if (stage == null || stage === '') return null;
  const normalized = String(stage).trim();
  if (!FACTORY_QUEUE_STAGES.includes(normalized)) {
    throw createFactoryQueueStatusError(400, 'invalid_factory_queue_stage', 'Factory queue stage filter is invalid.', {
      stage: normalized,
      allowedStages: FACTORY_QUEUE_STAGES,
    });
  }
  return normalized;
}

function timestampMs(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function summarizeFactoryQueueRow(row = {}) {
  return {
    total: normalizeCount(row.total_count),
    pending: normalizeCount(row.pending_count),
    leased: normalizeCount(row.leased_count),
    expiredLeases: normalizeCount(row.expired_lease_count),
    retrying: normalizeCount(row.retrying_count),
    completed: normalizeCount(row.completed_count),
    deadLetter: normalizeCount(row.dead_letter_count),
    byStage: {
      queued: normalizeCount(row.queued_count),
      intake_complete: normalizeCount(row.intake_complete_count),
      phase1_complete: normalizeCount(row.phase1_complete_count),
      phase6_complete: normalizeCount(row.phase6_complete_count),
      completed: normalizeCount(row.completed_count),
      dead_letter: normalizeCount(row.dead_letter_count),
    },
  };
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function realDeliveryProofStatus(item = {}, config = {}) {
  const realDelivery = itemRealDelivery(item);
  const keys = Object.keys(realDelivery);
  const requested = keys.length > 0 || hasFactoryItemRealDeliveryIntent(item);
  if (!requested) return null;
  const releaseArtifactCommands = realDelivery.releaseArtifactCommands || {};
  return {
    requested: true,
    repository: realDelivery.ciRepository || realDelivery.repository || null,
    branchName: realDelivery.branchName || realDelivery.branch || null,
    commitSha: realDelivery.implementationCommitSha || realDelivery.commitSha || null,
    prUrl: realDelivery.prUrl || realDelivery.pullRequestUrl || null,
    prNumber: realDelivery.prNumber || realDelivery.pullRequestNumber || null,
    autoMerge: realDelivery.autoMerge === true,
    releaseEnv: realDelivery.releaseEnv || null,
    deploymentUrl: realDelivery.deploymentUrl || realDelivery.productionUrl || null,
    candidateProofPath: realDelivery.candidateProofPath
      || realDelivery.realDeliveryCandidateProofPath
      || defaultFactoryCandidateProofPath(config, item),
    finalEvidencePath: realDelivery.finalEvidencePath
      || realDelivery.realAutonomousDeliveryEvidencePath
      || realDelivery.realDeliveryFinalEvidencePath
      || factoryCompletionFinalEvidencePath(config, item),
    rollbackTarget: realDelivery.rollbackTarget || null,
    rollbackVerified: realDelivery.rollbackVerified === true,
    rollbackEvidenceProvided: Boolean(realDelivery.rollbackEvidence || realDelivery.rollbackEvidencePath),
    riskLevel: realDelivery.riskLevel || null,
    productionSafe: realDelivery.productionSafe === true,
    productionSafetyEvidenceProvided: Boolean(
      realDelivery.productionSafetyEvidence || realDelivery.productionSafetyEvidencePath,
    ),
    healthCheckPath: realDelivery.healthCheckPath || null,
    requireHealthCommit: realDelivery.requireHealthCommit === true,
    releaseArtifactDir: realDelivery.releaseArtifactDir || null,
    useExistingReleaseArtifacts: realDelivery.useExistingReleaseArtifacts === true,
    releaseArtifactCommandsCount: Object.values(releaseArtifactCommands).filter(Boolean).length,
    checksCount: countArray(realDelivery.checks),
    requiredChecksCount: countArray(realDelivery.requiredChecks || realDelivery.required_checks),
    branchProtectionProvided: Boolean(realDelivery.branchProtection || realDelivery.branch_protection),
    branchProtectionSource: (realDelivery.branchProtection || realDelivery.branch_protection || {}).source || null,
    mergeReadinessProvided: Boolean(realDelivery.mergeReadiness || realDelivery.merge_readiness),
    testCommandsCount: countArray(realDelivery.testCommands),
    preflight: factoryRealDeliveryPreflightSummary(item, config, item.stage || 'queued'),
  };
}

function normalizeFactoryQueueStatusItem(item, nowMs = Date.now(), config = {}) {
  const availableAtMs = timestampMs(item.availableAt);
  const leaseExpiresAtMs = timestampMs(item.leaseExpiresAt);
  const locked = Boolean(item.lockedBy);
  const leaseActive = locked && leaseExpiresAtMs != null && leaseExpiresAtMs > nowMs;
  const leaseExpired = locked && leaseExpiresAtMs != null && leaseExpiresAtMs <= nowMs;
  const retrying = !TERMINAL_QUEUE_STAGES.includes(item.stage)
    && Boolean(item.lastError)
    && availableAtMs != null
    && availableAtMs > nowMs;
  return {
    id: item.id,
    title: item.title,
    stage: item.stage,
    taskId: item.taskId,
    projectId: item.projectId,
    projectName: item.projectName,
    evidencePath: item.evidencePath,
    realDelivery: realDeliveryProofStatus(item, config),
    forgeTaskId: item.forgeTaskId,
    evidenceStatus: item.evidenceStatus,
    lastAction: item.lastAction,
    lastError: item.lastError,
    attempts: item.attempts,
    maxAttempts: item.maxAttempts,
    availableAt: item.availableAt,
    lockedAt: item.lockedAt,
    lockedBy: item.lockedBy,
    leaseExpiresAt: item.leaseExpiresAt,
    deadLetteredAt: item.deadLetteredAt,
    completedAt: item.completedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    leaseActive,
    leaseExpired,
    retrying,
    terminal: TERMINAL_QUEUE_STAGES.includes(item.stage),
  };
}

function buildFactoryQueueStatus({ tenantId, stage, limit, summaryRow, rows, nowMs, config }) {
  return {
    schemaVersion: FACTORY_QUEUE_STATUS_SCHEMA_VERSION,
    queueBackend: 'postgres',
    queueTable: 'factory_delivery_queue',
    tenantId,
    generatedAt: new Date(nowMs).toISOString(),
    filter: { stage, limit },
    summary: summarizeFactoryQueueRow(summaryRow || {}),
    items: rows
      .map(normalizeFactoryQueueRow)
      .map((item) => normalizeFactoryQueueStatusItem(item, nowMs, config)),
  };
}

async function queryFactoryQueueSummary(pool, tenantId) {
  return pool.query(`
    SELECT
      COUNT(*)::integer AS total_count,
      COUNT(*) FILTER (WHERE stage <> ALL($2::text[]))::integer AS pending_count,
      COUNT(*) FILTER (WHERE stage = 'queued')::integer AS queued_count,
      COUNT(*) FILTER (WHERE stage = 'intake_complete')::integer AS intake_complete_count,
      COUNT(*) FILTER (WHERE stage = 'phase1_complete')::integer AS phase1_complete_count,
      COUNT(*) FILTER (WHERE stage = 'phase6_complete')::integer AS phase6_complete_count,
      COUNT(*) FILTER (WHERE stage = 'completed')::integer AS completed_count,
      COUNT(*) FILTER (WHERE stage = 'dead_letter')::integer AS dead_letter_count,
      COUNT(*) FILTER (WHERE locked_by IS NOT NULL AND lease_expires_at > NOW())::integer AS leased_count,
      COUNT(*) FILTER (WHERE locked_by IS NOT NULL AND lease_expires_at <= NOW())::integer AS expired_lease_count,
      COUNT(*) FILTER (
        WHERE last_error IS NOT NULL
          AND stage <> ALL($2::text[])
          AND available_at > NOW()
      )::integer AS retrying_count
    FROM factory_delivery_queue
    WHERE tenant_id = $1
  `, [tenantId, TERMINAL_QUEUE_STAGES]);
}

async function queryFactoryQueueItems(pool, tenantId, stage, limit) {
  return pool.query(`
    SELECT *
    FROM factory_delivery_queue
    WHERE tenant_id = $1
      AND ($2::text IS NULL OR stage = $2)
    ORDER BY
      CASE
        WHEN stage = 'dead_letter' THEN 0
        WHEN locked_by IS NOT NULL THEN 1
        WHEN last_error IS NOT NULL THEN 2
        ELSE 3
      END,
      updated_at DESC,
      created_at DESC,
      queue_id ASC
    LIMIT $3
  `, [tenantId, stage, limit]);
}

async function queryFactoryQueueStatus(pool, options = {}) {
  const tenantId = options.tenantId;
  if (!tenantId) {
    throw createFactoryQueueStatusError(400, 'missing_tenant_id', 'Factory queue status requires a tenant id.');
  }
  const stage = normalizeStageFilter(options.stage);
  const limit = positiveInteger(options.limit, 25);
  const [summaryResult, itemsResult] = await Promise.all([
    queryFactoryQueueSummary(pool, tenantId),
    queryFactoryQueueItems(pool, tenantId, stage, limit),
  ]);
  const nowMs = Date.now();
  return buildFactoryQueueStatus({
    tenantId,
    stage,
    limit,
    summaryRow: summaryResult.rows[0],
    rows: itemsResult.rows,
    nowMs,
    config: options,
  });
}

async function readPostgresFactoryQueueStatus(options = {}) {
  const pool = options.pool || createPgPoolFromEnv(resolveFactoryQueueConnectionString(options));
  const ownsPool = !options.pool;
  try {
    return await queryFactoryQueueStatus(pool, options);
  } finally {
    if (ownsPool && typeof pool.end === 'function') await pool.end();
  }
}

module.exports = {
  FACTORY_QUEUE_STATUS_SCHEMA_VERSION,
  FACTORY_QUEUE_STAGES,
  normalizeFactoryQueueStatusItem,
  queryFactoryQueueStatus,
  realDeliveryProofStatus,
  readPostgresFactoryQueueStatus,
  summarizeFactoryQueueRow,
};
