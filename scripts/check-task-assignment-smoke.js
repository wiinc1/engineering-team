#!/usr/bin/env node
const { URL } = require('url');

function bearerToken() {
  const token = process.env.TASK_ASSIGNMENT_SMOKE_BEARER_TOKEN || process.env.AUTH_BEARER_TOKEN;
  if (!token) {
    throw new Error('TASK_ASSIGNMENT_SMOKE_BEARER_TOKEN or AUTH_BEARER_TOKEN is required');
  }
  return token;
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

(async () => {
  const baseUrl = process.env.TASK_API_BASE_URL || 'http://127.0.0.1:3000';
  const token = bearerToken();
  const healthUrl = new URL('/health/task-assignment', baseUrl).toString();
  const smokeUrl = new URL('/api/internal/smoke-test/task-assignment', baseUrl).toString();

  const health = await fetchJson(healthUrl, token);
  if (!health.ok) {
    throw new Error(`assignment health is degraded: ${JSON.stringify(health)}`);
  }

  const smoke = await fetchJson(smokeUrl, token);
  if (!smoke.ok) {
    throw new Error(`assignment smoke failed: ${JSON.stringify(smoke)}`);
  }

  process.stdout.write('task assignment smoke passed\n');
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
