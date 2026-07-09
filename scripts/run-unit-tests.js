#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const UNIT_TEST_FILES = [
  'tests/unit/audit-api.test.js',
  'tests/unit/audit-api-deploy-wrapper.test.js',
  'tests/unit/audit-api-v1-workflow-routes.test.js',
  'tests/unit/audit-postgres-pool.test.js',
  'tests/unit/autonomous-delivery-metrics.test.js',
  'tests/unit/control-plane.test.js',
  'tests/unit/execution-contracts.test.js',
  'tests/unit/execution-contract-refinement.test.js',
  'tests/unit/orchestration.test.js',
  'tests/unit/pilot-delegation-readiness.test.js',
  'tests/unit/runtime-delegation.test.js',
  'tests/unit/browser-quality-config.test.js',
  'tests/unit/live-task-updates.test.js',
  'tests/unit/task-platform-api.test.js',
  'tests/unit/ai-agent-preview.test.js',
  'tests/unit/task-platform-projects.test.js',
  'tests/unit/projects-production-smoke.test.js',
  'tests/unit/task-platform-backfill.test.js',
  'tests/unit/task-platform-drift.test.js',
  'tests/unit/task-platform-source-policy.test.js',
  'tests/unit/task-platform-github-check.test.js',
  'tests/unit/task-platform-branch-protection.test.js',
  'tests/unit/task-platform-pr-summary.test.js',
  'tests/unit/task-platform-merge-readiness-gate.test.js',
  'tests/unit/task-assignment.test.js',
  'tests/unit/task-browser-session.test.js',
  'tests/unit/browser-auth-runtime-config.test.js',
  'tests/unit/auth-config-check.test.js',
  'tests/unit/auth-admin-seed.test.js',
  'tests/unit/seed-forge-local-smoke-task.test.js',
  'tests/unit/deploy-auth-bootstrap.test.js',
  'tests/unit/registration-auth.test.js',
  'tests/unit/registration-api.test.js',
  'tests/unit/registration-production-smoke.test.js',
  'tests/unit/oidc-production-smoke.test.js',
  'tests/unit/production-auth-status.test.js',
  'tests/unit/task-detail-adapter.test.js',
  'tests/unit/task-detail-canonical-list.test.js',
  'tests/unit/task-detail-next-action.test.js',
  'tests/unit/task-detail-responsive.test.js',
  'tests/unit/specialist-delegation.test.js',
  'tests/unit/command-router-delegation.test.js',
  'tests/unit/validate-specialist-runtime.test.js',
  'tests/unit/openclaw-specialist-runner.test.js',
  'tests/unit/task-id.test.js',
  'tests/unit/task-id-allocation.test.js',
  'tests/unit/task-id-http.test.js',
  'tests/unit/factory-delivery.test.js',
  'tests/unit/factory-delivery-file-queue.test.js',
  'tests/unit/factory-orchestrator-cli.test.js',
  'tests/unit/factory-delivery-real-evidence-phases.test.js',
  'tests/unit/factory-real-delivery-metadata-flow.test.js',
  'tests/unit/factory-submit-real-delivery-metadata.test.js',
  'tests/unit/factory-delivery-queue-postgres.test.js',
  'tests/unit/factory-delivery-queue-postgres-release.test.js',
  'tests/unit/factory-persona-progression.test.js',
  'tests/unit/projection-catch-up.test.js',
  'tests/unit/audit-workers-production-smoke.test.js',
  'tests/unit/et-forge-dispatch-bridge.test.js',
  'tests/unit/et-forge-bridge-smoke.test.js',
  'tests/unit/staging-runtime.test.js',
  'tests/unit/milestone-a-staging-verify.test.js',
  'tests/unit/factory-orchestration.test.js',
  'tests/unit/factory-agent-phases.test.js',
  'tests/unit/milestone-b-orchestration-verify.test.js',
  'tests/unit/milestone-c-agent-verify.test.js',
  'tests/unit/milestone-d-closeout-verify.test.js',
  'tests/unit/milestone-hosted-phase6-verify.test.js',
  'tests/unit/github-auto-merge.test.js',
  'tests/unit/golden-path-candidate-proof-generation.test.js',
  'tests/unit/golden-path-real-evidence.test.js',
  'tests/unit/golden-path-real-evidence-preflight.test.js',
  'tests/unit/golden-path-real-evidence-source.test.js',
  'tests/unit/golden-path-real-evidence-collector.test.js',
  'tests/unit/golden-path-release-artifact-inputs.test.js',
  'tests/unit/golden-path-release-command-artifacts.test.js',
  'tests/unit/golden-path-release-evidence-builder-injection.test.js',
  'tests/unit/golden-path-rollback-evidence-collector.test.js',
  'tests/unit/golden-path-no-default-pr.test.js',
  'tests/unit/golden-path-phase6-real-merge.test.js',
  'tests/unit/github-evidence-source-policy.test.js',
  'tests/unit/hosted-url-evidence.test.js',
  'tests/unit/real-commit-sha.test.js',
  'tests/unit/release-artifact-evidence-cli.test.js',
  'tests/unit/rollback-evidence-cli.test.js',
  'tests/unit/production-safety-evidence-cli.test.js',
  'tests/unit/real-delivery-candidate-cli.test.js',
  'tests/unit/real-delivery-candidate-continuity.test.js',
  'tests/unit/real-delivery-candidate-health-commit.test.js',
  'tests/unit/real-delivery-candidate-production-safety.test.js',
  'tests/unit/real-delivery-candidate-rollback-evidence.test.js',
  'tests/unit/real-delivery-candidate-proof-artifact.test.js',
  'tests/unit/real-delivery-candidate.test.js',
  'tests/unit/factory-real-delivery-candidate.test.js',
  'tests/unit/factory-real-delivery-completion.test.js',
  'tests/unit/factory-real-delivery-execution.test.js',
  'tests/unit/real-autonomous-delivery-evidence.test.js',
  'tests/unit/real-autonomous-delivery-builder.test.js',
  'tests/unit/real-autonomous-delivery-plan-cli.test.js',
  'tests/unit/real-autonomous-delivery-plan-executor.test.js',
  'tests/unit/real-autonomous-delivery-plan-execution-audit.test.js',
  'tests/unit/real-autonomous-delivery-preflight-cli.test.js',
  'tests/unit/real-autonomous-delivery-health-commit.test.js',
  'tests/unit/real-autonomous-delivery-github-identity.test.js',
  'tests/unit/real-delivery-pr-discovery.test.js',
  'tests/unit/golden-path-stack-probe.test.js',
  'tests/unit/factory-closeout.test.js',
  'tests/unit/github-intake-normalizer.test.js',
  'tests/unit/governance/*.test.js',
];

const ENV_KEYS_TO_DELETE = [
  'DATABASE_URL',
  'GOLDEN_PATH_DATABASE_URL',
  'AUDIT_STORE_BACKEND',
  'PGSSLMODE',
  'PGSSL_ACCEPT_SELF_SIGNED',
  'PGSSLMODE_REQUIRE',
  'PGPOOL_MAX',
  'PG_POOL_MAX',
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_TARGET_ENV',
  'VERCEL_OIDC_TOKEN',
  'AUTH_JWT_SECRET',
  'AUTH_PUBLIC_APP_URL',
  'AUTH_PRODUCTION_AUTH_STRATEGY',
  'FF_REAL_SPECIALIST_DELEGATION',
  'ET_FORGE_DISPATCH_ENABLED',
  'OPENCLAW_BASE_URL',
  'HERMES_BASE_URL',
  'FORGEADAPTER_BASE_URL',
  'FACTORY_BASE_URL',
  'FACTORY_QUEUE_PATH',
  'FACTORY_DELIVERY_DIR',
  'TENANT_ID',
  'SPECIALIST_DELEGATION_BASE_DIR',
  'SPECIALIST_DELEGATION_RUNNER',
  'FF_FACTORY_AGENT_DRIVEN_PHASE1',
  'FF_FACTORY_AGENT_DRIVEN_PHASES',
  'FACTORY_USE_FIXTURE_DELEGATION',
];

function buildSanitizedEnv() {
  const env = { ...process.env, NODE_ENV: 'test' };
  for (const key of ENV_KEYS_TO_DELETE) {
    delete env[key];
  }
  for (const key of Object.keys(env)) {
    if (key.startsWith('VERCEL_') || key.startsWith('FACTORY_')) {
      delete env[key];
    }
  }
  return env;
}

function main() {
  const env = buildSanitizedEnv();
  const nodeArgs = ['--test', ...UNIT_TEST_FILES];
  const nodeResult = spawnSync(process.execPath, nodeArgs, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });
  if (nodeResult.status !== 0) {
    process.exit(nodeResult.status || 1);
  }

  const vitestResult = spawnSync('npm', ['run', 'test:ui:vitest'], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exit(vitestResult.status || 0);
}

main();
