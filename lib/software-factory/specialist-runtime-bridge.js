'use strict';

const SUPPORTED_PAYLOAD_VERSION = 1;

function createRuntimeError(code, message, cause) {
  return Object.assign(new Error(message), { code, cause });
}

function parseJsonFromStdout(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) {
    throw createRuntimeError('SPECIALIST_RUNTIME_INVALID_JSON', 'Specialist runtime returned no JSON output');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  throw createRuntimeError('SPECIALIST_RUNTIME_INVALID_JSON', 'Specialist runtime output was not valid JSON');
}

function extractSessionId(response) {
  const candidates = [
    response?.sessionId,
    response?.session_id,
    response?.session?.id,
    response?.meta?.agentMeta?.sessionId,
    response?.meta?.sessionId,
    response?.result?.sessionId,
    response?.result?.session_id,
    response?.result?.session?.id,
    response?.result?.meta?.agentMeta?.sessionId,
    response?.result?.meta?.sessionId,
    response?.conversation?.sessionId,
    response?.id,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim()) || '';
}

function extractOutput(response) {
  const candidates = [
    response?.output,
    response?.reply,
    response?.message,
    response?.text,
    response?.payloads?.[0]?.text,
    response?.result?.output,
    response?.result?.reply,
    response?.result?.message,
    response?.result?.text,
    response?.result?.payloads?.[0]?.text,
  ];
  return candidates.find((value) => typeof value === 'string') || '';
}

function assertPayloadVersion(payload = {}, expected = SUPPORTED_PAYLOAD_VERSION) {
  if (payload.payloadVersion == null || payload.payloadVersion === '') return expected;
  const version = Number(payload.payloadVersion);
  if (version !== expected) {
    throw createRuntimeError(
      'SPECIALIST_RUNTIME_VERSION_UNSUPPORTED',
      `Unsupported specialist runtime payload version ${payload.payloadVersion}`,
    );
  }
  return version;
}

function buildBridgeResponse({
  payload = {},
  runtimeAgent,
  response = {},
  sessionIdFallback = '',
  runtimeProvider = null,
} = {}) {
  const sessionId = extractSessionId(response) || String(sessionIdFallback || '').trim();
  if (!sessionId) {
    throw createRuntimeError(
      'SPECIALIST_RUNTIME_MISSING_EVIDENCE',
      'Specialist runtime response did not include session evidence',
    );
  }

  return {
    agentId: runtimeAgent,
    sessionId,
    output: extractOutput(response),
    ownership: {
      specialistId: payload.specialist,
      runtimeAgentId: runtimeAgent,
      sessionId,
      runtimeProvider: runtimeProvider || null,
      response,
    },
  };
}

module.exports = {
  SUPPORTED_PAYLOAD_VERSION,
  assertPayloadVersion,
  buildBridgeResponse,
  createRuntimeError,
  extractOutput,
  extractSessionId,
  parseJsonFromStdout,
};
