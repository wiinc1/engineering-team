#!/usr/bin/env node
const path = require('path');
const { createAuditStore, assertAuditBackendConfiguration } = require('../lib/audit');

const baseDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd();

const backendConfig = assertAuditBackendConfiguration();
const store = createAuditStore({ baseDir, ...backendConfig });

(async () => {
  const result = await store.rebuildProjections();
  process.stdout.write(`${JSON.stringify({ baseDir, backend: backendConfig.backend, ...result }, null, 2)}\n`);
})().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
