'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRuntimeDelegateWork } = require('../../lib/software-factory/runtime-delegation');
const {
  GROK_SPECIALIST_RUNNER,
  resolveSpecialistRuntimeProvider,
} = require('../../lib/software-factory/specialist-runtime-provider');

const grokStub = path.join(__dirname, '..', 'fixtures', 'grok-cli-stub.js');

test('Grok runner delegates through the shared stdin/stdout contract', async () => {
  fs.chmodSync(grokStub, 0o755);
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specialist-runtime-grok-'));
  const delegateWork = createRuntimeDelegateWork({
    baseDir,
    delegationRunnerCommand: GROK_SPECIALIST_RUNNER,
    runnerEnv: {
      PATH: process.env.PATH,
      GROK_BIN: grokStub,
    },
  });

  const result = await delegateWork({
    specialist: 'engineer',
    request: 'Please implement this fix',
    delegationId: 'integration-grok',
    payloadVersion: 1,
  });
  assert.equal(result.agentId, 'sr-engineer');
  assert.match(result.sessionId, /^(specialist-delegation-)?[0-9a-f-]{36}$/i);
  assert.equal(result.ownership.runtimeProvider, 'grok');
  assert.equal(result.ownership.specialistId, 'engineer');
  assert.equal(result.output, 'OK');
});

test('missing Grok binary falls back without claiming live session ownership', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specialist-runtime-missing-'));
  const { createSpecialistCoordinator } = require('../../lib/software-factory/delegation');
  const coordinator = createSpecialistCoordinator({
    baseDir,
    artifactBaseDir: baseDir,
    delegateWork: createRuntimeDelegateWork({
      baseDir,
      delegationRunnerCommand: GROK_SPECIALIST_RUNNER,
      runnerEnv: {
        PATH: '/usr/bin:/bin',
        GROK_BIN: '/no/such/grok-binary',
      },
    }),
  });
  const result = await coordinator.handleRequest('Please implement this fix', {
    coordinatorAgent: 'main',
    targetSpecialist: 'engineer',
  });
  assert.equal(result.mode, 'fallback');
  assert.equal(result.attribution.delegated, false);
  assert.ok(result.metadata.errorCode);
});

test('switching SPECIALIST_RUNTIME_PROVIDER changes the resolved runner command', () => {
  const grok = resolveSpecialistRuntimeProvider({ env: { SPECIALIST_RUNTIME_PROVIDER: 'grok' } });
  const openclaw = resolveSpecialistRuntimeProvider({ env: { SPECIALIST_RUNTIME_PROVIDER: 'openclaw' } });
  const extra = resolveSpecialistRuntimeProvider({
    env: {
      SPECIALIST_RUNTIME_PROVIDER: 'other',
      SPECIALIST_RUNTIME_PROVIDERS: JSON.stringify({
        other: { runner: 'node scripts/other-specialist-runner.js', binary: 'other' },
      }),
    },
  });
  assert.match(grok.runner, /grok-specialist-runner/);
  assert.match(openclaw.runner, /openclaw-specialist-runner/);
  assert.match(extra.runner, /other-specialist-runner/);
});
