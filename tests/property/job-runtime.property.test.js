'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPayloadValidator } = require('../../lib/job-runtime/payload-schema');
const { semanticJobKey } = require('../../lib/job-runtime/policies');
const { createTaskCatalog } = require('../../lib/job-runtime/task-catalog');

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
