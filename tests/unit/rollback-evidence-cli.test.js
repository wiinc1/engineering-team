const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '../..', 'scripts/build-rollback-evidence.js');

function runBuilder(args, cwd = path.join(__dirname, '../..')) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

test('rollback evidence builder writes verified rollback proof', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-evidence-builder-'));
  const out = path.join(tmp, 'rollback-verification.json');
  const result = runBuilder([
    '--repo-root', tmp,
    '--release-env', 'staging',
    '--commit-sha', '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
    '--rollback-target', 'release-previous',
    '--verification-status', 'verified',
    '--verified-at', '2026-07-05T00:00:00.000Z',
    '--out', out,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(payload.environment, 'staging');
  assert.equal(payload.commit_sha, '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd');
  assert.equal(payload.rollback_target, 'release-previous');
  assert.equal(payload.verification_status, 'verified');
});

test('rollback evidence builder rejects skipped rollback verification', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-evidence-builder-reject-'));
  const out = path.join(tmp, 'rollback-verification.json');
  const result = runBuilder([
    '--repo-root', tmp,
    '--release-env', 'staging',
    '--commit-sha', 'not-a-sha',
    '--rollback-target', 'release-previous',
    '--verification-status', 'skipped',
    '--verified-at', 'not-a-date',
    '--out', out,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /verification_status must be 'verified'/);
  assert.match(result.stderr, /commit_sha actual 40-character commit SHA is required/);
  assert.match(result.stderr, /verified_at timestamp is required/);
  assert.equal(fs.existsSync(out), false);
});
