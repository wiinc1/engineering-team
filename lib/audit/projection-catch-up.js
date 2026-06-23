const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const DEFAULT_LAG_THRESHOLD_SECONDS = Number(process.env.PROJECTION_CATCHUP_LAG_THRESHOLD_SECONDS || 2);

async function readProjectionLagSeconds(baseUrl, authHeaders = {}) {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/metrics`;
  const response = await fetch(url, { headers: authHeaders });
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

  try {
    const lag = await readProjectionLagSeconds(ctx.baseUrl, ctx.metricsAuthHeaders || {});
    if (lag <= lagThresholdSeconds) {
      return workerCatchUpResult(label, lag, 'worker_caught_up');
    }
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      const lagAfterWait = await readProjectionLagSeconds(ctx.baseUrl, ctx.metricsAuthHeaders || {});
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
    waitMs = Number(process.env.PROJECTION_CATCHUP_WAIT_MS || 1500),
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

  const workerResult = await tryWorkerLagCatchUp(ctx, { label, lagThresholdSeconds, waitMs });
  if (workerResult) return workerResult;

  const manual = await runManualProjectionCatchUp(ctx, maxEvents);
  return {
    ...manual,
    label,
    warning: 'projection_worker_lag_detected_manual_catchup_invoked',
  };
}

module.exports = {
  DEFAULT_LAG_THRESHOLD_SECONDS,
  readProjectionLagSeconds,
  runProjectionCatchUp,
  runManualProjectionCatchUp,
};