#!/usr/bin/env node
const { createAuditApiServer, assertAuditBackendConfiguration, logAuditBackendSelection } = require('../lib/audit');
const { resolvePmRefinementDelegateWork } = require('../lib/audit/pm-refinement-delegate-config');

const port = Number(process.env.PORT || 3000);
const backendConfig = assertAuditBackendConfiguration();
logAuditBackendSelection(backendConfig);

const pmRefinement = resolvePmRefinementDelegateWork(process.env, process.cwd());
const serverOptions = {
  baseDir: process.cwd(),
  backend: backendConfig.backend,
  connectionString: backendConfig.connectionString,
  allowLegacyHeaders: process.env.ALLOW_LEGACY_HEADERS === 'true',
  pmRefinementDelegateWork: pmRefinement.delegateWork,
};

const { server } = createAuditApiServer(serverOptions);

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`audit api listening on ${port}\n`);
  process.stdout.write(`pm refinement delegate: ${pmRefinement.mode}\n`);
});