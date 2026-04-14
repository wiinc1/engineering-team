const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  commitAll,
  initGitRepo,
  makeTempDir,
  runScript,
  runScriptWithArgs,
  writeFile,
} = require('./helpers');

function createOwnershipConfig(root) {
  writeFile(root, 'config/change-ownership-map.json', JSON.stringify({
    classification: {
      runtime_roots: ['src', 'scripts'],
      test_patterns: ['^tests/', '\\.test\\.[^.]+$', '\\.spec\\.[^.]+$'],
      doc_patterns: ['^docs/', '^tasks/.+\\.md$'],
      non_runtime_patterns: ['^\\.github/', '\\.stories\\.[^.]+$']
    },
    domains: [
      {
        name: 'sample-domain',
        runtime_patterns: ['^src/sample/'],
        test_requirements: [
          { name: 'unit', patterns: ['^tests/unit/sample\\.test\\.js$'] },
          { name: 'integration', patterns: ['^tests/integration/sample\\.test\\.js$'] }
        ],
        doc_requirements: [
          { name: 'runbook', patterns: ['^docs/runbooks/sample\\.md$'] },
          { name: 'api', patterns: ['^docs/api/sample\\.yml$'] }
        ]
      },
    ],
  }, null, 2));
}

function initRepoWithBaseline(root) {
  initGitRepo(root);
  createOwnershipConfig(root);
  writeFile(root, 'README.md', '# temp repo\n');
  writeFile(root, 'src/sample/index.js', 'module.exports = 0;\n');
  writeFile(root, 'tests/unit/sample.test.js', 'test("baseline", () => {});\n');
  writeFile(root, 'tests/integration/sample.test.js', 'test("baseline integration", () => {});\n');
  writeFile(root, 'docs/runbooks/sample.md', '# baseline docs\n');
  writeFile(root, 'docs/api/sample.yml', 'openapi: 3.1.0\n');
  writeFile(root, 'src/other/index.js', 'module.exports = 0;\n');
  commitAll(root, 'baseline');
}

test('verify-change-completeness passes for docs-only changes', () => {
  const root = makeTempDir('governance-change-docs-');
  initRepoWithBaseline(root);
  writeFile(root, 'docs/runbooks/sample.md', '# docs only updated\n');

  const result = runScript('verify-change-completeness.js', root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /change completeness checks passed/);
});

test('verify-change-completeness fails when runtime changes lack tests', () => {
  const root = makeTempDir('governance-change-no-tests-');
  initRepoWithBaseline(root);
  writeFile(root, 'src/sample/index.js', 'module.exports = 1;\n');
  writeFile(root, 'docs/runbooks/sample.md', '# sample docs updated\n');
  writeFile(root, 'docs/api/sample.yml', 'openapi: 3.1.0\ninfo:\n  title: updated\n');

  const result = runScript('verify-change-completeness.js', root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime code changed without accompanying test changes/);
  assert.match(result.stderr, /without required test groups: unit, integration/);
});

test('verify-change-completeness fails when runtime changes lack matching docs', () => {
  const root = makeTempDir('governance-change-no-docs-');
  initRepoWithBaseline(root);
  writeFile(root, 'src/sample/index.js', 'module.exports = 1;\n');
  writeFile(root, 'tests/unit/sample.test.js', 'test("ok", () => { throw new Error("changed"); });\n');
  writeFile(root, 'tests/integration/sample.test.js', 'test("integration", () => { throw new Error("changed"); });\n');

  const result = runScript('verify-change-completeness.js', root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime code changed without accompanying task\/doc evidence updates/);
  assert.match(result.stderr, /without required doc groups: runbook, api/);
});

test('verify-change-completeness passes when runtime, tests, and matching docs change together', () => {
  const root = makeTempDir('governance-change-pass-');
  initRepoWithBaseline(root);
  writeFile(root, 'src/sample/index.js', 'module.exports = 1;\n');
  writeFile(root, 'tests/unit/sample.test.js', 'test("ok", () => { throw new Error("changed"); });\n');
  writeFile(root, 'tests/integration/sample.test.js', 'test("integration", () => { throw new Error("changed"); });\n');
  writeFile(root, 'docs/runbooks/sample.md', '# sample docs updated\n');
  writeFile(root, 'docs/api/sample.yml', 'openapi: 3.1.0\ninfo:\n  title: updated\n');

  const result = runScript('verify-change-completeness.js', root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /change completeness checks passed/);
});

test('verify-change-completeness fails on unmapped runtime files', () => {
  const root = makeTempDir('governance-change-unmapped-');
  initRepoWithBaseline(root);
  writeFile(root, 'src/other/index.js', 'module.exports = 2;\n');
  writeFile(root, 'tests/unit/sample.test.js', 'test("ok", () => { throw new Error("changed"); });\n');
  writeFile(root, 'tests/integration/sample.test.js', 'test("integration", () => { throw new Error("changed"); });\n');
  writeFile(root, 'docs/runbooks/sample.md', '# sample docs updated\n');
  writeFile(root, 'docs/api/sample.yml', 'openapi: 3.1.0\ninfo:\n  title: updated\n');

  const result = runScript('verify-change-completeness.js', root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime files are not mapped to an ownership domain/);
});
