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
    task_identifier: definition.identifier,
    correlation_id: envelope.correlation.correlationId,
    trace_id: envelope.correlation.traceId,
  };
}

function createTaskExecutor(definition, handler, options) {
  return async function execute(rawPayload, helpers) {
    let envelope;
    try {
      envelope = options.validator.validate(rawPayload, definition).envelope;
    } catch (error) {
      options.metrics.increment('job_runtime_validation_failure_total', { task: definition.identifier });
      options.logger.error('job_execution_rejected', { task_identifier: definition.identifier, error: sanitizedError(error) });
      throw asJobRuntimeError(error, 'job_payload_invalid');
    }
    const context = applicationContext(envelope, helpers);
    const fields = handlerLogFields(envelope, definition);
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
    options.logger.info('job_delivery_started', { ...fields, attempt: context.attempt });
    const startedAt = options.clock.now();
    try {
      await handler(envelope.data, context);
      await options.registry.markAcknowledged(envelope.deliveryId);
      options.metrics.increment('job_runtime_finish_total', { task: definition.identifier, outcome: 'acknowledged' });
      options.metrics.observe('job_runtime_duration_ms', options.clock.now() - startedAt, { task: definition.identifier });
      options.logger.info('job_delivery_acknowledged', fields);
    } catch (error) {
      const runtimeError = asJobRuntimeError(error);
      const retrying = context.attempt < Number(helpers.job.max_attempts);
      await options.registry.markFailed(envelope.deliveryId, { retrying, errorCode: runtimeError.code });
      options.metrics.increment(retrying ? 'job_runtime_retry_total' : 'job_runtime_fail_total', { task: definition.identifier });
      options.logger.error('job_delivery_failed', { ...fields, retrying, error: sanitizedError(runtimeError) });
      throw runtimeError;
    }
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
  syntheticHandler,
};
