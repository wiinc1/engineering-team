const test = require('node:test');
const assert = require('node:assert/strict');
const { runMilestoneAStagingVerify } = require('../../lib/audit/milestone-a-staging-verify');

function captureFileAuditEnv() {
  return {
    databaseUrl: process.env.DATABASE_URL,
    auditBackend: process.env.AUDIT_STORE_BACKEND,
    allowFile: process.env.ALLOW_FILE_AUDIT_BACKEND,
  };
}

function restoreFileAuditEnv(original) {
  if (original.databaseUrl == null) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = original.databaseUrl;
  if (original.auditBackend == null) delete process.env.AUDIT_STORE_BACKEND;
  else process.env.AUDIT_STORE_BACKEND = original.auditBackend;
  if (original.allowFile == null) delete process.env.ALLOW_FILE_AUDIT_BACKEND;
  else process.env.ALLOW_FILE_AUDIT_BACKEND = original.allowFile;
}

async function withFileAuditEnv(callback) {
  const original = captureFileAuditEnv();
  delete process.env.DATABASE_URL;
  process.env.AUDIT_STORE_BACKEND = 'file';
  process.env.ALLOW_FILE_AUDIT_BACKEND = 'true';
  try {
    return await callback();
  } finally {
    restoreFileAuditEnv(original);
  }
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(status, text) {
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

function stagingTaskStateResponse() {
  return textResponse(200, JSON.stringify({
    data: {
      task_id: 'TSK-STAGING1',
      title: 'smoke',
      waiting_state: 'task_refinement',
      next_required_action: 'PM refinement required',
    },
  }));
}

function auditSmokeRouteResponse(route, method) {
  if (route.endsWith('/metrics')) return textResponse(200, 'workflow_projection_lag_seconds 0\n');
  if (route.includes('/architect-handoff')) return jsonResponse(204, {});
  if (route.includes('/tasks/') && route.endsWith('/events') && method === 'POST') return jsonResponse(202, {});
  if (route.includes('/tasks/') && route.endsWith('/state')) return stagingTaskStateResponse();
  if (route.endsWith('/github/webhooks') || route.endsWith('/gitlab/webhooks')) {
    return jsonResponse(201, { taskId: 'TSK-INTAKE1' });
  }
  return null;
}

function taskDetailResponse() {
  return jsonResponse(200, {
    task: { task_id: 'TSK-FACTORY1', stage: 'DRAFT' },
    context: { intake_draft: true },
    summary: { waitingState: 'task_refinement', currentStage: 'DRAFT' },
  });
}

function factorySmokeRouteResponse(route, pathname, method) {
  if (pathname === '/tasks' && method === 'POST') return textResponse(201, JSON.stringify({ taskId: 'TSK-WORKFLOW1' }));
  if (route.includes('/api/v1/projects') && method === 'POST') return jsonResponse(201, { data: { projectId: 'PRJ-STAGING1' } });
  if (route.endsWith('/api/v1/tasks') && method === 'POST') return jsonResponse(201, { data: { taskId: 'TSK-FACTORY1', version: 1 } });
  if (route.includes('/owner') && method === 'PATCH') return jsonResponse(200, { data: { taskId: 'TSK-FACTORY1', version: 2 } });
  if (route.includes('/project') && method === 'PATCH') return jsonResponse(200, { data: { taskId: 'TSK-FACTORY1', version: 2 } });
  if (route.includes('/refinement/start')) return jsonResponse(202, { data: { status: 'refinement_started', contractVersion: 1 } });
  if (route.includes('/execution-contract/approve')) return jsonResponse(201, { data: { version: 1, approvalMode: 'policy' } });
  if (route.includes('/execution-contract')) return jsonResponse(201, { data: { version: 1, validation: { status: 'valid' } } });
  if (route.includes('/forge-execution-readiness')) return jsonResponse(422, { error: { code: 'task_not_execution_ready' } });
  if (route.includes('/detail')) return taskDetailResponse();
  return null;
}

function createMilestoneFetchMock(requests) {
  return async function fetchImpl(url, options = {}) {
    const route = String(url);
    const pathname = new URL(route).pathname;
    const method = options.method || 'GET';
    requests.push({ url: route, method });
    return auditSmokeRouteResponse(route, method)
      || factorySmokeRouteResponse(route, pathname, method)
      || jsonResponse(200, { data: {} });
  };
}

test('milestone A staging verify aggregates worker, bridge, intake, and factory checks', async () => {
  const requests = [];
  const evidence = await withFileAuditEnv(() => runMilestoneAStagingVerify({
    fetchImpl: createMilestoneFetchMock(requests),
    baseUrl: 'https://staging.example',
    jwtSecret: 'test-secret',
    githubWebhookSecret: 'webhook-secret',
    outputDir: 'observability/milestone-a-staging-test',
    queueBackend: 'file',
    allowFileQueue: true,
    skipForgePhases: true,
    requireDelegationSmoke: false,
    skipValidation: true,
    skipPilotAgentsSeed: true,
    outputPath: 'observability/milestone-a-staging-test/milestone-a-staging-verify.json',
  }));

  assert.equal(evidence.summary.passed, true, JSON.stringify(evidence.summary.checks, null, 2));
  assert.equal(evidence.summary.checks.length, 4);
  assert.ok(requests.some((entry) => /\/(github|gitlab)\/webhooks$/.test(entry.url)));
});
