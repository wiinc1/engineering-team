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
    sub: 'gitlab-intake-reader',
    tenant_id: 'engineering-team',
    roles: ['reader', 'admin'],
    exp: Math.floor(Date.now() / 1000) + 120,
    ...claims,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function withServer(handler, options = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlab-intake-api-'));
  const secret = 'gitlab-intake-secret';
  const previousBackend = process.env.AUDIT_STORE_BACKEND;
  const previousAllowFile = process.env.ALLOW_FILE_AUDIT_BACKEND;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.AUDIT_STORE_BACKEND = 'file';
  process.env.ALLOW_FILE_AUDIT_BACKEND = 'true';
  delete process.env.DATABASE_URL;
  const { server } = createAuditApiServer({
    baseDir,
    jwtSecret: 'jwt-secret',
    gitlabWebhookSecret: secret,
    ffGitLabIntakeNormalizer: 'true',
    ffGitLabIntakeProjectBootstrap: 'true',
    ffProjects: 'true',
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

function uniqueIssueIid() {
  return 900_000 + Math.floor(Math.random() * 99_000);
}

function issuePayload(overrides = {}) {
  const issueIid = overrides.object_attributes?.iid ?? uniqueIssueIid();
  const projectPath = 'wiinc1/engineering-team';
  const gitlabBaseUrl = 'http://192.168.1.116';
  const issueUrl = `${gitlabBaseUrl}/${projectPath}/-/issues/${issueIid}`;
  const base = {
    object_kind: 'issue',
    event_type: 'issue',
    project: {
      id: 1,
      path_with_namespace: projectPath,
      web_url: `${gitlabBaseUrl}/${projectPath}`,
    },
    object_attributes: {
      id: 10_000 + issueIid,
      iid: issueIid,
      title: 'Webhook intake pilot',
      description: 'Create an intake draft from this GitLab issue.',
      url: issueUrl,
      action: 'open',
      state: 'opened',
    },
    labels: [{ title: 'factory-intake' }],
    user: { username: 'wiinc1' },
  };
  return {
    ...base,
    ...overrides,
    object_attributes: {
      ...base.object_attributes,
      ...(overrides.object_attributes || {}),
      iid: issueIid,
      url: overrides.object_attributes?.url || issueUrl,
    },
  };
}

test('gitlab issue open with factory-intake label creates an intake draft task', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const issueIid = uniqueIssueIid();
    const body = JSON.stringify(issuePayload({ object_attributes: { iid: issueIid } }));
    const response = await fetch(`${baseUrl}/gitlab/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Issue Hook',
        'x-gitlab-event-uuid': 'delivery-gitlab-intake-1',
        'x-gitlab-token': secret,
      },
      body,
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.created, true);
    assert.ok(payload.taskId);
    assert.equal(payload.intakeProvider, 'gitlab');
    assert.equal(payload.forgeIssueUrl, `http://192.168.1.116/wiinc1/engineering-team/-/issues/${issueIid}`);
    assert.ok(payload.projectId);

    const duplicate = await fetch(`${baseUrl}/gitlab/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Issue Hook',
        'x-gitlab-event-uuid': 'delivery-gitlab-intake-2',
        'x-gitlab-token': secret,
      },
      body,
    });
    assert.equal(duplicate.status, 202);
    const duplicatePayload = await duplicate.json();
    assert.equal(duplicatePayload.reason, 'existing_intake_task');
    assert.equal(duplicatePayload.taskId, payload.taskId);

    const history = await fetch(`${baseUrl}/tasks/${encodeURIComponent(payload.taskId)}/history`, {
      headers: { authorization: `Bearer ${signJwt('jwt-secret')}` },
    });
    assert.equal(history.status, 200);
    const historyBody = await history.json();
    const created = historyBody.items.find((item) => item.event_type === 'task.created');
    assert.equal(created.payload.gitlab_issue_url, `http://192.168.1.116/wiinc1/engineering-team/-/issues/${issueIid}`);
    assert.ok(historyBody.items.some((item) => item.event_type === 'task.refinement_requested'));
  });
});

test('gitlab intake normalizer is gated behind ff_gitlab_intake_normalizer', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const body = JSON.stringify(issuePayload());
    const response = await fetch(`${baseUrl}/gitlab/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Issue Hook',
        'x-gitlab-event-uuid': 'delivery-gitlab-intake-flag',
        'x-gitlab-token': secret,
      },
      body,
    });
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.error.code, 'feature_disabled');
    assert.equal(payload.error.details.feature, 'ff_gitlab_intake_normalizer');
  }, { ffGitLabIntakeNormalizer: 'false' });
});

test('gitlab issue update syncs operator intake requirements on an existing intake draft', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const issueIid = uniqueIssueIid();
    const openBody = JSON.stringify(issuePayload({
      object_attributes: {
        iid: issueIid,
        description: 'Initial intake body.',
      },
    }));
    const openResponse = await fetch(`${baseUrl}/gitlab/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Issue Hook',
        'x-gitlab-event-uuid': 'delivery-gitlab-intake-open',
        'x-gitlab-token': secret,
      },
      body: openBody,
    });
    assert.equal(openResponse.status, 201);
    const openPayload = await openResponse.json();
    const taskId = openPayload.taskId;

    const updateBody = JSON.stringify(issuePayload({
      object_attributes: {
        iid: issueIid,
        title: 'Updated intake title',
        description: 'Updated operator requirements from GitLab.',
        action: 'update',
      },
    }));
    const updateResponse = await fetch(`${baseUrl}/gitlab/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Issue Hook',
        'x-gitlab-event-uuid': 'delivery-gitlab-intake-update',
        'x-gitlab-token': secret,
      },
      body: updateBody,
    });
    assert.equal(updateResponse.status, 200);
    const updatePayload = await updateResponse.json();
    assert.equal(updatePayload.synced, true);
    assert.equal(updatePayload.taskId, taskId);

    const detail = await fetch(`${baseUrl}/tasks/${encodeURIComponent(taskId)}/detail`, {
      headers: { authorization: `Bearer ${signJwt('jwt-secret')}` },
    });
    assert.equal(detail.status, 200);
    const detailBody = await detail.json();
    assert.equal(detailBody.context.operatorIntakeRequirements, 'Updated operator requirements from GitLab.');
    assert.equal(detailBody.task.title, 'Updated intake title');

    const history = await fetch(`${baseUrl}/tasks/${encodeURIComponent(taskId)}/history`, {
      headers: { authorization: `Bearer ${signJwt('jwt-secret')}` },
    });
    assert.equal(history.status, 200);
    const historyBody = await history.json();
    assert.ok(historyBody.items.some((item) => item.event_type === 'task.intake_requirements_updated'));
  });
});

test('gitlab issues without opt-in label are ignored', async () => {
  await withServer(async ({ baseUrl, secret }) => {
    const body = JSON.stringify(issuePayload({ labels: [{ title: 'enhancement' }] }));
    const response = await fetch(`${baseUrl}/gitlab/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Issue Hook',
        'x-gitlab-event-uuid': 'delivery-gitlab-intake-ignored',
        'x-gitlab-token': secret,
      },
      body,
    });
    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.reason, 'missing_opt_in_label');
  });
});