const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runGp005GithubIntakeProjectVerify } = require('../../lib/audit/gp-005-github-intake-project-verify');

function createGp005Fixture() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-005-verify-'));
  const stackStatePath = path.join(outputDir, 'stack.json');
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

function gp005ProjectName(issueNumber) {
  return `Factory delivery — GP-005 verify [#${issueNumber}]`;
}

function gp005CreatedWebhookResponse(projectId, issueNumber) {
  return jsonResponse(201, {
    received: true,
    created: true,
    taskId: 'TSK-GP005',
    projectId,
    projectName: gp005ProjectName(issueNumber),
    projectBootstrap: { skipped: false, created: true, projectId, attached: true },
  });
}

function gp005DuplicateWebhookResponse(projectId) {
  return jsonResponse(202, {
    received: true,
    ignored: true,
    reason: 'existing_intake_task',
    taskId: 'TSK-GP005',
    projectId,
    projectBootstrap: { skipped: false, existing: true, projectId, attached: false },
  });
}

function gp005TaskDetailResponse(projectId, issueNumber) {
  return jsonResponse(200, {
    data: {
      taskId: 'TSK-GP005',
      projectId,
      project: { projectId, name: gp005ProjectName(issueNumber) },
    },
  });
}

function gp005WebhookResponse(state, projectId, issueNumber) {
  state.webhookPosts += 1;
  return state.webhookPosts === 1
    ? gp005CreatedWebhookResponse(projectId, issueNumber)
    : gp005DuplicateWebhookResponse(projectId);
}

function createGp005FetchMock(state, projectId, issueNumber) {
  return async function fetchImpl(url, options = {}) {
    const route = String(url);
    if (route.endsWith('/github/webhooks') && options.method === 'POST') {
      return gp005WebhookResponse(state, projectId, issueNumber);
    }
    if (route.includes('/api/v1/tasks/TSK-GP005') && !route.endsWith('/state')) {
      return gp005TaskDetailResponse(projectId, issueNumber);
    }
    return jsonResponse(404, {});
  };
}

test('runGp005GithubIntakeProjectVerify writes complete evidence', async () => {
  const { outputDir, stackStatePath } = createGp005Fixture();
  const issueNumber = 912_345;
  const projectId = 'PRJ-TESTGP5';
  const fetchState = { webhookPosts: 0 };
  const { evidence, complete } = await runGp005GithubIntakeProjectVerify({
    fetchImpl: createGp005FetchMock(fetchState, projectId, issueNumber),
    baseUrl: 'http://127.0.0.1:13000',
    jwtSecret: 'test-secret',
    githubWebhookSecret: 'test-webhook-secret',
    outputDir,
    stackStatePath,
    issueNumber,
    completePath: path.join(outputDir, 'gp-005-complete.json'),
  });

  assert.equal(evidence.summary.passed, true);
  assert.equal(complete.summary.passed, true);
  assert.equal(fs.existsSync(path.join(outputDir, 'gp-005-complete.json')), true);
});
