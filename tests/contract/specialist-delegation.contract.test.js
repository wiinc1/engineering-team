const test = require('node:test');
// Issue #130 standards evidence: specialist delegation contract coverage remains active after mechanical compaction.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRuntimeDelegateWork, normalizeRuntimeEvidence } = require('../../lib/software-factory/runtime-delegation');
const { createSpecialistCoordinator } = require('../../lib/software-factory/delegation');
const { buildBridgeResponse, resolveRuntimeAgent } = require('../../scripts/openclaw-specialist-runner');

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

  assert.equal(result.agentId, resolveRuntimeAgent('engineer'));
  assert.equal(result.ownership.specialistId, 'engineer');
  assert.equal(result.ownership.runtimeAgentId, resolveRuntimeAgent('engineer'));
  assert.equal(result.sessionId, 'runtime-session-contract-check');
  assert.equal(result.ownership.runtime, 'fixture-openclaw');
});

test('normalizeRuntimeEvidence rejects responses that omit required ownership evidence', () => {
  assert.throws(
    () => normalizeRuntimeEvidence({ agentId: 'engineer' }),
    /must include agentId and sessionId/i,
  );
});

test('OpenClaw gateway responses satisfy the bridge evidence contract', () => {
  const bridge = buildBridgeResponse({
    payload: {
      specialist: 'engineer',
      delegationId: 'contract-gateway',
    },
    runtimeAgent: 'sr-engineer',
    response: {
      result: {
        payloads: [{ text: 'OK' }],
        meta: {
          agentMeta: {
            sessionId: 'specialist-delegation-contract-gateway',
          },
        },
      },
    },
  });

  assert.equal(bridge.agentId, 'sr-engineer');
  assert.equal(bridge.sessionId, 'specialist-delegation-contract-gateway');
  assert.equal(bridge.output, 'OK');
  assert.equal(bridge.ownership.specialistId, 'engineer');
});

test('OpenClaw PM refinement responses satisfy the bridge evidence contract', () => {
  const bridge = buildBridgeResponse({
    payload: {
      specialist: 'pm',
      delegationId: 'contract-pm-refinement',
    },
    runtimeAgent: 'pm',
    response: {
      result: {
        message: 'PM refinement complete',
        meta: {
          agentMeta: {
            sessionId: 'specialist-delegation-contract-pm-refinement',
          },
        },
      },
    },
  });

  assert.equal(bridge.agentId, 'pm');
  assert.equal(bridge.sessionId, 'specialist-delegation-contract-pm-refinement');
  assert.equal(bridge.output, 'PM refinement complete');
  assert.equal(bridge.ownership.specialistId, 'pm');
  assert.equal(bridge.ownership.runtimeAgentId, 'pm');
});

test('delegation artifacts may be stored outside the runtime working directory', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-contract-cwd-'));
  const artifactBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-contract-artifacts-'));
  const coordinator = createSpecialistCoordinator({
    baseDir,
    artifactBaseDir,
    delegateWork: async () => ({
      agentId: 'engineer',
      sessionId: 'runtime-session-artifact-contract',
      output: 'artifact contract satisfied',
    }),
  });

  const result = await coordinator.handleRequest('Please implement this fix', { coordinatorAgent: 'main' });

  assert.equal(result.mode, 'delegated');
  assert.equal(result.metadata.artifactPath, path.join(artifactBaseDir, 'observability', 'specialist-delegation.jsonl'));
  assert.equal(fs.existsSync(path.join(baseDir, 'observability')), false);
});
