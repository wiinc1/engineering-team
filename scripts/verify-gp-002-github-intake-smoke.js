#!/usr/bin/env node
const { readArg, githubSignature, writeEvidence } = require('./golden-path-smoke-lib');

async function postIssueIntake({ baseUrl, secret, issueNumber }) {
  const payload = {
    action: 'opened',
    issue: {
      number: issueNumber,
      title: 'GP-002 staging intake smoke',
      body: 'Automated GP-002 smoke — issue body for intake draft.',
      html_url: `https://github.com/wiinc1/engineering-team/issues/${issueNumber}`,
      labels: [{ name: 'factory-intake' }],
    },
    repository: { full_name: 'wiinc1/engineering-team', owner: { login: 'wiinc1' }, name: 'engineering-team' },
    sender: { login: 'wiinc1' },
  };
  const body = JSON.stringify(payload);
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/github/webhooks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'issues',
      'x-github-delivery': `gp-002-smoke-${issueNumber}`,
      'x-hub-signature-256': githubSignature(secret, body),
    },
    body,
  });
  return { status: response.status, ok: response.ok, body: await response.json().catch(() => ({})) };
}

async function main() {
  const argv = process.argv;
  const baseUrl = readArg(argv, '--base-url', process.env.AUDIT_WORKERS_SMOKE_BASE_URL || 'http://127.0.0.1:13000');
  const secret = readArg(argv, '--webhook-secret', process.env.GITHUB_WEBHOOK_SECRET || 'golden-path-local-webhook-secret');
  const outputPath = readArg(argv, '--out', 'observability/gp-002-github-intake-smoke.json');
  const issueNumber = Number(readArg(argv, '--issue-number', String(900_000 + Math.floor(Math.random() * 99_000))));
  const result = await postIssueIntake({ baseUrl, secret, issueNumber });
  const evidence = writeEvidence(outputPath, {
    generatedAt: new Date().toISOString(),
    step: 'GP-002',
    baseUrl,
    issueNumber,
    status: result.status,
    ok: result.ok,
    body: result.body,
    summary: {
      passed: result.ok && (result.body.taskId || result.body.task_id || result.body.existing_intake_task),
      taskId: result.body.taskId || result.body.task_id || result.body.existing_intake_task?.taskId || null,
    },
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence.summary.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});