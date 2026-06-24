const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildGoldenPathForgeDispatch,
  buildGoldenPathSimpleSections,
  buildExecutionContractBody,
} = require('../../lib/task-platform/golden-path-phase1');
const { validateExecutionContract } = require('../../lib/audit/execution-contracts');

test('golden path contract sections satisfy Simple tier validation', () => {
  const contract = {
    template_tier: 'Simple',
    owner: 'pm',
    sections: buildGoldenPathSimpleSections(),
  };
  const validation = validateExecutionContract(contract);
  assert.equal(validation.status, 'valid');
  assert.deepEqual(validation.missingSections, []);
});

test('golden path forge dispatch targets engineering-team workflow repo', () => {
  assert.deepEqual(buildGoldenPathForgeDispatch(), {
    targetRepo: 'wiinc1/engineering-team',
    projectId: 'engineering-team',
    domain: 'workflow',
    affectsUi: false,
  });
});

test('golden path execution contract body includes committed requirements', () => {
  const body = buildExecutionContractBody();
  assert.equal(body.templateTier, 'Simple');
  assert.equal(body.forgeDispatch.targetRepo, 'wiinc1/engineering-team');
  assert.ok(body.scopeBoundaries.committedRequirements.length >= 2);
  assert.deepEqual(body.autoApprovalSignals.unresolvedDependencies, []);
});