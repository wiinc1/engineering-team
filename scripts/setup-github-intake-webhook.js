#!/usr/bin/env node
/**
 * Optional GitHub issues webhook for GP-002/GP-005 intake.
 * Primary forge intake is GitLab — use scripts/setup-gitlab-intake-webhook.js by default.
 *
 * Requires GITHUB_TOKEN with admin:repo_hook (or repo) scope on wiinc1/engineering-team.
 *
 * Usage:
 *   GITHUB_TOKEN=... WEBHOOK_TARGET_URL=https://<et-api>/github/webhooks \
 *     GITHUB_WEBHOOK_SECRET=... node scripts/setup-github-intake-webhook.js
 *
 * Enable GitHub provider in ET:
 *   FF_GITHUB_INTAKE_NORMALIZER=true FORGE_INTAKE_PROVIDER=github
 */

const crypto = require('node:crypto');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function parseRepo(fullName = 'wiinc1/engineering-team') {
  const [owner, repo] = String(fullName).split('/');
  if (!owner || !repo) throw new Error(`Invalid repo: ${fullName}`);
  return { owner, repo };
}

async function githubRequest(token, path, { method = 'GET', body = null } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
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
  const token = readArg('--token', process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '');
  const { owner, repo } = parseRepo(readArg('--repo', process.env.GITHUB_INTAKE_REPO || 'wiinc1/engineering-team'));
  const targetUrl = readArg('--url', process.env.WEBHOOK_TARGET_URL || process.env.ENGINEERING_TEAM_WEBHOOK_URL || '');
  const secret = readArg('--secret', process.env.GITHUB_WEBHOOK_SECRET || 'golden-path-local-webhook-secret');
  const dryRun = process.argv.includes('--dry-run');

  if (!token) {
    throw new Error('GITHUB_TOKEN (or --token) is required');
  }
  if (!targetUrl) {
    throw new Error('WEBHOOK_TARGET_URL (or --url) is required — e.g. https://<hosted-et-api>/github/webhooks');
  }

  const config = {
    url: targetUrl.replace(/\/+$/, '').endsWith('/github/webhooks')
      ? targetUrl.replace(/\/+$/, '')
      : `${targetUrl.replace(/\/+$/, '')}/github/webhooks`,
    content_type: 'json',
    secret,
    insecure_ssl: '0',
  };

  const list = await githubRequest(token, `/repos/${owner}/${repo}/hooks`);
  if (!list.ok) {
    throw new Error(`List hooks failed (${list.status}): ${JSON.stringify(list.body)}`);
  }

  const existing = (Array.isArray(list.body) ? list.body : []).find((hook) => (
    hook.config?.url === config.url
    || String(hook.config?.url || '').includes('/github/webhooks')
  ));

  const payload = {
    name: 'web',
    active: true,
    events: ['issues', 'pull_request', 'issue_comment'],
    config,
  };

  if (dryRun) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      dryRun: true,
      repo: `${owner}/${repo}`,
      action: existing ? 'update' : 'create',
      hookId: existing?.id || null,
      config,
      note: 'Remove --dry-run to apply',
    }, null, 2)}\n`);
    return;
  }

  let result;
  if (existing) {
    result = await githubRequest(token, `/repos/${owner}/${repo}/hooks/${existing.id}`, {
      method: 'PATCH',
      body: {
        active: true,
        events: payload.events,
        config,
      },
    });
  } else {
    result = await githubRequest(token, `/repos/${owner}/${repo}/hooks`, {
      method: 'POST',
      body: payload,
    });
  }

  if (!result.ok) {
    throw new Error(`Webhook ${existing ? 'update' : 'create'} failed (${result.status}): ${JSON.stringify(result.body)}`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    repo: `${owner}/${repo}`,
    action: existing ? 'updated' : 'created',
    hookId: result.body.id,
    url: result.body.config?.url || config.url,
    events: result.body.events || payload.events,
    deliveryIdHint: crypto.createHash('sha256').update(`${Date.now()}`).digest('hex').slice(0, 12),
    verifyLocal: 'npm run gp-002:verify && npm run gp-005:verify',
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});