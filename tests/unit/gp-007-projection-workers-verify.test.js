const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  stackHasAuditWorkers,
  runGp007ProjectionWorkersVerify,
} = require('../../lib/audit/gp-007-projection-workers-verify');

test('stackHasAuditWorkers detects audit-workers process in stack state', () => {
  assert.equal(stackHasAuditWorkers({ processes: [{ name: 'audit-api', pid: 999999 }] }), false);
  assert.equal(stackHasAuditWorkers({ processes: [{ name: 'audit-workers', pid: process.pid }] }, { requireAlive: true }), true);
  assert.equal(stackHasAuditWorkers({ processes: [{ name: 'audit-workers', pid: 42 }] }, { requireAlive: false }), true);
});

test('runGp007ProjectionWorkersVerify copies smoke evidence to canonical path', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-007-verify-'));
  const stackDir = path.join(outputDir, 'stack-state');
  fs.mkdirSync(stackDir, { recursive: true });
  const stackStatePath = path.join(stackDir, 'stack.json');
  fs.writeFileSync(stackStatePath, JSON.stringify({
    processes: [{ name: 'audit-workers', pid: process.pid }],
  }));

  let metricsReads = 0;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/metrics')) {
      metricsReads += 1;
      const processed = metricsReads <= 1 ? 1 : 2;
      return {
        ok: true,
        status: 200,
        text: async () => `workflow_projection_lag_seconds 0\nworkflow_projection_events_processed_total ${processed}\nworkflow_outbox_events_published_total 1\n`,
      };
    }
    if (String(url).endsWith('/tasks') && options.method === 'POST') {
      return { ok: true, status: 201, text: async () => JSON.stringify({ taskId: 'TSK-INTAKE01' }) };
    }
    if (String(url).includes('/api/v1/tasks/') && String(url).endsWith('/events')) {
      return { ok: true, status: 202, text: async () => '{}' };
    }
    if (String(url).includes('/api/v1/tasks/') && String(url).endsWith('/state')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            task_id: String(url).includes('INTAKE01') ? 'TSK-INTAKE01' : 'TSK-SMOKE01',
            title: 'smoke',
            next_required_action: String(url).includes('INTAKE01') ? 'PM refinement required' : null,
          },
        }),
      };
    }
    return { ok: false, status: 404, text: async () => '{}' };
  };

  const { evidence, complete } = await runGp007ProjectionWorkersVerify({
    fetchImpl,
    baseUrl: 'http://127.0.0.1:13000',
    jwtSecret: 'test-secret',
    outputDir,
    stackStatePath,
    completePath: path.join(outputDir, 'gp-007-complete.json'),
    canonicalSmokePath: path.join(outputDir, 'canonical-smoke.json'),
    waitMs: 1,
    includeBridgeSmoke: false,
  });

  assert.equal(evidence.summary.passed, true);
  assert.equal(complete.summary.passed, true);
  assert.equal(fs.existsSync(path.join(outputDir, 'audit-workers-production-smoke.json')), true);
});