'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evidenceModeOptions } = require('../../lib/task-platform/factory-phase-runner-options');
const { buildFactoryCloseoutReport } = require('../../lib/task-platform/factory-closeout');
const { trustedPremergeFailures } = require('../../lib/task-platform/trusted-simple-merge');

test('trusted Simple close composes PR gates without claiming hosted release evidence', () => {
  const options = evidenceModeOptions({
    proofProfile: 'live',
    trustedDelivery: true,
    agentDrivenPhases: true,
  }, { id: 'factory-milestone-c-contract', templateTier: 'Simple' });
  assert.equal(options.trustedSimpleClose, true);
  assert.equal(options.requireRealEvidence, false);
  assert.equal(options.collectRealEvidence, false);

  assert.deepEqual(trustedPremergeFailures({
    requiredChecks: ['Repo validation', 'verify', 'Merge readiness'],
    checks: [
      { name: 'Repo validation', conclusion: 'success', source: 'github_check_run' },
      { name: 'verify', conclusion: 'success', source: 'github_check_run' },
    ],
  }), []);

  const reference = {
    path: 'observability/trusted-simple-close/TSK-901.json',
    sha256: '9'.repeat(64),
  };
  const closeout = buildFactoryCloseoutReport({
    engineeringTeam: { taskId: 'TSK-901' },
    status: 'phase6_complete',
    manualInterventions: [],
    trustedSimpleCloseEvidence: reference,
  }, { inventoryPath: '/definitely/missing/inventory.json' });
  assert.deepEqual(closeout.trustedSimpleCloseEvidence, reference);
  assert.deepEqual(closeout.manualInterventions, []);
});
