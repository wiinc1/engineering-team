const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  runFactoryOrchestratorTick,
  submitFactoryRequirements,
} = require('../../lib/task-platform/factory-delivery');
const { resolveFactoryConfig } = require('../../lib/task-platform/factory-delivery-shared');
const {
  isMigratedFactoryQueueMarker,
  loadFactoryQueue,
} = require('../../lib/task-platform/factory-delivery-file-queue');

function writeMigratedQueueMarker(queuePath) {
  fs.writeFileSync(queuePath, `${JSON.stringify({
    schemaVersion: '1.0',
    kind: 'factory-delivery-queue',
    migratedTo: 'factory_delivery_queue',
    migratedAt: '2026-07-05T12:00:00.000Z',
    sourceItems: 2,
    imported: 2,
    items: [],
  }, null, 2)}\n`);
}

test('file queue loader identifies migrated postgres marker', () => {
  assert.equal(isMigratedFactoryQueueMarker({
    migratedTo: 'factory_delivery_queue',
    items: [],
  }), true);
  assert.equal(isMigratedFactoryQueueMarker({ items: [] }), false);
  assert.equal(isMigratedFactoryQueueMarker({
    migratedTo: 'factory_delivery_queue',
    items: [{ id: 'factory-live' }],
  }), false);
});

test('file queue mode requires a non-default legacy queue path', () => {
  assert.throws(
    () => resolveFactoryConfig({ queueBackend: 'file', allowFileQueue: true }),
    /requires a non-default FACTORY_QUEUE_PATH/,
  );
  const queuePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'factory-file-queue-path-')), 'queue.json');
  const config = resolveFactoryConfig({ queueBackend: 'file', allowFileQueue: true, queuePath });
  assert.equal(config.queuePath, queuePath);
  const legacy = resolveFactoryConfig({ queueBackend: 'file', allowFileQueue: true, allowDefaultFileQueuePath: true });
  assert.equal(legacy.queuePath, 'observability/factory-delivery-queue.json');
});

test('file queue submission refuses to repopulate a migrated postgres queue marker', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-migrated-submit-'));
  const queuePath = path.join(tmp, 'factory-delivery-queue.json');
  writeMigratedQueueMarker(queuePath);

  assert.throws(
    () => submitFactoryRequirements([
      { title: 'Local smoke', requirements: 'Do not repopulate migrated legacy queue.' },
    ], {
      queuePath,
      queueBackend: 'file',
      allowFileQueue: true,
      deliveryDir: path.join(tmp, 'delivery'),
    }),
    /migrated to factory_delivery_queue/,
  );
  assert.deepEqual(loadFactoryQueue(queuePath).items, []);
});

test('file queue orchestrator refuses to process a migrated postgres queue marker', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-migrated-orchestrator-'));
  const queuePath = path.join(tmp, 'factory-delivery-queue.json');
  writeMigratedQueueMarker(queuePath);

  await assert.rejects(
    () => runFactoryOrchestratorTick({
      queuePath,
      queueBackend: 'file',
      allowFileQueue: true,
      jwtSecret: 'factory-test-secret',
      deliveryDir: path.join(tmp, 'delivery'),
      maxItems: 1,
    }),
    /migrated to factory_delivery_queue/,
  );
});
