'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { assertExecutionOwnership, classifyItem, createCutoverPlan, evaluateRollback } = require('../../lib/runtime-cutover');
const { verify: verifyLegacyRemoval } = require('../../scripts/verify-legacy-runtime-removal');

const base = {
  epoch: '98f48812-7aa6-4ce8-9e88-184ba4bcbb52', revision: 'a'.repeat(40), actorRole: 'admin',
  freezeConfirmed: true, releaseDecision: { allowed: true, revision: 'a'.repeat(40) },
};

test('approved matrices deterministically classify every supported legacy job and factory state', () => {
  const expected = {
    jobs: { queued: 'migrate', leased: 'drain_reconcile', running: 'drain_reconcile', retrying: 'migrate', completed: 'retain_history', dead_lettered: 'retain_history', cancelled: 'retain_history' },
    factory: { queued: 'migrate', not_started: 'migrate', paused: 'migrate', running: 'complete_frozen_legacy', completed: 'retain_history', failed: 'retain_history', cancelled: 'retain_history' },
  };
  for (const [scope, states] of Object.entries(expected)) {
    for (const [sourceState, disposition] of Object.entries(states)) {
      assert.deepEqual(classifyItem(scope, { tenantId: 'tenant-a', semanticId: 'run-1', sourceState, executingEngines: [] }), {
        disposition, evidenceCode: `matrix_${sourceState}`, resolved: true,
      });
    }
  }
});

test('cutover requires release evidence freeze privilege identity and fully resolved ownership', () => {
  const plan = createCutoverPlan({
    ...base, scope: 'jobs', targetEngine: 'graphile', items: [
      { tenantId: 'tenant-a', semanticId: 'job-1', sourceState: 'queued', executingEngines: [] },
      { tenantId: 'tenant-a', semanticId: 'job-2', sourceState: 'running', executingEngines: ['legacy', 'graphile'] },
    ],
  });
  assert.equal(plan.allowed, false);
  assert.ok(plan.reasons.includes('cutover_migration_unresolved'));
  assert.equal(plan.records[1].evidenceCode, 'concurrent_ownership');
  assert.match(plan.digest, /^sha256:[0-9a-f]{64}$/);
});

test('complete jobs and factory inventories produce revision-bound dry-run plans', () => {
  for (const [scope, targetEngine, sourceState] of [['jobs', 'graphile', 'queued'], ['factory', 'langgraph', 'paused']]) {
    const plan = createCutoverPlan({ ...base, scope, targetEngine, items: [{ tenantId: 'tenant-a', semanticId: 'work-1', sourceState }] });
    assert.equal(plan.allowed, true);
    assert.equal(plan.records[0].resolved, true);
  }
});

test('epoch guard rejects stale legacy and mismatched new processes', () => {
  const current = { scope: 'jobs', epoch: base.epoch, engine: 'graphile', state: 'active' };
  assert.equal(assertExecutionOwnership(current, { scope: 'jobs', epoch: base.epoch, engine: 'graphile' }), true);
  assert.throws(() => assertExecutionOwnership(current, { scope: 'jobs', epoch: base.epoch, engine: 'legacy' }), { code: 'legacy_runtime_invocation_blocked' });
  assert.throws(() => assertExecutionOwnership(current, { scope: 'jobs', epoch: crypto.randomUUID(), engine: 'graphile' }), { code: 'runtime_ownership_conflict' });
});

test('rollback is allowed only with a freeze, compatible schema, and zero active or ambiguous ownership', () => {
  assert.equal(evaluateRollback({ freezeConfirmed: true, schemaCompatible: true, activeTargetExecutions: 0, ambiguousOwnership: 0 }).allowed, true);
  const blocked = evaluateRollback({ freezeConfirmed: false, schemaCompatible: false, activeTargetExecutions: 1, ambiguousOwnership: 1 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.action, 'kill_switch_forward_recovery');
  assert.equal(blocked.reasons.length, 4);
});

test('static legacy-zero guard truthfully blocks final cleanup while executable paths remain', () => {
  for (const scope of ['jobs', 'factory']) {
    const result = verifyLegacyRemoval(scope, require('node:path').resolve(__dirname, '../..'));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'legacy_runtime_reference_present');
    assert.ok(result.present.length > 0);
  }
});
