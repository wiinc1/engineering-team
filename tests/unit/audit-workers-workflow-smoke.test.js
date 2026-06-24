const test = require('node:test');
const assert = require('node:assert/strict');
const { runAuditWorkersWorkflowSmoke } = require('../../lib/audit/audit-workers-workflow-smoke');

test('workflow smoke verifies intake projection exposes next_required_action', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).endsWith('/tasks') && options.method === 'POST') {
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ taskId: 'TSK-INTAKE01' }),
      };
    }
    if (String(url).includes('/api/v1/tasks/TSK-INTAKE01/state')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            task_id: 'TSK-INTAKE01',
            next_required_action: 'PM refinement required',
            waiting_state: 'task_refinement',
          },
        }),
      };
    }
    return { ok: false, status: 404, text: async () => '{}' };
  };

  const evidence = await runAuditWorkersWorkflowSmoke({
    fetchImpl,
    baseUrl: 'http://127.0.0.1:13000',
    authHeaders: { authorization: 'Bearer test' },
    maxAttempts: 1,
    waitMs: 1,
  });

  assert.equal(evidence.summary.passed, true);
  assert.ok(requests.some((entry) => entry.method === 'POST' && entry.url.endsWith('/tasks')));
});