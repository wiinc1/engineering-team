#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ARTIFACT_PATH = path.join('.artifacts', 'coverage-summary.json');
const REQUIRED_LINE_FLOOR = 70;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readArtifact() {
  if (!fs.existsSync(ARTIFACT_PATH)) {
    fail(`coverage artifact missing: run npm run coverage to create ${ARTIFACT_PATH}`);
  }
  return JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
}

function suiteFailures(suites = []) {
  return suites
    .filter((suite) => Number(suite?.lines?.pct) < REQUIRED_LINE_FLOOR)
    .map((suite) => `${suite.name} line coverage ${suite.lines.pct}% is below ${REQUIRED_LINE_FLOOR}%`);
}

function normalizeCoverageArtifact(artifact) {
  if (Array.isArray(artifact.suites) && artifact?.overall?.minimum_line_pct !== undefined) {
    return {
      label: 'minimum suite line coverage',
      minimumLinePct: Number(artifact.overall.minimum_line_pct),
      suites: artifact.suites,
    };
  }

  if (artifact?.totals?.percent_covered !== undefined) {
    const totalLinePct = Number(artifact.totals.percent_covered);
    return {
      label: 'total line coverage',
      minimumLinePct: totalLinePct,
      suites: [
        {
          name: artifact.generated_by || 'coverage',
          lines: { pct: totalLinePct },
        },
      ],
    };
  }

  fail(`coverage artifact has unsupported schema: regenerate ${ARTIFACT_PATH}`);
}

const artifact = readArtifact();
const coverage = normalizeCoverageArtifact(artifact);
const failures = suiteFailures(coverage.suites);
if (coverage.minimumLinePct < REQUIRED_LINE_FLOOR) {
  failures.push(`${coverage.label} ${coverage.minimumLinePct}% is below ${REQUIRED_LINE_FLOOR}%`);
}

if (failures.length) {
  fail(`coverage policy failed:\n${failures.join('\n')}`);
}

process.stdout.write(
  `coverage policy passed (${coverage.minimumLinePct}% ${coverage.label})\n`,
);
