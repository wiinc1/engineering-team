#!/usr/bin/env node

'use strict';

const {
  DEFAULT_SPECIALIST_MAP,
  listProviders,
  probeSpecialistRuntimeProvider,
  resolveSpecialistDelegationRunner,
  resolveSpecialistMap,
} = require('../lib/software-factory/specialist-runtime-provider');

async function main() {
  const env = process.env;
  const resolved = resolveSpecialistDelegationRunner({ env });
  const probe = await probeSpecialistRuntimeProvider(resolved, { env });
  const report = {
    provider: resolved.name,
    runner: resolved.runner,
    override: Boolean(resolved.override),
    health: resolved.health,
    probe,
    registeredProviders: Object.keys(listProviders(env)),
    agentMap: resolveSpecialistMap(env, resolved.mapEnv),
    defaultAgentMap: DEFAULT_SPECIALIST_MAP,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!probe.available) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
