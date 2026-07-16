'use strict';

const { JobRuntimeError, asJobRuntimeError } = require('./errors');

function unavailable(reason) {
  throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason } });
}

async function canonicalRecord(canonical, context, input) {
  if (!canonical || typeof canonical.lookup !== 'function') unavailable('canonical_lookup_unavailable');
  const record = await canonical.lookup({
    tenantId: context.tenantId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
  });
  if (!record || record.tenantId !== context.tenantId) {
    throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'tenant_mismatch' } });
  }
  if (typeof canonical.authorize === 'function') {
    const allowed = await canonical.authorize({ record, action: input.action, context, data: input.data });
    if (!allowed) throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'tenant_mismatch' } });
  }
  return record;
}

function factoryHandler(action, options) {
  return async (data, context) => {
    const record = await canonicalRecord(options.canonical, context, {
      resourceType: 'factory_run', resourceId: data.runId, action, data,
    });
    if (record.taskId !== data.taskId || record.threadId !== data.threadId) {
      throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'canonical_resource' } });
    }
    if (!options.langGraph || typeof options.langGraph[action] !== 'function') unavailable('langgraph_unavailable');
    if (!options.effectGuard) unavailable('effect_guard_unavailable');
    return options.effectGuard.execute({
      tenantId: context.tenantId,
      taskIdentifier: `factory.langgraph.${action}.v1`,
      effectCategory: 'langgraph_checkpoint',
      resourceType: 'factory_run',
      resourceId: data.runId,
      effectVersion: action === 'resume' ? data.checkpointVersion : data.workflowVersion,
      context,
      lookup: (effectKey) => options.langGraph.lookupEffect({ ...data, tenantId: context.tenantId, effectKey }),
      perform: (effectKey) => options.langGraph[action]({ ...data, tenantId: context.tenantId, effectKey, abortSignal: context.abortSignal }),
    });
  };
}

function auditProjectionHandler(options) {
  return async (data, context) => {
    await canonicalRecord(options.canonical, context, {
      resourceType: 'audit_runtime', resourceId: 'global', action: 'project', data,
    });
    if (typeof options.auditStore?.processProjectionQueue !== 'function') unavailable('audit_store_unavailable');
    return options.auditStore.processProjectionQueue(data.batchSize, context.tenantId);
  };
}

function outboxPublisher(options, context) {
  return async (event) => {
    if (!event?.tenant_id || !event?.event_id) {
      throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'tenant_mismatch' } });
    }
    const eventContext = Object.freeze({ ...context, tenantId: event.tenant_id });
    await canonicalRecord(options.canonical, eventContext, {
      resourceType: 'audit_event', resourceId: event.event_id, action: 'publish', data: {},
    });
    if (!options.effectGuard || typeof options.outbox?.publish !== 'function'
      || typeof options.outbox?.lookupEffect !== 'function') unavailable('outbox_publisher_unavailable');
    return options.effectGuard.execute({
      tenantId: event.tenant_id,
      taskIdentifier: 'audit.outbox.deliver.v1',
      effectCategory: options.outbox.effectCategory || 'notification',
      resourceType: 'audit_event', resourceId: event.event_id, effectVersion: event.schema_version,
      context: eventContext,
      lookup: (effectKey) => options.outbox.lookupEffect({ event, effectKey }),
      perform: (effectKey) => options.outbox.publish(event, { effectKey, abortSignal: context.abortSignal }),
    });
  };
}

function auditOutboxHandler(options) {
  return async (data, context) => {
    await canonicalRecord(options.canonical, context, {
      resourceType: 'audit_runtime', resourceId: 'global', action: 'publish', data,
    });
    if (typeof options.auditStore?.processOutbox !== 'function') unavailable('audit_store_unavailable');
    return options.auditStore.processOutbox(outboxPublisher(options, context), data.batchSize, context.tenantId);
  };
}

function maintenanceEffect(options, input, perform) {
  if (!options.effectGuard) unavailable('effect_guard_unavailable');
  const version = Number(String(input.data.occurrenceId).split(':').at(-1));
  return options.effectGuard.execute({
    tenantId: input.context.tenantId,
    taskIdentifier: input.taskIdentifier,
    effectCategory: input.effectCategory,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    effectVersion: Number.isFinite(version) ? version : 1,
    context: input.context,
    perform,
  });
}

function maintenanceHandlers(options) {
  return {
    'maintenance.sre_monitoring.expire.v1': async (data, context) => {
      await canonicalRecord(options.canonical, context, {
        resourceType: 'audit_runtime', resourceId: 'global', action: 'expire_sre_monitoring', data,
      });
      if (typeof options.auditStore?.processExpiredSreMonitoring !== 'function') unavailable('sre_expiry_unavailable');
      return maintenanceEffect(options, {
        data, context, taskIdentifier: 'maintenance.sre_monitoring.expire.v1',
        effectCategory: 'canonical_task', resourceType: 'audit_runtime', resourceId: 'global',
      }, () => options.auditStore.processExpiredSreMonitoring(data.batchSize));
    },
    'maintenance.factory.reconcile.v1': async (data, context) => {
      await canonicalRecord(options.canonical, context, {
        resourceType: 'factory_tenant', resourceId: context.tenantId, action: 'reconcile', data,
      });
      if (typeof options.factoryRecovery !== 'function') unavailable('factory_recovery_unavailable');
      return maintenanceEffect(options, {
        data, context, taskIdentifier: 'maintenance.factory.reconcile.v1',
        effectCategory: 'factory_queue_recovery', resourceType: 'factory_tenant', resourceId: context.tenantId,
      }, () => options.factoryRecovery({ tenantId: context.tenantId, occurrenceId: data.occurrenceId }));
    },
    'maintenance.job_runtime.prune.v1': async (data, context) => {
      await canonicalRecord(options.canonical, context, {
        resourceType: 'job_runtime', resourceId: context.tenantId, action: 'prune', data,
      });
      if (typeof options.pruneRegistry !== 'function') unavailable('registry_retention_unavailable');
      return maintenanceEffect(options, {
        data, context, taskIdentifier: 'maintenance.job_runtime.prune.v1',
        effectCategory: 'operational_retention', resourceType: 'job_runtime', resourceId: context.tenantId,
      }, () => options.pruneRegistry({ tenantId: context.tenantId, occurrenceId: data.occurrenceId }));
    },
  };
}

function createMigratedWorkloadHandlers(options = {}) {
  const handlers = {
    'factory.langgraph.start.v1': factoryHandler('start', options),
    'factory.langgraph.resume.v1': factoryHandler('resume', options),
    'audit.projection.catch_up.v1': auditProjectionHandler(options),
    'audit.outbox.deliver.v1': auditOutboxHandler(options),
    ...maintenanceHandlers(options),
  };
  return Object.freeze(Object.fromEntries(Object.entries(handlers).map(([key, handler]) => [
    key,
    async (data, context) => {
      try {
        const result = await handler(data, context);
        await options.scheduleNext?.(key, data, context);
        return result;
      } catch (error) { throw asJobRuntimeError(error); }
    },
  ])));
}

module.exports = {
  auditOutboxHandler,
  auditProjectionHandler,
  canonicalRecord,
  createMigratedWorkloadHandlers,
  factoryHandler,
  maintenanceEffect,
  maintenanceHandlers,
  outboxPublisher,
};
