const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const DEFAULT_LAG_THRESHOLD_SECONDS = Number(process.env.PROJECTION_CATCHUP_LAG_THRESHOLD_SECONDS || 2);

function resolveMetricsAuthHeaders(ctx = {}) {
  if (ctx.metricsAuthHeaders) {
    return ctx.metricsAuthHeaders;
  }
  if (!ctx.jwtSecret) {
    return {};
  }
  const { signHmacJwt } = require('../auth/jwt');
  const now = Math.floor(Date.now() / 1000);
  const token = signHmacJwt({
    sub: ctx.actorId || 'golden-path-operator',
    tenant_id: ctx.tenantId || 'engineering-team',
    roles: ['admin', 'reader'],
    iat: now,
    exp: now + 300,
  }, ctx.jwtSecret);
  return { authorization: `Bearer ${token}` };
}

async function readProjectionLagSeconds(baseUrl, authHeaders = {}, fetchImpl = fetch) {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/metrics`;
  const response = await fetchImpl(url, { headers: authHeaders });
  if (!response.ok) {
    throw new Error(`metrics fetch failed: ${response.status}`);
  }
  const text = await response.text();
  const match = text.match(/^workflow_projection_lag_seconds\s+(\d+(?:\.\d+)?)/m);
  return match ? Number(match[1]) : 0;
}

async function runManualProjectionCatchUp(ctx, maxEvents = 25) {
  if (!process.env.DATABASE_URL && !ctx.persistDir) {
    return { skipped: true, reason: 'no_database_url' };
  }

  if (ctx.persistDir) {
    return {
      skipped: true,
      reason: 'local_file_sync',
      mode: 'local_file_sync',
      processed: 0,
      failed: 0,
    };
  }

  const scriptPath = path.resolve(process.cwd(), 'scripts/process-audit-projection-queue.js');
  if (!fs.existsSync(scriptPath)) {
    return { skipped: true, reason: 'projection_script_missing', processed: 0, failed: 0 };
  }

  const baseDir = ctx.persistDir || process.cwd();
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, baseDir, String(maxEvents)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AUDIT_STORE_BACKEND: process.env.AUDIT_STORE_BACKEND || 'postgres',
    },
  });
  const result = JSON.parse(stdout);
  return {
    skipped: false,
    fallback: true,
    mode: 'manual_script',
    processed: result.processed ?? result.eventsProcessed ?? 0,
    failed: result.failed ?? result.failures ?? 0,
    raw: result,
  };
}

function workerCatchUpResult(label, lag, reason) {
  return {
    label,
    skipped: true,
    reason,
    mode: 'always_on_worker',
    projectionLagSeconds: lag,
    processed: 0,
    failed: 0,
  };
}

async function tryWorkerLagCatchUp(ctx, { label, lagThresholdSeconds, waitMs }) {
  if (!ctx.baseUrl) return null;
  const fetchImpl = ctx.fetchImpl || fetch;
  const metricsAuthHeaders = resolveMetricsAuthHeaders(ctx);

  try {
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    const lag = await readProjectionLagSeconds(ctx.baseUrl, metricsAuthHeaders, fetchImpl);
    if (lag <= lagThresholdSeconds) {
      return workerCatchUpResult(label, lag, waitMs > 0 ? 'worker_caught_up_after_wait' : 'worker_caught_up');
    }
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      const lagAfterWait = await readProjectionLagSeconds(ctx.baseUrl, metricsAuthHeaders, fetchImpl);
      if (lagAfterWait <= lagThresholdSeconds) {
        return workerCatchUpResult(label, lagAfterWait, 'worker_caught_up_after_wait');
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function runProjectionCatchUp(ctx, options = {}) {
  const {
    label = null,
    maxEvents = 25,
    lagThresholdSeconds = DEFAULT_LAG_THRESHOLD_SECONDS,
    waitMs = Number(process.env.PROJECTION_CATCHUP_WAIT_MS || 2500),
    maxRetries = Number(process.env.PROJECTION_CATCHUP_MAX_RETRIES || 5),
    forceFallback = process.env.GOLDEN_PATH_PROJECTION_FALLBACK === 'force',
  } = options;

  if (forceFallback) {
    const manual = await runManualProjectionCatchUp(ctx, maxEvents);
    return { ...manual, label, reason: manual.reason || 'forced_fallback' };
  }
  if (ctx.persistDir) {
    return {
      label,
      skipped: true,
      reason: 'local_file_sync',
      mode: 'local_file_sync',
      processed: 0,
      failed: 0,
    };
  }
  if (!process.env.DATABASE_URL) {
    return { label, skipped: true, reason: 'no_database_url', processed: 0, failed: 0 };
  }

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const attemptWaitMs = waitMs * (attempt + 1);
    const workerResult = await tryWorkerLagCatchUp(ctx, {
      label,
      lagThresholdSeconds,
      waitMs: attemptWaitMs,
    });
    if (workerResult) {
      return {
        ...workerResult,
        retries: attempt,
      };
    }
  }

  const manual = await runManualProjectionCatchUp(ctx, maxEvents);
  return {
    ...manual,
    label,
    retries: maxRetries,
    warning: 'projection_worker_lag_detected_manual_catchup_invoked',
    remediation: 'Start always-on audit workers (npm run audit:workers:up) or POST /projections/process as admin fallback.',
  };
}

module.exports = {
  DEFAULT_LAG_THRESHOLD_SECONDS,
  resolveMetricsAuthHeaders,
  readProjectionLagSeconds,
  runProjectionCatchUp,
  runManualProjectionCatchUp,
};