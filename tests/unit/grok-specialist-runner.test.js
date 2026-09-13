'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGrokArgs,
  parseGrokResponse,
  parsePayload,
  resolveSessionId,
  toLiveEvidenceSessionId,
} = require('../../scripts/grok-specialist-runner');
const { buildBridgeResponse } = require('../../lib/software-factory/specialist-runtime-bridge');

test('parsePayload accepts missing payloadVersion as v1', () => {
  const payload = parsePayload(JSON.stringify({
    specialist: 'engineer',
    request: 'Please implement this fix',
    delegationId: 'd1',
  }));
  assert.equal(payload.specialist, 'engineer');
});

test('parsePayload rejects unsupported payload versions', () => {
  assert.throws(
    () => parsePayload(JSON.stringify({ payloadVersion: 2, specialist: 'engineer' })),
    (error) => error.code === 'SPECIALIST_RUNTIME_VERSION_UNSUPPORTED',
  );
});

test('resolveSessionId uses a UUID fallback and strips live evidence prefix for Grok CLI', () => {
  const generated = resolveSessionId({});
  assert.match(generated, /^[0-9a-f-]{36}$/i);
  const reused = resolveSessionId({ sessionId: '11111111-1111-4111-8111-111111111111' });
  assert.equal(reused, '11111111-1111-4111-8111-111111111111');
  const stripped = resolveSessionId({
    sessionId: 'specialist-delegation-11111111-1111-4111-8111-111111111111',
  });
  assert.equal(stripped, '11111111-1111-4111-8111-111111111111');
});

test('buildGrokArgs is headless JSON with always-approve and a UUID session', () => {
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const args = buildGrokArgs({
    payload: { request: 'Please implement this fix' },
    runtimeAgent: 'sr-engineer',
    sessionId,
    env: {},
  });
  assert.deepEqual(args, [
    '--agent', 'sr-engineer',
    '--output-format', 'json',
    '--session-id', sessionId,
    '--always-approve',
    '-p', 'Please implement this fix',
  ]);
});

test('Grok JSON and plain output both satisfy the runner contract', () => {
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const json = parseGrokResponse(JSON.stringify({
    sessionId,
    output: 'OK',
  }));
  const jsonBridge = buildBridgeResponse({
    payload: { specialist: 'engineer' },
    runtimeAgent: 'sr-engineer',
    response: json,
    sessionIdFallback: sessionId,
    runtimeProvider: 'grok',
  });
  assert.equal(jsonBridge.agentId, 'sr-engineer');
  assert.equal(jsonBridge.sessionId, sessionId);
  assert.equal(jsonBridge.output, 'OK');
  assert.equal(jsonBridge.ownership.runtimeProvider, 'grok');
  assert.equal(
    toLiveEvidenceSessionId(jsonBridge.sessionId),
    `specialist-delegation-${sessionId}`,
  );

  const plain = parseGrokResponse('OK from grok');
  const plainBridge = buildBridgeResponse({
    payload: { specialist: 'qa' },
    runtimeAgent: 'qa-engineer',
    response: plain,
    sessionIdFallback: sessionId,
    runtimeProvider: 'grok',
  });
  assert.equal(plainBridge.sessionId, sessionId);
  assert.equal(plainBridge.output, 'OK from grok');
});
