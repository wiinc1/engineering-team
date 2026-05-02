#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ARTIFACT_PATH = path.join('.artifacts', 'coverage-summary.json');
const REQUIRED_LINE_FLOOR = 80;

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

const artifact = readArtifact();
const failures = suiteFailures(artifact.suites);
if (Number(artifact?.overall?.minimum_line_pct) < REQUIRED_LINE_FLOOR) {
  failures.push(`minimum suite line coverage ${artifact.overall.minimum_line_pct}% is below ${REQUIRED_LINE_FLOOR}%`);
}

if (failures.length) {
  fail(`coverage policy failed:\n${failures.join('\n')}`);
}

process.stdout.write(
  `coverage policy passed (${artifact.overall.minimum_line_pct}% minimum suite line coverage)\n`,
);
