const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildFactoryExecutionContractBody,
  resolveAgentDelegationRunner,
  pmRefinementDelegated,
  extractPmRefinementContractVersion,
} = require('../../lib/task-platform/factory-orchestration');

test('buildFactoryExecutionContractBody maps intake requirements into contract sections', () => {
  const body = buildFactoryExecutionContractBody({
    requirements: 'Add factory marker\nValidate with unit tests',
    templateTier: 'Simple',
  });
  assert.equal(body.templateTier, 'Simple');
  assert.match(body.sections['2'].body, /Add factory marker/);
  assert.equal(body.scopeBoundaries.committedRequirements.length, 2);
});

test('resolveAgentDelegationRunner defaults to fixture runner for local factory proof', () => {
  const previous = process.env.FACTORY_USE_FIXTURE_DELEGATION;
  delete process.env.SPECIALIST_DELEGATION_RUNNER;
  delete process.env.FF_REAL_SPECIALIST_DELEGATION;
  process.env.FACTORY_USE_FIXTURE_DELEGATION = 'true';
  assert.match(resolveAgentDelegationRunner(), /specialist-runtime-runner/);
  if (previous == null) delete process.env.FACTORY_USE_FIXTURE_DELEGATION;
  else process.env.FACTORY_USE_FIXTURE_DELEGATION = previous;
});

test('pmRefinementDelegated detects completed delegated refinement responses', () => {
  assert.equal(pmRefinementDelegated({
    body: { data: { status: 'completed', delegation: { delegated: true } } },
  }), true);
  assert.equal(extractPmRefinementContractVersion({
    body: { data: { contract: { version: 2 } } },
  }), 2);
});