const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  buildReleaseArtifacts,
} = require('../../lib/task-platform/release-artifact-evidence');

const SCRIPT = path.join(__dirname, '../..', 'scripts/build-release-artifacts.js');
const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';

function runBuilder(args, cwd = path.join(__dirname, '../..')) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function createReleaseRepo(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(tmp, ['init']);
  fs.writeFileSync(path.join(tmp, 'README.md'), 'release artifact proof\n');
  git(tmp, ['add', 'README.md']);
  git(tmp, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'init']);
  return {
    tmp,
    commitSha: git(tmp, ['rev-parse', 'HEAD']),
  };
}

function passCommand(label) {
  return `node -e "process.stdout.write('${label} passed')"`;
}

function commitHealthFetch(commitSha, url = DEPLOYMENT_URL) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ deployed_sha: commitSha, url }),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('release artifact builder writes command, deploy, health, and immutable artifacts', async () => {
  const { tmp, commitSha } = createReleaseRepo('release-artifact-builder-');
  const result = await buildReleaseArtifacts({
    repoRoot: tmp,
    releaseEnv: 'staging',
    commitSha,
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    repository: 'wiinc1/engineering-team',
    outDir: path.join(tmp, 'release'),
    healthCheckPath: '/version',
    requireHealthCommit: true,
    fetchImpl: async (url) => commitHealthFetch(commitSha, url),
    commands: {
      build: passCommand('build'),
      compatibility: passCommand('compatibility'),
      vulnerability: passCommand('vulnerability'),
      secret: passCommand('secret'),
    },
  });

  assert.equal(result.ok, true, result.failures.join('\n'));
  for (const name of ['build', 'compatibility', 'vulnerability', 'secret', 'immutable', 'deploy', 'health']) {
    assert.ok(fs.existsSync(result.artifacts[name]), `${name} artifact exists`);
  }
  assert.equal(readJson(result.artifacts.build).status, 'passed');
  assert.equal(readJson(result.artifacts.vulnerability).artifact_name, 'vulnerability-scan');
  assert.equal(readJson(result.artifacts.deploy).deployment_url, DEPLOYMENT_URL);
  assert.equal(readJson(result.artifacts.health).status, 'healthy');
  assert.equal(readJson(result.artifacts.immutable).commit_sha, commitSha);
});

test('release artifact builder rejects failed evidence commands without writing files', async () => {
  const { tmp, commitSha } = createReleaseRepo('release-artifact-builder-fail-');
  const result = await buildReleaseArtifacts({
    repoRoot: tmp,
    releaseEnv: 'staging',
    commitSha,
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    repository: 'wiinc1/engineering-team',
    outDir: path.join(tmp, 'release'),
    healthCheckPath: '/version',
    requireHealthCommit: true,
    fetchImpl: async (url) => commitHealthFetch(commitSha, url),
    commands: {
      build: passCommand('build'),
      compatibility: 'node -e "process.exit(2)"',
      vulnerability: passCommand('vulnerability'),
      secret: passCommand('secret'),
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /compatibility command failed/);
  assert.equal(fs.existsSync(path.join(tmp, 'release')), false);
});

test('release artifact builder can require deployed commit in health response', async () => {
  const { tmp, commitSha } = createReleaseRepo('release-artifact-builder-health-sha-');
  const result = await buildReleaseArtifacts({
    repoRoot: tmp,
    releaseEnv: 'staging',
    commitSha,
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    repository: 'wiinc1/engineering-team',
    outDir: path.join(tmp, 'release'),
    healthCheckPath: '/version',
    requireHealthCommit: true,
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ deployed_sha: commitSha, url }),
    }),
    commands: {
      build: passCommand('build'),
      compatibility: passCommand('compatibility'),
      vulnerability: passCommand('vulnerability'),
      secret: passCommand('secret'),
    },
  });

  assert.equal(result.ok, true, result.failures.join('\n'));
  const health = readJson(result.artifacts.health);
  assert.equal(health.health_check_url, `${DEPLOYMENT_URL}/version`);
  assert.equal(health.commit_verified, true);
});

test('release artifact builder rejects health responses without deployed commit proof', async () => {
  const { tmp, commitSha } = createReleaseRepo('release-artifact-builder-health-missing-sha-');
  const result = await buildReleaseArtifacts({
    repoRoot: tmp,
    releaseEnv: 'staging',
    commitSha,
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    repository: 'wiinc1/engineering-team',
    outDir: path.join(tmp, 'release'),
    healthCheckPath: '/version',
    requireHealthCommit: true,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' }),
    commands: {
      build: passCommand('build'),
      compatibility: passCommand('compatibility'),
      vulnerability: passCommand('vulnerability'),
      secret: passCommand('secret'),
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /did not prove deployed commit SHA/);
  assert.equal(fs.existsSync(path.join(tmp, 'release')), false);
});

test('release artifact builder requires hosted health commit proof before writing files', async () => {
  const { tmp, commitSha } = createReleaseRepo('release-artifact-builder-health-required-');
  const outDir = path.join(tmp, 'release');
  const result = await buildReleaseArtifacts({
    repoRoot: tmp,
    releaseEnv: 'staging',
    commitSha,
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    repository: 'wiinc1/engineering-team',
    outDir,
    fetchImpl: async () => ({ ok: true, status: 200 }),
    commands: {
      build: passCommand('build'),
      compatibility: passCommand('compatibility'),
      vulnerability: passCommand('vulnerability'),
      secret: passCommand('secret'),
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /health check path is required/);
  assert.match(result.failures.join('\n'), /must require deployed commit SHA health proof/);
  assert.equal(fs.existsSync(outDir), false);
});

test('release artifact builder rejects dirty local checkout evidence', async () => {
  const { tmp, commitSha } = createReleaseRepo('release-artifact-builder-dirty-');
  const outDir = path.join(tmp, 'release');
  fs.writeFileSync(path.join(tmp, 'README.md'), 'dirty release artifact proof\n');

  const result = await buildReleaseArtifacts({
    repoRoot: tmp,
    releaseEnv: 'staging',
    commitSha,
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    repository: 'wiinc1/engineering-team',
    outDir,
    healthCheckPath: '/version',
    requireHealthCommit: true,
    fetchImpl: async (url) => commitHealthFetch(commitSha, url),
    commands: {
      build: passCommand('build'),
      compatibility: passCommand('compatibility'),
      vulnerability: passCommand('vulnerability'),
      secret: passCommand('secret'),
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /local git worktree must be clean before release artifact generation \(1 dirty files\)/);
  assert.equal(fs.existsSync(outDir), false);
});

test('release artifact builder rejects missing repository identity', async () => {
  const { tmp, commitSha } = createReleaseRepo('release-artifact-builder-missing-repo-');
  const outDir = path.join(tmp, 'release');
  const result = await buildReleaseArtifacts({
    repoRoot: tmp,
    releaseEnv: 'staging',
    commitSha,
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    outDir,
    healthCheckPath: '/version',
    requireHealthCommit: true,
    fetchImpl: async (url) => commitHealthFetch(commitSha, url),
    commands: {
      build: passCommand('build'),
      compatibility: passCommand('compatibility'),
      vulnerability: passCommand('vulnerability'),
      secret: passCommand('secret'),
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /release artifact repository is required/);
  assert.equal(fs.existsSync(outDir), false);
});

test('release artifact builder rejects commit SHA drift from local HEAD', async () => {
  const { tmp } = createReleaseRepo('release-artifact-builder-head-drift-');
  const outDir = path.join(tmp, 'release');
  const requestedSha = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';

  const result = await buildReleaseArtifacts({
    repoRoot: tmp,
    releaseEnv: 'staging',
    commitSha: requestedSha,
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    repository: 'wiinc1/engineering-team',
    outDir,
    healthCheckPath: '/version',
    requireHealthCommit: true,
    fetchImpl: async (url) => commitHealthFetch(requestedSha, url),
    commands: {
      build: passCommand('build'),
      compatibility: passCommand('compatibility'),
      vulnerability: passCommand('vulnerability'),
      secret: passCommand('secret'),
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /release artifact commit SHA .* must match local HEAD/);
  assert.equal(fs.existsSync(outDir), false);
});

test('release artifact CLI rejects invalid hosted proof inputs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-artifact-cli-reject-'));
  const outDir = path.join(tmp, 'release');
  const result = runBuilder([
    '--repo-root', tmp,
    '--release-env', 'staging',
    '--commit-sha', 'not-a-sha',
    '--deployment-url', 'http://127.0.0.1:15173',
    '--rollback-target', 'release-previous',
    '--out-dir', outDir,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /actual 40-character commit SHA is required/);
  assert.match(result.stderr, /deployment_url must be hosted and non-local/);
  assert.match(result.stderr, /health check path is required/);
  assert.match(result.stderr, /must require deployed commit SHA health proof/);
  assert.match(result.stderr, /release artifact repository is required/);
  assert.match(result.stderr, /build command is required/);
  assert.equal(fs.existsSync(outDir), false);
});
