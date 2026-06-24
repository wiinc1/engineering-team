const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMilestoneDCompleteEvidence,
  runMilestoneDCloseoutVerify,
} = require('../../lib/audit/milestone-d-closeout-verify');

test('milestone D verify module exports closeout verifier', () => {
  assert.equal(typeof runMilestoneDCloseoutVerify, 'function');
  assert.equal(typeof buildMilestoneDCompleteEvidence, 'function');
});

test('buildMilestoneDCompleteEvidence maps verify checks to exit criteria', () => {
  const complete = buildMilestoneDCompleteEvidence({
    profile: 'coordinated-stack',
    baseUrl: 'http://127.0.0.1:13000',
    summary: {
      passed: true,
      checks: [
        { name: 'factory_phase6_complete', ok: true },
        { name: 'gp027_closeout_report', ok: true },
        { name: 'gp027_task_closed', ok: true },
        { name: 'gp027_step_classification', ok: true },
        { name: 'gp023_validation_in_closeout', ok: true },
      ],
    },
    closeout: {
      stepClassification: { automated: 20, stillManual: 2 },
    },
    artifacts: {
      factoryEvidence: 'observability/factory-closeout/TSK-007.json',
    },
  });

  assert.equal(complete.kind, 'milestone-d-complete');
  assert.equal(complete.summary.passed, true);
  assert.equal(complete.exitCriteria.milestoneDVerify, true);
  assert.equal(complete.exitCriteria.automatedStepsAtLeast12, true);
  assert.match(complete.notes.join(' '), /GP-022/);
});