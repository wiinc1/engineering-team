'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldSkipForgePhases,
  buildSkippedForgeSeedApi,
  buildSkippedForgeJob,
  resolveForgeSkipDecision,
  POLICY_VERSION,
} = require('../../lib/task-platform/golden-path-forge-skip');
const { runDeployValidation, validationSubprocessEnv } = require('../../lib/task-platform/golden-path-validation');

describe('golden-path forge skip helpers', () => {
  it('detects skip forge from options and phase2 skipped stack', () => {
    assert.equal(shouldSkipForgePhases({ skipForgeSeed: true, templateTier: 'Simple' }), true);
    assert.equal(shouldSkipForgePhases({}, { forge: null, stack: { skipped: true }, forgePolicy: { skipped: true } }), true);
    assert.equal(shouldSkipForgePhases({}, { forge: {}, api: { seed: { skipped: false } } }), false);
  });

  it('fails closed for non-Simple skip request', () => {
    assert.throws(
      () => shouldSkipForgePhases({ skipForgeSeed: true, templateTier: 'Standard' }),
      (err) => err && err.code === 'FORGE_SKIP_FORBIDDEN',
    );
  });

  it('builds skipped forge seed api shape with policy', () => {
    const decision = resolveForgeSkipDecision({ skipForgeSeed: true, templateTier: 'Simple' }, {});
    const api = buildSkippedForgeSeedApi(decision.record);
    assert.equal(api.seed.skipped, true);
    assert.equal(api.start.job.status, 'skipped');
    assert.equal(api.forgePolicy.policyVersion, POLICY_VERSION);
    assert.equal(api.seed.forgePolicy.skipped, true);
    const job = buildSkippedForgeJob('skip_forge_seed', decision.record);
    assert.equal(job.ok, true);
    assert.equal(job.forgePolicy.mode, 'simple_optional_skip');
  });
});

describe('golden-path validation env isolation', () => {
  it('strips live proof forge tokens from validation env', () => {
    const env = validationSubprocessEnv({
      FORGEADAPTER_SERVICE_TOKEN: 'live-token',
      OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
      NODE_ENV: 'test',
    });
    assert.equal(env.FORGEADAPTER_SERVICE_TOKEN, undefined);
    assert.equal(env.OPENCLAW_BASE_URL, undefined);
    assert.equal(env.ALLOW_FILE_AUDIT_BACKEND, 'true');
  });

  it('marks intentional skip as ok', async () => {
    const result = await runDeployValidation({ skipValidation: true });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
  });
});
