#!/usr/bin/env node
const { createAuditApiServer, assertAuditBackendConfiguration, logAuditBackendSelection } = require('../lib/audit');

const port = Number(process.env.PORT || 3000);
const backendConfig = assertAuditBackendConfiguration();
logAuditBackendSelection(backendConfig);
const { server } = createAuditApiServer({
  baseDir: process.cwd(),
  backend: backendConfig.backend,
  connectionString: backendConfig.connectionString,
  allowLegacyHeaders: process.env.ALLOW_LEGACY_HEADERS === 'true',
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`audit api listening on ${port}\n`);
});
