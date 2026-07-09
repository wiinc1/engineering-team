const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeReleaseEvidenceArtifacts } = require('../../lib/task-platform/golden-path-real-evidence-collector');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function fetchMock() {
  return async (url) => {
    if (String(url) === DEPLOYMENT_URL) return jsonResponse({ ok: true });
    throw new Error(`unexpected fetch ${url}`);
  };
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function createReleaseRepo(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  git(repoRoot, ['init']);
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'release command artifact proof\n');
  git(repoRoot, ['add', 'README.md']);
  git(repoRoot, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'init']);
  return {
    tmp,
    repoRoot,
    commitSha: git(repoRoot, ['rev-parse', 'HEAD']),
  };
}

function versionFetchMock(commitSha = COMMIT_SHA) {
  return async (url) => {
    if (String(url) === `${DEPLOYMENT_URL}/version`) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ commitSha }),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

function checkRun(name, status, conclusion) {
  return { id: name, name, status, conclusion, html_url: `https://github.example/checks/${name}` };
}

function passCommand(label) {
  return `node -e "process.stdout.write('${label} passed')"`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

test('release artifacts can be generated from explicit command evidence', async () => {
  const { tmp, repoRoot, commitSha } = createReleaseRepo('real-evidence-command-artifacts-');
  const releaseArtifactDir = path.join(tmp, 'release-artifacts');
  const result = await writeReleaseEvidenceArtifacts({
    cwd: repoRoot,
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    releaseArtifactDir,
    healthCheckPath: '/version',
    requireHealthCommit: true,
    releaseArtifactCommands: {
      build: passCommand('build'),
      compatibility: passCommand('compatibility'),
      vulnerability: passCommand('vulnerability'),
      secret: passCommand('secret'),
    },
    fetchImpl: versionFetchMock(commitSha),
  }, {
    repository: 'wiinc1/engineering-team',
    commitSha,
    checks: [checkRun('build', 'completed', 'success')],
  });

  assert.equal(readJson(result.artifacts.compatibility).status, 'passed');
  assert.equal(readJson(result.artifacts.vulnerability).artifact_name, 'vulnerability-scan');
  assert.equal(readJson(result.artifacts.secret).source_system, 'command');
});

test('release artifacts can reuse prebuilt command artifacts when explicitly requested', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-prebuilt-'));
  for (const [fileName, artifactName] of [
    ['compatibility-report.json', 'compatibility-report'],
    ['vulnerability-scan.json', 'vulnerability-scan'],
    ['secret-scan.json', 'secret-scan'],
  ]) {
    writeJson(path.join(tmp, fileName), {
      schema_version: '1.0',
      generated_by: 'release-artifact-evidence-builder',
      generated_at: '2026-07-05T00:00:00.000Z',
      commit_sha: COMMIT_SHA,
      environment: 'staging',
      source_system: 'command',
      artifact_name: artifactName,
      status: 'passed',
    });
  }

  const result = await writeReleaseEvidenceArtifacts({
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    releaseArtifactDir: tmp,
    useExistingReleaseArtifacts: true,
    fetchImpl: fetchMock(),
  }, {
    repository: 'wiinc1/engineering-team',
    commitSha: COMMIT_SHA,
    checks: [checkRun('build', 'completed', 'success')],
  });

  assert.ok(result.artifacts.build);
  assert.equal(result.artifacts.compatibility, path.join(tmp, 'compatibility-report.json'));
  assert.equal(result.artifacts.vulnerability, path.join(tmp, 'vulnerability-scan.json'));
  assert.equal(result.artifacts.secret, path.join(tmp, 'secret-scan.json'));
});

test('phase release artifact collection can require health endpoint commit proof', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-health-commit-'));
  const result = await writeReleaseEvidenceArtifacts({
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    releaseArtifactDir: tmp,
    healthCheckPath: '/version',
    requireHealthCommit: true,
    fetchImpl: versionFetchMock(),
  }, {
    repository: 'wiinc1/engineering-team',
    commitSha: COMMIT_SHA,
    checks: [
      checkRun('build', 'completed', 'success'),
      checkRun('unit tests', 'completed', 'success'),
      checkRun('Dependency vulnerability scan', 'completed', 'success'),
      checkRun('Secret scan', 'completed', 'success'),
    ],
  });

  const health = readJson(result.artifacts.health);
  assert.equal(health.health_check_url, `${DEPLOYMENT_URL}/version`);
  assert.equal(health.commit_verified, true);
});
