'use strict';

const { createAuditLogger } = require('../audit/logger');
const { redact } = require('./redaction');

function createMetricSink() {
  const counters = new Map();
  const observations = new Map();
  const gauges = new Map();
  return Object.freeze({
    increment(name, labels = {}, value = 1) {
      const key = JSON.stringify([name, labels]);
      counters.set(key, (counters.get(key) || 0) + value);
    },
    observe(name, value, labels = {}) {
      const key = JSON.stringify([name, labels]);
      observations.set(key, [...(observations.get(key) || []), value]);
    },
    gauge(name, value, labels = {}) {
      const key = JSON.stringify([name, labels]);
      gauges.set(key, value);
    },
    snapshot() {
      return Object.freeze({
        counters: Object.fromEntries(counters),
        observations: Object.fromEntries(observations),
        gauges: Object.fromEntries(gauges),
      });
    },
  });
}

function createJobRuntimeLogger(options = {}) {
  const logger = options.logger || createAuditLogger(options.baseDir || process.cwd());
  function write(level, event, fields = {}) {
    logger[level](redact({
      feature: 'ff_graphile_worker_cutover',
      component: 'job_runtime',
      event,
      ...fields,
    }));
  }
  return Object.freeze({
    info(event, fields) { write('info', event, fields); },
    error(event, fields) { write('error', event, fields); },
  });
}

module.exports = {
  createJobRuntimeLogger,
  createMetricSink,
};
