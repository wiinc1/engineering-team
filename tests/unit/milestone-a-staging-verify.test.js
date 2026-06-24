const test = require('node:test');
const assert = require('node:assert/strict');
const { runMilestoneAStagingVerify } = require('../../lib/audit/milestone-a-staging-verify');

test('milestone A staging verify aggregates worker, bridge, intake, and factory checks', async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAuditBackend = process.env.AUDIT_STORE_BACKEND;
  const originalAllowFile = process.env.ALLOW_FILE_AUDIT_BACKEND;
  delete process.env.DATABASE_URL;
  process.env.AUDIT_STORE_BACKEND = 'file';
  process.env.ALLOW_FILE_AUDIT_BACKEND = 'true';

  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const route = String(url);
    const method = options.method || 'GET';
    requests.push({ url: route, method });
    if (route.endsWith('/metrics')) {
      return { ok: true, status: 200, text: async () => 'workflow_projection_lag_seconds 0\n' };
    }
    if (route.includes('/architect-handoff')) {
      return { ok: true, status: 204, json: async () => ({}), text: async () => '' };
    }
    if (route.includes('/tasks/') && route.endsWith('/events') && method === 'POST') {
      return { ok: true, status: 202, json: async () => ({}), text: async () => '{}' };
    }
    if (route.includes('/tasks/') && route.endsWith('/state')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { task_id: 'TSK-STAGING1', title: 'smoke' } }),
      };
    }
    if (route.endsWith('/github/webhooks')) {
      return { ok: true, status: 201, json: async () => ({ taskId: 'TSK-INTAKE1' }) };
    }
    if (route.includes('/api/v1/projects') && method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ data: { projectId: 'PRJ-STAGING1' } }) };
    }
    if (route.endsWith('/api/v1/tasks') && method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ data: { taskId: 'TSK-FACTORY1', version: 1 } }) };
    }
    if (route.includes('/owner') && method === 'PATCH') {
      return { ok: true, status: 200, json: async () => ({ data: { taskId: 'TSK-FACTORY1', version: 2 } }) };
    }
    if (route.includes('/project') && method === 'PATCH') {
      return { ok: true, status: 200, json: async () => ({ data: { taskId: 'TSK-FACTORY1', version: 2 } }) };
    }
    if (route.includes('/refinement/start')) {
      return { ok: true, status: 202, json: async () => ({ data: { status: 'refinement_started', contractVersion: 1 } }) };
    }
    if (route.includes('/execution-contract/approve')) {
      return { ok: true, status: 201, json: async () => ({ data: { version: 1, approvalMode: 'policy' } }) };
    }
    if (route.includes('/execution-contract')) {
      return {
        ok: true,
        status: 201,
        json: async () => ({ data: { version: 1, validation: { status: 'valid' } } }),
      };
    }
    if (route.includes('/forge-execution-readiness')) {
      return { ok: true, status: 422, json: async () => ({ error: { code: 'task_not_execution_ready' } }) };
    }
    if (route.includes('/detail')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          task: { task_id: 'TSK-FACTORY1', stage: 'DRAFT' },
          context: { intake_draft: true },
          summary: { waitingState: 'task_refinement', currentStage: 'DRAFT' },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ data: {} }), text: async () => '{}' };
  };

  const evidence = await runMilestoneAStagingVerify({
    fetchImpl,
    baseUrl: 'https://staging.example',
    jwtSecret: 'test-secret',
    githubWebhookSecret: 'webhook-secret',
    outputDir: 'observability/milestone-a-staging-test',
    skipForgePhases: true,
    requireDelegationSmoke: false,
    skipValidation: true,
    skipPilotAgentsSeed: true,
    outputPath: 'observability/milestone-a-staging-test/milestone-a-staging-verify.json',
  });

  try {
    assert.equal(evidence.summary.passed, true, JSON.stringify(evidence.summary.checks, null, 2));
    assert.equal(evidence.summary.checks.length, 4);
    assert.ok(requests.some((entry) => entry.url.includes('/github/webhooks')));
  } finally {
    if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalAuditBackend == null) delete process.env.AUDIT_STORE_BACKEND;
    else process.env.AUDIT_STORE_BACKEND = originalAuditBackend;
    if (originalAllowFile == null) delete process.env.ALLOW_FILE_AUDIT_BACKEND;
    else process.env.ALLOW_FILE_AUDIT_BACKEND = originalAllowFile;
  }
});