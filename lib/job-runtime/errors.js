'use strict';

const ERROR_DEFINITIONS = Object.freeze({
  job_payload_invalid: ['Job payload was rejected.', false],
  job_runtime_unavailable: ['Job runtime is unavailable.', true],
  job_schedule_conflict: ['Job schedule conflicts with an existing delivery.', false],
  job_task_unknown: ['Job task is not registered.', false],
  job_version_unsupported: ['Job payload version is unsupported.', false],
});

class JobRuntimeError extends Error {
  constructor(code, options = {}) {
    const definition = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.job_runtime_unavailable;
    super(definition[0], { cause: options.cause });
    this.name = 'JobRuntimeError';
    this.code = ERROR_DEFINITIONS[code] ? code : 'job_runtime_unavailable';
    this.retryable = options.retryable ?? definition[1];
    this.safeDetails = Object.freeze({ ...(options.safeDetails || {}) });
  }
}

function asJobRuntimeError(error, fallbackCode = 'job_runtime_unavailable') {
  return error instanceof JobRuntimeError
    ? error
    : new JobRuntimeError(fallbackCode, { cause: error });
}

function sanitizedError(error) {
  const runtimeError = asJobRuntimeError(error);
  return Object.freeze({
    code: runtimeError.code,
    message: runtimeError.message,
    retryable: runtimeError.retryable,
    details: runtimeError.safeDetails,
  });
}

module.exports = {
  ERROR_DEFINITIONS,
  JobRuntimeError,
  asJobRuntimeError,
  sanitizedError,
};
