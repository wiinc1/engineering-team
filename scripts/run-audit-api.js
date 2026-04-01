#!/usr/bin/env node
const { createAuditApiServer, assertAuditBackendConfiguration } = require('../lib/audit');

const port = Number(process.env.PORT || 3000);
const { backend, connectionString } = assertAuditBackendConfiguration();
const { server } = createAuditApiServer({
  baseDir: process.cwd(),
  backend,
  connectionString,
  allowLegacyHeaders: process.env.ALLOW_LEGACY_HEADERS === 'true',
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`audit api listening on ${port}\n`);
});
