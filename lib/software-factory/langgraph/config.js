'use strict';

const {
  DEFAULT_MAX_STATE_BYTES,
  DEFAULT_NAMESPACE,
  DEFAULT_OPERATION_TIMEOUT_MS,
  DEFAULT_POOL_BUDGET,
  DEFAULT_RESUME_LEASE_MS,
  DEFAULT_RETENTION_DAYS,
  GRAPH_VERSION,
  LANGGRAPH_SCHEMA,
  STATE_SCHEMA_VERSION,
} = require('./constants');
const { LangGraphRuntimeError } = require('./errors');

function boolean(value, fallback) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw invalidConfig('invalid_boolean');
}

function integer(value, fallback, min, max) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw invalidConfig('invalid_integer');
  return parsed;
}

function invalidConfig(reason) {
  return new LangGraphRuntimeError('langgraph_configuration_invalid', { safeDetails: { reason } });
}

function runtimeConfig(input = {}, env = process.env) {
  const production = input.production ?? String(env.NODE_ENV || '').toLowerCase() === 'production';
  const enabled = boolean(input.enabled ?? env.FF_LANGGRAPH_RUNTIME, false);
  const killSwitch = boolean(input.killSwitch ?? env.LANGGRAPH_GLOBAL_KILL_SWITCH, false);
  const saver = String(input.saver ?? env.LANGGRAPH_CHECKPOINTER ?? 'postgres').trim().toLowerCase();
  if (!['postgres', 'memory', 'file'].includes(saver)) throw invalidConfig('unsupported_checkpointer');
  if (production && saver !== 'postgres') throw invalidConfig('production_requires_postgres');
  if (production && enabled && !input.pool && !env.DATABASE_URL) throw invalidConfig('database_url_required');
  const schema = String(input.schema ?? env.LANGGRAPH_CHECKPOINT_SCHEMA ?? LANGGRAPH_SCHEMA);
  if (schema !== LANGGRAPH_SCHEMA) throw invalidConfig('schema_must_be_dedicated');
  return Object.freeze({
    enabled,
    graphVersion: GRAPH_VERSION,
    killSwitch,
    maxStateBytes: integer(input.maxStateBytes ?? env.LANGGRAPH_MAX_STATE_BYTES, DEFAULT_MAX_STATE_BYTES, 4_096, 1_048_576),
    namespace: DEFAULT_NAMESPACE,
    operationTimeoutMs: integer(input.operationTimeoutMs ?? env.LANGGRAPH_OPERATION_TIMEOUT_MS, DEFAULT_OPERATION_TIMEOUT_MS, 100, 120_000),
    poolBudget: integer(input.poolBudget ?? env.LANGGRAPH_POOL_BUDGET, DEFAULT_POOL_BUDGET, 1, 16),
    production,
    resumeLeaseMs: integer(input.resumeLeaseMs ?? env.LANGGRAPH_RESUME_LEASE_MS, DEFAULT_RESUME_LEASE_MS, 1_000, 900_000),
    retentionDays: integer(input.retentionDays ?? env.LANGGRAPH_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, 1, 365),
    saver,
    schema,
    stateSchemaVersion: STATE_SCHEMA_VERSION,
  });
}

function assertInvocationAllowed(config) {
  if (!config.enabled) throw invalidConfig('runtime_disabled');
  if (config.killSwitch) throw invalidConfig('global_kill_switch');
}

module.exports = { assertInvocationAllowed, boolean, integer, runtimeConfig };
