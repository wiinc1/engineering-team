#!/usr/bin/env node
const {
  createAuditStore,
  createProjectionWorker,
  createOutboxWorker,
  createSupervisedWorker,
  assertAuditBackendConfiguration,
  logAuditBackendSelection,
} = require('../lib/audit');
const {
  createEtForgeDispatchOutboxPublisher,
  createCombinedOutboxPublisher,
  resolveEtForgeDispatchConfig,
} = require('../lib/task-platform/et-forge-dispatch-bridge');

const backendConfig = assertAuditBackendConfiguration();
logAuditBackendSelection(backendConfig);

const store = createAuditStore({
  baseDir: process.cwd(),
  backend: backendConfig.backend,
  connectionString: backendConfig.connectionString,
  projectionMode: 'async',
});

async function defaultOutboxPublisher(event) {
  if (process.env.OUTBOX_WEBHOOK_URL) {
    const response = await fetch(process.env.OUTBOX_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!response.ok) throw new Error(`outbox webhook failed: ${response.status}`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ published: event.event_id, task_id: event.task_id, event_type: event.event_type })}\n`);
}

const publisher = createCombinedOutboxPublisher([
  createEtForgeDispatchOutboxPublisher(resolveEtForgeDispatchConfig()),
  defaultOutboxPublisher,
]);

(async () => {
  if (store.runMigrations) await store.runMigrations({ baseDir: process.cwd() });
  const metricsProvider = () => (typeof store.readMetrics === 'function' ? store.readMetrics() : {});
  const projectionWorker = createSupervisedWorker('projection_worker', () => createProjectionWorker(store, { batchSize: Number(process.env.PROJECTION_BATCH_SIZE || 100) }).runOnce(), {
    intervalMs: Number(process.env.PROJECTION_INTERVAL_MS || 5000),
    pushgateway: process.env.PUSHGATEWAY_URL ? { endpoint: process.env.PUSHGATEWAY_URL, job: 'projection-worker', instance: process.pid } : undefined,
    metricsProvider,
    onError: error => process.stderr.write(`[projection_worker] ${error.stack}\n`),
  });
  const outboxWorker = createSupervisedWorker('outbox_worker', () => createOutboxWorker(store, publisher, { batchSize: Number(process.env.OUTBOX_BATCH_SIZE || 100) }).runOnce(), {
    intervalMs: Number(process.env.OUTBOX_INTERVAL_MS || 5000),
    pushgateway: process.env.PUSHGATEWAY_URL ? { endpoint: process.env.PUSHGATEWAY_URL, job: 'outbox-worker', instance: process.pid } : undefined,
    metricsProvider,
    onError: error => process.stderr.write(`[outbox_worker] ${error.stack}\n`),
  });

  process.on('SIGTERM', () => { projectionWorker.stop(); outboxWorker.stop(); });
  process.on('SIGINT', () => { projectionWorker.stop(); outboxWorker.stop(); });

  process.stdout.write(`${JSON.stringify({
    feature: 'gp_007_audit_workers',
    action: 'worker_startup',
    outcome: 'starting',
    backend: backendConfig.backend,
    projectionIntervalMs: Number(process.env.PROJECTION_INTERVAL_MS || 5000),
    outboxIntervalMs: Number(process.env.OUTBOX_INTERVAL_MS || 5000),
    etForgeDispatchEnabled: resolveEtForgeDispatchConfig().enabled,
    pushgateway: Boolean(process.env.PUSHGATEWAY_URL),
  })}\n`);

  await Promise.all([projectionWorker.start(), outboxWorker.start()]);

  process.stdout.write(`${JSON.stringify({
    feature: 'gp_007_audit_workers',
    action: 'worker_startup',
    outcome: 'ready',
    pid: process.pid,
  })}\n`);
})().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
