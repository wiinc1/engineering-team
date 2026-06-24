const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { signHmacJwt } = require('../auth/jwt');
const { readProjectionLagSeconds } = require('./projection-catch-up');

function makeBearerToken({ jwtSecret, tenantId, actorId, roles }) {
  const now = Math.floor(Date.now() / 1000);
  return signHmacJwt({
    sub: actorId,
    tenant_id: tenantId,
    roles,
    iat: now,
    exp: now + 300,
  }, jwtSecret);
}

function resolveOptions(options = {}) {
  const baseUrl = String(
    options.baseUrl
    || process.env.AUDIT_WORKERS_SMOKE_BASE_URL
    || process.env.PROJECTS_PROD_BASE_URL
    || process.env.AUTH_PUBLIC_APP_URL
    || '',
  ).trim();

  const tenantId = String(
    options.tenantId
    || process.env.AUDIT_WORKERS_SMOKE_TENANT_ID
    || process.env.TENANT_ID
    || 'engineering-team',
  ).trim();

  return {
    fetchImpl: options.fetchImpl || fetch,
    baseUrl,
    tenantId,
    actorId: String(options.actorId || process.env.AUDIT_WORKERS_SMOKE_ACTOR_ID || 'audit-workers-smoke').trim(),
    jwtSecret: options.jwtSecret || process.env.AUTH_JWT_SECRET,
    outputPath: options.outputPath || 'observability/audit-workers-production-smoke.json',
    lagThresholdSeconds: Number(options.lagThresholdSeconds || process.env.PROJECTION_CATCHUP_LAG_THRESHOLD_SECONDS || 5),
    waitMs: Number(options.waitMs || process.env.AUDIT_WORKERS_SMOKE_WAIT_MS || 7000),
  };
}

async function fetchJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  const text = await response.text().catch(() => '');
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return {
    status: response.status,
    ok: response.ok,
    body,
    text,
  };
}

function buildAuthHeaders(ctx) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${makeBearerToken({
      jwtSecret: ctx.jwtSecret,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      roles: ['admin', 'contributor', 'reader'],
    })}`,
  };
}

function taskApiPath(taskId, suffix = '') {
  const encoded = encodeURIComponent(taskId);
  return `/api/v1/tasks/${encoded}${suffix}`;
}

async function appendSmokeEvent(ctx, taskId, authHeaders) {
  return fetchJson(ctx.fetchImpl, `${ctx.baseUrl.replace(/\/+$/, '')}${taskApiPath(taskId, '/events')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      eventType: 'task.created',
      actorType: 'system',
      idempotencyKey: `audit-workers-smoke:${taskId}`,
      payload: {
        title: 'Audit workers production smoke',
        initial_stage: 'BACKLOG',
      },
    }),
  });
}

async function measureProjectionLag(ctx, authHeaders, evidence) {
  const lagBefore = await readProjectionLagSeconds(ctx.baseUrl, authHeaders, ctx.fetchImpl).catch((error) => {
    evidence.metrics.lagReadError = error.message;
    return null;
  });
  evidence.metrics.projectionLagSecondsBefore = lagBefore;
  await new Promise((resolve) => setTimeout(resolve, ctx.waitMs));
  const lagAfter = await readProjectionLagSeconds(ctx.baseUrl, authHeaders, ctx.fetchImpl).catch((error) => {
    evidence.metrics.lagReadErrorAfter = error.message;
    return null;
  });
  evidence.metrics.projectionLagSecondsAfter = lagAfter;
  return lagAfter;
}

async function verifyProjectedState(ctx, taskId, authHeaders, evidence) {
  const state = await fetchJson(
    ctx.fetchImpl,
    `${ctx.baseUrl.replace(/\/+$/, '')}${taskApiPath(taskId, '/state')}`,
    { headers: authHeaders },
  );
  evidence.task.stateStatus = state.status;
  evidence.task.state = state.body?.data || state.body || null;
  return state;
}

async function runAuditWorkersProductionSmoke(options = {}) {
  const ctx = resolveOptions(options);
  const evidence = {
    schemaVersion: '1.0',
    kind: 'audit-workers-production-smoke',
    generatedAt: new Date().toISOString(),
    baseUrl: ctx.baseUrl,
    tenantId: ctx.tenantId,
    summary: { passed: false, checks: [] },
    metrics: {},
    task: {},
  };

  if (!ctx.baseUrl) {
    throw new Error('AUDIT_WORKERS_SMOKE_BASE_URL (or --base-url) is required');
  }
  if (!ctx.jwtSecret) {
    throw new Error('AUTH_JWT_SECRET is required for audit workers production smoke');
  }

  const authHeaders = buildAuthHeaders(ctx);
  const taskId = `TSK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const create = await appendSmokeEvent(ctx, taskId, authHeaders);
  evidence.task.createStatus = create.status;
  evidence.summary.checks.push({ name: 'append_event', ok: create.status === 202, status: create.status });

  const lagAfter = await measureProjectionLag(ctx, authHeaders, evidence);
  evidence.summary.checks.push({
    name: 'projection_lag_under_threshold',
    ok: lagAfter != null && lagAfter <= ctx.lagThresholdSeconds,
    thresholdSeconds: ctx.lagThresholdSeconds,
    lagSeconds: lagAfter,
  });

  const state = await verifyProjectedState(ctx, taskId, authHeaders, evidence);
  evidence.summary.checks.push({
    name: 'projected_state_visible',
    ok: state.status === 200 && Boolean(evidence.task.state?.task_id || evidence.task.state?.title),
    status: state.status,
  });

  evidence.summary.passed = evidence.summary.checks.every((check) => check.ok);
  fs.mkdirSync(path.dirname(path.resolve(ctx.outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(ctx.outputPath), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

module.exports = {
  runAuditWorkersProductionSmoke,
};