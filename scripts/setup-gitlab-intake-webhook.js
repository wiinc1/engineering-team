#!/usr/bin/env node
/**
 * Register (or update) the GitLab issue webhook for GP-002/GP-005 intake.
 * Requires GITLAB_TOKEN with api scope on wiinc1/engineering-team.
 *
 * Usage:
 *   GITLAB_TOKEN=... WEBHOOK_TARGET_URL=https://<et-api>/gitlab/webhooks \
 *     GITLAB_WEBHOOK_SECRET=... node scripts/setup-gitlab-intake-webhook.js
 *
 * Local coordinated stack (no public URL): use smoke scripts instead:
 *   npm run gp-002:verify && npm run gp-005:verify
 *
 * GitHub intake remains optional:
 *   FORGE_INTAKE_PROVIDER=github npm run github:intake:webhook:setup
 */

const crypto = require('node:crypto');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function parseGitLabBaseUrl(value = '') {
  return String(value || 'http://192.168.1.116').replace(/\/+$/, '');
}

function encodeProjectPath(projectPath = 'wiinc1/engineering-team') {
  return encodeURIComponent(String(projectPath).trim());
}

async function gitlabRequest(baseUrl, token, path, { method = 'GET', body = null } = {}) {
  const response = await fetch(`${baseUrl}/api/v4${path}`, {
    method,
    headers: {
      'PRIVATE-TOKEN': token,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  return { status: response.status, ok: response.ok, body: payload };
}

async function main() {
  const token = readArg('--token', process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN || '');
  const gitlabBaseUrl = parseGitLabBaseUrl(
    readArg('--gitlab-url', process.env.GITLAB_BASE_URL || process.env.GITLAB_INTAKE_BASE_URL || 'http://192.168.1.116'),
  );
  const projectPath = readArg('--project', process.env.GITLAB_INTAKE_PROJECT || process.env.GITLAB_PROJECT_PATH || 'wiinc1/engineering-team');
  const targetUrl = readArg('--url', process.env.WEBHOOK_TARGET_URL || process.env.ENGINEERING_TEAM_WEBHOOK_URL || '');
  const secret = readArg('--secret', process.env.GITLAB_WEBHOOK_SECRET || 'golden-path-local-webhook-secret');
  const dryRun = process.argv.includes('--dry-run');

  if (!token) {
    throw new Error('GITLAB_TOKEN (or --token) is required');
  }
  if (!targetUrl) {
    throw new Error('WEBHOOK_TARGET_URL (or --url) is required — e.g. https://<hosted-et-api>/gitlab/webhooks');
  }

  const hookUrl = targetUrl.replace(/\/+$/, '').endsWith('/gitlab/webhooks')
    ? targetUrl.replace(/\/+$/, '')
    : `${targetUrl.replace(/\/+$/, '')}/gitlab/webhooks`;

  const list = await gitlabRequest(gitlabBaseUrl, token, `/projects/${encodeProjectPath(projectPath)}/hooks`);
  if (!list.ok) {
    throw new Error(`List hooks failed (${list.status}): ${JSON.stringify(list.body)}`);
  }

  const existing = (Array.isArray(list.body) ? list.body : []).find((hook) => (
    hook.url === hookUrl
    || String(hook.url || '').includes('/gitlab/webhooks')
  ));

  const payload = {
    url: hookUrl,
    token: secret,
    issue_events: true,
    merge_requests_events: false,
    note_events: false,
    job_events: false,
    pipeline_events: false,
    push_events: false,
    tag_push_events: false,
    enable_ssl_verification: true,
  };

  if (dryRun) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      dryRun: true,
      project: projectPath,
      gitlabBaseUrl,
      action: existing ? 'update' : 'create',
      hookId: existing?.id || null,
      hookUrl,
      note: 'Remove --dry-run to apply',
    }, null, 2)}\n`);
    return;
  }

  let result;
  if (existing) {
    result = await gitlabRequest(gitlabBaseUrl, token, `/projects/${encodeProjectPath(projectPath)}/hooks/${existing.id}`, {
      method: 'PUT',
      body: payload,
    });
  } else {
    result = await gitlabRequest(gitlabBaseUrl, token, `/projects/${encodeProjectPath(projectPath)}/hooks`, {
      method: 'POST',
      body: payload,
    });
  }

  if (!result.ok) {
    throw new Error(`Webhook ${existing ? 'update' : 'create'} failed (${result.status}): ${JSON.stringify(result.body)}`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    project: projectPath,
    gitlabBaseUrl,
    action: existing ? 'updated' : 'created',
    hookId: result.body.id,
    url: result.body.url || hookUrl,
    issueEvents: result.body.issue_events,
    deliveryIdHint: crypto.createHash('sha256').update(`${Date.now()}`).digest('hex').slice(0, 12),
    verifyLocal: 'npm run gp-002:verify && npm run gp-005:verify',
    githubOptional: 'FORGE_INTAKE_PROVIDER=github npm run github:intake:webhook:setup',
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});