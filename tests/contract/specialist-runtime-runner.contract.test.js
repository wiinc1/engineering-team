'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertPayloadVersion,
  buildBridgeResponse,
  extractSessionId,
} = require('../../lib/software-factory/specialist-runtime-bridge');
const { buildBridgeResponse: openclawBridge } = require('../../scripts/openclaw-specialist-runner');

test('runner payload version 1 is the shared contract', () => {
  assert.equal(assertPayloadVersion({}), 1);
  assert.equal(assertPayloadVersion({ payloadVersion: 1 }), 1);
  assert.throws(
    () => assertPayloadVersion({ payloadVersion: 99 }),
    (error) => error.code === 'SPECIALIST_RUNTIME_VERSION_UNSUPPORTED',
  );
});

test('Grok and OpenClaw adapters emit the same evidence shape', () => {
  const payload = { specialist: 'qa', delegationId: 'contract-shared' };
  const grok = buildBridgeResponse({
    payload,
    runtimeAgent: 'qa-engineer',
    response: { sessionId: '55555555-5555-4555-8555-555555555555', output: 'OK' },
    runtimeProvider: 'grok',
  });
  const openclaw = openclawBridge({
    payload,
    runtimeAgent: 'qa-engineer',
    response: {
      result: {
        payloads: [{ text: 'OK' }],
        meta: { agentMeta: { sessionId: 'specialist-delegation-contract-shared' } },
      },
    },
  });
  for (const evidence of [grok, openclaw]) {
    assert.equal(typeof evidence.agentId, 'string');
    assert.equal(typeof evidence.sessionId, 'string');
    assert.ok(evidence.sessionId);
    assert.equal(typeof evidence.output, 'string');
    assert.equal(evidence.ownership.specialistId, 'qa');
    assert.equal(evidence.ownership.runtimeAgentId, 'qa-engineer');
  }
  assert.equal(grok.ownership.runtimeProvider, 'grok');
});

test('extractSessionId reads Grok and OpenClaw response shapes', () => {
  assert.equal(extractSessionId({ sessionId: 'sess-a' }), 'sess-a');
  assert.equal(extractSessionId({ result: { meta: { agentMeta: { sessionId: 'sess-b' } } } }), 'sess-b');
});
