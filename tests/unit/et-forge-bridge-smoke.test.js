const test = require('node:test');
const assert = require('node:assert/strict');
const { runEtForgeBridgeSmoke } = require('../../lib/audit/et-forge-bridge-smoke');

test('et-forge bridge smoke passes when bridge is enabled and dry-run handles contract approval', async () => {
  const evidence = await runEtForgeBridgeSmoke({
    enabled: 'true',
    forgeAdapterBaseUrl: 'http://forge.local',
    engineeringTeamBaseUrl: 'http://et.local',
    outputPath: 'observability/et-forge-bridge-smoke.test.json',
    probeLiveForge: false,
  });

  assert.equal(evidence.summary.passed, true);
  assert.equal(evidence.dryRun.dispatchHandled, true);
  assert.equal(evidence.config.enabled, true);
});