'use strict';

const { createAuditLogger } = require('../../audit/logger');

const SAFE_FIELDS = new Set([
  'checkpoint_id', 'duration_ms', 'error_code', 'factory_run_id_hash', 'graph_version', 'node',
  'outcome', 'size_bytes', 'state_schema_version', 'thread_id', 'tenant_id_hash',
]);

function hashIdentifier(value) {
  if (!value) return null;
  return require('crypto').createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function redactedFields(fields = {}) {
  const output = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_FIELDS.has(key)) continue;
    if (key === 'checkpoint_id' || key === 'thread_id') output[key] = String(value).slice(0, 64);
    else output[key] = value;
  }
  return output;
}

function createLangGraphLogger(options = {}) {
  const logger = options.logger || createAuditLogger(options.baseDir || process.cwd());
  function write(level, event, fields) {
    logger[level]({ feature: 'ff_langgraph_runtime', component: 'langgraph_runtime', event, ...redactedFields(fields) });
  }
  return Object.freeze({
    info(event, fields) { write('info', event, fields); },
    error(event, fields) { write('error', event, fields); },
  });
}

function createMetricSink() {
  const counters = new Map();
  const histograms = new Map();
  const gauges = new Map();
  return Object.freeze({
    increment(name, labels = {}, value = 1) {
      const key = JSON.stringify([name, labels]);
      counters.set(key, (counters.get(key) || 0) + value);
    },
    observe(name, value, labels = {}) {
      const key = JSON.stringify([name, labels]);
      const samples = histograms.get(key);
      if (samples) samples.push(Number(value));
      else histograms.set(key, [Number(value)]);
    },
    gauge(name, value, labels = {}) { gauges.set(JSON.stringify([name, labels]), Number(value)); },
    snapshot() {
      return Object.freeze({
        counters: Object.fromEntries(counters),
        histograms: Object.fromEntries(
          [...histograms].map(([key, values]) => [key, Object.freeze([...values])]),
        ),
        gauges: Object.fromEntries(gauges),
      });
    },
  });
}

function recordError(metrics, logger, error, fields = {}) {
  const code = error?.code || 'langgraph_checkpoint_unavailable';
  metrics.increment('langgraph_checkpoint_errors_total', { code });
  if (code === 'langgraph_version_unsupported') metrics.increment('langgraph_version_mismatch_total');
  if (code === 'langgraph_tenant_mismatch') metrics.increment('langgraph_tenant_rejections_total');
  logger.error('langgraph_operation_failed', { ...fields, error_code: code, outcome: 'error' });
}

module.exports = { createLangGraphLogger, createMetricSink, hashIdentifier, recordError, redactedFields };
