#!/usr/bin/env node
const { runFactoryOrchestratorTick, resolveFactoryConfig } = require('../lib/task-platform/factory-delivery');
const {
  readGoldenPathRealEvidenceCliOptions,
} = require('../lib/task-platform/golden-path-real-evidence-preflight');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readArgs(name) {
  const values = [];
  for (let index = 0; index < process.argv.length - 1; index += 1) {
    if (process.argv[index] === name) values.push(process.argv[index + 1]);
  }
  return values.filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRealEvidenceOptions() {
  const testCommands = readArgs('--test-command');
  return {
    ...readGoldenPathRealEvidenceCliOptions(),
    fixBranchName: readArg('--fix-branch') || readArg('--fix-branch-name', process.env.FIX_BRANCH_NAME || ''),
    fixCommitSha: readArg('--fix-commit-sha', process.env.FIX_COMMIT_SHA || ''),
    fixPrUrl: readArg('--fix-pr-url', process.env.FIX_PR_URL || ''),
    ...(testCommands.length ? { realDeliveryTestCommands: testCommands } : {}),
    realDeliveryRiskLevel: readArg('--risk-level', process.env.REAL_DELIVERY_RISK_LEVEL || ''),
    realDeliveryProductionSafe: hasFlag('--production-safe'),
    realDeliveryProductionSafetyEvidence: readArg(
      '--production-safety-evidence',
      process.env.REAL_DELIVERY_PRODUCTION_SAFETY_EVIDENCE || process.env.PRODUCTION_SAFETY_EVIDENCE || '',
    ),
    realDeliveryCandidateProofPath: readArg('--candidate-proof', process.env.REAL_DELIVERY_CANDIDATE_PROOF_PATH || ''),
    realAutonomousDeliveryEvidencePath: readArg('--final-evidence')
      || readArg('--real-delivery-final-evidence')
      || readArg('--real-autonomous-delivery-evidence', process.env.REAL_AUTONOMOUS_DELIVERY_EVIDENCE || ''),
    realDeliveryHealthCheckPath: readArg('--health-check-path', process.env.REAL_DELIVERY_HEALTH_CHECK_PATH || ''),
    realDeliveryMaxChangedFiles: readArg('--max-changed-files', process.env.MAX_REAL_DELIVERY_CHANGED_FILES || ''),
    rollbackPlan: readArg('--rollback-plan', process.env.ROLLBACK_PLAN || ''),
    realDeliveryRollbackEvidence: readArg(
      '--rollback-evidence',
      process.env.REAL_DELIVERY_ROLLBACK_EVIDENCE || process.env.ROLLBACK_EVIDENCE || '',
    ),
  };
}

function buildOrchestratorRuntime() {
  const once = hasFlag('--once');
  const intervalMs = Number(readArg('--interval-ms', process.env.FACTORY_ORCHESTRATOR_INTERVAL_MS || 15000));
  const maxItems = Number(readArg('--max-items', process.env.FACTORY_ORCHESTRATOR_BATCH || 1));
  return {
    once,
    intervalMs,
    config: {
      baseUrl: readArg('--base-url', process.env.FACTORY_BASE_URL || 'http://127.0.0.1:13000'),
      queueBackend: readArg('--queue-backend', process.env.FACTORY_QUEUE_BACKEND || 'postgres'),
      allowFileQueue: hasFlag('--allow-file-queue'),
      queuePath: readArg('--queue', process.env.FACTORY_QUEUE_PATH || 'observability/factory-delivery-queue.json'),
      factoryQueueDatabaseUrl: readArg(
        '--database-url',
        process.env.FACTORY_QUEUE_DATABASE_URL || process.env.DATABASE_URL || '',
      ),
      workerId: readArg('--worker-id', process.env.FACTORY_WORKER_ID || `factory-${process.pid}`),
      factoryQueueLeaseSeconds: Number(
        readArg('--lease-seconds', process.env.FACTORY_QUEUE_LEASE_SECONDS || 900),
      ),
      factoryQueueRetryBaseSeconds: Number(
        readArg('--retry-base-seconds', process.env.FACTORY_QUEUE_RETRY_BASE_SECONDS || 30),
      ),
      factoryQueueMaxAttempts: Number(
        readArg('--max-attempts', process.env.FACTORY_QUEUE_MAX_ATTEMPTS || 5),
      ),
      forgeAdapterUrl: readArg('--forgeadapter-url', process.env.FORGEADAPTER_BASE_URL || 'http://127.0.0.1:14010'),
      openclawUrl: readArg('--openclaw-url', process.env.OPENCLAW_BASE_URL || ''),
      operatorUrl: readArg('--operator-url', process.env.FACTORY_OPERATOR_URL || 'http://127.0.0.1:15173'),
      requireDelegationSmoke: !hasFlag('--skip-delegation-smoke'),
      skipValidation: hasFlag('--skip-validation'),
      releaseEnv: readArg('--release-env', process.env.RELEASE_ENV || ''),
      agentDrivenPhases: hasFlag('--agent-driven-phases'),
      autoMerge: hasFlag('--auto-merge'),
      ...readRealEvidenceOptions(),
      maxItems,
    },
  };
}

async function main() {
  const { once, intervalMs, config } = buildOrchestratorRuntime();
  const resolvedConfig = resolveFactoryConfig(config);

  do {
    const tick = await runFactoryOrchestratorTick({ ...config, ...resolvedConfig });
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

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildOrchestratorRuntime,
  readRealEvidenceOptions,
};
