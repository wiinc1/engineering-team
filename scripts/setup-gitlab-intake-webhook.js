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

function resolveGitlabWebhookRuntime() {
  const token = readArg('--token', process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN || '');
  const gitlabBaseUrl = parseGitLabBaseUrl(
    readArg('--gitlab-url', process.env.GITLAB_BASE_URL || process.env.GITLAB_INTAKE_BASE_URL || 'http://192.168.1.116'),
  );
  const projectPath = readArg('--project', process.env.GITLAB_INTAKE_PROJECT || process.env.GITLAB_PROJECT_PATH || 'wiinc1/engineering-team');
  const targetUrl = readArg('--url', process.env.WEBHOOK_TARGET_URL || process.env.ENGINEERING_TEAM_WEBHOOK_URL || '');
  const secret = readArg('--secret', process.env.GITLAB_WEBHOOK_SECRET || 'golden-path-local-webhook-secret');
  const dryRun = process.argv.includes('--dry-run');
  return { token, gitlabBaseUrl, projectPath, targetUrl, secret, dryRun };
}

function assertGitlabWebhookRuntime(runtime) {
  if (!runtime.token) throw new Error('GITLAB_TOKEN (or --token) is required');
  if (!runtime.targetUrl) {
    throw new Error('WEBHOOK_TARGET_URL (or --url) is required - e.g. https://<hosted-et-api>/gitlab/webhooks');
  }
}

function normalizeGitlabHookUrl(targetUrl) {
  const trimmed = targetUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/gitlab/webhooks')
    ? trimmed
    : `${targetUrl.replace(/\/+$/, '')}/gitlab/webhooks`;
}

async function listGitlabHooks(runtime) {
  const project = encodeProjectPath(runtime.projectPath);
  const list = await gitlabRequest(runtime.gitlabBaseUrl, runtime.token, `/projects/${project}/hooks`);
  if (!list.ok) {
    throw new Error(`List hooks failed (${list.status}): ${JSON.stringify(list.body)}`);
  }
  return Array.isArray(list.body) ? list.body : [];
}

function findExistingGitlabHook(hooks, hookUrl) {
  return hooks.find((hook) => (
    hook.url === hookUrl
    || String(hook.url || '').includes('/gitlab/webhooks')
  ));
}

function buildGitlabHookPayload(hookUrl, secret) {
  const enableSslVerification = hookUrl.startsWith('https://');
  return {
    url: hookUrl,
    token: secret,
    issue_events: true,
    merge_requests_events: false,
    note_events: false,
    job_events: false,
    pipeline_events: false,
    push_events: false,
    tag_push_events: false,
    enable_ssl_verification: enableSslVerification,
  };
}

function gitlabProjectHooksPath(projectPath, existing = null) {
  const basePath = `/projects/${encodeProjectPath(projectPath)}/hooks`;
  return existing ? `${basePath}/${existing.id}` : basePath;
}

async function upsertGitlabHook(runtime, existing, payload) {
  if (existing) {
    return gitlabRequest(runtime.gitlabBaseUrl, runtime.token, gitlabProjectHooksPath(runtime.projectPath, existing), {
      method: 'PUT',
      body: payload,
    });
  }
  return gitlabRequest(runtime.gitlabBaseUrl, runtime.token, gitlabProjectHooksPath(runtime.projectPath), {
    method: 'POST',
    body: payload,
  });
}

function localWebhookHint(result) {
  return result.status === 422 && String(result.body?.error || '').includes('Invalid url')
    ? ' GitLab may block local/private webhook URLs until an admin enables allow_local_requests_from_web_hooks_and_services, or use a public HTTPS ET API URL.'
    : '';
}

function assertGitlabHookResult(result, existing) {
  if (!result.ok) {
    const hint = localWebhookHint(result);
    throw new Error(`Webhook ${existing ? 'update' : 'create'} failed (${result.status}): ${JSON.stringify(result.body)}.${hint}`);
  }
}

function deliveryIdHint() {
  return crypto.createHash('sha256').update(`${Date.now()}`).digest('hex').slice(0, 12);
}

function writeGitlabDryRun(runtime, existing, hookUrl) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    dryRun: true,
    project: runtime.projectPath,
    gitlabBaseUrl: runtime.gitlabBaseUrl,
    action: existing ? 'update' : 'create',
    hookId: existing?.id || null,
    hookUrl,
    note: 'Remove --dry-run to apply',
  }, null, 2)}\n`);
}

function writeGitlabHookResult(runtime, existing, result, hookUrl) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    project: runtime.projectPath,
    gitlabBaseUrl: runtime.gitlabBaseUrl,
    action: existing ? 'updated' : 'created',
    hookId: result.body.id,
    url: result.body.url || hookUrl,
    issueEvents: result.body.issue_events,
    deliveryIdHint: deliveryIdHint(),
    verifyLocal: 'npm run gp-002:verify && npm run gp-005:verify',
    githubOptional: 'FORGE_INTAKE_PROVIDER=github npm run github:intake:webhook:setup',
  }, null, 2)}\n`);
}

async function main() {
  const runtime = resolveGitlabWebhookRuntime();
  assertGitlabWebhookRuntime(runtime);
  const hookUrl = normalizeGitlabHookUrl(runtime.targetUrl);
  const hooks = await listGitlabHooks(runtime);
  const existing = findExistingGitlabHook(hooks, hookUrl);
  const payload = buildGitlabHookPayload(hookUrl, runtime.secret);
  if (runtime.dryRun) return writeGitlabDryRun(runtime, existing, hookUrl);
  const result = await upsertGitlabHook(runtime, existing, payload);
  assertGitlabHookResult(result, existing);
  return writeGitlabHookResult(runtime, existing, result, hookUrl);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
