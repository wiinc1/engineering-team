'use strict';

const crypto = require('node:crypto');
const { JOB_RUNTIME_SCHEMA } = require('./constants');
const { JobRuntimeError } = require('./errors');

const EFFECT_TABLE = `${JOB_RUNTIME_SCHEMA}.job_effect_ledger`;
const EFFECT_CATEGORIES = Object.freeze([
  'gitlab', 'github', 'deployment', 'notification', 'canonical_task', 'audit_record',
  'langgraph_checkpoint', 'evidence', 'closeout', 'factory_queue_recovery',
  'operational_retention', 'audit_projection',
]);
const EFFECT_CATEGORY_SET = new Set(EFFECT_CATEGORIES);

function safeResultCode(value, fallback = 'completed') {
  return /^[a-z][a-z0-9_]{1,63}$/.test(String(value || '')) ? String(value) : fallback;
}

function effectKey(input) {
  const identity = [
    'v1', input.tenantId, input.taskIdentifier, input.effectCategory,
    input.resourceType, input.resourceId, String(input.effectVersion),
  ];
  if (identity.some((value) => value == null || value === '')) throw new JobRuntimeError('job_payload_invalid');
  if (!EFFECT_CATEGORY_SET.has(input.effectCategory)) {
    throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'effect_category' } });
  }
  return `effect:v1:${crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

function normalizeEffect(row) {
  if (!row) return null;
  return Object.freeze({
    tenantId: row.tenant_id,
    effectKey: row.effect_key,
    taskIdentifier: row.task_identifier,
    effectCategory: row.effect_category,
    resourceType: row.canonical_resource_type,
    resourceId: row.canonical_resource_id,
    effectVersion: Number(row.effect_version),
    status: row.status,
    ownerToken: row.owner_token,
    resultCode: row.result_code,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null,
  });
}

class EffectLedger {
  constructor(pool) { this.pool = pool; }

  async begin(input) {
    const result = await this.pool.query(`INSERT INTO ${EFFECT_TABLE} (
        tenant_id, effect_key, task_identifier, effect_category, canonical_resource_type,
        canonical_resource_id, effect_version, owner_token, lease_expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW() + make_interval(secs => $9))
      ON CONFLICT (tenant_id, effect_key) DO UPDATE SET
        owner_token = EXCLUDED.owner_token,
        lease_expires_at = EXCLUDED.lease_expires_at,
        updated_at = NOW()
      WHERE job_effect_ledger.status = 'started' AND job_effect_ledger.lease_expires_at <= NOW()
      RETURNING *`, [
      input.tenantId, input.effectKey, input.taskIdentifier, input.effectCategory,
      input.resourceType, input.resourceId, input.effectVersion, input.ownerToken, input.leaseSeconds,
    ]);
    const record = normalizeEffect(result.rows[0]) || await this.find(input.tenantId, input.effectKey);
    return Object.freeze({ owner: record?.ownerToken === input.ownerToken, record });
  }

  async find(tenantId, key) {
    const result = await this.pool.query(
      `SELECT * FROM ${EFFECT_TABLE} WHERE tenant_id = $1 AND effect_key = $2`, [tenantId, key],
    );
    return normalizeEffect(result.rows[0]);
  }

  async complete(input) {
    const result = await this.pool.query(`UPDATE ${EFFECT_TABLE}
      SET status = 'completed', result_code = $3, completed_at = NOW(), lease_expires_at = NULL, updated_at = NOW()
      WHERE tenant_id = $1 AND effect_key = $2 AND status IN ('started', 'completed') RETURNING *`,
    [input.tenantId, input.effectKey, safeResultCode(input.resultCode)]);
    if (!result.rows[0]) throw new JobRuntimeError('job_schedule_conflict');
    return normalizeEffect(result.rows[0]);
  }

  async terminal(input) {
    const result = await this.pool.query(`UPDATE ${EFFECT_TABLE}
      SET status = 'terminal', result_code = $4, completed_at = NOW(), lease_expires_at = NULL, updated_at = NOW()
      WHERE tenant_id = $1 AND effect_key = $2 AND owner_token = $3 AND status = 'started' RETURNING *`,
    [input.tenantId, input.effectKey, input.ownerToken, input.resultCode]);
    return normalizeEffect(result.rows[0]);
  }
}

class EffectGuard {
  constructor(options) {
    this.ledger = options.ledger;
    this.metrics = options.metrics;
    this.logger = options.logger;
    this.idGenerator = options.idGenerator || (() => crypto.randomUUID());
    this.leaseSeconds = options.leaseSeconds || 30 * 60;
    this.faults = options.faults || {};
  }

  async execute(input) {
    const key = effectKey(input);
    const ownerToken = this.idGenerator();
    const claim = await this.ledger.begin({ ...input, effectKey: key, ownerToken, leaseSeconds: this.leaseSeconds });
    if (claim.record?.status === 'completed') return this.suppressed(input, key, 'ledger_completed');
    if (!claim.owner) return this.reconcile(input, key, claim.record);
    if (typeof input.lookup === 'function') {
      const observed = await input.lookup(key);
      if (observed?.completed === true) {
        await this.ledger.complete({ tenantId: input.tenantId, effectKey: key, resultCode: observed.code });
        return this.suppressed(input, key, 'canonical_effect_completed');
      }
    }
    await this.faults.beforeEffect?.(input);
    try {
      const result = await input.perform(key);
      await this.faults.afterEffect?.(input, result);
      await this.ledger.complete({ tenantId: input.tenantId, effectKey: key, resultCode: result?.code });
      return Object.freeze({ completed: true, suppressed: false, effectKey: key, result });
    } catch (error) {
      if (error instanceof JobRuntimeError && !error.retryable) {
        await this.ledger.terminal({
          tenantId: input.tenantId, effectKey: key, ownerToken, resultCode: error.code,
        });
      }
      throw error;
    }
  }

  async reconcile(input, key, record) {
    if (record?.status === 'terminal') {
      throw new JobRuntimeError('job_schedule_conflict', { safeDetails: { reason: 'terminal_effect' } });
    }
    const observed = typeof input.lookup === 'function' ? await input.lookup(key) : null;
    if (observed?.completed === true) {
      await this.ledger.complete({ tenantId: input.tenantId, effectKey: key, resultCode: observed.code });
      return this.suppressed(input, key, 'canonical_effect_completed');
    }
    throw new JobRuntimeError('job_runtime_unavailable', {
      safeDetails: { reason: 'effect_in_progress' }, retryable: true,
    });
  }

  suppressed(input, key, reason) {
    this.metrics.increment('job_runtime_effect_suppressed_total', { task: input.taskIdentifier, reason });
    this.logger.info('job_effect_suppressed', {
      tenant_id: input.tenantId,
      task_identifier: input.taskIdentifier,
      effect_category: input.effectCategory,
      effect_key: key,
      canonical_resource_type: input.resourceType,
      canonical_resource_id: input.resourceId,
      delivery_id: input.context?.deliveryId,
      workload_id: input.context?.workloadId,
      attempt: input.context?.attempt,
      correlation_id: input.context?.correlation?.correlationId,
      request_id: input.context?.correlation?.requestId,
      trace_id: input.context?.correlation?.traceId,
      reason,
    });
    return Object.freeze({ completed: true, suppressed: true, effectKey: key, reason });
  }
}

function createEffectGuard(options) { return new EffectGuard(options); }
function createEffectLedger(pool) { return new EffectLedger(pool); }

module.exports = {
  EFFECT_TABLE,
  EFFECT_CATEGORIES,
  EffectGuard,
  EffectLedger,
  createEffectGuard,
  createEffectLedger,
  effectKey,
  normalizeEffect,
  safeResultCode,
};
