#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { createTaskCatalog } = require('../lib/job-runtime/task-catalog');
const { createWorkloadProducers } = require('../lib/job-runtime/workload-producers');
const {
  assertInventoryCompleteness,
  inventory,
  inventoryDigest,
  verifyDiscoverySources,
  verifySignature,
} = require('../lib/job-runtime/workload-inventory');

function verify(rootDir = process.cwd()) {
  const missingSources = verifyDiscoverySources(rootDir);
  if (!verifySignature()) throw new Error(`Workload inventory signature mismatch; expected ${inventoryDigest()}`);
  assertInventoryCompleteness(createTaskCatalog(), null, {
    producers: createWorkloadProducers({ async enqueue() {} }),
  });
  for (const workload of inventory.workloads) {
    for (const file of [workload.producer, workload.consumer, ...workload.legacySources]) {
      if (!require('node:fs').existsSync(path.join(rootDir, file))) missingSources.push(file);
    }
  }
  if (missingSources.length) throw new Error(`Workload inventory sources missing: ${[...new Set(missingSources)].join(', ')}`);
  return Object.freeze({ workloads: inventory.workloads.length, mechanisms: inventory.mechanisms.length, digest: inventoryDigest() });
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify({ ok: true, ...verify() })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { verify };
