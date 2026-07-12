'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  FORGE_GP_STEPS,
  PHASE2_FORGE_GP_STEPS,
  POLICY_VERSION,
  resolveForgeClaimPolicy,
  assertForgeSkipAllowed,
  resolveForgeSkipDecision,
  partitionForgeSteps,
  partitionPhaseStepsWithForgePolicy,
  applyForgeSkipToStepInventory,
} = require('../../lib/task-platform/forge-claim-policy');

describe('forge-claim-policy Simple skip (#273)', () => {
  it('allows Simple-class optional skip with honest mode', () => {
    const policy = resolveForgeClaimPolicy(
      { skipForgeSeed: true, templateTier: 'Simple' },
      {},
    );
    assert.equal(policy.canSkip, true);
    assert.equal(policy.forgeRequired, false);
    assert.equal(policy.mode, 'simple_optional_skip');
    assert.match(policy.rationale, /optional|Simple/i);
  });

  it('resolveForgeSkipDecision skips only when allowed', () => {
    const allowed = resolveForgeSkipDecision(
      { skipForgePhases: true, templateTier: 'Simple' },
      {},
    );
    assert.equal(allowed.skip, true);
    assert.equal(allowed.record.skipped, true);
    assert.equal(allowed.record.policyVersion, POLICY_VERSION);
    assert.deepEqual(allowed.record.skippedSteps, [...FORGE_GP_STEPS]);
  });

  it('env STAGING_SKIP_FORGE_* is honored for Simple', () => {
    const simple = resolveForgeSkipDecision({}, { STAGING_SKIP_FORGE_SEED: 'true' });
    assert.equal(simple.skip, true);
  });
});

describe('forge-claim-policy fail-closed (#273)', () => {
  it('forbids Standard/Complex skip', () => {
    const policy = resolveForgeClaimPolicy(
      { skipForgePhases: true, templateTier: 'Standard' },
      {},
    );
    assert.equal(policy.canSkip, false);
    assert.equal(policy.mode, 'skip_forbidden');
    assert.throws(
      () => assertForgeSkipAllowed({ skipForgeSeed: true, templateTier: 'Complex' }, {}),
      (err) => err && err.code === 'FORGE_SKIP_FORBIDDEN',
    );
  });

  it('forbids FACTORY_FORGE_REQUIRED even for Simple', () => {
    assert.throws(
      () => assertForgeSkipAllowed(
        { skipForgeSeed: true, templateTier: 'Simple' },
        { FACTORY_FORGE_REQUIRED: 'true' },
      ),
      (err) => err && err.code === 'FORGE_SKIP_FORBIDDEN',
    );
  });

  it('forbids STAGING_SKIP for Standard tier', () => {
    assert.throws(
      () => resolveForgeSkipDecision(
        { templateTier: 'Standard' },
        { STAGING_SKIP_FORGE_PHASES: 'true' },
      ),
      (err) => err && err.code === 'FORGE_SKIP_FORBIDDEN',
    );
  });
});

describe('forge-claim-policy inventory honesty (#273)', () => {
  it('partitionForgeSteps skips only forgeadapter GPs; keeps GP-012/014 under skip', () => {
    const skipped = partitionForgeSteps({
      skipped: true,
      includeGp013: true,
      includeGp012: true,
      includeGp014: true,
      phase: 'phase2',
    });
    assert.deepEqual(skipped.completed, ['GP-012', 'GP-013', 'GP-014']);
    assert.deepEqual(skipped.skipped, [...FORGE_GP_STEPS]);
    assert.ok(!skipped.completed.some((s) => FORGE_GP_STEPS.includes(s)));
    assert.ok(!skipped.skipped.includes('GP-012'));
    assert.ok(!skipped.skipped.includes('GP-014'));
    assert.ok(FORGE_GP_STEPS.includes('GP-009'));
    assert.ok(FORGE_GP_STEPS.includes('GP-011'));
    assert.ok(!FORGE_GP_STEPS.includes('GP-012'));
    assert.ok(!FORGE_GP_STEPS.includes('GP-014'));
  });

  it('partitionForgeSteps phase2 live includes forge + non-forge phase2 steps', () => {
    const live = partitionForgeSteps({
      skipped: false,
      includeGp013: false,
      includeGp012: true,
      includeGp014: true,
      phase: 'phase2',
    });
    assert.deepEqual(live.completed, [...PHASE2_FORGE_GP_STEPS, 'GP-012', 'GP-014']);
    assert.ok(!live.completed.includes('GP-016'));
    assert.ok(!live.completed.includes('GP-018'));
    assert.ok(!live.completed.includes('GP-020'));
  });

  it('partitionPhaseStepsWithForgePolicy strips forge steps when skipped', () => {
    const out = partitionPhaseStepsWithForgePolicy({
      steps: ['GP-015', 'GP-016'],
      forgeStepsInPhase: ['GP-016'],
      skipped: true,
    });
    assert.deepEqual(out.steps, ['GP-015']);
    assert.deepEqual(out.stepsSkipped, ['GP-016']);
  });

  it('applyForgeSkipToStepInventory removes only forgeadapter GPs from completed', () => {
    const decision = resolveForgeSkipDecision({ skipForgeSeed: true, templateTier: 'Simple' }, {});
    const evidence = applyForgeSkipToStepInventory({
      stepsCompleted: ['GP-009', 'GP-010', 'GP-012', 'GP-013', 'GP-014', 'GP-015', 'GP-016', 'GP-021'],
      stepsSkipped: [],
    }, decision.record);
    assert.ok(!evidence.stepsCompleted.includes('GP-009'));
    assert.ok(!evidence.stepsCompleted.includes('GP-016'));
    assert.ok(evidence.stepsCompleted.includes('GP-012'));
    assert.ok(evidence.stepsCompleted.includes('GP-013'));
    assert.ok(evidence.stepsCompleted.includes('GP-014'));
    assert.ok(evidence.stepsCompleted.includes('GP-015'));
    assert.ok(evidence.stepsCompleted.includes('GP-021'));
    assert.ok(evidence.stepsSkipped.includes('GP-009'));
    assert.ok(evidence.stepsSkipped.includes('GP-020'));
    assert.ok(!evidence.stepsSkipped.includes('GP-012'));
    assert.ok(!evidence.stepsSkipped.includes('GP-014'));
    assert.equal(evidence.forgePolicy.mode, 'simple_optional_skip');
  });
});
