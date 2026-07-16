'use strict';

const crypto = require('crypto');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const DEFINITIONS = Object.freeze({
  langgraph_checkpoint_unavailable: ['Checkpoint storage is unavailable.', true],
  langgraph_concurrency_conflict: ['The graph thread is already being resumed.', true],
  langgraph_configuration_invalid: ['LangGraph runtime configuration is invalid.', false],
  langgraph_migration_mismatch: ['LangGraph checkpoint schema is incompatible.', false],
  langgraph_state_invalid: ['Graph state was rejected.', false],
  langgraph_tenant_mismatch: ['Graph thread tenant binding does not match.', false],
  langgraph_version_unsupported: ['Graph or state version is unsupported.', false],
});

class LangGraphRuntimeError extends Error {
  constructor(code, options = {}) {
    const resolved = DEFINITIONS[code] ? code : 'langgraph_checkpoint_unavailable';
    super(DEFINITIONS[resolved][0], { cause: options.cause });
    this.name = 'LangGraphRuntimeError';
    this.code = resolved;
    this.retryable = options.retryable ?? DEFINITIONS[resolved][1];
    this.safeDetails = Object.freeze({ ...(options.safeDetails || {}) });
  }
}

function asRuntimeError(error, fallback = 'langgraph_checkpoint_unavailable') {
  return error instanceof LangGraphRuntimeError
    ? error
    : new LangGraphRuntimeError(fallback, { cause: error });
}

function normalizeRequestId(value) {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
    ? value
    : crypto.randomUUID();
}

function errorEnvelope(error, requestId) {
  const resolved = asRuntimeError(error);
  const normalizedRequestId = normalizeRequestId(requestId);
  return Object.freeze({
    error: Object.freeze({
      code: resolved.code,
      message: resolved.message,
      retryable: resolved.retryable,
      details: resolved.safeDetails,
      request_id: normalizedRequestId,
      requestId: normalizedRequestId,
    }),
  });
}

module.exports = { DEFINITIONS, LangGraphRuntimeError, asRuntimeError, errorEnvelope, normalizeRequestId };
