'use strict';

const FIXED_NOW = Date.parse('2026-07-14T12:00:00.000Z');
const DELIVERY_ID = '00000000-0000-4000-8000-000000000286';

function validContext(overrides = {}) {
  return {
    tenantId: 'tenant-one',
    correlationId: 'corr-286',
    requestId: 'request-286',
    traceId: '0123456789abcdef0123456789abcdef',
    ...overrides,
  };
}

function validRequest(overrides = {}) {
  return {
    task: 'job_runtime.synthetic',
    version: 1,
    workloadId: 'probe-286',
    canonicalResource: { type: 'synthetic', id: 'probe-286' },
    data: { probeId: 'probe-286', expectedOutcome: 'acknowledge' },
    runAt: new Date(FIXED_NOW),
    ...overrides,
  };
}

function captureLogger() {
  const entries = [];
  return {
    entries,
    info(event, fields) { entries.push({ level: 'info', event, fields }); },
    error(event, fields) { entries.push({ level: 'error', event, fields }); },
  };
}

function metricRecorder() {
  const increments = [];
  const observations = [];
  const gauges = [];
  return {
    increments,
    observations,
    gauges,
    increment(name, labels, value) { increments.push({ name, labels, value }); },
    observe(name, value, labels) { observations.push({ name, value, labels }); },
    gauge(name, value, labels) { gauges.push({ name, value, labels }); },
  };
}

function deliveryRecord(overrides = {}) {
  return {
    deliveryId: DELIVERY_ID,
    tenantId: 'tenant-one',
    workloadId: 'probe-286',
    semanticJobKey: 'jr:v1:fixture',
    taskIdentifier: 'job_runtime.synthetic.v1',
    task: 'job_runtime.synthetic',
    version: 1,
    graphileJobId: '42',
    queue: 'job-runtime-synthetic',
    status: 'queued',
    attemptCount: 0,
    scheduledFor: new Date(FIXED_NOW).toISOString(),
    correlationId: 'corr-286',
    traceId: '0123456789abcdef0123456789abcdef',
    ...overrides,
  };
}

module.exports = {
  DELIVERY_ID,
  FIXED_NOW,
  captureLogger,
  deliveryRecord,
  metricRecorder,
  validContext,
  validRequest,
};
