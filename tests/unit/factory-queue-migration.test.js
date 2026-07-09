const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildFactoryQueueImport } = require('../../lib/task-platform/factory-delivery-queue-postgres');
const {
  migratedQueueMarker,
  writeMigratedQueueMarker,
} = require('../../scripts/migrate-factory-queue-postgres');

function queuePayload() {
  return {
    schemaVersion: '1.0',
    kind: 'factory-delivery-queue',
    items: [
      { id: 'factory-legacy-1', stage: 'failed' },
      { id: 'factory-legacy-2', stage: 'phase6_complete' },
    ],
  };
}

test('factory queue migration marker records imported source count and clears live items', () => {
  const marker = migratedQueueMarker(queuePayload(), {
    imported: [
      { id: 'factory-legacy-1', stage: 'dead_letter' },
      { id: 'factory-legacy-2', stage: 'phase6_complete' },
    ],
  }, '2026-07-05T12:00:00.000Z');

  assert.equal(marker.migratedTo, 'factory_delivery_queue');
  assert.equal(marker.migratedAt, '2026-07-05T12:00:00.000Z');
  assert.equal(marker.sourceItems, 2);
  assert.equal(marker.imported, 2);
  assert.deepEqual(marker.items, []);
});

test('factory queue migration writes an empty migrated legacy queue marker', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-queue-migration-'));
  const queuePath = path.join(tmp, 'factory-delivery-queue.json');
  fs.writeFileSync(queuePath, `${JSON.stringify(queuePayload(), null, 2)}\n`);

  const marker = writeMigratedQueueMarker(queuePath, queuePayload(), { imported: [{ id: 'factory-legacy-1' }] });
  const persisted = JSON.parse(fs.readFileSync(queuePath, 'utf8'));

  assert.equal(marker.imported, 1);
  assert.equal(persisted.migratedTo, 'factory_delivery_queue');
  assert.deepEqual(persisted.items, []);
});

test('factory queue migration preserves top-level real-delivery proof metadata', () => {
  const imported = buildFactoryQueueImport({
    id: 'factory-real-delivery',
    title: 'Real delivery import',
    requirements: 'Move real-delivery queue item into durable postgres.',
    templateTier: 'Standard',
    stage: 'phase6_complete',
    ciRepository: 'wiinc1/engineering-team',
    branchName: 'factory/real-delivery-import',
    implementationCommitSha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/418',
    candidateProofPath: 'observability/factory-delivery/factory-real-delivery-candidate-proof.json',
    finalEvidencePath: 'observability/factory-delivery/factory-real-delivery-final-evidence.json',
    metadata: { realDelivery: { releaseEnv: 'staging' } },
  }, 0, { tenantId: 'tenant-a' });

  const metadata = JSON.parse(imported.params[24]);
  assert.equal(metadata.realDelivery.releaseEnv, 'staging');
  assert.equal(metadata.realDelivery.ciRepository, 'wiinc1/engineering-team');
  assert.equal(metadata.realDelivery.branchName, 'factory/real-delivery-import');
  assert.equal(metadata.realDelivery.implementationCommitSha, '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd');
  assert.equal(metadata.realDelivery.prUrl, 'https://github.com/wiinc1/engineering-team/pull/418');
  assert.equal(metadata.realDelivery.candidateProofPath, 'observability/factory-delivery/factory-real-delivery-candidate-proof.json');
  assert.equal(metadata.realDelivery.finalEvidencePath, 'observability/factory-delivery/factory-real-delivery-final-evidence.json');
});

test('factory queue migration idempotency includes normalized real-delivery proof metadata', () => {
  const base = {
    title: 'Real delivery import',
    requirements: 'Move real-delivery queue item into durable postgres.',
    templateTier: 'Standard',
    stage: 'queued',
    changeKind: 'bugfix',
    changedFiles: ['lib/task-platform/factory-delivery-queue-import.js'],
    ciRepository: 'wiinc1/engineering-team',
    branchName: 'factory/real-delivery-import',
    implementationCommitSha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/418',
  };
  const first = buildFactoryQueueImport({ ...base, candidateProofPath: 'proof-a.json' }, 0, { tenantId: 'tenant-a' });
  const retry = buildFactoryQueueImport({ ...base, candidateProofPath: 'proof-a.json' }, 0, { tenantId: 'tenant-a' });
  const differentProof = buildFactoryQueueImport({ ...base, candidateProofPath: 'proof-b.json' }, 0, { tenantId: 'tenant-a' });

  assert.equal(first.params[2], retry.params[2]);
  assert.notEqual(first.params[2], differentProof.params[2]);
});
