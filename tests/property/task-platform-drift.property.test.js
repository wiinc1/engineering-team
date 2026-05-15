const test = require('node:test');
const assert = require('node:assert/strict');
const { detectTaskPlatformDrift } = require('../../lib/task-platform/drift');

function taskRow(index, overrides = {}) {
  return {
    task_id: `TSK-PROP-${index}`,
    version: 1 + (index % 9),
    canonical_version: 1 + (index % 9),
    last_audit_sequence_number: index + 3,
    last_projected_sequence_number: index + 3,
    sync_status: 'synced',
    ...overrides,
  };
}

test('task-platform drift detector stays clean when checkpoint invariants hold', () => {
  const rows = Array.from({ length: 50 }, (_, index) => taskRow(index));
  const result = detectTaskPlatformDrift(rows);

  assert.equal(result.ok, true);
  assert.equal(result.total, 0);
});

test('task-platform drift detector reports every generated invariant violation', () => {
  for (let index = 0; index < 50; index += 1) {
    const version = 2 + (index % 11);
    const result = detectTaskPlatformDrift([
      taskRow(index, {
        version,
        canonical_version: version - 1,
        last_audit_sequence_number: index + 10,
        last_projected_sequence_number: index + 9,
        sync_status: index % 2 === 0 ? 'error' : 'pending',
      }),
    ]);
    const types = result.findings.map(finding => finding.type);

    assert.equal(result.ok, false);
    assert.ok(types.includes('version_mismatch'), `missing version drift for ${index}`);
    assert.ok(types.includes('stale_projection_sequence'), `missing sequence drift for ${index}`);
    assert.ok(types.includes('inactive_sync_status'), `missing sync-status drift for ${index}`);
  }
});
