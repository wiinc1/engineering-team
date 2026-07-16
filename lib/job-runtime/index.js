'use strict';

const { createPgPoolFromEnv } = require('../audit/postgres');
const { runtimeConfig } = require('./config');
const { createEffectGuard, createEffectLedger } = require('./effect-ledger');
const { sanitizedError } = require('./errors');
const { createGraphileAdapter } = require('./graphile-adapter');
const { buildTaskList } = require('./handlers');
const { createJobRuntimeLogger, createMetricSink } = require('./observability');
const { createPayloadValidator } = require('./payload-schema');
const { createConnectionBudgetPool, ensurePoolErrorHandler } = require('./pool');
const { createJobRuntimePort } = require('./port');
const { verifyJobRuntimePrivileges } = require('./postgres-roles');
const { createDeliveryRegistry } = require('./registry');
const { createJobRuntime } = require('./runtime');
const { createTaskCatalog } = require('./task-catalog');
const { assertInventoryCompleteness } = require('./workload-inventory');
const { createMigratedWorkloadHandlers } = require('./workload-handlers');
const { createWorkloadProducers } = require('./workload-producers');
const {
  SCHEDULE_BRIDGE_TASK,
  createScheduleBridge,
  createWorkloadScheduler,
} = require('./workload-scheduler');

function canonicalAuthorization(canonical) {
  return async (input) => {
    if (input.type === 'synthetic') return input.id === input.workloadId;
    if (!canonical || typeof canonical.lookup !== 'function') return false;
    const record = await canonical.lookup({
      tenantId: input.tenantId,
      resourceType: input.type,
      resourceId: input.id,
    });
    return Boolean(record && record.tenantId === input.tenantId);
  };
}

function createInfrastructureCore(options) {
  const sharedPool = options.pool || createPgPoolFromEnv(options.connectionString);
  const logger = options.logger || createJobRuntimeLogger({ baseDir: options.baseDir });
  const metrics = options.metrics || createMetricSink();
  const config = runtimeConfig({ ...options.config, poolMax: sharedPool.options?.max || options.config?.poolMax });
  const pool = options.runtimePool || (typeof sharedPool.connect === 'function'
    ? createConnectionBudgetPool(sharedPool, config.poolBudget.available)
    : sharedPool);
  ensurePoolErrorHandler(pool, logger, metrics);
  const catalog = options.catalog || createTaskCatalog();
  const validator = options.validator || createPayloadValidator();
  const registry = options.registry || createDeliveryRegistry(pool);
  const effectLedger = options.effectLedger || createEffectLedger(pool);
  const adapter = options.adapter || createGraphileAdapter({ pool, schema: config.schema, logger });
  const timers = options.timers || { setTimeout, clearTimeout, setInterval, clearInterval };
  const common = { catalog, validator, registry, adapter, logger, metrics, timers, clock: options.clock || { now: Date.now } };
  const effectGuard = options.effectGuard || createEffectGuard({
    ledger: effectLedger, logger, metrics, idGenerator: options.effectIdGenerator, faults: options.effectFaults,
  });
  return { pool, sharedPool, logger, metrics, config, catalog, registry, effectLedger, adapter, common, effectGuard, timers };
}

function createDefaultPruner(core) {
  return async () => {
    const { common, config, registry, metrics, logger } = core;
    const cutoff = new Date(common.clock.now() - config.retentionDays * 24 * 60 * 60 * 1_000);
    try {
      const count = await registry.pruneTerminalBefore(cutoff, config.retentionBatch);
      metrics.increment('job_runtime_registry_pruned_total', {}, count);
      return { code: 'pruned', count };
    } catch (error) {
      metrics.increment('job_runtime_retention_failure_total');
      logger.error('job_runtime_retention_failed', { error: sanitizedError(error) });
      throw error;
    }
  };
}

function defaultCronItems() {
  return [{
    task: SCHEDULE_BRIDGE_TASK,
    match: '* * * * *',
    options: { backfillPeriod: 60_000, maxAttempts: 3, queueName: 'maintenance-runtime', priority: -6 },
    payload: { scheduleVersion: 1 },
    identifier: 'job-runtime-schedule-recovery-v1',
  }];
}

function createJobRuntimeInfrastructure(options = {}) {
  const core = createInfrastructureCore(options);
  const { pool, sharedPool, metrics, config, catalog, registry, effectLedger, common, effectGuard, timers } = core;
  const port = createJobRuntimePort({
    ...common,
    authorizeCanonical: options.authorizeCanonical || canonicalAuthorization(options.canonical),
    idGenerator: options.idGenerator,
  });
  const producers = createWorkloadProducers(port);
  const scheduler = options.scheduler || createWorkloadScheduler(producers, {
    clock: common.clock,
    systemTenantId: options.systemTenantId,
  });
  const migratedHandlers = createMigratedWorkloadHandlers({
    ...(options.workloads || {}),
    canonical: options.canonical,
    effectGuard,
    scheduleNext: (identifier, data, context) => scheduler.next(identifier, data, context),
    pruneRegistry: options.workloads?.pruneRegistry || createDefaultPruner(core),
  });
  const handlers = { ...migratedHandlers, ...(options.handlers || {}) };
  assertInventoryCompleteness(catalog, handlers, { producers });
  const taskList = Object.freeze({
    ...buildTaskList({ ...common, handlers }),
    [SCHEDULE_BRIDGE_TASK]: createScheduleBridge(() => scheduler),
  });
  const cronItems = options.cronItems || defaultCronItems();
  const runtime = createJobRuntime({
    ...common,
    pool,
    config,
    taskList,
    cronItems,
    timers,
    events: options.events,
    verifyPrivileges: options.verifyPrivileges || (() => verifyJobRuntimePrivileges(pool)),
  });
  return Object.freeze({
    catalog, config, effectGuard, effectLedger, handlers: Object.freeze(handlers), metrics,
    pool: sharedPool, runtimePool: pool, port, producers, registry, runtime, scheduler,
  });
}

module.exports = {
  canonicalAuthorization,
  createJobRuntimeInfrastructure,
};
