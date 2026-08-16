'use strict';

const { JobRuntimeError } = require('./errors');

const SCHEDULE_BRIDGE_TASK = 'job_runtime.schedule.recover.v1';
const SCHEDULES = Object.freeze({
  'audit.projection.catch_up.v1': Object.freeze({ intervalMs: 5_000, batchSize: 100, producer: 'auditProjection' }),
  'audit.outbox.deliver.v1': Object.freeze({ intervalMs: 5_000, batchSize: 100, producer: 'auditOutbox' }),
  'maintenance.sre_monitoring.expire.v1': Object.freeze({ intervalMs: 60_000, batchSize: 100, producer: 'sreMonitoringExpiry' }),
  'maintenance.factory.reconcile.v1': Object.freeze({ intervalMs: 30_000, producer: 'factoryReconciliation' }),
  'maintenance.job_runtime.prune.v1': Object.freeze({ intervalMs: 60 * 60_000, producer: 'registryRetention' }),
});

function occurrence(identifier, timestamp) {
  return `${identifier.split('.').slice(0, -1).join('-')}:${timestamp}`;
}

function scheduleContext(tenantId, identifier, timestamp) {
  const safe = identifier.replace(/[^a-z0-9]+/gi, '-');
  return Object.freeze({
    tenantId,
    correlationId: `schedule:${safe}:${timestamp}`,
  });
}

class WorkloadScheduler {
  constructor(producers, options = {}) {
    this.producers = producers;
    this.clock = options.clock || { now: Date.now };
    this.systemTenantId = options.systemTenantId || 'engineering-team';
  }

  async recover(timestamp) {
    const scheduledAt = Date.parse(timestamp);
    if (!Number.isFinite(scheduledAt)) throw new JobRuntimeError('job_payload_invalid');
    return Promise.all(Object.keys(SCHEDULES).map((identifier) => this.enqueue(identifier, scheduledAt)));
  }

  async next(identifier, data) {
    const policy = SCHEDULES[identifier];
    if (!policy) return null;
    const previous = Number(String(data.occurrenceId).split(':').at(-1));
    const scheduledAt = Math.max(Number.isFinite(previous) ? previous + policy.intervalMs : 0, this.clock.now());
    return this.enqueue(identifier, scheduledAt);
  }

  enqueue(identifier, scheduledAt) {
    const policy = SCHEDULES[identifier];
    if (!policy || typeof this.producers[policy.producer] !== 'function') {
      throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'schedule_contract' } });
    }
    const input = {
      occurrenceId: occurrence(identifier, scheduledAt),
      ...(policy.batchSize ? { batchSize: policy.batchSize } : {}),
      runAt: new Date(scheduledAt),
    };
    return this.producers[policy.producer](scheduleContext(this.systemTenantId, identifier, scheduledAt), input);
  }
}

function createScheduleBridge(getScheduler) {
  return async (payload) => {
    const keys = payload && typeof payload === 'object' ? Object.keys(payload).sort() : [];
    if (payload?.scheduleVersion !== 1 || !payload?._cron?.ts || keys.join(',') !== '_cron,scheduleVersion') {
      throw new JobRuntimeError('job_payload_invalid', { safeDetails: { reason: 'schedule_payload' } });
    }
    const scheduler = getScheduler();
    if (!scheduler) throw new JobRuntimeError('job_runtime_unavailable');
    await scheduler.recover(payload._cron.ts);
  };
}

function createWorkloadScheduler(producers, options) {
  return new WorkloadScheduler(producers, options);
}

module.exports = {
  SCHEDULES,
  SCHEDULE_BRIDGE_TASK,
  WorkloadScheduler,
  createScheduleBridge,
  createWorkloadScheduler,
  occurrence,
  scheduleContext,
};
