'use strict';

const { JobRuntimeError } = require('./errors');

function requireFields(input, fields) {
  if (!input || fields.some((field) => input[field] == null || input[field] === '')) {
    throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'producer_contract' } });
  }
}

function request(task, workloadId, canonicalType, canonicalId, data, runAt) {
  return Object.freeze({
    task,
    version: 1,
    workloadId,
    canonicalResource: Object.freeze({ type: canonicalType, id: canonicalId }),
    data: Object.freeze({ ...data }),
    ...(runAt ? { runAt } : {}),
  });
}

class WorkloadProducers {
  constructor(port) {
    if (!port || typeof port.enqueue !== 'function') throw new JobRuntimeError('job_runtime_unavailable');
    this.port = port;
  }

  factoryStart(context, input) {
    requireFields(input, ['runId', 'taskId', 'threadId', 'workflowVersion']);
    return this.port.enqueue(context, request(
      'factory.langgraph.start', input.runId, 'factory_run', input.runId,
      { runId: input.runId, taskId: input.taskId, threadId: input.threadId, workflowVersion: input.workflowVersion },
    ));
  }

  factoryResume(context, input) {
    requireFields(input, ['runId', 'taskId', 'threadId', 'workflowVersion', 'checkpointVersion']);
    return this.port.enqueue(context, request(
      'factory.langgraph.resume', `${input.runId}:${input.checkpointVersion}`, 'factory_run', input.runId,
      {
        runId: input.runId,
        taskId: input.taskId,
        threadId: input.threadId,
        workflowVersion: input.workflowVersion,
        checkpointVersion: input.checkpointVersion,
      },
    ));
  }

  auditProjection(context, input) {
    return this.auditBatch(context, input, 'audit.projection.catch_up');
  }

  auditOutbox(context, input) {
    return this.auditBatch(context, input, 'audit.outbox.deliver');
  }

  sreMonitoringExpiry(context, input) {
    return this.auditBatch(context, input, 'maintenance.sre_monitoring.expire');
  }

  auditBatch(context, input, task) {
    requireFields(input, ['occurrenceId', 'batchSize']);
    return this.port.enqueue(context, request(
      task, input.occurrenceId, 'audit_runtime', 'global',
      { occurrenceId: input.occurrenceId, batchSize: input.batchSize }, input.runAt,
    ));
  }

  factoryReconciliation(context, input) {
    return this.maintenance(context, input, 'maintenance.factory.reconcile', 'factory_tenant');
  }

  registryRetention(context, input) {
    return this.maintenance(context, input, 'maintenance.job_runtime.prune', 'job_runtime');
  }

  maintenance(context, input, task, resourceType) {
    requireFields(input, ['occurrenceId']);
    return this.port.enqueue(context, request(
      task, input.occurrenceId, resourceType, context.tenantId, { occurrenceId: input.occurrenceId }, input.runAt,
    ));
  }
}

function createWorkloadProducers(port) {
  return new WorkloadProducers(port);
}

module.exports = { WorkloadProducers, createWorkloadProducers, request, requireFields };
