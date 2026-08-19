'use strict';

const crypto = require('node:crypto');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/;
const MATRICES = Object.freeze({
  jobs: Object.freeze({
    queued: 'migrate', leased: 'drain_reconcile', running: 'drain_reconcile', retrying: 'migrate',
    completed: 'retain_history', dead_lettered: 'retain_history', cancelled: 'retain_history',
  }),
  factory: Object.freeze({
    queued: 'migrate', not_started: 'migrate', paused: 'migrate', running: 'complete_frozen_legacy',
    completed: 'retain_history', failed: 'retain_history', cancelled: 'retain_history',
  }),
});
const TARGETS = Object.freeze({ jobs: 'graphile', factory: 'langgraph' });
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const APPROVAL_TTL_MS = 15 * 60_000;

class CutoverError extends Error {
  constructor(code, reasons = []) {
    super('Runtime cutover operation failed closed.');
    this.name = 'CutoverError';
    this.code = code;
    this.reasons = Object.freeze([...reasons]);
  }
}

function validateIdentity(item) {
  return SAFE_ID.test(String(item?.tenantId || '')) && SAFE_ID.test(String(item?.semanticId || ''));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')}`;
}

function cutoverPlanDigest(plan) {
  const { digest: _ignored, ...payload } = plan || {};
  return sha256(payload);
}

function cutoverApprovalDigest(approval) {
  const { approvalDigest: _ignored, ...payload } = approval || {};
  return sha256(payload);
}

function classifyItem(scope, item) {
  if (!validateIdentity(item)) return Object.freeze({ disposition: 'quarantine', evidenceCode: 'invalid_identity', resolved: false });
  const executing = [...new Set(item.executingEngines || [])];
  if (executing.length > 1) return Object.freeze({ disposition: 'quarantine', evidenceCode: 'concurrent_ownership', resolved: false });
  const disposition = MATRICES[scope]?.[item.sourceState];
  if (!disposition) return Object.freeze({ disposition: 'quarantine', evidenceCode: 'unsupported_state', resolved: false });
  if (executing[0] && executing[0] !== 'legacy') return Object.freeze({ disposition: 'quarantine', evidenceCode: 'unexpected_owner', resolved: false });
  return Object.freeze({ disposition, evidenceCode: `matrix_${item.sourceState}`, resolved: true });
}

function createCutoverPlan(input) {
  const reasons = [];
  if (!TARGETS[input?.scope] || TARGETS[input.scope] !== input.targetEngine) reasons.push('cutover_target_invalid');
  if (!UUID_PATTERN.test(String(input?.epoch || ''))) reasons.push('cutover_epoch_invalid');
  if (!/^[0-9a-f]{40}$/.test(String(input?.revision || ''))) reasons.push('cutover_revision_invalid');
  if (!['admin', 'platform_owner'].includes(input?.actorRole)) reasons.push('cutover_forbidden');
  if (input?.freezeConfirmed !== true) reasons.push('cutover_freeze_required');
  if (input?.releaseDecision?.allowed !== true
    || input.releaseDecision.revision !== input.revision
    || !DIGEST_PATTERN.test(String(input.releaseDecision.manifestDigest || ''))) {
    reasons.push('cutover_release_gate_failed');
  }
  const items = Array.isArray(input?.items) ? input.items : [];
  const mode = input?.mode === 'apply' ? 'apply' : 'dry-run';
  const records = items.map((item) => {
    const classified = classifyItem(input?.scope, item);
    const reconciliationDigest = item?.reconciliation?.digest || null;
    const applyReady = mode !== 'apply' || (
      classified.resolved
      && item?.reconciliation?.verified === true
      && DIGEST_PATTERN.test(String(reconciliationDigest || ''))
      && Number(item?.activeExecutions || 0) === 0
      && asExecutingEngines(item).length === 0
    );
    return Object.freeze({
      tenantId: validateIdentity(item) ? item.tenantId : null,
      semanticId: validateIdentity(item) ? item.semanticId : null,
      sourceState: SAFE_ID.test(String(item?.sourceState || '')) ? item.sourceState : 'invalid',
      sourceEngine: 'legacy', targetEngine: input?.targetEngine || null,
      ...classified,
      resolved: classified.resolved && applyReady,
      reconciliationDigest: DIGEST_PATTERN.test(String(reconciliationDigest || '')) ? reconciliationDigest : null,
      reconciliationVerified: item?.reconciliation?.verified === true,
    });
  });
  if (records.some((record) => !record.resolved)) reasons.push('cutover_migration_unresolved');
  if (items.length === 0) reasons.push('cutover_inventory_empty');
  const decision = {
    schemaVersion: 1, scope: input?.scope || null, epoch: input?.epoch || null,
    targetEngine: input?.targetEngine || null, revision: input?.revision || null,
    mode, freezeConfirmed: input?.freezeConfirmed === true,
    manifestDigest: input?.releaseDecision?.manifestDigest || null,
    deploymentId: input?.releaseDecision?.deploymentId || null,
    allowed: reasons.length === 0,
    reasons: Object.freeze([...new Set(reasons)].sort()), records: Object.freeze(records),
  };
  return Object.freeze({ ...decision, digest: sha256(decision) });
}

function asExecutingEngines(item) {
  return [...new Set(Array.isArray(item?.executingEngines) ? item.executingEngines : [])];
}

function assertExecutionOwnership(current, attempted) {
  const valid = current && attempted
    && current.state === 'active'
    && current.scope === attempted.scope
    && current.engine === attempted.engine
    && current.epoch === attempted.epoch;
  if (!valid) {
    const code = attempted?.engine === 'legacy' ? 'legacy_runtime_invocation_blocked' : 'runtime_ownership_conflict';
    throw new CutoverError(code, ['exclusive_epoch_mismatch']);
  }
  return true;
}

function evaluateRollback(input) {
  const reasons = [];
  if (input?.freezeConfirmed !== true) reasons.push('rollback_freeze_required');
  if (Number(input?.activeTargetExecutions || 0) !== 0) reasons.push('rollback_active_target_execution');
  if (Number(input?.ambiguousOwnership || 0) !== 0) reasons.push('rollback_ownership_ambiguous');
  if (input?.schemaCompatible !== true) reasons.push('rollback_schema_incompatible');
  return Object.freeze({ allowed: reasons.length === 0, reasons: Object.freeze(reasons), action: reasons.length ? 'kill_switch_forward_recovery' : 'activate_exclusive_previous_epoch' });
}

function createDatabaseOwnershipGuard(pool, expected) {
  return Object.freeze({
    async assert() {
      const result = await pool.query(`
        SELECT scope, epoch::text, engine, state
        FROM runtime_control.ownership_epochs
        WHERE scope = $1 AND state = 'active'
      `, [expected.scope]);
      return assertExecutionOwnership(result.rows[0], expected);
    },
  });
}

function validateJointCutover(input, now = Date.now()) {
  const reasons = [];
  const plans = [input?.jobsPlan, input?.factoryPlan];
  const [jobsPlan, factoryPlan] = plans;
  if (jobsPlan?.scope !== 'jobs' || jobsPlan?.targetEngine !== 'graphile') reasons.push('jobs_plan_invalid');
  if (factoryPlan?.scope !== 'factory' || factoryPlan?.targetEngine !== 'langgraph') reasons.push('factory_plan_invalid');
  for (const plan of plans) {
    if (plan?.mode !== 'apply' || plan?.allowed !== true || plan?.freezeConfirmed !== true) reasons.push('apply_plan_not_allowed');
    if (plan?.digest !== cutoverPlanDigest(plan)) reasons.push('apply_plan_digest_mismatch');
    if (plan?.records?.some((record) => record.resolved !== true || record.reconciliationVerified !== true
      || !DIGEST_PATTERN.test(String(record.reconciliationDigest || '')))) reasons.push('apply_reconciliation_incomplete');
  }
  if (!jobsPlan?.revision || jobsPlan.revision !== factoryPlan?.revision) reasons.push('apply_revision_mismatch');
  const approval = input?.approval || {};
  if (approval.schemaVersion !== 'runtime-cutover-approval.v1' || approval.approved !== true) reasons.push('approval_invalid');
  if (!SAFE_ID.test(String(approval.actorId || '')) || !['admin', 'platform_owner'].includes(approval.actorRole)) reasons.push('approval_forbidden');
  if (!SAFE_ID.test(String(approval.requestId || ''))) reasons.push('approval_request_invalid');
  const approvedAt = Date.parse(approval.approvedAt || '');
  if (!Number.isFinite(approvedAt) || approvedAt > now + 60_000 || now - approvedAt > APPROVAL_TTL_MS) reasons.push('approval_stale');
  if (approval.revision !== jobsPlan?.revision
    || approval.jobsPlanDigest !== jobsPlan?.digest
    || approval.factoryPlanDigest !== factoryPlan?.digest
    || approval.graphileManifestDigest !== jobsPlan?.manifestDigest
    || approval.langgraphManifestDigest !== factoryPlan?.manifestDigest) reasons.push('approval_scope_mismatch');
  const approvalDigest = cutoverApprovalDigest(approval);
  if (input?.confirmationDigest !== approvalDigest) reasons.push('approval_confirmation_mismatch');
  return Object.freeze({ allowed: reasons.length === 0, approvalDigest, reasons: Object.freeze([...new Set(reasons)].sort()) });
}

async function applyPlanRecords(client, plan) {
  for (const record of plan.records) {
    await client.query(`
      INSERT INTO runtime_control.migration_records
        (scope, epoch, tenant_id, semantic_id, source_engine, target_engine,
         source_state, disposition, outcome, evidence_code, reconciliation_digest)
      VALUES ($1, $2::uuid, $3, $4, 'legacy', $5, $6, $7, 'reconciled', $8, $9)
    `, [
      plan.scope, plan.epoch, record.tenantId, record.semanticId, plan.targetEngine,
      record.sourceState, record.disposition, record.evidenceCode, record.reconciliationDigest,
    ]);
  }
}

async function lockAndRetireLegacy(client) {
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('runtime-exclusive-cutover'))");
  const active = await client.query(`
    SELECT scope, epoch::text, engine, state
    FROM runtime_control.ownership_epochs
    WHERE scope IN ('jobs', 'factory') AND state = 'active'
    FOR UPDATE
  `);
  if (active.rows.some((row) => row.engine !== 'legacy')) {
    throw new CutoverError('runtime_cutover_existing_target_owner', ['non_legacy_epoch_already_active']);
  }
  await client.query(`
    UPDATE runtime_control.ownership_epochs
    SET state = 'retired', retired_at = NOW()
    WHERE scope IN ('jobs', 'factory') AND state = 'active' AND engine = 'legacy'
  `);
}

async function activatePlan(client, plan, approval) {
  await client.query(`
    INSERT INTO runtime_control.ownership_epochs
      (scope, epoch, engine, revision, state, actor_id, request_id, evidence_digest)
    VALUES ($1, $2::uuid, $3, $4, 'active', $5, $6, $7)
  `, [plan.scope, plan.epoch, plan.targetEngine, plan.revision, approval.actorId, approval.requestId, plan.manifestDigest]);
  await applyPlanRecords(client, plan);
}

async function appendCutoverAudit(client, input, approvalDigest) {
  const { approval, jobsPlan, factoryPlan } = input;
  await client.query(`
    INSERT INTO runtime_control.cutover_audit
      (request_id, revision, jobs_epoch, factory_epoch, jobs_plan_digest,
       factory_plan_digest, graphile_manifest_digest, langgraph_manifest_digest,
       approval_digest, actor_id, actor_role, result)
    VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11, 'applied')
  `, [
    approval.requestId, approval.revision, jobsPlan.epoch, factoryPlan.epoch,
    jobsPlan.digest, factoryPlan.digest, jobsPlan.manifestDigest, factoryPlan.manifestDigest,
    approvalDigest, approval.actorId, approval.actorRole,
  ]);
}

async function runCutoverTransaction(client, input, approvalDigest) {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await lockAndRetireLegacy(client);
  for (const plan of [input.jobsPlan, input.factoryPlan]) await activatePlan(client, plan, input.approval);
  await appendCutoverAudit(client, input, approvalDigest);
  await client.query('COMMIT');
}

async function executeJointRuntimeCutover(pool, input, options = {}) {
  const validation = validateJointCutover(input, options.now ?? Date.now());
  if (!validation.allowed) throw new CutoverError('runtime_cutover_apply_blocked', validation.reasons);
  const { jobsPlan, factoryPlan, approval } = input;
  const client = await pool.connect();
  try {
    await runCutoverTransaction(client, input, validation.approvalDigest);
    return Object.freeze({
      applied: true, requestId: approval.requestId, revision: approval.revision,
      jobsEpoch: jobsPlan.epoch, factoryEpoch: factoryPlan.epoch,
      approvalDigest: validation.approvalDigest,
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  APPROVAL_TTL_MS, CutoverError, MATRICES, TARGETS, applyPlanRecords, appendCutoverAudit,
  assertExecutionOwnership, classifyItem, createCutoverPlan, createDatabaseOwnershipGuard,
  cutoverApprovalDigest, cutoverPlanDigest, evaluateRollback, executeJointRuntimeCutover,
  lockAndRetireLegacy, runCutoverTransaction, validateJointCutover,
};
