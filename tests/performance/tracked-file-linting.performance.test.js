const test = require('node:test');
const assert = require('node:assert/strict');

const {
  initGitRepo,
  makeTempDir,
  runScript,
  writeFile,
} = require('../unit/governance/helpers');

test('tracked-file linting stays within the local developer budget for modest repos', () => {
  const root = makeTempDir('lint-repo-performance-');
  initGitRepo(root);
  for (let index = 0; index < 120; index += 1) {
    writeFile(root, `src/generated-free-${index}.js`, `export const value${index} = ${index};\n`);
  }

  const started = process.hrtime.bigint();
  const result = runScript('lint-repo.js', root);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /duration: \d+\.\d{3}s/);
  assert(elapsedMs < 5000, `lint took ${elapsedMs.toFixed(1)}ms`);
});
