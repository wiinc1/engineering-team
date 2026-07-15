'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const envelopeFixture = require('../fixtures/job-runtime/v1-valid-envelope.json');
const { DELIVERY_ID, FIXED_NOW, captureLogger, deliveryRecord, metricRecorder, validContext, validRequest } = require('../fixtures/job-runtime/v1');
const { buildTaskList } = require('../../lib/job-runtime/handlers');
const { createPayloadValidator } = require('../../lib/job-runtime/payload-schema');
const { createJobRuntimePort } = require('../../lib/job-runtime/port');
const { createTaskCatalog } = require('../../lib/job-runtime/task-catalog');

test('producer and handler share the exact v1 payload and correlation contract', async () => {
  const catalog = createTaskCatalog();
  const validator = createPayloadValidator();
  let queuedEnvelope;
  const registry = {
    async createPending() { return { created: true, record: deliveryRecord({ graphileJobId: null }) }; },
    async attachGraphileJob() { return deliveryRecord(); },
    async markRunning() { return deliveryRecord({ status: 'running' }); },
    async markAcknowledged() {},
    async markFailed() {},
  };
  const port = createJobRuntimePort({
    catalog, validator, registry, logger: captureLogger(), metrics: metricRecorder(),
    clock: { now: () => FIXED_NOW }, idGenerator: () => DELIVERY_ID,
    adapter: {
      async addJob(definition, envelope) { queuedEnvelope = { definition, envelope }; return { id: '42' }; },
      async compensate() {},
    },
  });
  await port.enqueue(validContext(), validRequest());
  assert.deepEqual(queuedEnvelope.envelope, envelopeFixture);
  assert.equal(queuedEnvelope.definition.identifier, 'job_runtime.synthetic.v1');
  let handlerContract;
  const taskList = buildTaskList({
    catalog, validator, registry, logger: captureLogger(), metrics: metricRecorder(), clock: { now: () => FIXED_NOW },
    handlers: { 'job_runtime.synthetic.v1': async (data, context) => { handlerContract = { data, context }; } },
  });
  await taskList['job_runtime.synthetic.v1'](queuedEnvelope.envelope, {
    job: { id: '42', attempts: 1, max_attempts: 3 },
    abortSignal: new AbortController().signal,
  });
  assert.deepEqual(handlerContract.data, envelopeFixture.data);
  assert.deepEqual(handlerContract.context.correlation, envelopeFixture.correlation);
  assert.equal(handlerContract.context.tenantId, 'tenant-one');
  assert.equal(handlerContract.context.job, undefined);
});

test('health and readiness contracts expose no payload or Graphile storage detail', () => {
  const healthKeys = ['status', 'state', 'database', 'claimsEnabled', 'acceptingClaims', 'catalogVersion', 'pool'];
  const readinessKeys = ['ready', 'draining', 'state', 'claimsEnabled', 'acceptingClaims'];
  assert.equal(healthKeys.includes('payload'), false);
  assert.equal(healthKeys.some((key) => key.includes('table')), false);
  assert.equal(readinessKeys.includes('graphileJobId'), false);
});
