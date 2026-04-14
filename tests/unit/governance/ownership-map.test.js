const test = require('node:test');
const assert = require('node:assert/strict');

const {
  commitAll,
  initGitRepo,
  makeTempDir,
  runScript,
  runScriptWithArgs,
  writeFile,
} = require('./helpers');

function createValidRepo(root) {
  initGitRepo(root);
  writeFile(root, 'config/change-ownership-map.json', JSON.stringify({
    classification: {
      runtime_roots: ['src'],
      test_patterns: ['^tests/', '\\.test\\.[^.]+$'],
      doc_patterns: ['^docs/'],
      non_runtime_patterns: ['^\\.github/']
    },
    domains: [
      {
        name: 'sample',
        runtime_patterns: ['^src/sample/'],
        test_requirements: [{ name: 'unit', patterns: ['^tests/unit/sample\\.test\\.js$'] }],
        doc_requirements: [{ name: 'runbook', patterns: ['^docs/runbooks/sample\\.md$'] }]
      }
    ]
  }, null, 2));
  writeFile(root, 'src/sample/index.js', 'module.exports = 1;\n');
  writeFile(root, 'tests/unit/sample.test.js', 'test("ok", () => {});\n');
  writeFile(root, 'docs/runbooks/sample.md', '# sample\n');
  commitAll(root, 'baseline');
}

test('ownership lint passes on a valid ownership map', () => {
  const root = makeTempDir('ownership-lint-pass-');
  createValidRepo(root);
  const result = runScript('lint-change-ownership-map.js', root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ownership map lint passed/);
});

test('ownership lint fails on unmapped runtime files', () => {
  const root = makeTempDir('ownership-lint-unmapped-');
  createValidRepo(root);
  writeFile(root, 'src/other/index.js', 'module.exports = 2;\n');

  const result = runScript('lint-change-ownership-map.js', root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unmapped runtime files/);
});

test('governance drift check reports issues in strict mode', () => {
  const root = makeTempDir('governance-drift-');
  createValidRepo(root);
  writeFile(root, 'src/other/index.js', 'module.exports = 2;\n');

  const result = runScriptWithArgs('governance-drift.js', ['--strict'], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Governance drift report/);
  assert.match(result.stdout, /Unmapped runtime files/);
});
