const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBridgeResponse,
  buildOpenClawArgs,
  extractOutput,
  extractSessionId,
  parseJsonFromStdout,
  resolveRuntimeAgent,
  resolveSpecialistMap,
} = require('../../scripts/openclaw-specialist-runner');

test('resolveSpecialistMap merges defaults with overrides', () => {
  const map = resolveSpecialistMap({
    OPENCLAW_SPECIALIST_MAP: JSON.stringify({
      engineer: 'jr-engineer',
    }),
  });

  assert.equal(map.engineer, 'jr-engineer');
  assert.equal(map.architect, 'architect');
  assert.equal(map.qa, 'qa-engineer');
});

test('resolveRuntimeAgent uses the configured alias map', () => {
  assert.equal(resolveRuntimeAgent('engineer'), 'sr-engineer');
  assert.equal(resolveRuntimeAgent('qa'), 'qa-engineer');
  assert.equal(resolveRuntimeAgent('engineer', {
    OPENCLAW_SPECIALIST_MAP: JSON.stringify({ engineer: 'jr-engineer' }),
  }), 'jr-engineer');
});

test('buildOpenClawArgs targets the mapped agent and uses local mode by default', () => {
  const args = buildOpenClawArgs({
    payload: { request: 'Please implement this fix' },
    runtimeAgent: 'sr-engineer',
    env: {},
  });

  assert.deepEqual(args, [
    'agent',
    '--json',
    '--agent',
    'sr-engineer',
    '--message',
    'Please implement this fix',
    '--timeout',
    '60',
    '--local',
  ]);
});

test('parseJsonFromStdout tolerates banner lines before the final JSON payload', () => {
  const parsed = parseJsonFromStdout('synced credentials\n{"sessionId":"sess-1","reply":"done"}\n');

  assert.equal(parsed.sessionId, 'sess-1');
  assert.equal(parsed.reply, 'done');
});

test('parseJsonFromStdout extracts multiline JSON payloads after banner text', () => {
  const parsed = parseJsonFromStdout('[agents] synced credentials\n{\n  "meta": {\n    "agentMeta": {\n      "sessionId": "sess-5"\n    }\n  },\n  "payloads": [\n    {\n      "text": "done"\n    }\n  ]\n}\n');

  assert.equal(parsed.meta.agentMeta.sessionId, 'sess-5');
  assert.equal(parsed.payloads[0].text, 'done');
});

test('extractSessionId and extractOutput handle nested OpenClaw result shapes', () => {
  const response = {
    result: {
      session: { id: 'sess-2' },
      message: 'handled',
    },
  };

  assert.equal(extractSessionId(response), 'sess-2');
  assert.equal(extractOutput(response), 'handled');
});

test('extractSessionId and extractOutput handle OpenClaw payload/meta response shapes', () => {
  const response = {
    payloads: [{ text: 'handled from payloads' }],
    meta: {
      agentMeta: {
        sessionId: 'sess-4',
      },
    },
  };

  assert.equal(extractSessionId(response), 'sess-4');
  assert.equal(extractOutput(response), 'handled from payloads');
});

test('buildBridgeResponse preserves runtime agent evidence and logical specialist ownership', () => {
  const bridge = buildBridgeResponse({
    payload: { specialist: 'engineer' },
    runtimeAgent: 'sr-engineer',
    response: { sessionId: 'sess-3', reply: 'handled by runtime' },
  });

  assert.equal(bridge.agentId, 'sr-engineer');
  assert.equal(bridge.sessionId, 'sess-3');
  assert.equal(bridge.output, 'handled by runtime');
  assert.equal(bridge.ownership.specialistId, 'engineer');
  assert.equal(bridge.ownership.runtimeAgentId, 'sr-engineer');
});
