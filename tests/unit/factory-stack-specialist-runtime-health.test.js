'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROVIDER_GROK,
  PROVIDER_OPENCLAW,
  resolveSpecialistRuntimeProvider,
  probeCliProvider,
} = require('../../lib/software-factory/specialist-runtime-provider');

test('Grok provider health is a CLI probe, not OpenClaw :18789', () => {
  const provider = resolveSpecialistRuntimeProvider({ env: { SPECIALIST_RUNTIME_PROVIDER: 'grok' } });
  assert.equal(provider.name, PROVIDER_GROK);
  assert.equal(provider.health.kind, 'cli');
  assert.notEqual(provider.health.kind, 'http');
});

test('OpenClaw provider health stays an HTTP gateway probe', () => {
  const provider = resolveSpecialistRuntimeProvider({ env: { SPECIALIST_RUNTIME_PROVIDER: 'openclaw' } });
  assert.equal(provider.name, PROVIDER_OPENCLAW);
  assert.equal(provider.health.kind, 'http');
  assert.match(provider.health.defaultUrl, /18789/);
});

test('CLI probe reports unavailable when the binary cannot start', async () => {
  const probe = await probeCliProvider(
    { name: 'grok', health: { kind: 'cli', binary: 'grok-not-installed-xyz' } },
    {
      env: {},
      execFileImpl: async () => {
        throw new Error('ENOENT');
      },
    },
  );
  assert.equal(probe.available, false);
  assert.equal(probe.errorCode, 'SPECIALIST_RUNTIME_NOT_CONFIGURED');
});

test('CLI probe reports available when --help succeeds', async () => {
  const probe = await probeCliProvider(
    { name: 'grok', health: { kind: 'cli', binary: 'grok' } },
    {
      env: {},
      execFileImpl: async () => ({ stdout: 'Grok Build TUI' }),
    },
  );
  assert.equal(probe.available, true);
  assert.equal(probe.provider, 'grok');
});
