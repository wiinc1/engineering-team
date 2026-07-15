'use strict';

const Ajv = require('ajv');
const {
  JOB_PAYLOAD_MAX_ARRAY_LENGTH,
  JOB_PAYLOAD_MAX_BYTES,
  JOB_PAYLOAD_MAX_DEPTH,
} = require('./constants');
const { JobRuntimeError } = require('./errors');
const { findSecretPath } = require('./redaction');

const SAFE_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const TENANT_ID_PATTERN = '^[a-z0-9][a-z0-9_-]{1,63}$';
const TASK_NAME_PATTERN = '^[a-z][a-z0-9_.-]{2,79}$';

const ENVELOPE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['catalogVersion', 'deliveryId', 'task', 'version', 'tenantId', 'workloadId', 'correlation', 'data'],
  properties: {
    catalogVersion: { type: 'integer', const: 1 },
    deliveryId: { type: 'string', format: 'uuid' },
    task: { type: 'string', pattern: TASK_NAME_PATTERN },
    version: { type: 'integer', minimum: 1, maximum: 999 },
    tenantId: { type: 'string', pattern: TENANT_ID_PATTERN },
    workloadId: { type: 'string', pattern: SAFE_ID_PATTERN },
    correlation: {
      type: 'object',
      additionalProperties: false,
      required: ['correlationId'],
      properties: {
        correlationId: { type: 'string', pattern: SAFE_ID_PATTERN },
        requestId: { type: 'string', pattern: SAFE_ID_PATTERN },
        traceId: { type: 'string', pattern: '^[A-Fa-f0-9]{16,32}$' },
      },
    },
    data: { type: 'object' },
  },
});

function jsonDepthAndShape(value, depth = 0, seen = new Set()) {
  if (depth > JOB_PAYLOAD_MAX_DEPTH) return false;
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) {
    return typeof value !== 'number' || Number.isFinite(value);
  }
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.length <= JOB_PAYLOAD_MAX_ARRAY_LENGTH
      && value.every((item) => jsonDepthAndShape(item, depth + 1, seen));
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value).every((item) => jsonDepthAndShape(item, depth + 1, seen));
}

function createPayloadValidator(options = {}) {
  const ajv = options.ajv || new Ajv({ allErrors: false, strict: true, formats: { uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i } });
  const envelopeValidator = ajv.compile(ENVELOPE_SCHEMA);
  const compiledSchemas = new Map();

  function taskValidator(identifier, schema) {
    if (!compiledSchemas.has(identifier)) compiledSchemas.set(identifier, ajv.compile(schema));
    return compiledSchemas.get(identifier);
  }

  function validate(envelope, definition) {
    const secretPath = findSecretPath(envelope);
    if (secretPath) throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'secret_like_content' } });
    if (!jsonDepthAndShape(envelope)) throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'non_json_or_depth' } });
    if (!envelopeValidator(envelope)) throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'envelope_schema' } });
    if (!taskValidator(definition.identifier, definition.schema)(envelope.data)) {
      throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'task_schema' } });
    }
    const bytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
    if (bytes > (options.maxBytes || JOB_PAYLOAD_MAX_BYTES)) {
      throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'payload_too_large' } });
    }
    return Object.freeze({ envelope, bytes });
  }

  return Object.freeze({ validate });
}

module.exports = {
  ENVELOPE_SCHEMA,
  SAFE_ID_PATTERN,
  TASK_NAME_PATTERN,
  TENANT_ID_PATTERN,
  createPayloadValidator,
  jsonDepthAndShape,
};
