const test = require('node:test');
const assert = require('node:assert/strict');

const {
  initGitRepo,
  makeTempDir,
  runScript,
  writeFile,
} = require('../unit/governance/helpers');

test('lint-repo discovers untracked authored source and ignores excluded outputs', () => {
  const root = makeTempDir('lint-repo-integration-');
  initGitRepo(root);
  writeFile(root, 'src/discovered.js', 'export const covered = true;  \n');
  writeFile(root, 'src/generated/ignored.js', 'export const ignored = true;  \n');
  writeFile(root, 'dist/bundle.js', 'export const ignored = true;  \n');

  const failed = runScript('lint-repo.js', root);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /src\/discovered\.js:1 lint:trailing-whitespace/);
  assert.doesNotMatch(failed.stderr, /src\/generated\/ignored/);
  assert.doesNotMatch(failed.stderr, /dist\/bundle/);

  writeFile(root, 'src/discovered.js', 'export const covered = true;\n');
  const passed = runScript('lint-repo.js', root);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /lint checks passed/);
});

test('lint-repo blocks compact source unless a non-stale allowlist entry documents it', () => {
  const root = makeTempDir('lint-repo-allowlist-');
  initGitRepo(root);
  writeFile(root, 'src/compact-fixture.js', `export const compact = '${'x'.repeat(1201)}';\n`);

  const failed = runScript('lint-repo.js', root);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /readability:minified-source/);

  writeFile(root, 'config/lint-source-allowlist.json', `${JSON.stringify({
    version: 1,
    entries: [{
      path: 'src/compact-fixture.js',
      rules: ['readability:minified-source'],
      owner: '@engineering-team/governance',
      reason: 'Compact fixture intentionally exercises parser limits.',
      followUp: 'Replace with a readable fixture once parser coverage changes.',
    }],
  }, null, 2)}\n`);

  const passed = runScript('lint-repo.js', root);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /allowlisted readability findings: 1/);
});
