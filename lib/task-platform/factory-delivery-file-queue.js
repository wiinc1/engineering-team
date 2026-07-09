const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_QUEUE_PATH = 'observability/factory-delivery-queue.json';
const MIGRATED_FACTORY_QUEUE_TABLE = 'factory_delivery_queue';

function isMigratedFactoryQueueMarker(queue = {}) {
  return queue?.migratedTo === MIGRATED_FACTORY_QUEUE_TABLE
    && Array.isArray(queue.items)
    && queue.items.length === 0;
}

function migratedQueueMarkerError(queuePath, operation = 'file queue operation') {
  const error = new Error(
    `Factory queue file ${queuePath} was migrated to ${MIGRATED_FACTORY_QUEUE_TABLE}; use FACTORY_QUEUE_BACKEND=postgres for ${operation}`,
  );
  error.code = 'factory_queue_migrated_to_postgres';
  return error;
}

function assertActiveFactoryQueueFile(queue = {}, queuePath = DEFAULT_QUEUE_PATH, operation) {
  if (isMigratedFactoryQueueMarker(queue)) throw migratedQueueMarkerError(queuePath, operation);
  return queue;
}

function loadFactoryQueue(queuePath = DEFAULT_QUEUE_PATH) {
  const resolved = path.resolve(process.cwd(), queuePath);
  if (!fs.existsSync(resolved)) {
    return { schemaVersion: '1.0', kind: 'factory-delivery-queue', items: [] };
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function saveFactoryQueue(queue, queuePath = DEFAULT_QUEUE_PATH) {
  const resolved = path.resolve(process.cwd(), queuePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(queue, null, 2)}\n`);
  return resolved;
}

module.exports = {
  DEFAULT_QUEUE_PATH,
  MIGRATED_FACTORY_QUEUE_TABLE,
  assertActiveFactoryQueueFile,
  isMigratedFactoryQueueMarker,
  loadFactoryQueue,
  saveFactoryQueue,
};
