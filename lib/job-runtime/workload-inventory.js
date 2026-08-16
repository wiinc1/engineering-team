'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const inventory = require('../../config/job-runtime-workload-inventory.json');
const { JobRuntimeError } = require('./errors');

const INVENTORY_PATH = 'config/job-runtime-workload-inventory.json';
const DISCOVERY_MARKERS = Object.freeze({
  'scripts/run-factory-orchestrator.js': /runFactoryOrchestratorTick/,
  'scripts/run-audit-workers.js': /createSupervisedWorker/,
  'lib/audit/workers.js': /processExpiredSreMonitoring/,
  'lib/audit/postgres.js': /FOR UPDATE SKIP LOCKED/,
  'lib/audit/store.js': /processOutbox/,
  'scripts/process-audit-projection-queue.js': /createProjectionWorker/,
  'scripts/process-audit-outbox.js': /createOutboxWorker/,
  'scripts/rebuild-audit-projections.js': /rebuildProjections/,
  'lib/task-platform/factory-delivery-queue-recovery.js': /recoverExpiredFactoryQueueLeases/,
  'lib/task-platform/factory-delivery-queue-postgres.js': /FOR UPDATE SKIP LOCKED/,
  'lib/job-runtime/index.js': /pruneTerminalBefore/,
  'scripts/command-router.js': /setInterval\(poll/,
  'scripts/factory-stack-postgres-watch.js': /ensurePostgres/,
  'scripts/dual-remote-mirror-agent.js': /schedule|StartInterval/,
  'lib/task-platform/dual-remote-mirror-ops.js': /while \(true\)/,
  'scripts/dev-golden-path/factory-orchestrator.js': /factory-orchestrator/,
});

const LOOP_DISCOVERY_PATTERNS = Object.freeze([
  /setInterval\(/,
  /while \(true\)/,
  /while \(!stopping\)/,
  /FOR UPDATE SKIP LOCKED/,
  /StartInterval/,
]);

function sourceFiles(rootDir, relativeDir) {
  const base = path.join(rootDir, relativeDir);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(relativeDir, entry.name);
    if (relative.startsWith('lib/job-runtime/')) return [];
    return entry.isDirectory() ? sourceFiles(rootDir, relative) : (entry.name.endsWith('.js') ? [relative] : []);
  });
}

function discoverLoopSources(rootDir) {
  return Object.freeze(sourceFiles(rootDir, 'scripts').concat(sourceFiles(rootDir, 'lib'))
    .filter((source) => {
      const text = fs.readFileSync(path.join(rootDir, source), 'utf8');
      return LOOP_DISCOVERY_PATTERNS.some((pattern) => pattern.test(text));
    }).sort());
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function inventoryDigest(value = inventory) {
  const unsigned = { ...value };
  delete unsigned.signature;
  return crypto.createHash('sha256').update(JSON.stringify(stable(unsigned))).digest('hex');
}

function verifySignature(value = inventory) {
  return value.signature?.algorithm === 'sha256'
    && value.signature.digest === inventoryDigest(value);
}

function assertInventoryCompleteness(catalog, handlers, options = {}) {
  const value = options.inventory || inventory;
  if (!verifySignature(value)) {
    throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'inventory_signature' } });
  }
  const expected = new Set(value.workloads.map((entry) => entry.taskIdentifier));
  const catalogIds = new Set(catalog.identifiers.filter((id) => id !== 'job_runtime.synthetic.v1'));
  if (expected.size !== catalogIds.size || [...expected].some((id) => !catalogIds.has(id))) {
    throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'inventory_catalog_gap' } });
  }
  if (handlers && [...expected].some((id) => typeof handlers[id] !== 'function')) {
    throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'inventory_handler_gap' } });
  }
  if (options.producers && value.workloads.some((entry) => typeof options.producers[entry.producerMethod] !== 'function')) {
    throw new JobRuntimeError('job_runtime_unavailable', { safeDetails: { reason: 'inventory_producer_gap' } });
  }
  return true;
}

function verifyDiscoverySources(rootDir, value = inventory) {
  const mechanisms = new Map(value.mechanisms.map((entry) => [entry.source, entry]));
  const missing = [];
  for (const [source, marker] of Object.entries(DISCOVERY_MARKERS)) {
    const absolute = path.join(rootDir, source);
    if (!fs.existsSync(absolute) || !marker.test(fs.readFileSync(absolute, 'utf8')) || !mechanisms.has(source)) {
      missing.push(source);
    }
  }
  for (const source of discoverLoopSources(rootDir)) {
    if (!mechanisms.has(source)) missing.push(source);
  }
  return Object.freeze(missing);
}

module.exports = {
  DISCOVERY_MARKERS,
  LOOP_DISCOVERY_PATTERNS,
  INVENTORY_PATH,
  assertInventoryCompleteness,
  discoverLoopSources,
  inventory,
  inventoryDigest,
  stable,
  verifyDiscoverySources,
  verifySignature,
};
