const test = require('node:test');
const assert = require('node:assert/strict');

const {
  initGitRepo,
  makeTempDir,
  runScript,
  writeFile,
} = require('../unit/governance/helpers');

test('lint-repo diagnostics do not print source lines or secret-like values', () => {
  const root = makeTempDir('lint-repo-security-');
  const secret = 'ghp_exampleSecretTokenValue1234567890';
  initGitRepo(root);
  writeFile(root, 'src/secret.js', `export const token = '${secret}';  \n`);

  const result = runScript('lint-repo.js', root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/secret\.js:1 lint:trailing-whitespace/);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
  assert.doesNotMatch(result.stdout, new RegExp(secret));
});
