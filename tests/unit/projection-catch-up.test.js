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

test('postgres replay sets PGSSLMODE before forge seed for local Docker', () => {
  const script = fs.readFileSync(path.join(__dirname, '../../scripts/replay-golden-path-postgres.js'), 'utf8');
  assert.match(script, /ensurePostgresProcessEnv/);
  assert.match(script, /PGSSLMODE/);
});

test('runProjectionCatchUp skips file-backed local stack', async () => {
  const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projection-catchup-'));
  const result = await runProjectionCatchUp({ persistDir, baseUrl: 'http://127.0.0.1:13000' }, { label: 'phase-1' });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'local_file_sync');
});

test('runProjectionCatchUp uses worker lag when metrics require jwt auth', async () => {
  const originalFetch = global.fetch;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://audit:audit@127.0.0.1:15432/engineering_team';
  let authHeader = null;
  global.fetch = async (_url, init = {}) => {
    authHeader = init.headers?.authorization || null;
    return {
      ok: true,
      async text() {
        return 'workflow_projection_lag_seconds 0\n';
      },
    };
  };

  try {
    const result = await runProjectionCatchUp(
      {
        baseUrl: 'http://127.0.0.1:13000',
        jwtSecret: 'golden-path-local-dev-secret',
        tenantId: 'engineering-team',
        actorId: 'projection-catchup-test',
      },
      { waitMs: 0, maxRetries: 1 },
    );
    assert.equal(result.mode, 'always_on_worker');
    assert.match(authHeader, /^Bearer /);
  } finally {
    global.fetch = originalFetch;
    if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test('runProjectionCatchUp uses worker lag when metrics are fresh', async () => {
  const originalFetch = global.fetch;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://audit:audit@127.0.0.1:15432/engineering_team';
  global.fetch = async () => ({
    ok: true,
    async text() {
      return 'workflow_projection_lag_seconds 0\n';
    },
  });

  try {
    const result = await runProjectionCatchUp(
      { baseUrl: 'http://127.0.0.1:13000' },
      { waitMs: 0, maxRetries: 2 },
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'worker_caught_up');
    assert.equal(result.mode, 'always_on_worker');
    assert.equal(result.retries, 0);
  } finally {
    global.fetch = originalFetch;
    if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test('runProjectionCatchUp logs structured warning when manual fallback is invoked', async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalStderr = process.stderr.write;
  const stderrLines = [];
  process.env.DATABASE_URL = 'postgres://audit:audit@127.0.0.1:15432/engineering_team';
  process.stderr.write = (chunk) => {
    stderrLines.push(String(chunk));
    return true;
  };

  try {
    const result = await runProjectionCatchUp(
      { baseUrl: 'http://127.0.0.1:13000' },
      { waitMs: 0, maxRetries: 0 },
    );
    assert.equal(result.warning, 'projection_worker_lag_detected_manual_catchup_invoked');
    assert.ok(stderrLines.some((line) => line.includes('manual_fallback')));
  } finally {
    process.stderr.write = originalStderr;
    if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test('runProjectionCatchUp retries worker lag polling before manual fallback', async () => {
  const originalFetch = global.fetch;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://audit:audit@127.0.0.1:15432/engineering_team';
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      async text() {
        return calls < 3
          ? 'workflow_projection_lag_seconds 9\n'
          : 'workflow_projection_lag_seconds 0\n';
      },
    };
  };

  try {
    const result = await runProjectionCatchUp(
      { baseUrl: 'http://127.0.0.1:13000' },
      { waitMs: 0, maxRetries: 3 },
    );
    assert.equal(result.mode, 'always_on_worker');
    assert.equal(result.reason, 'worker_caught_up');
    assert.ok(calls >= 3);
  } finally {
    global.fetch = originalFetch;
    if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
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