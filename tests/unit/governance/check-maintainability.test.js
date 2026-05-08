const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  commitAll,
  initGitRepo,
  makeTempDir,
  runScript,
  writeFile,
} = require('./helpers');

test('check-maintainability skips tracked files deleted in the working tree', () => {
  const root = makeTempDir('governance-maintainability-deleted-');
  initGitRepo(root);
  writeFile(root, 'src/deleted-wrapper.js', 'module.exports = () => true;\n');
  commitAll(root, 'baseline');

  fs.unlinkSync(path.join(root, 'src/deleted-wrapper.js'));

  const result = runScript('check-maintainability.js', root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /maintainability checks passed/);
});
