'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePmRefinementTemplateTier,
  buildPmRefinementContractHttpBody,
} = require('../../lib/audit/pm-refinement-template-tier');

test('resolvePmRefinementTemplateTier prefers body, then options, then env, then Standard', () => {
  assert.equal(resolvePmRefinementTemplateTier({ templateTier: 'Simple' }), 'Simple');
  assert.equal(resolvePmRefinementTemplateTier({}, { template_tier: 'Simple' }), 'Simple');
  assert.equal(resolvePmRefinementTemplateTier({}, {}, { FACTORY_TEMPLATE_TIER: 'Simple' }), 'Simple');
  assert.equal(resolvePmRefinementTemplateTier(), 'Standard');
});

test('buildPmRefinementContractHttpBody includes ui_ux dispatch only when intake suggests UI', () => {
  const body = buildPmRefinementContractHttpBody({
    pmDraft: { templateTier: 'Simple', sections: [], riskFlags: [] },
    uiUxIntake: true,
    idempotencyKey: 'k1',
    contractIsValid: true,
    waitingState: 'execution_contract_review',
    defaultOperatorVerificationPath: () => '/tasks/TSK-1',
  });
  assert.equal(body.templateTier, 'Simple');
  assert.equal(body.dispatchSignals.workCategory, 'ui_ux');
  assert.equal(body.waitingState, 'execution_contract_review');
});
