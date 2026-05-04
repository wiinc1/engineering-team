#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = '.artifacts';
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, 'coverage-summary.json');
const REQUIRED_LINE_FLOOR = 80;

const NODE_COVERAGE_ARGS = [
  '--test',
  '--experimental-test-coverage',
  "--test-coverage-include=lib/**/*.js",
  "--test-coverage-include=api/**/*.js",
  "--test-coverage-include=scripts/**/*.js",
  "--test-coverage-include=src/**/*.js",
  "--test-coverage-exclude=lib/**/postgres*.js",
  "--test-coverage-exclude=lib/audit/postgres-*.js",
  "--test-coverage-exclude=lib/monitoring/pushgateway.js",
  "--test-coverage-exclude=lib/task-platform/postgres*.js",
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
  'tests/unit/task-assignment.test.js',
  'tests/unit/task-browser-session.test.js',
  'tests/unit/auth-config-check.test.js',
  'tests/unit/magic-link-auth.test.js',
  'tests/unit/magic-link-production-smoke.test.js',
  'tests/unit/task-detail-adapter.test.js',
  'tests/unit/task-detail-responsive.test.js',
  'tests/unit/specialist-delegation.test.js',
  'tests/unit/command-router-delegation.test.js',
  'tests/unit/validate-specialist-runtime.test.js',
  'tests/unit/openclaw-specialist-runner.test.js',
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
  const result = spawnSync(command, args, { encoding: 'utf8', shell: true });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  return result.stdout || '';
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
const uiOutput = run('npx', ['vitest', 'run', '--coverage', ...UI_TEST_FILES], 'UI coverage');
const artifact = writeArtifact([parseNodeCoverage(nodeOutput), parseUiCoverage(uiOutput)]);

if (!artifact.overall.pass) {
  process.stderr.write(`coverage failed: minimum line coverage ${artifact.overall.minimum_line_pct}%\n`);
  process.exit(1);
}

process.stdout.write(`coverage artifact written to ${ARTIFACT_PATH}\n`);
