#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createAuditStore } = require('../lib/audit/store');
const { deriveExecutionContractProjection } = require('../lib/audit/execution-contracts');
const { buildProductReconciliationReport } = require('../lib/audit/product-delivery-integrity');
const { apiGet } = require('../lib/task-platform/golden-path-shared');

function readArg(argv, flag, fallback = null) {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) return fallback;
  return argv[index + 1];
}

async function loadTaskContext({
  taskId,
  tenantId,
  baseUrl,
  jwtSecret,
}) {
  if (baseUrl) {
    const ctx = {
      baseUrl: String(baseUrl).replace(/\/+$/, ''),
      jwtSecret: jwtSecret || process.env.AUTH_JWT_SECRET || 'golden-path-local-dev-secret',
      tenantId,
      actorId: 'product-delivery-reconcile',
      fetchImpl: globalThis.fetch,
    };
    const [stateRes, historyRes] = await Promise.all([
      apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/state`, ['reader', 'admin']),
      apiGet(ctx, `/tasks/${encodeURIComponent(taskId)}/history?limit=500`, ['reader', 'admin']),
    ]);
    if (!stateRes.ok) {
      throw new Error(`task_state_unavailable:${taskId}:${stateRes.status}`);
    }
    return {
      state: stateRes.body || {},
      history: historyRes.body?.items || historyRes.body?.data?.items || [],
    };
  }

  const store = createAuditStore({
    ffAuditFoundation: true,
    ffWorkflowEngine: true,
    ffExecutionContracts: true,
  });
  const [state, history] = await Promise.all([
    store.getTaskCurrentState(taskId, { tenantId }),
    store.getTaskHistory(taskId, { tenantId, limit: 500 }),
  ]);
  if (!state) {
    throw new Error(`task_not_found:${taskId}`);
  }
  return { state, history };
}

async function main() {
  const argv = process.argv.slice(2);
  const taskId = readArg(argv, '--task-id', process.env.TSK_RESEED_TASK_ID || 'TSK-001');
  const tenantId = readArg(argv, '--tenant-id', process.env.DEFAULT_TENANT_ID || process.env.TENANT_ID || 'engineering-team');
  const mismatchReason = readArg(argv, '--reason', 'operator_reported_ui_mismatch');
  const record = readArg(argv, '--record', 'false') === 'true';
  const repoRoot = readArg(argv, '--repo-root', process.cwd());
  const baseUrl = readArg(argv, '--base-url', process.env.ENGINEERING_TEAM_BASE_URL || null);
  const jwtSecret = readArg(argv, '--jwt-secret', process.env.AUTH_JWT_SECRET || null);

  const { state, history } = await loadTaskContext({
    taskId,
    tenantId,
    baseUrl,
    jwtSecret,
  });

  const projection = deriveExecutionContractProjection(history);
  const contract = projection.latest || null;
  const report = buildProductReconciliationReport({
    taskId,
    contract,
    history,
    state,
    options: { repoRoot },
  });

  report.mismatch_reason = mismatchReason;
  report.recommendations = report.verification.verified
    ? ['Run golden-path browser verification and attach on-load screenshot evidence before QA pass.']
    : [
      `Merge submission commit ${report.commit_sha || '(missing)'} onto ${report.runnable_surface?.branch || 'main'}.`,
      'Cherry-pick or reconcile forge worktree output to the runnable surface branch.',
      'Reset product_delivery layer and rerun QA with golden-path browser profile.',
    ];

  const outputDir = path.join(repoRoot, 'observability');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `product-reconciliation-${taskId}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  let recorded = null;
  if (record) {
    if (!baseUrl) {
      const store = createAuditStore({
        ffAuditFoundation: true,
        ffWorkflowEngine: true,
        ffExecutionContracts: true,
      });
      const result = await store.appendEvent({
        taskId,
        tenantId,
        eventType: 'task.product_delivery_reconciled',
        actorId: 'admin@golden-path.local',
        actorType: 'user',
        idempotencyKey: `product-reconciliation:${taskId}:${report.generated_at}`,
        payload: {
          status: report.product_delivery?.status === 'verified' ? 'verified' : 'failed',
          mismatch_reason: mismatchReason,
          commit_sha: report.commit_sha,
          runnable_surface_verified: report.verification?.verified === true,
          report_path: path.relative(repoRoot, outputPath),
        },
        source: 'script',
      });
      recorded = {
        eventId: result.event?.event_id || null,
        duplicate: result.duplicate === true,
      };
    } else {
      recorded = { skipped: true, reason: 'record_requires_direct_store_or_events_api' };
    }
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    taskId,
    outputPath,
    recorded,
    report,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});