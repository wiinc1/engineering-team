const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runProjectionCatchUp } = require('../../lib/audit/projection-catch-up');

test('runProjectionCatchUp skips file-backed local stack', async () => {
  const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projection-catchup-'));
  const result = await runProjectionCatchUp({ persistDir, baseUrl: 'http://127.0.0.1:13000' }, { label: 'phase-1' });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'local_file_sync');
});

test('runProjectionCatchUp uses worker lag when metrics are fresh', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async text() {
      return 'workflow_projection_lag_seconds 0\n';
    },
  });

  try {
    const result = await runProjectionCatchUp(
      { baseUrl: 'http://127.0.0.1:13000' },
      { waitMs: 0 },
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'worker_caught_up');
    assert.equal(result.mode, 'always_on_worker');
  } finally {
    global.fetch = originalFetch;
  }
});