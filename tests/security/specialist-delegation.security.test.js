const test = require('node:test');
// Issue #130 standards evidence: specialist delegation security coverage remains active after mechanical compaction.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSpecialistCoordinator, resolveDelegationArtifactBaseDir } = require('../../lib/software-factory/delegation');
const { DEFAULT_SPECIALIST_MAP } = require('../../scripts/openclaw-specialist-runner');
const { DEFAULT_SMOKE_REQUEST } = require('../../scripts/validate-specialist-runtime');

test('delegation fallback messages stay sanitized when runtime execution fails', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-security-'));
  const coordinator = createSpecialistCoordinator({
    baseDir,
    delegateWork: async () => {
      const error = new Error('secret token leaked from /usr/local/bin/runtime');
      error.code = 'SPECIALIST_RUNTIME_EXEC_FAILED';
      throw error;
    },
  });

  const result = await coordinator.handleRequest('Please implement this feature', { coordinatorAgent: 'main' });

  assert.equal(result.mode, 'fallback');
  assert.match(result.message, /failed during execution/i);
  assert.doesNotMatch(result.message, /secret token/i);
  assert.doesNotMatch(result.message, /\/usr\/local\/bin\/runtime/i);
  assert.equal(result.metadata.fallbackReason, 'runtime_exec_failed');
  assert.equal(result.metadata.userFacingReasonCategory, 'runtime_execution_failed');
});

test('canonical specialist delegation disablement does not leak the legacy flag identifier', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-security-disabled-'));
  const coordinator = createSpecialistCoordinator({
    baseDir,
    ffSpecialistDelegation: 'false',
  });

  const result = await coordinator.handleRequest('Please implement this feature', { coordinatorAgent: 'main' });

  assert.equal(result.mode, 'coordinator');
  assert.equal(result.metadata.fallbackReason, 'feature_disabled');
  assert.match(result.message, /ff_real_specialist_delegation/i);
  assert.doesNotMatch(result.message, /ff_specialist_delegation/i);
});

test('default live smoke request is bounded against repository edits', () => {
  assert.match(DEFAULT_SMOKE_REQUEST, /replying OK only/i);
  assert.match(DEFAULT_SMOKE_REQUEST, /Do not inspect or edit files/i);
  assert.doesNotMatch(DEFAULT_SMOKE_REQUEST, /\bQA\b|\btest\b/i);
});

test('serverless artifact base selection avoids read-only bundle paths', () => {
  assert.equal(
    resolveDelegationArtifactBaseDir({ baseDir: '/var/task' }, { FACTORY_SERVERLESS: '1' }),
    path.join('/tmp', 'engineering-team'),
  );
  assert.equal(
    resolveDelegationArtifactBaseDir(
      { baseDir: '/var/task' },
      { FACTORY_SERVERLESS: '1', SPECIALIST_DELEGATION_ARTIFACT_DIR: '/tmp/delegation-artifacts' },
    ),
    '/tmp/delegation-artifacts',
  );
});

test('default OpenClaw specialist map covers all assignable pilot roles', () => {
  for (const role of [
    'pm',
    'architect',
    'engineer',
    'principal',
    'jr-engineer',
    'sr-engineer',
    'qa',
    'sre',
    'engineer-jr',
    'engineer-sr',
    'engineer-principal',
  ]) {
    assert.equal(typeof DEFAULT_SPECIALIST_MAP[role], 'string');
    assert.notEqual(DEFAULT_SPECIALIST_MAP[role].trim(), '');
  }
});
