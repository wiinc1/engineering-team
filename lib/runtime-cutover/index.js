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
  if (input?.releaseDecision?.allowed !== true || input.releaseDecision.revision !== input.revision) reasons.push('cutover_release_gate_failed');
  const items = Array.isArray(input?.items) ? input.items : [];
  const records = items.map((item) => Object.freeze({
    tenantId: validateIdentity(item) ? item.tenantId : null,
    semanticId: validateIdentity(item) ? item.semanticId : null,
    sourceState: SAFE_ID.test(String(item?.sourceState || '')) ? item.sourceState : 'invalid',
    sourceEngine: 'legacy', targetEngine: input?.targetEngine || null,
    ...classifyItem(input?.scope, item),
  }));
  if (records.some((record) => !record.resolved)) reasons.push('cutover_migration_unresolved');
  if (items.length === 0) reasons.push('cutover_inventory_empty');
  const decision = {
    schemaVersion: 1, scope: input?.scope || null, epoch: input?.epoch || null,
    targetEngine: input?.targetEngine || null, revision: input?.revision || null,
    mode: input?.mode === 'apply' ? 'apply' : 'dry-run', allowed: reasons.length === 0,
    reasons: Object.freeze([...new Set(reasons)].sort()), records: Object.freeze(records),
  };
  return Object.freeze({ ...decision, digest: `sha256:${crypto.createHash('sha256').update(JSON.stringify(decision)).digest('hex')}` });
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

module.exports = { CutoverError, MATRICES, TARGETS, assertExecutionOwnership, classifyItem, createCutoverPlan, createDatabaseOwnershipGuard, evaluateRollback };
