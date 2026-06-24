#!/usr/bin/env node
const { runFactoryOrchestratorTick, resolveFactoryConfig } = require('../lib/task-platform/factory-delivery');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const once = hasFlag('--once');
  const intervalMs = Number(readArg('--interval-ms', process.env.FACTORY_ORCHESTRATOR_INTERVAL_MS || 15000));
  const maxItems = Number(readArg('--max-items', process.env.FACTORY_ORCHESTRATOR_BATCH || 1));
  const config = {
    baseUrl: readArg('--base-url', process.env.FACTORY_BASE_URL || 'http://127.0.0.1:13000'),
    queuePath: readArg('--queue', process.env.FACTORY_QUEUE_PATH || 'observability/factory-delivery-queue.json'),
    forgeAdapterUrl: readArg('--forgeadapter-url', process.env.FORGEADAPTER_BASE_URL || 'http://127.0.0.1:14010'),
    openclawUrl: readArg('--openclaw-url', process.env.OPENCLAW_BASE_URL || ''),
    operatorUrl: readArg('--operator-url', process.env.FACTORY_OPERATOR_URL || 'http://127.0.0.1:15173'),
    requireDelegationSmoke: hasFlag('--require-delegation-smoke'),
    maxItems,
  };

  do {
    const tick = await runFactoryOrchestratorTick(config);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      ...tick,
      at: new Date().toISOString(),
    }, null, 2)}\n`);

    if (once || tick.pendingCount === 0) {
      break;
    }
    await sleep(intervalMs);
  } while (true);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});