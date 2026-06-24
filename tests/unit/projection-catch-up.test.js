const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runProjectionCatchUp } = require('../../lib/audit/projection-catch-up');
const {
  mergeStepsCompleted,
  pollForgeExecutionReadiness,
} = require('../../lib/task-platform/golden-path-shared');
const {
  readmeHasGoldenPathMarker,
  addReadmeGoldenPathMarker,
} = require('../../lib/task-platform/golden-path-phases');

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

test('mergeStepsCompleted keeps golden-path step ids in numeric order', () => {
  assert.deepEqual(
    mergeStepsCompleted(['GP-015', 'GP-013'], ['GP-002', 'GP-015']),
    ['GP-002', 'GP-013', 'GP-015'],
  );
});

test('pollForgeExecutionReadiness retries until forge execution-readiness succeeds', async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async (url, init = {}) => {
    attempts += 1;
    assert.match(String(url), /\/tasks\/TSK-GOLDEN001\/forge-execution-readiness$/);
    assert.equal(init.method, 'GET');
    assert.match(init.headers.authorization, /^Bearer /);
    if (attempts < 2) {
      return {
        ok: false,
        status: 422,
        json: async () => ({ error: { code: 'task_not_execution_ready' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { taskId: 'TSK-GOLDEN001', executionReady: true } }),
    };
  };

  try {
    const readiness = await pollForgeExecutionReadiness(
      'http://127.0.0.1:13000',
      'TSK-GOLDEN001',
      'local-forge-smoke-token',
      { timeoutMs: 2000, intervalMs: 1 },
    );
    assert.equal(readiness.ok, true);
    assert.equal(readiness.status, 200);
    assert.equal(attempts, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('golden-path readme marker helpers stay idempotent for phase 4 retest setup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-projection-readme-'));
  const readme = path.join(dir, 'README.md');
  fs.writeFileSync(readme, '# App\n');
  assert.equal(readmeHasGoldenPathMarker(readme), false);
  const first = addReadmeGoldenPathMarker(readme);
  const second = addReadmeGoldenPathMarker(readme);
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(readmeHasGoldenPathMarker(readme), true);
});