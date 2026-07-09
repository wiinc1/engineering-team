const crypto = require('node:crypto');
const { createPgPoolFromEnv } = require('../audit/postgres');
const { FACTORY_QUEUE_IMPORT_SQL, buildFactoryQueueImport } = require('./factory-delivery-queue-import');
const { recoverExpiredFactoryQueueLeases } = require('./factory-delivery-queue-recovery');
const { DEFAULT_DELIVERY_DIR, normalizeRequirement, evidencePathForItem, makeForgeTaskId } = require('./factory-delivery-shared');
const {
  RECOVERABLE_QUEUE_STAGES,
  DEFAULT_QUEUE_RETRY_BASE_SECONDS,
  DEFAULT_QUEUE_MAX_ATTEMPTS,
  releaseParamsForOutcome,
} = require('./factory-delivery-queue-release');
const {
  requiresFactoryFinalProof,
  verifyFactoryRealDeliveryCompletion,
} = require('./factory-real-delivery-completion');

const TERMINAL_QUEUE_STAGES = Object.freeze(['completed', 'dead_letter']);
const DEFAULT_QUEUE_LEASE_SECONDS = 15 * 60;

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

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

function normalizeFactoryQueueRow(row = {}) {
  const item = {
    id: row.queue_id,
    idempotencyKey: row.idempotency_key,
    tenantId: row.tenant_id,
    title: row.title,
    requirements: row.requirements,
    templateTier: row.template_tier,
    changeKind: row.change_kind || null,
    changedFiles: parseJson(row.changed_files, []),
    githubIssueUrl: row.github_issue_url || null,
    stage: row.stage,
    taskId: row.task_id || null,
    projectId: row.project_id || null,
    projectName: row.project_name || null,
    evidencePath: row.evidence_path || null,
    persistDir: row.persist_dir || null,
    forgeTaskId: row.forge_task_id || null,
    evidenceStatus: row.evidence_status || null,
    lastAction: row.last_action || null,
    lastError: row.last_error || null,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || DEFAULT_QUEUE_MAX_ATTEMPTS),
    availableAt: toIso(row.available_at),
    lockedAt: toIso(row.locked_at),
    lockedBy: row.locked_by || null,
    leaseExpiresAt: toIso(row.lease_expires_at),
    deadLetteredAt: toIso(row.dead_lettered_at),
    completedAt: toIso(row.completed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    metadata: parseJson(row.metadata, {}),
  };
  return item;
}

function buildFactoryQueueInsert(requirement, index, config = {}) {
  const normalized = normalizeRequirement(requirement, index);
  const idempotencyKey = buildIdempotencyKey(requirement, normalized);
  const deliveryDir = config.deliveryDir || DEFAULT_DELIVERY_DIR;
  const item = {
    id: normalized.id,
    title: normalized.title,
    requirements: normalized.requirements,
    templateTier: normalized.templateTier,
    changeKind: normalized.changeKind,
    changedFiles: normalized.changedFiles,
    githubIssueUrl: normalized.githubIssueUrl,
    stage: 'queued',
    taskId: null,
    projectId: null,
    evidencePath: evidencePathForItem({ id: normalized.id }, deliveryDir),
    persistDir: null,
    forgeTaskId: makeForgeTaskId(normalized.id),
    metadata: normalized.metadata || {},
  };
  return {
    item,
    params: [
      config.tenantId,
      item.id,
      idempotencyKey,
      item.title,
      item.requirements,
      item.templateTier,
      item.changeKind,
      JSON.stringify(item.changedFiles || []),
      item.githubIssueUrl,
      item.stage,
      item.taskId,
      item.projectId,
      item.evidencePath,
      item.persistDir,
      item.forgeTaskId,
      positiveInteger(config.factoryQueueMaxAttempts, DEFAULT_QUEUE_MAX_ATTEMPTS),
      JSON.stringify(item.metadata),
    ],
  };
}

async function submitPostgresFactoryRequirements(pool, requirements = [], config = {}) {
  const created = [];
  for (const requirement of requirements) {
    const insert = buildFactoryQueueInsert(requirement, created.length, config);
    const result = await pool.query(`INSERT INTO factory_delivery_queue (
        tenant_id, queue_id, idempotency_key, title, requirements, template_tier, change_kind,
        changed_files, github_issue_url, stage, task_id, project_id, evidence_path, persist_dir, forge_task_id, max_attempts, metadata
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb
      )
      ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
      SET updated_at = factory_delivery_queue.updated_at
      RETURNING *
    `, insert.params);
    created.push(normalizeFactoryQueueRow(result.rows[0]));
  }
  return {
    queueBackend: 'postgres',
    queueTable: 'factory_delivery_queue',
    created,
  };
}

async function importPostgresFactoryQueue(pool, queue = {}, config = {}) {
  const sourceItems = Array.isArray(queue) ? queue : queue.items || [];
  const imported = [];
  for (let index = 0; index < sourceItems.length; index += 1) {
    const entry = buildFactoryQueueImport(sourceItems[index], index, config);
    const result = await pool.query(FACTORY_QUEUE_IMPORT_SQL, entry.params);
    imported.push(normalizeFactoryQueueRow(result.rows[0]));
  }
  return {
    queueBackend: 'postgres',
    queueTable: 'factory_delivery_queue',
    sourceItems: sourceItems.length,
    imported,
  };
}

function withQueueLease(row, workerId) {
  return {
    item: {
      ...normalizeFactoryQueueRow(row),
      _queueLease: {
        workerId,
        lockedAt: toIso(row.locked_at),
        claimedStage: row.stage,
        attempts: Number(row.attempts || 0),
        maxAttempts: Number(row.max_attempts || DEFAULT_QUEUE_MAX_ATTEMPTS),
      },
    },
    row,
  };
}

async function claimAvailableFactoryQueueRows(client, config) {
  const result = await client.query(`
    WITH claimed AS (
      SELECT queue_id
      FROM factory_delivery_queue
      WHERE tenant_id = $1
        AND stage <> ALL($5::text[])
        AND available_at <= NOW()
        AND (locked_by IS NULL OR lease_expires_at <= NOW())
      ORDER BY available_at ASC, created_at ASC, queue_id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $2
    )
    UPDATE factory_delivery_queue queue
    SET locked_by = $3,
        locked_at = date_trunc('milliseconds', NOW()),
        lease_expires_at = date_trunc('milliseconds', NOW()) + make_interval(secs => $4),
        updated_at = NOW()
    FROM claimed
    WHERE queue.tenant_id = $1
      AND queue.queue_id = claimed.queue_id
    RETURNING queue.*
  `, [
    config.tenantId,
    config.maxItems,
    config.workerId,
    config.leaseSeconds,
    TERMINAL_QUEUE_STAGES,
  ]);
  return result.rows.map((row) => withQueueLease(row, config.workerId));
}

async function claimPostgresFactoryQueueItems(pool, config = {}) {
  const tenantId = config.tenantId;
  const workerId = config.workerId || `factory-${process.pid}`;
  const maxItems = positiveInteger(config.maxItems, 1);
  const leaseSeconds = positiveInteger(config.factoryQueueLeaseSeconds, DEFAULT_QUEUE_LEASE_SECONDS);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const recovery = await recoverExpiredFactoryQueueLeases(client, {
      tenantId,
      terminalStages: TERMINAL_QUEUE_STAGES,
      retryBaseSeconds: config.factoryQueueRetryBaseSeconds,
    });
    const claims = await claimAvailableFactoryQueueRows(client, {
      tenantId,
      maxItems,
      workerId,
      leaseSeconds,
    });
    Object.defineProperty(claims, 'recovery', { value: recovery, enumerable: false });
    await client.query('COMMIT');
    return claims;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function releasePostgresFactoryQueueItem(pool, claim, outcome = {}, config = {}) {
  assertPostgresFactoryQueueCompletionProof(claim, outcome, config);
  const release = releaseParamsForOutcome(claim, outcome, config);
  const result = await pool.query(`
    UPDATE factory_delivery_queue
    SET stage = $4,
        task_id = COALESCE($5, task_id),
        project_id = COALESCE($6, project_id),
        project_name = COALESCE($7, project_name),
        evidence_path = COALESCE($8, evidence_path),
        persist_dir = COALESCE($9, persist_dir),
        forge_task_id = COALESCE($10, forge_task_id),
        evidence_status = $11,
        last_action = $12,
        last_error = $13,
        attempts = $14,
        available_at = CASE
          WHEN $13::text IS NULL OR $16::boolean = true THEN NOW()
          ELSE NOW() + make_interval(secs => $15)
        END,
        locked_by = NULL,
        locked_at = NULL,
        lease_expires_at = NULL,
        dead_lettered_at = CASE WHEN $16::boolean = true THEN NOW() ELSE dead_lettered_at END,
        completed_at = CASE WHEN $17::boolean = true THEN NOW() ELSE completed_at END,
        metadata = $18::jsonb,
        updated_at = NOW()
    WHERE tenant_id = $1
      AND queue_id = $2
      AND locked_by = $3
      AND locked_at = $19::timestamptz
      AND lease_expires_at > NOW()
    RETURNING *
  `, release.params);
  if (!result.rows[0]) {
    throw new Error(`Factory queue lease was lost before releasing item ${claim.item?.id || '(unknown)'}`);
  }
  return {
    item: normalizeFactoryQueueRow(result.rows[0]),
    deadLetter: release.deadLetter,
    error: release.errorMessage,
  };
}

function releaseCompletionItem(claim = {}, outcome = {}) {
  const claimedItem = claim.item || {};
  const outcomeItem = outcome.item || {};
  return {
    ...claimedItem,
    ...outcomeItem,
    metadata: {
      ...(claimedItem.metadata || {}),
      ...(outcomeItem.metadata || {}),
      realDelivery: {
        ...(claimedItem.metadata?.realDelivery || {}),
        ...(outcomeItem.metadata?.realDelivery || {}),
      },
    },
  };
}

function assertPostgresFactoryQueueCompletionProof(claim = {}, outcome = {}, config = {}) {
  if (outcome.error) return;
  const item = releaseCompletionItem(claim, outcome);
  if (item.stage !== 'completed') return;
  const claimedItem = claim.item || {};
  if (!requiresFactoryFinalProof(config, item) && !requiresFactoryFinalProof(config, claimedItem)) return;
  verifyFactoryRealDeliveryCompletion(config, item);
}

async function countPendingPostgresFactoryQueueItems(pool, config = {}) {
  const result = await pool.query(`
    SELECT COUNT(*)::integer AS pending_count
    FROM factory_delivery_queue
    WHERE tenant_id = $1
      AND stage <> ALL($2::text[])
  `, [config.tenantId, TERMINAL_QUEUE_STAGES]);
  return Number(result.rows[0]?.pending_count || 0);
}

function resolveFactoryQueueConnectionString(options = {}) {
  const connectionString = options.factoryQueueDatabaseUrl
    || options.databaseUrl
    || options.connectionString
    || process.env.FACTORY_QUEUE_DATABASE_URL
    || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('FACTORY_QUEUE_DATABASE_URL or DATABASE_URL is required for postgres factory queue');
  }
  return connectionString;
}

function createPostgresFactoryQueueStore(options = {}) {
  const pool = options.pool || createPgPoolFromEnv(resolveFactoryQueueConnectionString(options));
  const ownsPool = !options.pool;
  return {
    kind: 'postgres',
    submit(requirements, config) {
      return submitPostgresFactoryRequirements(pool, requirements, { ...options, ...config });
    },
    claim(config) {
      return claimPostgresFactoryQueueItems(pool, { ...options, ...config });
    },
    release(claim, outcome, config) {
      return releasePostgresFactoryQueueItem(pool, claim, outcome, { ...options, ...config });
    },
    pendingCount(config) {
      return countPendingPostgresFactoryQueueItems(pool, { ...options, ...config });
    },
    requeueDeadLetter(config) {
      const { requeueDeadLetterPostgresFactoryQueueItem } = require('./factory-delivery-queue-requeue');
      return requeueDeadLetterPostgresFactoryQueueItem(pool, { ...options, ...config });
    },
    importQueue(queue, config) {
      return importPostgresFactoryQueue(pool, queue, { ...options, ...config });
    },
    async close() {
      if (ownsPool && typeof pool.end === 'function') await pool.end();
    },
  };
}

module.exports = {
  TERMINAL_QUEUE_STAGES,
  RECOVERABLE_QUEUE_STAGES,
  DEFAULT_QUEUE_LEASE_SECONDS,
  DEFAULT_QUEUE_RETRY_BASE_SECONDS,
  DEFAULT_QUEUE_MAX_ATTEMPTS,
  normalizeFactoryQueueRow,
  buildFactoryQueueInsert,
  buildFactoryQueueImport,
  submitPostgresFactoryRequirements,
  importPostgresFactoryQueue,
  recoverExpiredFactoryQueueLeases,
  claimPostgresFactoryQueueItems,
  releaseParamsForOutcome,
  assertPostgresFactoryQueueCompletionProof,
  releasePostgresFactoryQueueItem,
  countPendingPostgresFactoryQueueItems,
  resolveFactoryQueueConnectionString,
  createPostgresFactoryQueueStore,
};
