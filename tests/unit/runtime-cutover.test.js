'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const {
  assertExecutionOwnership, classifyItem, createCutoverPlan, createDatabaseOwnershipGuard,
  cutoverApprovalDigest, evaluateRollback, executeJointRuntimeCutover, validateJointCutover,
} = require('../../lib/runtime-cutover');
const { verify: verifyLegacyRemoval } = require('../../scripts/verify-legacy-runtime-removal');

const base = {
  epoch: '98f48812-7aa6-4ce8-9e88-184ba4bcbb52', revision: 'a'.repeat(40), actorRole: 'admin',
  freezeConfirmed: true, releaseDecision: {
    allowed: true, revision: 'a'.repeat(40), manifestDigest: `sha256:${'b'.repeat(64)}`,
  },
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

test('classification quarantines unsafe identities, states, and owners independently', () => {
  assert.deepEqual(classifyItem('jobs', { tenantId: '', semanticId: 'job-1', sourceState: 'queued' }), {
    disposition: 'quarantine', evidenceCode: 'invalid_identity', resolved: false,
  });
  assert.deepEqual(classifyItem('jobs', { tenantId: 'tenant-a', semanticId: 'job-1', sourceState: 'unknown' }), {
    disposition: 'quarantine', evidenceCode: 'unsupported_state', resolved: false,
  });
  assert.deepEqual(classifyItem('jobs', { tenantId: 'tenant-a', semanticId: 'job-1', sourceState: 'queued', executingEngines: ['graphile'] }), {
    disposition: 'quarantine', evidenceCode: 'unexpected_owner', resolved: false,
  });
  assert.deepEqual(classifyItem('jobs', { tenantId: 'tenant-a', semanticId: 'job-1', sourceState: 'queued', executingEngines: ['legacy', 'legacy'] }), {
    disposition: 'migrate', evidenceCode: 'matrix_queued', resolved: true,
  });
});

test('complete jobs and factory inventories produce revision-bound dry-run plans', () => {
  for (const [scope, targetEngine, sourceState] of [['jobs', 'graphile', 'queued'], ['factory', 'langgraph', 'paused']]) {
    const plan = createCutoverPlan({ ...base, scope, targetEngine, items: [{ tenantId: 'tenant-a', semanticId: 'work-1', sourceState }] });
    assert.equal(plan.allowed, true);
    assert.equal(plan.records[0].resolved, true);
    assert.equal(plan.scope, scope);
    assert.equal(plan.targetEngine, targetEngine);
    assert.equal(plan.revision, base.revision);
    assert.equal(plan.epoch, base.epoch);
    assert.equal(plan.mode, 'dry-run');
  }
  assert.equal(createCutoverPlan({
    ...base, scope: 'jobs', targetEngine: 'graphile', mode: 'apply',
    items: [{ tenantId: 'tenant-a', semanticId: 'job-1', sourceState: 'queued' }],
  }).mode, 'apply');
});

test('each cutover precondition emits its stable blocking reason', () => {
  const valid = { ...base, scope: 'jobs', targetEngine: 'graphile', items: [{ tenantId: 'tenant-a', semanticId: 'job-1', sourceState: 'queued' }] };
  for (const [overrides, expected] of [
    [{ targetEngine: 'langgraph' }, 'cutover_target_invalid'],
    [{ epoch: 'invalid' }, 'cutover_epoch_invalid'],
    [{ revision: `x${base.revision}` }, 'cutover_revision_invalid'],
    [{ actorRole: 'reader' }, 'cutover_forbidden'],
    [{ freezeConfirmed: false }, 'cutover_freeze_required'],
    [{ releaseDecision: { allowed: false, revision: base.revision } }, 'cutover_release_gate_failed'],
    [{ releaseDecision: { allowed: true, revision: 'b'.repeat(40) } }, 'cutover_release_gate_failed'],
    [{ items: [] }, 'cutover_inventory_empty'],
  ]) assert.ok(createCutoverPlan({ ...valid, ...overrides }).reasons.includes(expected), expected);
});

test('epoch guard rejects stale legacy and mismatched new processes', () => {
  const current = { scope: 'jobs', epoch: base.epoch, engine: 'graphile', state: 'active' };
  assert.equal(assertExecutionOwnership(current, { scope: 'jobs', epoch: base.epoch, engine: 'graphile' }), true);
  assert.throws(() => assertExecutionOwnership(current, { scope: 'jobs', epoch: base.epoch, engine: 'legacy' }), { code: 'legacy_runtime_invocation_blocked' });
  assert.throws(() => assertExecutionOwnership(current, { scope: 'jobs', epoch: crypto.randomUUID(), engine: 'graphile' }), { code: 'runtime_ownership_conflict' });
  assert.throws(() => assertExecutionOwnership(null, { scope: 'jobs', epoch: base.epoch, engine: 'graphile' }), {
    code: 'runtime_ownership_conflict', reasons: ['exclusive_epoch_mismatch'],
  });
  assert.throws(() => assertExecutionOwnership({ ...current, state: 'standby' }, { scope: 'jobs', epoch: base.epoch, engine: 'graphile' }), { code: 'runtime_ownership_conflict' });
  assert.throws(() => assertExecutionOwnership({ ...current, scope: 'factory' }, { scope: 'jobs', epoch: base.epoch, engine: 'graphile' }), { code: 'runtime_ownership_conflict' });
});

test('rollback is allowed only with a freeze, compatible schema, and zero active or ambiguous ownership', () => {
  assert.equal(evaluateRollback({ freezeConfirmed: true, schemaCompatible: true, activeTargetExecutions: 0, ambiguousOwnership: 0 }).allowed, true);
  const blocked = evaluateRollback({ freezeConfirmed: false, schemaCompatible: false, activeTargetExecutions: 1, ambiguousOwnership: 1 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.action, 'kill_switch_forward_recovery');
  assert.deepEqual(blocked.reasons, [
    'rollback_freeze_required', 'rollback_active_target_execution',
    'rollback_ownership_ambiguous', 'rollback_schema_incompatible',
  ]);
  assert.equal(evaluateRollback({ freezeConfirmed: true, schemaCompatible: true }).action, 'activate_exclusive_previous_epoch');
});

test('database ownership guard queries the active epoch and applies the same fail-closed decision', async () => {
  const expected = { scope: 'jobs', epoch: base.epoch, engine: 'graphile' };
  const calls = [];
  const guard = createDatabaseOwnershipGuard({
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ ...expected, state: 'active' }] };
    },
  }, expected);
  assert.equal(await guard.assert(), true);
  assert.match(calls[0].sql, /runtime_control\.ownership_epochs/);
  assert.deepEqual(calls[0].values, ['jobs']);
});

function jointApplyFixture() {
  const release = (digest) => ({
    allowed: true, revision: base.revision, deploymentId: 'staging-42', manifestDigest: digest,
  });
  const plan = (scope, targetEngine, epoch, manifestDigest) => createCutoverPlan({
    ...base, scope, targetEngine, epoch, mode: 'apply', releaseDecision: release(manifestDigest),
    items: [{
      tenantId: 'tenant-a', semanticId: `${scope}-1`, sourceState: 'queued',
      activeExecutions: 0, executingEngines: [],
      reconciliation: { verified: true, digest: `sha256:${'c'.repeat(64)}` },
    }],
  });
  const jobsPlan = plan('jobs', 'graphile', base.epoch, `sha256:${'d'.repeat(64)}`);
  const factoryPlan = plan('factory', 'langgraph', '6b852ce3-b3ef-40a7-a118-770d7215fdcb', `sha256:${'e'.repeat(64)}`);
  const approval = {
    schemaVersion: 'runtime-cutover-approval.v1', approved: true,
    approvedAt: '2026-08-19T18:00:00.000Z', actorId: 'operator-1', actorRole: 'platform_owner',
    requestId: 'cutover-20260819-1', revision: base.revision,
    jobsPlanDigest: jobsPlan.digest, factoryPlanDigest: factoryPlan.digest,
    graphileManifestDigest: jobsPlan.manifestDigest,
    langgraphManifestDigest: factoryPlan.manifestDigest,
  };
  return { approval, jobsPlan, factoryPlan, confirmationDigest: cutoverApprovalDigest(approval) };
}

test('apply mode requires payload-free reconciliation proof and zero executing engines', () => {
  const plan = createCutoverPlan({
    ...base, scope: 'jobs', targetEngine: 'graphile', mode: 'apply',
    items: [{
      tenantId: 'tenant-a', semanticId: 'job-1', sourceState: 'running',
      activeExecutions: 1, executingEngines: ['legacy'],
      reconciliation: { verified: true, digest: `sha256:${'c'.repeat(64)}` },
    }],
  });
  assert.equal(plan.allowed, false);
  assert.ok(plan.reasons.includes('cutover_migration_unresolved'));
  assert.equal(plan.records[0].resolved, false);
});

test('joint validation binds fresh manual approval to both exact plans and manifests', () => {
  const input = jointApplyFixture();
  assert.equal(validateJointCutover(input, Date.parse('2026-08-19T18:05:00.000Z')).allowed, true);
  assert.ok(validateJointCutover(
    { ...input, confirmationDigest: `sha256:${'f'.repeat(64)}` },
    Date.parse('2026-08-19T18:05:00.000Z'),
  ).reasons.includes('approval_confirmation_mismatch'));
  assert.ok(validateJointCutover(input, Date.parse('2026-08-19T18:16:00.001Z')).reasons.includes('approval_stale'));
});

test('joint apply retires legacy and commits both target epochs plus audit in one transaction', async () => {
  const input = jointApplyFixture();
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql: String(sql).trim(), values });
      if (String(sql).includes('FOR UPDATE')) return { rows: [{ scope: 'jobs', engine: 'legacy' }, { scope: 'factory', engine: 'legacy' }] };
      return { rows: [], rowCount: 1 };
    },
    release() { queries.push({ sql: 'RELEASE' }); },
  };
  const result = await executeJointRuntimeCutover({ async connect() { return client; } }, input, {
    now: Date.parse('2026-08-19T18:05:00.000Z'),
  });
  assert.equal(result.applied, true);
  assert.equal(queries[0].sql, 'BEGIN ISOLATION LEVEL SERIALIZABLE');
  assert.ok(queries.some((entry) => entry.sql.includes('runtime_control.cutover_audit')));
  assert.equal(queries.at(-2).sql, 'COMMIT');
  assert.equal(queries.at(-1).sql, 'RELEASE');
});

test('joint apply rolls back when a target runtime already owns either scope', async () => {
  const input = jointApplyFixture();
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(String(sql).trim());
      if (String(sql).includes('FOR UPDATE')) return { rows: [{ scope: 'jobs', engine: 'graphile' }] };
      return { rows: [] };
    },
    release() { queries.push('RELEASE'); },
  };
  await assert.rejects(
    executeJointRuntimeCutover({ async connect() { return client; } }, input, {
      now: Date.parse('2026-08-19T18:05:00.000Z'),
    }),
    { code: 'runtime_cutover_existing_target_owner' },
  );
  assert.ok(queries.includes('ROLLBACK'));
  assert.equal(queries.at(-1), 'RELEASE');
});

test('static legacy-zero guard truthfully blocks final cleanup while executable paths remain', () => {
  for (const scope of ['jobs', 'factory']) {
    const result = verifyLegacyRemoval(scope, require('node:path').resolve(__dirname, '../..'));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'legacy_runtime_reference_present');
    assert.ok(result.present.length > 0);
  }
});
