const path = require('node:path');
const { ROOT } = require('./constants');
const { spawnManaged } = require('./runtime');

function factoryOrchestratorEnabled(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env.FF_FACTORY_ORCHESTRATOR_ENABLED || '').trim().toLowerCase());
}

function startFactoryOrchestrator({
  sharedEnv,
  logsDir,
  etApiUrl,
  forgeadapterUrl,
  uiUrl,
  openclawUrl,
}) {
  return spawnManaged(
    'factory-orchestrator',
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'run-factory-orchestrator.js'),
      '--base-url', etApiUrl,
      '--forgeadapter-url', forgeadapterUrl,
      '--operator-url', uiUrl,
      ...(openclawUrl ? ['--openclaw-url', openclawUrl] : []),
      ...(process.env.FF_REAL_SPECIALIST_DELEGATION === 'true' ? ['--require-delegation-smoke'] : []),
    ],
    {
      ...sharedEnv,
      FACTORY_BASE_URL: etApiUrl,
      FORGEADAPTER_BASE_URL: forgeadapterUrl,
      OPENCLAW_BASE_URL: openclawUrl || '',
      FACTORY_OPERATOR_URL: uiUrl,
    },
    path.join(logsDir, 'factory-orchestrator.log'),
  );
}

module.exports = {
  factoryOrchestratorEnabled,
  startFactoryOrchestrator,
};