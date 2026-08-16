'use strict';

const {
  GRAPHILE_WORKER_SCHEMA,
  JOB_RUNTIME_DEFAULT_CONCURRENCY,
  JOB_RUNTIME_DEFAULT_RESERVED_CONNECTIONS,
  JOB_RUNTIME_DEFAULT_RETENTION_BATCH,
  JOB_RUNTIME_DEFAULT_RETENTION_DAYS,
  JOB_RUNTIME_DEFAULT_RETENTION_INTERVAL_MS,
  JOB_RUNTIME_DEFAULT_SHUTDOWN_MS,
} = require('./constants');
const { JobRuntimeError } = require('./errors');
const { assertConcurrencyPolicy } = require('./policies');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function integer(value, fallback, { min, max }) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'invalid_configuration' } });
  }
  return parsed;
}

function boolean(value, fallback) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'invalid_feature_flag' } });
}

function runtimeConfig(input = {}, env = process.env) {
  const production = input.production ?? String(env.NODE_ENV || '').toLowerCase() === 'production';
  const poolMax = input.poolMax ?? integer(env.PGPOOL_MAX || env.PG_POOL_MAX, 10, { min: 3, max: 100 });
  const concurrency = input.concurrency ?? integer(env.JOB_RUNTIME_CONCURRENCY, JOB_RUNTIME_DEFAULT_CONCURRENCY, { min: 1, max: 32 });
  const reservedConnections = input.reservedConnections ?? integer(
    env.JOB_RUNTIME_RESERVED_CONNECTIONS,
    JOB_RUNTIME_DEFAULT_RESERVED_CONNECTIONS,
    { min: 2, max: 64 },
  );
  const poolBudget = assertConcurrencyPolicy({ concurrency, poolMax, reservedConnections });
  const claimsEnabled = input.claimsEnabled ?? boolean(env.FF_GRAPHILE_WORKER_CUTOVER, false);
  const ownershipEpoch = String(input.ownershipEpoch ?? env.JOB_RUNTIME_OWNERSHIP_EPOCH ?? '').trim() || null;
  if (claimsEnabled && concurrency !== 4) {
    throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'fair_concurrency' } });
  }
  if (production && claimsEnabled && !UUID_PATTERN.test(ownershipEpoch || '')) {
    throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'ownership_epoch_required' } });
  }
  return Object.freeze({
    schema: GRAPHILE_WORKER_SCHEMA,
    claimsEnabled,
    ownershipEpoch,
    production,
    concurrency,
    poolBudget,
    pollIntervalMs: input.pollIntervalMs ?? integer(env.JOB_RUNTIME_POLL_INTERVAL_MS, 1_000, { min: 100, max: 60_000 }),
    shutdownDeadlineMs: input.shutdownDeadlineMs ?? integer(env.JOB_RUNTIME_SHUTDOWN_MS, JOB_RUNTIME_DEFAULT_SHUTDOWN_MS, { min: 1_000, max: 300_000 }),
    retentionDays: input.retentionDays ?? integer(env.JOB_RUNTIME_RETENTION_DAYS, JOB_RUNTIME_DEFAULT_RETENTION_DAYS, { min: 1, max: 365 }),
    retentionBatch: input.retentionBatch ?? integer(env.JOB_RUNTIME_RETENTION_BATCH, JOB_RUNTIME_DEFAULT_RETENTION_BATCH, { min: 1, max: 10_000 }),
    retentionIntervalMs: input.retentionIntervalMs ?? integer(
      env.JOB_RUNTIME_RETENTION_INTERVAL_MS,
      JOB_RUNTIME_DEFAULT_RETENTION_INTERVAL_MS,
      { min: 60_000, max: 24 * 60 * 60 * 1_000 },
    ),
  });
}

module.exports = {
  boolean,
  integer,
  runtimeConfig,
};
