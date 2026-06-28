const test = require('node:test');
const assert = require('node:assert/strict');
const { runAuditWorkersProductionSmoke } = require('../../lib/audit/audit-workers-production-smoke');

test('audit workers production smoke posts through /api/v1 task routes', async () => {
  const requests = [];
  let metricsReads = 0;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).endsWith('/metrics')) {
      metricsReads += 1;
      const processed = metricsReads <= 1 ? 10 : 12;
      const outbox = metricsReads <= 1 ? 5 : 6;
      return {
        ok: true,
        status: 200,
        text: async () => `workflow_projection_lag_seconds 0\nworkflow_projection_events_processed_total ${processed}\nworkflow_outbox_events_published_total ${outbox}\n`,
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

  const evidence = await runAuditWorkersProductionSmoke({
    fetchImpl,
    baseUrl: 'https://engineering-team-zeta.vercel.app',
    jwtSecret: 'test-secret',
    outputPath: 'observability/audit-workers-production-smoke.test.json',
    waitMs: 1,
  });

  assert.equal(evidence.summary.passed, true);
  assert.ok(requests.some((entry) => entry.url.includes('/api/v1/tasks/') && entry.url.endsWith('/events')));
  assert.ok(requests.some((entry) => entry.url.includes('/api/v1/tasks/') && entry.url.endsWith('/state')));
  assert.equal(evidence.metrics.projectionEventsProcessedDelta, 2);
});