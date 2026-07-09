const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  stackHasAuditApi,
  runGp002GithubIntakeVerify,
} = require('../../lib/audit/gp-002-github-intake-verify');

test('stackHasAuditApi detects audit-api process in stack state', () => {
  assert.equal(stackHasAuditApi({ processes: [{ name: 'audit-workers', pid: 999999 }] }), false);
  assert.equal(stackHasAuditApi({ processes: [{ name: 'audit-api', pid: process.pid }] }, { requireAlive: true }), true);
  assert.equal(stackHasAuditApi({ processes: [{ name: 'audit-api', pid: 42 }] }, { requireAlive: false }), true);
});

function createGp002Fixture() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-002-verify-'));
  const stackDir = path.join(outputDir, 'stack-state');
  fs.mkdirSync(stackDir, { recursive: true });
  const stackStatePath = path.join(stackDir, 'stack.json');
  fs.writeFileSync(stackStatePath, JSON.stringify({
    processes: [{ name: 'audit-api', pid: process.pid }],
  }));
  return { outputDir, stackStatePath };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function gp002CreatedWebhookResponse(expectedIssueUrl) {
  return jsonResponse(201, {
    received: true,
    created: true,
    taskId: 'TSK-GP002',
    intakeProvider: 'gitlab',
    forgeIssueUrl: expectedIssueUrl,
    gitlabIssueUrl: expectedIssueUrl,
    intakeDraft: true,
  });
}

function gp002DuplicateWebhookResponse() {
  return jsonResponse(202, {
    received: true,
    ignored: true,
    reason: 'existing_intake_task',
    taskId: 'TSK-GP002',
  });
}

function gp002TaskStateResponse() {
  return jsonResponse(200, {
    data: {
      task_id: 'TSK-GP002',
      waiting_state: 'task_refinement',
      assignee: 'pm',
    },
  });
}

function gp002HistoryResponse(expectedIssueUrl) {
  return jsonResponse(200, {
    items: [
      {
        event_type: 'task.created',
        payload: {
          forge_issue_url: expectedIssueUrl,
          gitlab_issue_url: expectedIssueUrl,
        },
      },
      { event_type: 'task.refinement_requested' },
    ],
  });
}

function gp002WebhookResponse(state, expectedIssueUrl) {
  state.webhookPosts += 1;
  return state.webhookPosts === 1
    ? gp002CreatedWebhookResponse(expectedIssueUrl)
    : gp002DuplicateWebhookResponse();
}

function createGp002FetchMock(state, expectedIssueUrl) {
  return async function fetchImpl(url, options = {}) {
    const route = String(url);
    if (route.endsWith('/gitlab/webhooks') && options.method === 'POST') {
      return gp002WebhookResponse(state, expectedIssueUrl);
    }
    if (route.includes('/api/v1/tasks/TSK-GP002/state')) return gp002TaskStateResponse();
    if (route.includes('/tasks/TSK-GP002/history')) return gp002HistoryResponse(expectedIssueUrl);
    return jsonResponse(404, {});
  };
}

test('runGp002GithubIntakeVerify writes smoke and complete evidence', async () => {
  const { outputDir, stackStatePath } = createGp002Fixture();
  const issueNumber = 991_234;
  const expectedIssueUrl = `http://192.168.1.116/wiinc1/engineering-team/-/issues/${issueNumber}`;
  const fetchState = { webhookPosts: 0 };
  const { evidence, complete } = await runGp002GithubIntakeVerify({
    fetchImpl: createGp002FetchMock(fetchState, expectedIssueUrl),
    baseUrl: 'http://127.0.0.1:13000',
    jwtSecret: 'test-secret',
    githubWebhookSecret: 'test-webhook-secret',
    outputDir,
    stackStatePath,
    issueNumber,
    waitMs: 1,
    maxAttempts: 2,
    completePath: path.join(outputDir, 'gp-002-complete.json'),
    canonicalSmokePath: path.join(outputDir, 'canonical-smoke.json'),
  });

  assert.equal(evidence.summary.passed, true);
  assert.equal(complete.summary.passed, true);
  assert.equal(fs.existsSync(path.join(outputDir, 'gp-002-github-intake-smoke.json')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'gp-002-complete.json')), true);
});
