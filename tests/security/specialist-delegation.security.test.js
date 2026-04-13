const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSpecialistCoordinator } = require('../../lib/software-factory/delegation');

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
});
