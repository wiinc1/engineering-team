#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_QUEUE_PATH,
  resolveFactoryConfig,
} = require('../lib/task-platform/factory-delivery');
const {
  createPostgresFactoryQueueStore,
  buildFactoryQueueImport,
} = require('../lib/task-platform/factory-delivery-queue-postgres');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function loadQueue(queuePath) {
  const resolved = path.resolve(process.cwd(), queuePath);
  const payload = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!Array.isArray(payload.items)) {
    throw new Error(`Factory queue file ${queuePath} must contain an items array`);
  }
  return { resolved, payload };
}

function buildImportDryRun(payload, config = {}) {
  const sourceItems = Array.isArray(payload.items) ? payload.items : [];
  const items = sourceItems.map((item, index) => {
    const entry = buildFactoryQueueImport(item, index, config);
    return {
      id: entry.item.id,
      stage: entry.item.stage,
      taskId: entry.item.taskId || null,
      evidencePath: entry.item.evidencePath || null,
      attempts: entry.item.attempts,
    };
  });
  const stageCounts = items.reduce((counts, item) => {
    counts[item.stage] = (counts[item.stage] || 0) + 1;
    return counts;
  }, {});
  return { sourceItems: sourceItems.length, stageCounts, items };
}

function migratedQueueMarker(payload = {}, result = {}, migratedAt = new Date().toISOString()) {
  const sourceItems = Array.isArray(payload.items) ? payload.items.length : 0;
  return {
    schemaVersion: payload.schemaVersion || '1.0',
    kind: payload.kind || 'factory-delivery-queue',
    migratedTo: 'factory_delivery_queue',
    migratedAt,
    sourceItems,
    imported: Number(result.imported?.length ?? result.imported ?? 0),
    items: [],
  };
}

function writeMigratedQueueMarker(queuePath, payload, result) {
  const marker = migratedQueueMarker(payload, result);
  fs.writeFileSync(queuePath, `${JSON.stringify(marker, null, 2)}\n`);
  return marker;
}

async function main() {
  const queuePath = readArg('--queue', process.env.FACTORY_QUEUE_PATH || DEFAULT_QUEUE_PATH);
  const { resolved, payload } = loadQueue(queuePath);
  const config = resolveFactoryConfig({
    queueBackend: 'postgres',
    tenantId: readArg('--tenant-id', process.env.TENANT_ID || 'engineering-team'),
    deliveryDir: readArg('--delivery-dir', process.env.FACTORY_DELIVERY_DIR || ''),
    factoryQueueDatabaseUrl: readArg(
      '--database-url',
      process.env.FACTORY_QUEUE_DATABASE_URL || process.env.DATABASE_URL || '',
    ),
  });

  if (hasFlag('--dry-run')) {
    const dryRun = buildImportDryRun(payload, config);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      dryRun: true,
      queuePath: resolved,
      queueBackend: 'postgres',
      queueTable: 'factory_delivery_queue',
      ...dryRun,
    }, null, 2)}\n`);
    return;
  }

  const store = createPostgresFactoryQueueStore(config);
  try {
    const result = await store.importQueue(payload, config);
    const sourceCleared = !hasFlag('--preserve-source');
    if (sourceCleared) writeMigratedQueueMarker(resolved, payload, result);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      queuePath: resolved,
      queueBackend: result.queueBackend,
      queueTable: result.queueTable,
      sourceItems: result.sourceItems,
      imported: result.imported.length,
      sourceCleared,
      items: result.imported.map((item) => ({
        id: item.id,
        stage: item.stage,
        taskId: item.taskId || null,
        evidencePath: item.evidencePath || null,
      })),
    }, null, 2)}\n`);
  } finally {
    await store.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildImportDryRun, loadQueue, migratedQueueMarker, readArg, writeMigratedQueueMarker };
