const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runGp005GithubIntakeProjectVerify } = require('../../lib/audit/gp-005-github-intake-project-verify');

test('runGp005GithubIntakeProjectVerify writes complete evidence', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-005-verify-'));
  const stackStatePath = path.join(outputDir, 'stack.json');
  fs.writeFileSync(stackStatePath, JSON.stringify({
    processes: [{ name: 'audit-api', pid: process.pid }],
  }));

  const issueNumber = 912_345;
  const projectId = 'PRJ-TESTGP5';
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
            taskId: 'TSK-GP005',
            projectId,
            projectName: 'Factory delivery — GP-005 verify [#912345]',
            projectBootstrap: { skipped: false, created: true, projectId, attached: true },
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
          taskId: 'TSK-GP005',
          projectId,
          projectBootstrap: { skipped: false, existing: true, projectId, attached: false },
        }),
      };
    }
    if (String(url).includes('/api/v1/tasks/TSK-GP005') && !String(url).endsWith('/state')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            taskId: 'TSK-GP005',
            projectId,
            project: { projectId, name: 'Factory delivery — GP-005 verify [#912345]' },
          },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '{}' };
  };

  const { evidence, complete } = await runGp005GithubIntakeProjectVerify({
    fetchImpl,
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