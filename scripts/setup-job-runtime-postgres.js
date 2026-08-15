#!/usr/bin/env node
'use strict';

const { createAuditLogger } = require('../lib/audit/logger');
const { createPgPoolFromEnv, runMigrations } = require('../lib/audit/postgres');
const { GRAPHILE_WORKER_SCHEMA } = require('../lib/job-runtime/constants');
const { createGraphileAdapter } = require('../lib/job-runtime/graphile-adapter');
const { createJobRuntimeLogger } = require('../lib/job-runtime/observability');
const { createMetricSink } = require('../lib/job-runtime/observability');
const { ensurePoolErrorHandler } = require('../lib/job-runtime/pool');
const { applyLeastPrivilegeGrants, verifyJobRuntimePrivileges } = require('../lib/job-runtime/postgres-roles');
const { createDeliveryRegistry } = require('../lib/job-runtime/registry');

async function setupJobRuntimePostgres(options = {}) {
  const pool = options.pool || createPgPoolFromEnv(options.connectionString);
  const logger = options.logger || createJobRuntimeLogger({
    logger: createAuditLogger(options.baseDir || process.cwd()),
  });
  ensurePoolErrorHandler(pool, logger, options.metrics || createMetricSink());
  const adapter = options.adapter || createGraphileAdapter({ pool, schema: GRAPHILE_WORKER_SCHEMA, logger });
  try {
    await adapter.migrate();
    await runMigrations(pool, { baseDir: options.baseDir || process.cwd() });
    await applyLeastPrivilegeGrants(pool, options.roles);
    await createDeliveryRegistry(pool).verifySchema();
    await verifyJobRuntimePrivileges(pool);
    logger.info('job_runtime_postgres_setup_complete', { graphile_schema: GRAPHILE_WORKER_SCHEMA });
  } finally {
    await adapter.close().catch(() => {});
    if (!options.pool) await pool.end();
  }
}

async function main() {
  const logger = createJobRuntimeLogger({ baseDir: process.cwd() });
  try {
    await setupJobRuntimePostgres({ logger });
  } catch (error) {
    logger.error('job_runtime_postgres_setup_failed', { error_code: error.code || 'job_runtime_unavailable' });
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  main,
  setupJobRuntimePostgres,
};
