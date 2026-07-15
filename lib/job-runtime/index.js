'use strict';

const { createPgPoolFromEnv } = require('../audit/postgres');
const { runtimeConfig } = require('./config');
const { createGraphileAdapter } = require('./graphile-adapter');
const { buildTaskList } = require('./handlers');
const { createJobRuntimeLogger, createMetricSink } = require('./observability');
const { createPayloadValidator } = require('./payload-schema');
const { ensurePoolErrorHandler } = require('./pool');
const { createJobRuntimePort } = require('./port');
const { verifyJobRuntimePrivileges } = require('./postgres-roles');
const { createDeliveryRegistry } = require('./registry');
const { createJobRuntime } = require('./runtime');
const { createTaskCatalog } = require('./task-catalog');

function createJobRuntimeInfrastructure(options = {}) {
  const pool = options.pool || createPgPoolFromEnv(options.connectionString);
  const logger = options.logger || createJobRuntimeLogger({ baseDir: options.baseDir });
  const metrics = options.metrics || createMetricSink();
  ensurePoolErrorHandler(pool, logger, metrics);
  const config = runtimeConfig({ ...options.config, poolMax: pool.options?.max || options.config?.poolMax });
  const catalog = options.catalog || createTaskCatalog();
  const validator = options.validator || createPayloadValidator();
  const registry = options.registry || createDeliveryRegistry(pool);
  const adapter = options.adapter || createGraphileAdapter({ pool, schema: config.schema, logger });
  const common = { catalog, validator, registry, adapter, logger, metrics, clock: options.clock || { now: Date.now } };
  const taskList = buildTaskList({ ...common, handlers: options.handlers });
  const port = createJobRuntimePort({ ...common, authorizeCanonical: options.authorizeCanonical, idGenerator: options.idGenerator });
  const runtime = createJobRuntime({
    ...common,
    pool,
    config,
    taskList,
    timers: options.timers || { setTimeout, clearTimeout, setInterval, clearInterval },
    events: options.events,
    verifyPrivileges: options.verifyPrivileges || (() => verifyJobRuntimePrivileges(pool)),
  });
  return Object.freeze({ catalog, config, metrics, pool, port, registry, runtime });
}

module.exports = {
  createJobRuntimeInfrastructure,
};
