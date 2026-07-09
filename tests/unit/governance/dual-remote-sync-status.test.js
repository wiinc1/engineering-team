const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('dual-remote-sync-status reports GitLab primary policy and exit codes', () => {
  const script = path.join(__dirname, '../../../scripts/dual-remote-sync-status.js');
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: process.env,
  });
  assert.ok(result.stdout, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.policy.primary, 'origin (GitLab)');
  assert.equal(report.policy.backup, 'github (GitHub)');
  assert.match(report.policy.docs, /dual-remote-gitlab-primary/);
  assert.ok(report.tips['origin/main']);
  assert.ok(report.tips['github/main']);
  assert.ok([0, 2, 3].includes(result.status));
});
