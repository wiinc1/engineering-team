const test = require('node:test');
const assert = require('node:assert/strict');
const { detectTaskPlatformDrift } = require('../../lib/task-platform/drift');

test('reports clean task-platform checkpoints as drift-free', () => {
  const result = detectTaskPlatformDrift([
    {
      task_id: 'TSK-1',
      version: 3,
      canonical_version: 3,
      last_audit_sequence_number: 10,
      last_projected_sequence_number: 10,
      sync_status: 'synced',
    },
    {
      task_id: 'TSK-2',
      version: 1,
      canonical_version: 1,
      sync_status: 'active',
    },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.total, 0);
});

test('reports missing checkpoints, version drift, stale projections, and failed sync state', () => {
  const result = detectTaskPlatformDrift([
    {
      task_id: 'TSK-MISSING',
      version: 1,
    },
    {
      task_id: 'TSK-VERSION',
      version: 4,
      canonical_version: 3,
      sync_status: 'synced',
    },
    {
      task_id: 'TSK-SEQUENCE',
      version: 2,
      canonical_version: 2,
      last_audit_sequence_number: 8,
      last_projected_sequence_number: 6,
      sync_status: 'synced',
    },
    {
      task_id: 'TSK-ERROR',
      version: 2,
      canonical_version: 2,
      sync_status: 'error',
      last_error: 'projection failed',
    },
  ]);

  assert.equal(result.ok, false);
  assert.deepEqual(result.findings.map(finding => finding.type), [
    'missing_checkpoint',
    'version_mismatch',
    'stale_projection_sequence',
    'inactive_sync_status',
  ]);
  assert.ok(result.remediation.every(Boolean));
});
