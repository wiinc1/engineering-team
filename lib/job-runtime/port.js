'use strict';

const crypto = require('node:crypto');
const { JOB_RUNTIME_CATALOG_VERSION } = require('./constants');
const { JobRuntimeError, asJobRuntimeError, sanitizedError } = require('./errors');
const { SAFE_ID_PATTERN, TENANT_ID_PATTERN, createPayloadValidator } = require('./payload-schema');
const { schedulingPolicy, semanticJobKey } = require('./policies');

const safeId = new RegExp(SAFE_ID_PATTERN);
const safeTenantId = new RegExp(TENANT_ID_PATTERN);

function scheduleDate(value, clock, options = {}) {
  if (value == null) return new Date(clock.now());
  const date = value instanceof Date ? new Date(value) : new Date(String(value));
  const delta = date.getTime() - clock.now();
  if (!Number.isFinite(date.getTime()) || (!options.allowPast && delta < -1_000) || delta > 30 * 24 * 60 * 60 * 1_000) {
    throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'schedule' } });
  }
  return date;
}

function assertRequestIdentity(context, request, definition) {
  if (!safeTenantId.test(context.tenantId || '') || !safeId.test(request.workloadId || '')) {
    throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'identity' } });
  }
  const canonical = request.canonicalResource || {};
  if (!definition.canonicalResourceTypes.includes(canonical.type) || !safeId.test(canonical.id || '')) {
    throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'canonical_resource' } });
  }
  if (!safeId.test(context.correlationId || '')) {
    throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'correlation' } });
  }
  return canonical;
}

function createEnvelope(context, request, definition, deliveryId) {
  return Object.freeze({
    catalogVersion: JOB_RUNTIME_CATALOG_VERSION,
    deliveryId,
    task: request.task,
    version: request.version,
    tenantId: context.tenantId,
    workloadId: request.workloadId,
    correlation: Object.freeze({
      correlationId: context.correlationId,
      ...(context.requestId ? { requestId: context.requestId } : {}),
      ...(context.traceId ? { traceId: context.traceId } : {}),
    }),
    data: request.data,
  });
}

class JobRuntimePort {
  constructor(options) {
    this.options = options;
    this.validator = options.validator || createPayloadValidator();
    this.clock = options.clock || { now: Date.now };
    this.idGenerator = options.idGenerator || (() => crypto.randomUUID());
    this.authorizeCanonical = options.authorizeCanonical || (async ({ type, id, workloadId }) => (
      type === 'synthetic' && id === workloadId
    ));
  }

  async enqueue(context, request) {
    try {
      return await this.enqueueValidated(context, request);
    } catch (error) {
      const runtimeError = asJobRuntimeError(error);
      const validationCodes = new Set(['job_payload_invalid', 'job_task_unknown', 'job_version_unsupported']);
      if (validationCodes.has(runtimeError.code)) {
        this.options.metrics.increment('job_runtime_validation_failure_total', { reason: runtimeError.code });
        if (runtimeError.safeDetails.reason === 'tenant_mismatch') {
          this.options.metrics.increment('job_runtime_tenant_rejection_total');
        }
        if (runtimeError.code === 'job_version_unsupported') {
          this.options.metrics.increment('job_runtime_unknown_version_total');
        }
        if (runtimeError.code === 'job_task_unknown') {
          this.options.metrics.increment('job_runtime_unknown_task_total');
        }
        this.options.logger.error('job_enqueue_rejected', {
          correlation_id: context?.correlationId,
          error: sanitizedError(runtimeError),
        });
      }
      throw runtimeError;
    }
  }

  async enqueueValidated(context, request) {
    await this.options.ownershipGuard?.assert();
    const definition = this.options.catalog.resolve(request.task, request.version);
    const canonical = assertRequestIdentity(context, request, definition);
    const authorized = await this.authorizeCanonical({
      tenantId: context.tenantId,
      type: canonical.type,
      id: canonical.id,
      workloadId: request.workloadId,
    });
    if (!authorized) throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'tenant_mismatch' } });
    const deliveryId = this.idGenerator();
    const envelope = createEnvelope(context, request, definition, deliveryId);
    const validated = this.validator.validate(envelope, definition);
    const key = semanticJobKey({ ...envelope, ...canonical, canonicalResourceType: canonical.type, canonicalResourceId: canonical.id });
    const proposedSchedule = scheduleDate(request.runAt, this.clock, { allowPast: true });
    if (typeof this.options.registry.findBySemanticKey === 'function') {
      const existing = await this.options.registry.findBySemanticKey(context.tenantId, key);
      if (existing) return this.duplicateResult(existing, proposedSchedule);
    }
    const scheduledFor = scheduleDate(request.runAt, this.clock);
    const orderingKey = `${context.tenantId}:${canonical.type}:${canonical.id}`;
    const schedule = { ...schedulingPolicy(definition, orderingKey), runAt: scheduledFor };
    return this.persistAndEnqueue({ context, request, canonical, definition, envelope, validated, scheduledFor, schedule, key, orderingKey });
  }

  async persistAndEnqueue(state) {
    const pending = await this.options.registry.createPending({
      deliveryId: state.envelope.deliveryId,
      tenantId: state.context.tenantId,
      workloadId: state.request.workloadId,
      semanticJobKey: state.key,
      taskIdentifier: state.definition.identifier,
      task: state.request.task,
      version: state.request.version,
      catalogVersion: JOB_RUNTIME_CATALOG_VERSION,
      handlerVersion: state.definition.handlerVersion,
      orderingKey: state.orderingKey,
      ...state.schedule,
      queue: state.schedule.queueName,
      canonicalResourceType: state.canonical.type,
      canonicalResourceId: state.canonical.id,
      correlationId: state.context.correlationId,
      requestId: state.context.requestId,
      traceId: state.context.traceId,
      payloadSizeBytes: state.validated.bytes,
      scheduledFor: state.scheduledFor,
    });
    if (!pending.created) return this.duplicateResult(pending.record, state.scheduledFor);
    let job;
    try {
      job = await this.options.adapter.addJob(state.definition, state.envelope, state.schedule, state.key);
      const record = await this.options.registry.attachGraphileJob(state.envelope.deliveryId, job.id);
      this.options.metrics.increment('job_runtime_enqueue_total', { task: state.definition.identifier, outcome: 'queued' });
      this.options.logger.info('job_enqueued', logFields(record));
      return record;
    } catch (error) {
      if (job) await this.options.adapter.compensate(job.id).catch(() => {});
      return this.handleEnqueueFailure(error, state.envelope.deliveryId);
    }
  }

  duplicateResult(record, scheduledFor) {
    if (record.scheduledFor !== scheduledFor.toISOString()) throw new JobRuntimeError('job_schedule_conflict');
    this.options.metrics.increment('job_runtime_enqueue_total', { task: record.taskIdentifier, outcome: 'duplicate' });
    this.options.metrics.increment('job_runtime_duplicate_delivery_total', { task: record.taskIdentifier });
    return record;
  }

  async handleEnqueueFailure(error, deliveryId) {
    const runtimeError = asJobRuntimeError(error);
    await this.options.registry.markFailed(deliveryId, { retrying: false, errorCode: runtimeError.code }).catch(() => {});
    this.options.metrics.increment('job_runtime_enqueue_total', { outcome: 'failed' });
    this.options.logger.error('job_enqueue_failed', { delivery_id: deliveryId, error: sanitizedError(runtimeError) });
    throw runtimeError;
  }
}

function createJobRuntimePort(options) {
  return new JobRuntimePort(options);
}

function logFields(record) {
  return {
    delivery_id: record.deliveryId,
    tenant_id: record.tenantId,
    task_identifier: record.taskIdentifier,
    correlation_id: record.correlationId,
    trace_id: record.traceId,
  };
}

module.exports = {
  assertRequestIdentity,
  createEnvelope,
  createJobRuntimePort,
  JobRuntimePort,
  scheduleDate,
};
