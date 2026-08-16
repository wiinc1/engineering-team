'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { effectKey } = require('../../lib/job-runtime/effect-ledger');
const { createPayloadValidator } = require('../../lib/job-runtime/payload-schema');
const { queueLane, semanticJobKey } = require('../../lib/job-runtime/policies');
const { createTaskCatalog } = require('../../lib/job-runtime/task-catalog');
const { createWorkloadScheduler } = require('../../lib/job-runtime/workload-scheduler');

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function safeId(random, prefix) {
  return `${prefix}-${Math.floor(random() * 0x7fffffff).toString(36)}`;
}

test('semantic keys are deterministic and collision-free across 2000 generated identities', () => {
  const random = seededRandom(286);
  const keys = new Set();
  for (let index = 0; index < 2000; index += 1) {
    const input = {
      tenantId: `tenant-${Math.floor(random() * 20)}`,
      task: 'job_runtime.synthetic',
      version: 1,
      workloadId: safeId(random, 'work'),
      canonicalResourceType: 'synthetic',
      canonicalResourceId: safeId(random, 'resource'),
    };
    const first = semanticJobKey(input);
    assert.equal(first, semanticJobKey({ ...input }));
    assert.equal(keys.has(first), false);
    keys.add(first);
  }
  assert.equal(keys.size, 2000);
});

test('all generated valid v1 envelopes validate and secret-bearing variants fail closed', () => {
  const random = seededRandom(1286);
  const definition = createTaskCatalog().resolve('job_runtime.synthetic', 1);
  const validator = createPayloadValidator();
  for (let index = 0; index < 500; index += 1) {
    const probeId = safeId(random, 'probe');
    const envelope = {
      catalogVersion: 1,
      deliveryId: `00000000-0000-4000-8${String(index).padStart(3, '0').slice(-3)}-${String(index).padStart(12, '0')}`,
      task: definition.name,
      version: 1,
      tenantId: `tenant-${Math.floor(random() * 20)}`,
      workloadId: probeId,
      correlation: { correlationId: safeId(random, 'corr') },
      data: { probeId, expectedOutcome: random() > 0.5 ? 'acknowledge' : 'retry_once' },
    };
    assert.equal(validator.validate(envelope, definition).envelope, envelope);
    assert.throws(() => validator.validate({ ...envelope, data: { ...envelope.data, apiToken: 'forbidden' } }, definition), {
      code: 'job_payload_invalid',
    });
  }
});

test('generated tenant resource and replay identities stay isolated while ordering lanes remain bounded', () => {
  const random = seededRandom(2287);
  const factory = createTaskCatalog().resolve('factory.langgraph.start', 1);
  const lanes = new Set();
  const effects = new Set();
  for (let index = 0; index < 1000; index += 1) {
    const tenantId = `tenant-${Math.floor(random() * 20)}`;
    const resourceId = safeId(random, 'run');
    const orderingKey = `${tenantId}:factory_run:${resourceId}`;
    const lane = queueLane(factory, orderingKey);
    assert.equal(lane, queueLane(factory, orderingKey));
    assert.equal(lane, 'factory-workflow');
    lanes.add(lane);
    const identity = {
      tenantId, taskIdentifier: factory.identifier, effectCategory: 'langgraph_checkpoint',
      resourceType: 'factory_run', resourceId, effectVersion: 1,
    };
    const key = effectKey(identity);
    assert.equal(effects.has(key), false);
    effects.add(key);
    assert.notEqual(key, effectKey({ ...identity, tenantId: `${tenantId}-other` }));
  }
  assert.equal(effects.size, 1000);
  assert.equal(lanes.size, 1);
});

test('generated recurring occurrences remain monotonic and preserve one serialized ordering identity', async () => {
  const scheduled = [];
  const scheduler = createWorkloadScheduler({
    async auditProjection(context, input) { scheduled.push({ context, input }); },
  }, { clock: { now: () => 10_000 }, systemTenantId: 'engineering-team' });
  let occurrenceId = 'projection:1000';
  for (let index = 0; index < 100; index += 1) {
    await scheduler.next('audit.projection.catch_up.v1', { occurrenceId });
    occurrenceId = scheduled.at(-1).input.occurrenceId;
  }
  const timestamps = scheduled.map((entry) => entry.input.runAt.getTime());
  assert.deepEqual(timestamps, [...timestamps].sort((left, right) => left - right));
  assert.equal(new Set(scheduled.map((entry) => entry.context.tenantId)).size, 1);
  assert.equal(new Set(scheduled.map((entry) => entry.input.occurrenceId)).size, scheduled.length);
});
