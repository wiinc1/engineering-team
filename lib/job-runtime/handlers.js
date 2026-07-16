'use strict';

const { JobRuntimeError, asJobRuntimeError, sanitizedError } = require('./errors');

async function syntheticHandler(data, context) {
  if (data.expectedOutcome === 'retry_once' && context.attempt === 1) {
    throw new JobRuntimeError('job_runtime_unavailable');
  }
}

function applicationContext(envelope, helpers) {
  return Object.freeze({
    deliveryId: envelope.deliveryId,
    tenantId: envelope.tenantId,
    workloadId: envelope.workloadId,
    correlation: envelope.correlation,
    attempt: Number(helpers.job.attempts),
    abortSignal: helpers.abortSignal,
  });
}

function handlerLogFields(envelope, definition) {
  return {
    delivery_id: envelope.deliveryId,
    tenant_id: envelope.tenantId,
    workload_id: envelope.workloadId,
    task_identifier: definition.identifier,
    correlation_id: envelope.correlation.correlationId,
    request_id: envelope.correlation.requestId,
    trace_id: envelope.correlation.traceId,
  };
}

async function runWithPolicy(handler, data, context, definition, options) {
  const timers = options.timers || { setTimeout, clearTimeout };
  if (context.abortSignal?.aborted) {
    throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'cancelled' } });
  }
  let timeoutId;
  let abortListener;
  const deadline = new Promise((_, reject) => {
    timeoutId = timers.setTimeout(() => reject(new JobRuntimeError('job_runtime_unavailable', {
      safeDetails: { reason: 'handler_timeout' }, retryable: true,
    })), definition.timeoutMs);
  });
  const cancelled = new Promise((_, reject) => {
    abortListener = () => reject(new JobRuntimeError('job_runtime_unavailable', {
      safeDetails: { reason: 'cancelled' }, retryable: true,
    }));
    context.abortSignal?.addEventListener('abort', abortListener, { once: true });
  });
  try {
    return await Promise.race([handler(data, context), deadline, cancelled]);
  } finally {
    timers.clearTimeout?.(timeoutId);
    context.abortSignal?.removeEventListener('abort', abortListener);
  }
}

function validatedEnvelope(rawPayload, definition, options) {
  try {
    return options.validator.validate(rawPayload, definition).envelope;
  } catch (error) {
    options.metrics.increment('job_runtime_validation_failure_total', { task: definition.identifier });
    options.logger.error('job_execution_rejected', { task_identifier: definition.identifier, error: sanitizedError(error) });
    throw asJobRuntimeError(error, 'job_payload_invalid');
  }
}

async function recordClaim(envelope, context, helpers, definition, options) {
  const runningRecord = await options.registry.markRunning({
    deliveryId: envelope.deliveryId,
    tenantId: envelope.tenantId,
    graphileJobId: helpers.job.id,
    attemptCount: context.attempt,
  });
  options.metrics.increment('job_runtime_claim_total', { task: definition.identifier });
  if (context.attempt === 1) {
    options.metrics.observe(
      'job_runtime_ready_to_start_ms',
      Math.max(0, options.clock.now() - new Date(runningRecord.scheduledFor).getTime()),
      { task: definition.identifier },
    );
  }
}

async function acknowledge(envelope, fields, definition, startedAt, options) {
  await options.registry.markAcknowledged(envelope.deliveryId);
  options.metrics.increment('job_runtime_finish_total', { task: definition.identifier, outcome: 'acknowledged' });
  options.metrics.observe('job_runtime_duration_ms', options.clock.now() - startedAt, { task: definition.identifier });
  options.logger.info('job_delivery_acknowledged', fields);
}

async function recordFailure(error, envelope, context, helpers, fields, definition, options) {
  const runtimeError = asJobRuntimeError(error);
  const reason = runtimeError.safeDetails.reason;
  if (reason === 'cancelled') options.metrics.increment('job_runtime_cancellation_total', { task: definition.identifier });
  if (reason === 'handler_timeout') options.metrics.increment('job_runtime_timeout_total', { task: definition.identifier });
  const retrying = runtimeError.retryable && context.attempt < Number(helpers.job.max_attempts);
  await options.registry.markFailed(envelope.deliveryId, { retrying, errorCode: runtimeError.code });
  options.metrics.increment(retrying ? 'job_runtime_retry_total' : 'job_runtime_fail_total', { task: definition.identifier });
  if (reason === 'tenant_mismatch') options.metrics.increment('job_runtime_tenant_rejection_total', { task: definition.identifier });
  options.logger.error('job_delivery_failed', { ...fields, retrying, error: sanitizedError(runtimeError) });
  if (retrying) throw runtimeError;
  return Object.freeze({ acknowledged: true, terminal: true, code: runtimeError.code });
}

async function executeTask(rawPayload, helpers, definition, handler, options) {
  const envelope = validatedEnvelope(rawPayload, definition, options);
  const context = applicationContext(envelope, helpers);
  const fields = handlerLogFields(envelope, definition);
  await recordClaim(envelope, context, helpers, definition, options);
  options.logger.info('job_delivery_started', { ...fields, attempt: context.attempt });
  const startedAt = options.clock.now();
  try {
    await runWithPolicy(handler, envelope.data, context, definition, options);
    await acknowledge(envelope, fields, definition, startedAt, options);
  } catch (error) {
    return recordFailure(error, envelope, context, helpers, fields, definition, options);
  }
}

function createTaskExecutor(definition, handler, options) {
  return async function execute(rawPayload, helpers) {
    return executeTask(rawPayload, helpers, definition, handler, options);
  };
}

function buildTaskList(options) {
  const handlers = { 'job_runtime.synthetic.v1': syntheticHandler, ...(options.handlers || {}) };
  return Object.freeze(Object.fromEntries(options.catalog.identifiers.map((identifier) => {
    const definition = options.catalog.resolveIdentifier(identifier);
    const handler = handlers[identifier];
    if (typeof handler !== 'function') throw new JobRuntimeError('job_task_unknown');
    return [identifier, createTaskExecutor(definition, handler, options)];
  })));
}

module.exports = {
  applicationContext,
  buildTaskList,
  createTaskExecutor,
  runWithPolicy,
  syntheticHandler,
};
