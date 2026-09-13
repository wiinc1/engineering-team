'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  DEFAULT_PROVIDER,
  GROK_SPECIALIST_RUNNER,
  OPENCLAW_SPECIALIST_RUNNER,
  PROVIDER_UNKNOWN,
  listProviders,
  resolveProviderName,
  resolveRuntimeAgent,
  resolveSpecialistDelegationRunner,
  resolveSpecialistRuntimeProvider,
} = require('../../lib/software-factory/specialist-runtime-provider');

test('defaults to grok when no provider is configured', () => {
  assert.equal(resolveProviderName({ env: {} }), DEFAULT_PROVIDER);
  const provider = resolveSpecialistRuntimeProvider({ env: {} });
  assert.equal(provider.name, 'grok');
  assert.match(provider.runner, /grok-specialist-runner\.js$/);
  assert.equal(provider.health.kind, 'cli');
});

test('selects the OpenClaw adapter when SPECIALIST_RUNTIME_PROVIDER=openclaw', () => {
  const provider = resolveSpecialistRuntimeProvider({
    env: { SPECIALIST_RUNTIME_PROVIDER: 'openclaw' },
  });
  assert.equal(provider.name, 'openclaw');
  assert.equal(provider.runner, OPENCLAW_SPECIALIST_RUNNER);
  assert.equal(provider.health.kind, 'http');
});

test('rejects an unknown provider name', () => {
  assert.throws(
    () => resolveSpecialistRuntimeProvider({ env: { SPECIALIST_RUNTIME_PROVIDER: 'codex-prime' } }),
    (error) => {
      assert.equal(error.code, PROVIDER_UNKNOWN);
      assert.match(error.message, /codex-prime/);
      return true;
    },
  );
});

test('rejects extra providers whose runner is not a repo scripts adapter', () => {
  assert.throws(
    () => resolveSpecialistRuntimeProvider({
      env: {
        SPECIALIST_RUNTIME_PROVIDER: 'evil',
        SPECIALIST_RUNTIME_PROVIDERS: JSON.stringify({
          evil: { runner: 'node -e "process.stdout.write(\\"hi\\")"', binary: 'node' },
        }),
      },
    }),
    (error) => {
      assert.equal(error.code, PROVIDER_UNKNOWN);
      assert.match(error.message, /scripts\/\*-specialist-runner/);
      return true;
    },
  );
});

test('registers a third provider from SPECIALIST_RUNTIME_PROVIDERS', () => {
  const env = {
    SPECIALIST_RUNTIME_PROVIDER: 'codex',
    SPECIALIST_RUNTIME_PROVIDERS: JSON.stringify({
      codex: { runner: 'node scripts/codex-specialist-runner.js', binary: 'codex' },
    }),
  };
  const provider = resolveSpecialistRuntimeProvider({ env });
  assert.equal(provider.name, 'codex');
  assert.equal(provider.runner, 'node scripts/codex-specialist-runner.js');
  assert.deepEqual(Object.keys(listProviders(env)).sort(), ['codex', 'grok', 'openclaw']);
});

test('explicit SPECIALIST_DELEGATION_RUNNER wins over the provider default', () => {
  const resolved = resolveSpecialistDelegationRunner({
    env: {
      SPECIALIST_RUNTIME_PROVIDER: 'openclaw',
      SPECIALIST_DELEGATION_RUNNER: 'node scripts/grok-specialist-runner.js',
    },
  });
  assert.equal(resolved.name, 'openclaw');
  assert.match(resolved.runner, /grok-specialist-runner\.js$/);
  assert.equal(resolved.override, true);
});

test('Grok and OpenClaw share specialist alias maps', () => {
  assert.equal(resolveRuntimeAgent('pm', {}, 'GROK_SPECIALIST_MAP'), 'product-manager');
  assert.equal(resolveRuntimeAgent('engineer', {}, 'GROK_SPECIALIST_MAP'), 'sr-engineer');
  assert.equal(resolveRuntimeAgent('qa', {}, 'OPENCLAW_SPECIALIST_MAP'), 'qa-engineer');
  assert.equal(resolveRuntimeAgent('sre', {
    GROK_SPECIALIST_MAP: JSON.stringify({ sre: 'site-reliability' }),
  }, 'GROK_SPECIALIST_MAP'), 'site-reliability');
});

test('grok runner path is distinct from the OpenClaw adapter', () => {
  assert.match(GROK_SPECIALIST_RUNNER, /scripts\/grok-specialist-runner\.js$/);
  assert.match(OPENCLAW_SPECIALIST_RUNNER, /scripts\/openclaw-specialist-runner\.js$/);
  assert.notEqual(GROK_SPECIALIST_RUNNER, OPENCLAW_SPECIALIST_RUNNER);
  assert.equal(path.basename(GROK_SPECIALIST_RUNNER.replace(/^node /, '')), 'grok-specialist-runner.js');
});
