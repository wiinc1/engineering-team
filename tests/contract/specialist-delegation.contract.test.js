const test = require('node:test');
// Issue #130 standards evidence: specialist delegation contract coverage remains active after mechanical compaction.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRuntimeDelegateWork, normalizeRuntimeEvidence } = require('../../lib/software-factory/runtime-delegation');

const runtimeRunnerPath = path.join(__dirname, '..', 'fixtures', 'specialist-runtime-runner.js');

test('runtime delegation fixture satisfies the evidence contract', async () => {
  const delegateWork = createRuntimeDelegateWork({
    baseDir: fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-contract-')),
    delegationRunnerCommand: `node ${runtimeRunnerPath}`,
  });

  const result = await delegateWork({
    specialist: 'engineer',
    request: 'Please implement this fix',
    delegationId: 'contract-check',
  });

  assert.equal(result.agentId, 'engineer');
  assert.equal(result.sessionId, 'runtime-session-contract-check');
  assert.equal(result.ownership.runtime, 'fixture-openclaw');
});

test('normalizeRuntimeEvidence rejects responses that omit required ownership evidence', () => {
  assert.throws(
    () => normalizeRuntimeEvidence({ agentId: 'engineer' }),
    /must include agentId and sessionId/i,
  );
});
