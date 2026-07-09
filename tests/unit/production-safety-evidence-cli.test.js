const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '../..', 'scripts/build-production-safety-evidence.js');
const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const DEPLOYMENT_URL = 'https://factory-staging.engineering-team.io';

function runBuilder(args, cwd = path.join(__dirname, '../..')) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeReleaseArtifacts(root, artifactDir = 'release-artifacts') {
  const dir = path.join(root, artifactDir);
  const base = (artifactName, sourceSystem) => ({
    schema_version: '1.0',
    generated_by: 'release-artifact-evidence-builder',
    generated_at: '2026-07-05T00:00:00.000Z',
    commit_sha: COMMIT_SHA,
    environment: 'staging',
    source_system: sourceSystem,
    artifact_name: artifactName,
  });
  writeJson(path.join(dir, 'build.json'), { ...base('build', 'command'), status: 'passed' });
  writeJson(path.join(dir, 'compatibility-report.json'), { ...base('compatibility-report', 'command'), status: 'passed' });
  writeJson(path.join(dir, 'vulnerability-scan.json'), { ...base('vulnerability-scan', 'command'), status: 'passed' });
  writeJson(path.join(dir, 'secret-scan.json'), { ...base('secret-scan', 'command'), status: 'passed' });
  writeJson(path.join(dir, 'post-deploy-health.json'), {
    ...base('post-deploy-health', 'http-health-check'),
    checked_sha: COMMIT_SHA,
    deployment_url: DEPLOYMENT_URL,
    status: 'healthy',
    commit_verified: true,
  });
  return artifactDir;
}

test('production-safety evidence builder writes validated hosted proof', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'production-safety-builder-'));
  const out = path.join(tmp, 'production-safety.json');
  const releaseArtifactDir = writeReleaseArtifacts(tmp);
  const result = runBuilder([
    '--repo-root', tmp,
    '--release-env', 'staging',
    '--deployment-url', DEPLOYMENT_URL,
    '--commit-sha', COMMIT_SHA,
    '--validation-status', 'passed',
    '--risk-level', 'low',
    '--production-safe',
    '--validated-at', '2026-07-05T00:00:00.000Z',
    '--release-artifact-dir', releaseArtifactDir,
    '--out', out,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(payload.environment, 'staging');
  assert.equal(payload.deployment_url, DEPLOYMENT_URL);
  assert.equal(payload.commit_sha, COMMIT_SHA);
  assert.equal(payload.production_safe, true);
  assert.equal(payload.validation_artifacts.source, 'release-artifacts');
  assert.equal(payload.validation_artifacts.artifacts.health.commit_verified, true);
  assert.match(payload.validation_artifacts.artifacts.build.digest, /^[0-9a-f]{64}$/);
});

test('production-safety evidence builder rejects local URLs and fake SHAs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'production-safety-builder-reject-'));
  const out = path.join(tmp, 'production-safety.json');
  const result = runBuilder([
    '--repo-root', tmp,
    '--release-env', 'staging',
    '--deployment-url', 'http://127.0.0.1:15173',
    '--commit-sha', 'not-a-sha',
    '--validation-status', 'passed',
    '--risk-level', 'low',
    '--production-safe',
    '--out', out,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /deployment_url must be hosted and non-local/);
  assert.match(result.stderr, /commit_sha actual 40-character commit SHA is required/);
  assert.match(result.stderr, /validation requires --release-artifact-dir/);
  assert.equal(fs.existsSync(out), false);
});
