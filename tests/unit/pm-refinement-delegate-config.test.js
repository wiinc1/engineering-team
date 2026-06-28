const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  resolvePmRefinementDelegateWork,
  shouldUseOpenClawPmRefinementDelegate,
  buildOpenClawPmRefinementEnv,
} = require('../../lib/audit/pm-refinement-delegate-config');

test('golden path defaults to OpenClaw PM refinement delegate', () => {
  const env = {
    NODE_ENV: 'development',
    GOLDEN_PATH_LOCAL_PM_REFINEMENT: 'false',
    GOLDEN_PATH_OPENCLAW_PM_REFINEMENT: 'true',
    PM_REFINEMENT_DELEGATE_WORK: 'openclaw',
  };
  assert.equal(shouldUseOpenClawPmRefinementDelegate(env), true);
  const resolved = resolvePmRefinementDelegateWork(env, path.join(process.cwd()));
  assert.equal(resolved.mode, 'openclaw');
  assert.equal(typeof resolved.delegateWork, 'function');
  assert.match(resolved.openClawEnv.SPECIALIST_DELEGATION_RUNNER, /openclaw-specialist-runner\.js$/);
});

test('local PM refinement remains opt-in via GOLDEN_PATH_LOCAL_PM_REFINEMENT', () => {
  const env = {
    NODE_ENV: 'development',
    GOLDEN_PATH_LOCAL_PM_REFINEMENT: 'true',
  };
  const resolved = resolvePmRefinementDelegateWork(env, process.cwd());
  assert.equal(resolved.mode, 'local');
});