#!/usr/bin/env node
const {
  withLocalPhases,
  withLocalPhase6,
  runGoldenPathPhases,
} = require('../lib/task-platform/golden-path-phases');
const {
  DEFAULT_FORGE_SERVICE_TOKEN,
  DEFAULT_FORGE_ADAPTER_TOKEN,
} = require('../lib/task-platform/golden-path-shared');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const options = {
    fromPhase: Number(readArg('--from', '2')),
    toPhase: Number(readArg('--to', '5')),
    outputPath: readArg('--out', 'observability/golden-path-pilot.json'),
    persistDir: readArg('--persist-dir'),
    baseUrl: readArg('--base-url'),
    forgeTaskId: readArg('--forge-task-id', 'TSK-GOLDEN001'),
    skipDelegationSmoke: hasFlag('--skip-delegation-smoke'),
    operatorUrl: readArg('--operator-url'),
    skipValidation: hasFlag('--skip-validation'),
    mergeCommitSha: readArg('--merge-commit-sha'),
    productionUrl: readArg('--production-url'),
    jwtSecret: readArg('--jwt-secret')
      || process.env.GOLDEN_PATH_JWT_SECRET
      || process.env.AUTH_JWT_SECRET,
    forgeServiceToken: readArg('--forge-service-token')
      || process.env.FORGE_SERVICE_TOKEN
      || DEFAULT_FORGE_SERVICE_TOKEN,
    forgeAdapterToken: readArg('--forge-adapter-token')
      || process.env.FORGEADAPTER_SERVICE_TOKEN
      || DEFAULT_FORGE_ADAPTER_TOKEN,
  };

  if (hasFlag('--local')) {
    if (options.fromPhase === 6 && options.toPhase === 6) {
      return withLocalPhase6(options);
    }
    return withLocalPhases(options);
  }

  return runGoldenPathPhases(options);
}

main()
  .then((result) => {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: result.evidence.status,
      stepsCompleted: result.evidence.stepsCompleted,
      forgeTaskId: result.evidence.forgeadapter?.taskId,
      startJobId: result.evidence.forgeadapter?.startJobId,
      completeJobId: result.evidence.forgeadapter?.completeJobId,
      evidencePath: result.outputPath,
      phaseResults: result.phaseResults,
    }, null, 2)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });