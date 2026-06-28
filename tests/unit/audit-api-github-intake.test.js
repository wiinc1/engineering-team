const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createAuditApiServer } = require('../../lib/audit/http-projects');

function signJwt(secret, claims = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'github-intake-reader',
    tenant_id: 'engineering-team',
    roles: ['reader', 'admin'],
    exp: Math.floor(Date.now() / 1000) + 120,
    ...claims,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function githubSignature(secret, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function withServer(handler, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-intake-api-'));
  const secret = 'gh-intake-secret';
  const previousBackend = process.env.AUDIT_STORE_BACKEND;
  const previousAllowFile = process.env.ALLOW_FILE_AUDIT_BACKEND;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.AUDIT_STORE_BACKEND = 'file';
  process.env.ALLOW_FILE_AUDIT_BACKEND = 'true';
  delete process.env.DATABASE_URL;
  const { server } = createAuditApiServer({
    baseDir,
    jwtSecret: 'jwt-secret',
    githubWebhookSecret: secret,
    ffGitHubIntakeNormalizer: 'true',
    ffGitHubIntakeProjectBootstrap: 'true',
    ffProjects: 'true',
    ffGitHubSync: 'true',
    ...options,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await handler({ baseUrl, secret, baseDir });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (previousBackend === undefined) delete process.env.AUDIT_STORE_BACKEND;
    else process.env.AUDIT_STORE_BACKEND = previousBackend;
    if (previousAllowFile === undefined) delete process.env.ALLOW_FILE_AUDIT_BACKEND;
    else process.env.ALLOW_FILE_AUDIT_BACKEND = previousAllowFile;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

function uniqueIssueNumber() {
  return 900_000 + Math.floor(Math.random() * 99_000);
}

function issuePayload(overrides = {}) {
  const issueNumber = overrides.issue?.number ?? uniqueIssueNumber();
  const base = {
    action: 'opened',
    issue: {
      number: issueNumber,
      title: 'Webhook intake pilot',
      body: 'Create an intake draft from this GitHub issue.',
      html_url: `https://github.com/wiinc1/engineering-team/issues/${issueNumber}`,
      labels: [{ name: 'factory-intake' }],
    },
    repository: {
      full_name: 'wiinc1/engineering-team',
      owner: { login: 'wiinc1' },
      name: 'engineering-team',
    },
    sender: { login: 'wiinc1' },
  };
  return {
    ...base,
    ...overrides,
    issue: {
      ...base.issue,
      ...(overrides.issue || {}),
      number: issueNumber,
      html_url: overrides.issue?.html_url || base.issue.html_url,
    },
  };
}

test('issues.opened with factory-intake label creates an intake draft task', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const issueNumber = uniqueIssueNumber();
    const body = JSON.stringify(issuePayload({ issue: { number: issueNumber } }));
    const response = await fetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'issues',
        'x-github-delivery': 'delivery-intake-1',
        'x-hub-signature-256': githubSignature(secret, body),
      },
      body,
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.created, true);
    assert.ok(payload.taskId);
    assert.equal(payload.githubIssueUrl, `https://github.com/wiinc1/engineering-team/issues/${issueNumber}`);
    assert.ok(payload.projectId);
    assert.equal(payload.projectBootstrap?.projectId, payload.projectId);

    const duplicate = await fetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'issues',
        'x-github-delivery': 'delivery-intake-2',
        'x-hub-signature-256': githubSignature(secret, body),
      },
      body,
    });
    assert.equal(duplicate.status, 202);
    const duplicatePayload = await duplicate.json();
    assert.equal(duplicatePayload.reason, 'existing_intake_task');
    assert.equal(duplicatePayload.taskId, payload.taskId);
    assert.equal(duplicatePayload.projectId, payload.projectId);

    const taskDetail = await fetch(`${baseUrl}/api/v1/tasks/${encodeURIComponent(payload.taskId)}`, {
      headers: { authorization: `Bearer ${signJwt('jwt-secret', { roles: ['admin', 'pm', 'reader'] })}` },
    });
    assert.equal(taskDetail.status, 200);
    const taskBody = await taskDetail.json();
    assert.equal(taskBody.data?.projectId, payload.projectId);

    const state = await fetch(`${baseUrl}/tasks/${encodeURIComponent(payload.taskId)}/state`, {
      headers: { authorization: `Bearer ${signJwt('jwt-secret')}` },
    });
    assert.equal(state.status, 200);
    const stateBody = await state.json();
    const currentStage = stateBody.current_stage || stateBody.data?.current_stage;
    assert.ok(currentStage === 'DRAFT' || currentStage === 'INTAKE_DRAFT');
    assert.equal(stateBody.waiting_state, 'task_refinement');
    assert.equal(stateBody.assignee, 'pm');

    const history = await fetch(`${baseUrl}/tasks/${encodeURIComponent(payload.taskId)}/history`, {
      headers: { authorization: `Bearer ${signJwt('jwt-secret')}` },
    });
    assert.equal(history.status, 200);
    const historyBody = await history.json();
    const created = historyBody.items.find((item) => item.event_type === 'task.created');
    assert.equal(created.payload.github_issue_url, `https://github.com/wiinc1/engineering-team/issues/${issueNumber}`);
    assert.ok(historyBody.items.some((item) => item.event_type === 'task.refinement_requested'));
  });
});

test('github intake normalizer is gated behind ff_github_intake_normalizer', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const body = JSON.stringify(issuePayload({ issue: { number: 903, html_url: 'https://github.com/wiinc1/engineering-team/issues/903', labels: [{ name: 'factory-intake' }], title: 'Flag gate', body: 'Gate test' } }));
    const response = await fetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'issues',
        'x-github-delivery': 'delivery-intake-flag',
        'x-hub-signature-256': githubSignature(secret, body),
      },
      body,
    });
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.error.code, 'feature_disabled');
    assert.equal(payload.error.details.feature, 'ff_github_intake_normalizer');
  }, { ffGitHubIntakeNormalizer: 'false' });
});

test('issues without opt-in label are ignored', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const body = JSON.stringify(issuePayload({
      issue: {
        number: 902,
        title: 'Ignored issue',
        body: 'No label',
        html_url: 'https://github.com/wiinc1/engineering-team/issues/902',
        labels: [{ name: 'enhancement' }],
      },
    }));
    const response = await fetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'issues',
        'x-github-delivery': 'delivery-intake-ignored',
        'x-hub-signature-256': githubSignature(secret, body),
      },
      body,
    });
    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.ignored, true);
    assert.equal(payload.reason, 'missing_opt_in_label');
  });
});