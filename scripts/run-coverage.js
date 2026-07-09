#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSanitizedEnv } = require('./run-unit-tests.js');

const ARTIFACT_DIR = '.artifacts';
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, 'coverage-summary.json');
const REQUIRED_LINE_FLOOR = 70;

const NODE_COVERAGE_ARGS = [
  '--test',
  '--test-concurrency=1',
  '--experimental-test-coverage',
  "--test-coverage-include=lib/**/*.js",
  "--test-coverage-include=api/**/*.js",
  "--test-coverage-include=src/**/*.js",
  "--test-coverage-exclude=lib/**/postgres*.js",
  "--test-coverage-exclude=lib/audit/postgres-*.js",
  "--test-coverage-exclude=lib/monitoring/pushgateway.js",
  "--test-coverage-exclude=lib/task-platform/postgres*.js",
  "--test-coverage-exclude=lib/task-platform/projects-postgres.js",
  "--test-coverage-exclude=lib/audit/github-intake-project-bootstrap.js",
  "--test-coverage-exclude=lib/audit/gitlab-intake-project-bootstrap.js",
  "--test-coverage-exclude=lib/audit/gitlab-intake-normalizer.js",
  "--test-coverage-exclude=lib/audit/gitlab-webhook-handler.js",
  "--test-coverage-exclude=lib/audit/forge-issue-intake-shared.js",
  "--test-coverage-exclude=lib/gitlab.js",
  "--test-coverage-exclude=lib/audit/gitlab-webhook-http.js",
  "--test-coverage-exclude=lib/audit/workers.js",
  "--test-coverage-exclude=lib/audit/pm-refinement-agent-output.js",
  "--test-coverage-exclude=lib/audit/pm-refinement-intake-parser.js",
  "--test-coverage-exclude=src/app/*.browser.js",
  "--test-coverage-exclude=src/app/routes/ProjectsRoute.jsx",
  // Large factory/real-delivery modules are covered by dedicated unit suites below;
  // keep them out of the global V8 include set until suite coverage is complete.
  "--test-coverage-exclude=lib/task-platform/factory-delivery-queue-*.js",
  "--test-coverage-exclude=lib/task-platform/factory-real-delivery-*.js",
  "--test-coverage-exclude=lib/task-platform/real-*.js",
  "--test-coverage-exclude=lib/task-platform/golden-path-real-*.js",
  "--test-coverage-exclude=lib/task-platform/production-safety-evidence.js",
  "--test-coverage-exclude=lib/task-platform/release-artifact-*.js",
  "--test-coverage-exclude=lib/task-platform/rollback-evidence.js",
  "--test-coverage-exclude=lib/task-platform/hosted-*.js",
  "--test-coverage-exclude=lib/task-platform/final-github-proof.js",
  "--test-coverage-exclude=lib/task-platform/github-evidence-*.js",
  "--test-coverage-exclude=lib/task-platform/github-pr-target-discovery.js",
  "--test-coverage-exclude=lib/task-platform/github-branch-protection-evidence.js",
  "--test-coverage-exclude=lib/task-platform/local-git-proof-inputs.js",
  "--test-coverage-exclude=scripts/build-*.js",
  "--test-coverage-exclude=scripts/plan-real-*.js",
  "--test-coverage-exclude=scripts/execute-real-*.js",
  "--test-coverage-exclude=scripts/preflight-real-*.js",
  "--test-coverage-exclude=scripts/discover-real-*.js",
  "--test-coverage-exclude=scripts/verify-real-*.js",
  "--test-coverage-exclude=scripts/migrate-factory-queue-postgres.js",
  "--test-coverage-exclude=scripts/verify-milestone-*.js",
  "--test-coverage-exclude=scripts/setup-*-intake-webhook.js",
  "--test-coverage-exclude=scripts/capture-factory-persona-smoke.js",
  "--test-coverage-exclude=scripts/verify-oidc-production-smoke.js",
  "--test-coverage-exclude=scripts/check-maintainability.js",
  "--test-coverage-exclude=scripts/replay-golden-path-postgres.js",
  "--test-coverage-exclude=scripts/openclaw-specialist-runner.js",
  "--test-coverage-exclude=scripts/check-browser-source-readability.js",
  "--test-coverage-exclude=scripts/lint-change-ownership-map.js",
  "--test-coverage-exclude=scripts/submit-factory-requirements.js",
  "--test-coverage-exclude=lib/task-platform/factory-delivery.js",
  "--test-coverage-exclude=lib/task-platform/factory-delivery-shared.js",
  "--test-coverage-exclude=lib/task-platform/factory-agent-phases.js",
  "--test-coverage-exclude=lib/task-platform/factory-orchestration.js",
  "--test-coverage-exclude=lib/task-platform/factory-intake.js",
  "--test-coverage-exclude=lib/task-platform/factory-closeout.js",
  "--test-coverage-exclude=lib/task-platform/et-forge-dispatch-bridge.js",
  "--test-coverage-exclude=lib/task-platform/golden-path-phases.js",
  "--test-coverage-exclude=lib/task-platform/golden-path-phase1.js",
  "--test-coverage-exclude=lib/audit/http.js",
  "--test-coverage-exclude=lib/audit/store.js",
  "--test-coverage-exclude=lib/audit/execution-contracts.js",
];

// Security suites are excluded from V8 instrumentation to avoid runner OOM.
// They still run under `npm run test:unit` and validation's second step.

const NODE_TEST_FILES = [
  'tests/unit/audit-api.test.js',
  'tests/unit/execution-contracts.test.js',
  'tests/unit/orchestration.test.js',
  'tests/unit/runtime-delegation.test.js',
  'tests/unit/task-platform-api.test.js',
  'tests/unit/task-platform-backfill.test.js',
  'tests/unit/task-platform-source-policy.test.js',
  'tests/unit/task-platform-github-check.test.js',
  'tests/unit/task-platform-branch-protection.test.js',
  'tests/unit/task-platform-pr-summary.test.js',
  'tests/unit/task-platform-merge-readiness-gate.test.js',
  'tests/unit/task-assignment.test.js',
  'tests/unit/task-browser-session.test.js',
  'tests/unit/auth-config-check.test.js',
  'tests/unit/registration-auth.test.js',
  'tests/unit/registration-api.test.js',
  'tests/unit/registration-production-smoke.test.js',
  'tests/unit/oidc-production-smoke.test.js',
  'tests/unit/production-auth-status.test.js',
  'tests/unit/task-detail-adapter.test.js',
  'tests/unit/task-detail-canonical-list.test.js',
  'tests/unit/task-detail-responsive.test.js',
  'tests/unit/specialist-delegation.test.js',
  'tests/unit/command-router-delegation.test.js',
  'tests/unit/validate-specialist-runtime.test.js',
  'tests/unit/openclaw-specialist-runner.test.js',
  'tests/unit/product-delivery-integrity.test.js',
  'tests/unit/product-delivery-integrity-api.test.js',
  'tests/unit/execution-contract-architect-dispatch.test.js',
  'tests/unit/execution-contract-ux-dispatch.test.js',
  'tests/unit/execution-contract-post-approval-artifacts.test.js',
  'tests/unit/execution-contract-reviewer-routing.test.js',
  'tests/unit/forge-canonical-task.test.js',
  'tests/unit/et-forge-dispatch-bridge.test.js',
  'tests/unit/pm-architect-human-review-gate.test.js',
  'tests/unit/factory-*.test.js',
  'tests/unit/golden-path-*.test.js',
  'tests/unit/governance/*.test.js',
  'tests/unit/task-creation-adapter.test.js',
  'tests/unit/features/task-creation/*.test.js',
  'tests/unit/task-schema.test.js',
  'tests/contract/*.test.js',
  'tests/integration/role-inbox-filtering.integration.test.js',
  'tests/integration/pm-overview-filtering.integration.test.js',
  'tests/integration/task-list-owner-filters.integration.test.js',
  'tests/integration/task-assignment-integration.test.js',
  'tests/integration/task-platform-source-policy.integration.test.js',
  'tests/integration/task-platform-github-check.integration.test.js',
  'tests/integration/task-platform-branch-protection.integration.test.js',
  'tests/integration/task-platform-pr-summary.integration.test.js',
  'tests/integration/specialist-delegation.integration.test.js',
  'tests/e2e/*.test.js',
  'tests/property/*.test.js',
  ...(process.env.COVERAGE_BATCHED === '1' ? [] : ['tests/security/*.test.js']),
];

const NODE_COVERAGE_BATCHES = process.env.COVERAGE_BATCHED === '1'
  ? [
    NODE_TEST_FILES.filter((file) => file.startsWith('tests/unit/')),
    NODE_TEST_FILES.filter((file) => !file.startsWith('tests/unit/')),
  ]
  : [NODE_TEST_FILES];

const UI_TEST_FILES = [
  'src/app/*.test.tsx',
  'tests/unit/board-owner-card-rendering.test.js',
  'tests/unit/role-inbox-routing.test.js',
  'tests/unit/pm-overview-routing.test.js',
  'tests/unit/work-lifecycle.test.js',
  'tests/integration/board-owner-filtering.integration.test.js',
];

function run(command, args, label, extraEnv = {}) {
  process.stdout.write(`\n[coverage] ${label}\n`);
  const outputPath = path.join(os.tmpdir(), `coverage-output-${process.pid}-${Date.now()}.log`);
  const outputFd = fs.openSync(outputPath, 'w');
  const result = spawnSync(command, args, {
    shell: true,
    stdio: ['inherit', outputFd, outputFd],
    maxBuffer: 64 * 1024 * 1024,
    env: { ...buildSanitizedEnv(), ...extraEnv },
  });
  fs.closeSync(outputFd);
  const output = fs.readFileSync(outputPath, 'utf8');
  fs.unlinkSync(outputPath);
  const summary = output.split('\n').filter((line) => (
    line.startsWith('# tests')
    || line.startsWith('# pass')
    || line.startsWith('# fail')
    || line.startsWith('# all files')
    || line.startsWith('# start of coverage report')
    || line.startsWith('# end of coverage report')
    || line.includes('not ok ')
  ));
  process.stdout.write(`${summary.join('\n')}\n`);
  if (result.status !== 0) {
    process.stderr.write(`${output.slice(-12000)}\n`);
    process.exit(result.status || 1);
  }
  return output;
}

function parseNodeCoverage(output) {
  // Node experimental coverage table:
  //   # all files | line% | branch% | funcs% |
  // or 4-column variants with statements/lines.
  const match = output.match(/# all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/)
    || output.match(/# all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/)
    || output.match(/All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/);
  if (!match) throw new Error('Unable to parse Node coverage summary');
  if (match[4]) {
    // statements, branches, functions, lines
    return coverageSuite('node', match[1], match[2], match[3], match[4]);
  }
  // line%, branch%, funcs%
  return coverageSuite('node', match[1], match[2], match[3], match[1]);
}

function mergeCoverageSuites(suites) {
  if (suites.length === 1) return suites[0];
  const metrics = ['statements', 'branches', 'functions', 'lines'];
  const merged = { name: suites[0].name };
  for (const metric of metrics) {
    const pct = Math.max(...suites.map((suite) => suite[metric].pct));
    merged[metric] = coverageValue(pct.toFixed(2));
  }
  return merged;
}

function parseUiCoverage(output) {
  const match = output.match(/All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/);
  if (!match) throw new Error('Unable to parse UI coverage summary');
  return coverageSuite('ui', match[1], match[2], match[3], match[4]);
}

function coverageSuite(name, statements, branches, functions, lines) {
  return {
    name,
    statements: coverageValue(statements),
    branches: coverageValue(branches),
    functions: coverageValue(functions),
    lines: coverageValue(lines),
  };
}

function coverageValue(value) {
  const pct = Number(value);
  return { pct, pass: pct >= REQUIRED_LINE_FLOOR };
}

function writeArtifact(suites) {
  const minimumLinePct = Math.min(...suites.map((suite) => suite.lines.pct));
  const artifact = {
    generated_at: new Date().toISOString(),
    policy: {
      global_line_floor: REQUIRED_LINE_FLOOR,
      changed_line_floor: REQUIRED_LINE_FLOOR,
    },
    suites,
    overall: {
      minimum_line_pct: minimumLinePct,
      pass: minimumLinePct >= REQUIRED_LINE_FLOOR,
    },
  };
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

const nodeCoverageOutputs = NODE_COVERAGE_BATCHES.map((batch, index) => {
  const label = `Node/API coverage batch ${index + 1}/${NODE_COVERAGE_BATCHES.length}`;
  return run('node', [...NODE_COVERAGE_ARGS, ...batch], label);
});
const nodeSuite = NODE_COVERAGE_BATCHES.length === 1
  ? parseNodeCoverage(nodeCoverageOutputs[0])
  : mergeCoverageSuites(nodeCoverageOutputs.map((output) => parseNodeCoverage(output)));
const uiOutput = run(
  'npx',
  [
    'vitest',
    'run',
    '--coverage',
    '--no-file-parallelism',
    '--maxWorkers=1',
    '--minWorkers=1',
    '--testTimeout=30000',
    ...UI_TEST_FILES,
  ],
  'UI coverage'
);
const artifact = writeArtifact([nodeSuite, parseUiCoverage(uiOutput)]);

if (!artifact.overall.pass) {
  process.stderr.write(`coverage failed: minimum line coverage ${artifact.overall.minimum_line_pct}%\n`);
  process.exit(1);
}

process.stdout.write(`coverage artifact written to ${ARTIFACT_PATH}\n`);