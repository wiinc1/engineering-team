const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildPlanReport,
  optionsFromArgv,
} = require('../../scripts/plan-real-autonomous-delivery');

const SCRIPT = path.join(__dirname, '../..', 'scripts/plan-real-autonomous-delivery.js');
const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';
const BASE_URL = 'https://factory-api-staging.openclaw.app';
const PR_URL = 'https://github.com/wiinc1/engineering-team/pull/418';

function cleanEnv() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GITHUB_TOKEN: '',
    GH_TOKEN: '',
  };
}

function completeArgs() {
  return [
    'node',
    SCRIPT,
    '--release-env',
    'staging',
    '--base-url',
    BASE_URL,
    '--operator-url',
    DEPLOYMENT_URL,
    '--repository',
    'wiinc1/engineering-team',
    '--branch',
    'feat/real-delivery-plan',
    '--implementation-commit-sha',
    COMMIT_SHA,
    '--pr-url',
    PR_URL,
    '--github-token',
    'secret-token',
    '--deployment-url',
    DEPLOYMENT_URL,
    '--rollback-target',
    'release-previous',
    '--health-check-path',
    '/version',
    '--require-health-commit',
    '--candidate-test-command',
    'node --test tests/unit/real-autonomous-delivery-plan-artifacts.test.js',
  ];
}

function writeExistingReleaseArtifacts(outDir, overrides = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [key, fileName, artifactName] of [
    ['build', 'build.json', 'build'],
    ['compatibility', 'compatibility-report.json', 'compatibility-report'],
    ['vulnerability', 'vulnerability-scan.json', 'vulnerability-scan'],
    ['secret', 'secret-scan.json', 'secret-scan'],
  ]) {
    fs.writeFileSync(path.join(outDir, fileName), `${JSON.stringify({
      schema_version: '1.0',
      generated_by: 'release-artifact-evidence-builder',
      generated_at: '2026-07-05T00:00:00.000Z',
      artifact_name: artifactName,
      commit_sha: COMMIT_SHA,
      environment: 'staging',
      source_system: 'command',
      status: 'passed',
      ...(overrides[key] || {}),
    }, null, 2)}\n`);
  }
}

function planWithExistingArtifacts(artifactDir) {
  return buildPlanReport(optionsFromArgv([
    ...completeArgs(),
    '--use-existing-release-artifacts',
    '--release-artifact-dir',
    artifactDir,
  ], cleanEnv()));
}

test('real autonomous delivery plan fails closed when reused release artifacts are missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-missing-artifacts-'));
  const report = planWithExistingArtifacts(tmp);

  assert.equal(report.ok, false);
  assert.match(report.failures.join('\n'), /existing build artifact cannot be read/);
  assert.match(report.failures.join('\n'), /existing secret-scan artifact cannot be read/);
  assert.equal(report.commands.every((item) => item.ready === false), true);
});

test('real autonomous delivery plan requires reused release artifacts to match the implementation commit', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-stale-artifacts-'));
  writeExistingReleaseArtifacts(tmp, {
    compatibility: { commit_sha: '4f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd' },
  });
  const report = planWithExistingArtifacts(tmp);

  assert.equal(report.ok, false);
  assert.match(report.failures.join('\n'), /existing compatibility-report artifact commit_sha must match expected release commit/);
});

test('real autonomous delivery plan rejects malformed reused release artifacts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-malformed-artifacts-'));
  writeExistingReleaseArtifacts(tmp, {
    secret: { generated_by: 'test-fixture', artifact_name: 'secret' },
  });
  const report = planWithExistingArtifacts(tmp);

  assert.equal(report.ok, false);
  assert.match(report.failures.join('\n'), /existing secret-scan\.generated_by must be a release evidence generator/);
  assert.match(report.failures.join('\n'), /existing secret-scan\.artifact_name must be secret-scan/);
});

test('real autonomous delivery plan can use verified existing release artifacts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-plan-existing-artifacts-'));
  writeExistingReleaseArtifacts(tmp);
  const report = planWithExistingArtifacts(tmp);

  assert.equal(report.ok, true, report.failures.join('\n'));
  assert.equal(report.commands.some((item) => item.id === 'release-artifacts'), false);
  assert.match(report.commands.find((item) => item.id === 'hosted-preflight').command, /--use-existing-release-artifacts/);
});
