#!/usr/bin/env node
const path = require('path');
const { createAuditStore, createOutboxWorker, assertAuditBackendConfiguration } = require('../lib/audit');

(async () => {
  const baseDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const backendConfig = assertAuditBackendConfiguration();
  const store = createAuditStore({ baseDir, ...backendConfig });
  const worker = createOutboxWorker(store, event => {
    process.stdout.write(`${JSON.stringify({ published: event.event_id, task_id: event.task_id, event_type: event.event_type })}\n`);
  }, { batchSize: Number(process.argv[3] || 100) });
  const result = await worker.runOnce();
  process.stdout.write(`${JSON.stringify({ baseDir, backend: backendConfig.backend, ...result }, null, 2)}\n`);
})().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
