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

test('runGp002GithubIntakeVerify writes smoke and complete evidence', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-002-verify-'));
  const stackDir = path.join(outputDir, 'stack-state');
  fs.mkdirSync(stackDir, { recursive: true });
  const stackStatePath = path.join(stackDir, 'stack.json');
  fs.writeFileSync(stackStatePath, JSON.stringify({
    processes: [{ name: 'audit-api', pid: process.pid }],
  }));

  const issueNumber = 991_234;
  let webhookPosts = 0;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/github/webhooks') && options.method === 'POST') {
      webhookPosts += 1;
      if (webhookPosts === 1) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            received: true,
            created: true,
            taskId: 'TSK-GP002',
            githubIssueUrl: `https://github.com/wiinc1/engineering-team/issues/${issueNumber}`,
            intakeDraft: true,
          }),
        };
      }
      return {
        ok: true,
        status: 202,
        json: async () => ({
          received: true,
          ignored: true,
          reason: 'existing_intake_task',
          taskId: 'TSK-GP002',
        }),
      };
    }
    if (String(url).includes('/api/v1/tasks/TSK-GP002/state')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            task_id: 'TSK-GP002',
            waiting_state: 'task_refinement',
            assignee: 'pm',
          },
        }),
      };
    }
    if (String(url).includes('/tasks/TSK-GP002/history')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              event_type: 'task.created',
              payload: {
                github_issue_url: `https://github.com/wiinc1/engineering-team/issues/${issueNumber}`,
              },
            },
            { event_type: 'task.refinement_requested' },
          ],
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '{}' };
  };

  const { evidence, complete } = await runGp002GithubIntakeVerify({
    fetchImpl,
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