const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildFactoryExecutionContractBody,
  resolveFactoryWorkCategory,
  FIXTURE_DELEGATION_RUNNER,
  resolveAgentDelegationRunner,
  resolveAgentDelegationEnv,
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

test('buildFactoryExecutionContractBody preserves requested non-Simple tier', () => {
  const body = buildFactoryExecutionContractBody({
    requirements: 'Implement a low-risk code path\nValidate with unit tests',
    templateTier: 'Standard',
    changeKind: 'bugfix',
    changedFiles: ['lib/task-platform/factory-delivery.js'],
  });
  assert.equal(body.templateTier, 'Standard');
  assert.equal(body.dispatchSignals.factoryTemplateTier, 'Standard');
  assert.equal(body.dispatchSignals.workCategory, 'code');
  assert.equal(body.dispatchSignals.changeKind, 'bugfix');
  assert.deepEqual(body.dispatchSignals.changedFiles, ['lib/task-platform/factory-delivery.js']);
  assert.ok(body.sections['3']);
});

test('resolveFactoryWorkCategory keeps docs-only work distinct from code work', () => {
  assert.equal(resolveFactoryWorkCategory({ changeKind: 'docs-only' }), 'docs');
  assert.equal(resolveFactoryWorkCategory({ changeKind: 'refactor' }), 'clear_refactor');
  assert.equal(resolveFactoryWorkCategory({ changeKind: 'bugfix' }), 'code');
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

test('resolveAgentDelegationRunner uses live runner for strict real-evidence delegation', () => {
  const runner = resolveAgentDelegationRunner({ requireRealEvidence: true }, {});
  assert.match(runner, /openclaw-specialist-runner\.js/);
  assert.doesNotMatch(runner, /specialist-runtime-runner/);

  const env = resolveAgentDelegationEnv({ collectRealEvidence: true }, {});
  assert.match(env.SPECIALIST_DELEGATION_RUNNER, /openclaw-specialist-runner\.js/);
});

test('resolveAgentDelegationRunner rejects fixture runner in strict real-evidence delegation', () => {
  assert.throws(
    () => resolveAgentDelegationRunner({ requireRealEvidence: true }, {
      FACTORY_USE_FIXTURE_DELEGATION: 'true',
    }),
    /FACTORY_PROOF_FIXTURE_FORBIDDEN|Real-evidence|live factory proof cannot use the fixture specialist runner/,
  );
  assert.throws(
    () => resolveAgentDelegationRunner({
      collectRealEvidence: true,
      delegationRunner: FIXTURE_DELEGATION_RUNNER,
    }, {}),
    /FACTORY_PROOF_FIXTURE_FORBIDDEN|Real-evidence|live factory proof cannot use the fixture specialist runner/,
  );
});

test('resolveAgentDelegationRunner rejects fixture under FACTORY_PROOF_PROFILE=live', () => {
  assert.throws(
    () => resolveAgentDelegationRunner({}, {
      FACTORY_PROOF_PROFILE: 'live',
      FACTORY_USE_FIXTURE_DELEGATION: 'true',
    }),
    /FACTORY_PROOF_FIXTURE_FORBIDDEN/,
  );
  const runner = resolveAgentDelegationRunner({}, {
    FACTORY_PROOF_PROFILE: 'live',
    FF_REAL_SPECIALIST_DELEGATION: 'true',
  });
  assert.match(runner, /openclaw-specialist-runner\.js/);
});

test('pmRefinementDelegated detects completed delegated refinement responses', () => {
  assert.equal(pmRefinementDelegated({
    body: { data: { status: 'completed', delegation: { delegated: true } } },
  }), true);
  assert.equal(extractPmRefinementContractVersion({
    body: { data: { contract: { version: 2 } } },
  }), 2);
});
