const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeTempDir,
  runScript,
  writeFile,
} = require('./helpers');

function writeCoverageArtifact(root, artifact) {
  writeFile(root, '.artifacts/coverage-summary.json', `${JSON.stringify(artifact, null, 2)}\n`);
}

test('check-coverage-policy accepts npm coverage suite artifacts', () => {
  const root = makeTempDir('governance-coverage-suite-');
  writeCoverageArtifact(root, {
    suites: [
      { name: 'node', lines: { pct: 84 } },
      { name: 'ui', lines: { pct: 83 } },
    ],
    overall: {
      minimum_line_pct: 83,
      pass: true,
    },
  });

  const result = runScript('check-coverage-policy.js', root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /83% minimum suite line coverage/);
});

test('check-coverage-policy accepts python verify coverage artifacts', () => {
  const root = makeTempDir('governance-coverage-python-');
  writeCoverageArtifact(root, {
    generated_by: 'run_python_tests.py',
    totals: {
      percent_covered: 85.5,
      percent_covered_display: '86',
    },
  });

  const result = runScript('check-coverage-policy.js', root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /85.5% total line coverage/);
});
