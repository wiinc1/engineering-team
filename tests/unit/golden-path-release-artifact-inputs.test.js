const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeReleaseEvidenceArtifacts } = require('../../lib/task-platform/golden-path-real-evidence-collector');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function checkRun(name, status, conclusion) {
  return { id: name.toLowerCase().replace(/\s+/g, '-'), name, status, conclusion, html_url: `https://github.example/checks/${encodeURIComponent(name)}` };
}

function fetchMock({ healthy = true } = {}) {
  return async (url) => {
    const target = String(url);
    if (target === `${DEPLOYMENT_URL}/version`) return jsonResponse({ commitSha: COMMIT_SHA }, healthy ? 200 : 503);
    if (target === DEPLOYMENT_URL) return jsonResponse({ ok: healthy }, healthy ? 200 : 503);
    throw new Error(`unexpected fetch ${target}`);
  };
}

function proof() {
  return {
    repository: 'wiinc1/engineering-team',
    commitSha: COMMIT_SHA,
    checks: [checkRun('build', 'completed', 'success')],
  };
}

test('strict hosted release artifact preparation rejects missing rollback and health commit proof', async () => {
  await assert.rejects(
    () => writeReleaseEvidenceArtifacts({
      requireRealEvidence: true,
      releaseEnv: 'staging',
      deploymentUrl: DEPLOYMENT_URL,
      rollbackTarget: 'release-previous',
      releaseArtifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-missing-hosted-proof-')),
      fetchImpl: fetchMock(),
    }, proof()),
    /requires verified rollback proof.*requires rollback evidence.*requires health check path.*requires deployed commit SHA health proof/s,
  );
});

test('release artifacts do not claim production rollback verification unless explicitly verified', async () => {
  const result = await writeReleaseEvidenceArtifacts({
    releaseEnv: 'prod',
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    releaseArtifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-prod-')),
    fetchImpl: fetchMock(),
  }, proof());

  assert.ok(result.artifacts.deploy);
  assert.equal(result.artifacts.rollback, undefined);
});

test('release artifact preparation rejects missing repository identity', async () => {
  const missingRepositoryProof = { ...proof(), repository: '' };
  await assert.rejects(
    () => writeReleaseEvidenceArtifacts({
      releaseEnv: 'staging',
      deploymentUrl: DEPLOYMENT_URL,
      rollbackTarget: 'release-previous',
      releaseArtifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-missing-repository-')),
      fetchImpl: fetchMock(),
    }, missingRepositoryProof),
    /release evidence repository is required/,
  );
});

test('hosted release artifacts require explicit deployment URL instead of operator URL fallback', async () => {
  const result = await writeReleaseEvidenceArtifacts({
    releaseEnv: 'staging',
    operatorUrl: 'http://127.0.0.1:15173',
    rollbackTarget: 'release-previous',
    releaseArtifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-hosted-url-')),
    fetchImpl: fetchMock(),
  }, proof());

  assert.equal(result.artifacts.deploy, undefined);
  assert.equal(result.artifacts.health, undefined);
});

test('hosted release artifact preparation rejects local deployment URLs', async () => {
  await assert.rejects(
    () => writeReleaseEvidenceArtifacts({
      releaseEnv: 'prod',
      deploymentUrl: 'http://127.0.0.1:15173',
      rollbackTarget: 'release-previous',
      rollbackVerified: true,
      releaseArtifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-local-url-')),
      fetchImpl: fetchMock(),
    }, proof()),
    /hosted prod deployment URL must be hosted and non-local/,
  );
});

test('hosted release artifact preparation rejects placeholder deployment URLs', async () => {
  await assert.rejects(
    () => writeReleaseEvidenceArtifacts({
      releaseEnv: 'staging',
      deploymentUrl: 'https://factory.example.test',
      rollbackTarget: 'release-previous',
      releaseArtifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-placeholder-url-')),
      fetchImpl: fetchMock(),
    }, proof()),
    /must not use placeholder or reserved domains/,
  );
});

test('release artifact preparation rejects unhealthy deployment proof', async () => {
  await assert.rejects(
    () => writeReleaseEvidenceArtifacts({
      releaseEnv: 'staging',
      deploymentUrl: DEPLOYMENT_URL,
      rollbackTarget: 'release-previous',
      releaseArtifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-unhealthy-')),
      fetchImpl: fetchMock({ healthy: false }),
    }, proof()),
    /post-deploy health check failed/,
  );
});
