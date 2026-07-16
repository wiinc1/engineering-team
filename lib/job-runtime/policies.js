'use strict';

const crypto = require('node:crypto');
const { JobRuntimeError } = require('./errors');

const NAMED_QUEUE_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;

function semanticJobKey(input) {
  const components = [
    'v1',
    input.tenantId,
    input.task,
    String(input.version),
    input.workloadId,
    input.canonicalResourceType,
    input.canonicalResourceId,
  ];
  if (components.some((component) => !component)) throw new JobRuntimeError('job_payload_invalid');
  const digest = crypto.createHash('sha256').update(JSON.stringify(components)).digest('hex');
  return `jr:v1:${digest}`;
}

function queueLane(definition, orderingKey) {
  const lanes = Number(definition.concurrency?.lanes || 1);
  if (!Number.isInteger(lanes) || lanes < 1 || lanes > 32) {
    throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'queue_policy' } });
  }
  if (lanes === 1) return definition.queue;
  if (!orderingKey) throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'ordering_key' } });
  const digest = crypto.createHash('sha256').update(String(orderingKey)).digest();
  return `${definition.queue}-${digest.readUInt32BE(0) % lanes}`;
}

function schedulingPolicy(definition, orderingKey) {
  const { maxAttempts, priority } = definition.retry || {};
  const queueName = queueLane(definition, orderingKey);
  if (!NAMED_QUEUE_PATTERN.test(queueName || '')) {
    throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'queue_policy' } });
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'retry_policy' } });
  }
  if (!Number.isInteger(priority) || priority < -10 || priority > 10) {
    throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'priority_policy' } });
  }
  return Object.freeze({ queueName, maxAttempts, priority });
}

function assertConcurrencyPolicy({ concurrency, poolMax, reservedConnections }) {
  if (![concurrency, poolMax, reservedConnections].every(Number.isInteger)) {
    throw new JobRuntimeError('job_runtime_unavailable');
  }
  const available = poolMax - reservedConnections;
  if (concurrency < 1 || reservedConnections < 2 || available < concurrency) {
    throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'pool_budget' } });
  }
  return Object.freeze({ concurrency, poolMax, reservedConnections, available });
}

module.exports = {
  NAMED_QUEUE_PATTERN,
  assertConcurrencyPolicy,
  queueLane,
  schedulingPolicy,
  semanticJobKey,
};
