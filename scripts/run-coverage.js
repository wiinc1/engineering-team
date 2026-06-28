#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ARTIFACT_DIR = '.artifacts';
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, 'coverage-summary.json');
const REQUIRED_LINE_FLOOR = 80;

const NODE_COVERAGE_ARGS = [
  '--test',
  '--test-concurrency=1',
  '--experimental-test-coverage',
  "--test-coverage-include=lib/**/*.js",
  "--test-coverage-include=api/**/*.js",
  "--test-coverage-include=scripts/**/*.js",
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
];

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
  'tests/performance/*.test.js',
  'tests/security/*.test.js',
  'chaos/*.test.js',
];

const UI_TEST_FILES = [
  'src/app/*.test.tsx',
  'tests/unit/board-owner-card-rendering.test.js',
  'tests/unit/role-inbox-routing.test.js',
  'tests/unit/pm-overview-routing.test.js',
  'tests/unit/work-lifecycle.test.js',
  'tests/integration/board-owner-filtering.integration.test.js',
];

function run(command, args, label) {
  process.stdout.write(`\n[coverage] ${label}\n`);
  const outputPath = path.join(os.tmpdir(), `coverage-output-${process.pid}-${Date.now()}.log`);
  const outputFd = fs.openSync(outputPath, 'w');
  const result = spawnSync(command, args, {
    shell: true,
    stdio: ['inherit', outputFd, 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.closeSync(outputFd);
  const output = fs.readFileSync(outputPath, 'utf8');
  fs.unlinkSync(outputPath);
  process.stdout.write(output);
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  return output;
}

function parseNodeCoverage(output) {
  const match = output.match(/# all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/);
  if (!match) throw new Error('Unable to parse Node coverage summary');
  return coverageSuite('node', match[1], match[2], match[3], match[1]);
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

const nodeOutput = run('node', [...NODE_COVERAGE_ARGS, ...NODE_TEST_FILES], 'Node/API coverage');
const uiOutput = run(
  'npx',
  [
    'vitest',
    'run',
    '--coverage',
    '--no-file-parallelism',
    '--maxWorkers=1',
    '--minWorkers=1',
    '--testTimeout=10000',
    ...UI_TEST_FILES,
  ],
  'UI coverage'
);
const artifact = writeArtifact([parseNodeCoverage(nodeOutput), parseUiCoverage(uiOutput)]);

if (!artifact.overall.pass) {
  process.stderr.write(`coverage failed: minimum line coverage ${artifact.overall.minimum_line_pct}%\n`);
  process.exit(1);
}

process.stdout.write(`coverage artifact written to ${ARTIFACT_PATH}\n`);
