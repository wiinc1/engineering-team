const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeReleaseEvidenceArtifacts } = require('../../lib/task-platform/golden-path-real-evidence-collector');

const COMMIT_SHA = '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
const DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';

function checkRun(name, status, conclusion) {
  return { id: name.toLowerCase().replace(/\s+/g, '-'), name, status, conclusion, html_url: `https://github.example/checks/${encodeURIComponent(name)}` };
}

function fetchImpl() {
  return async (url) => ({
    ok: String(url) === DEPLOYMENT_URL,
    status: String(url) === DEPLOYMENT_URL ? 200 : 404,
    text: async () => JSON.stringify({ ok: String(url) === DEPLOYMENT_URL }),
  });
}

function writeRollbackEvidence(dir, overrides = {}) {
  const filePath = path.join(dir, 'rollback-source.json');
  fs.writeFileSync(filePath, `${JSON.stringify({
    environment: 'staging',
    rollback_target: 'release-previous',
    verification_status: 'verified',
    verified_at: '2026-07-05T00:00:00.000Z',
    ...overrides,
  }, null, 2)}\n`);
  return filePath;
}

test('release artifacts require rollback evidence when verification is explicit', async () => {
  await assert.rejects(
    () => writeReleaseEvidenceArtifacts({
      releaseEnv: 'staging',
      deploymentUrl: DEPLOYMENT_URL,
      rollbackTarget: 'release-previous',
      rollbackVerified: true,
      releaseArtifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-missing-rollback-')),
      fetchImpl: fetchImpl(),
    }, { repository: 'wiinc1/engineering-team', commitSha: COMMIT_SHA, checks: [checkRun('build', 'completed', 'success')] }),
    /rollback-verification artifact is required/,
  );
});

test('release artifacts copy verified rollback evidence into the release bundle', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-evidence-rollback-'));
  const result = await writeReleaseEvidenceArtifacts({
    releaseEnv: 'staging',
    deploymentUrl: DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    rollbackVerified: true,
    rollbackEvidence: writeRollbackEvidence(tmp, {
      commit_sha: '4c8d1f0a9b2e3d7c6a5f4b3e2d1c0a9876543210',
      verified_by: 'sre-agent',
    }),
    releaseArtifactDir: tmp,
    fetchImpl: fetchImpl(),
  }, { repository: 'wiinc1/engineering-team', commitSha: COMMIT_SHA, checks: [checkRun('build', 'completed', 'success')] });

  const rollback = JSON.parse(fs.readFileSync(result.artifacts.rollback, 'utf8'));
  assert.equal(rollback.rollback_target, 'release-previous');
  assert.equal(rollback.verification_status, 'verified');
  assert.equal(rollback.verified_by, 'sre-agent');
  assert.equal(rollback.commit_sha, COMMIT_SHA);
});
