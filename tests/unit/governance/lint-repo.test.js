const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyAllowlist,
  discoverLintFiles,
  isIncludedPath,
  lineFindings,
  readabilityFindings,
  staleAllowlistFindings,
  validateAllowlist,
} = require('../../../scripts/lint-repo');
const { makeTempDir, writeFile } = require('./helpers');

test('lint file discovery includes authored app, API, script, and test sources', () => {
  const root = makeTempDir('governance-lint-discovery-');
  const trackedFiles = [
    'api/route.js',
    'lib/domain/service.cjs',
    'scripts/tool.mjs',
    'src/component.tsx',
    'tests/unit/example.test.ts',
    'docs/example.js',
    'src/generated/client.js',
    'lib/vendor/package.js',
    'dist/bundle.js',
    'node_modules/pkg/index.js',
    'src/styles.css',
  ];

  for (const filePath of trackedFiles) writeFile(root, filePath, 'export const ok = true;\n');

  assert.equal(isIncludedPath('src/component.tsx'), true);
  assert.equal(isIncludedPath('src/generated/client.js'), false);
  assert.deepEqual(discoverLintFiles({ root, files: trackedFiles }), [
    'api/route.js',
    'lib/domain/service.cjs',
    'scripts/tool.mjs',
    'src/component.tsx',
    'tests/unit/example.test.ts',
  ]);
});

test('line checks report whitespace and tabs without including source content', () => {
  const findings = lineFindings('src/example.js', 'const secret = "value";  \n\tconst next = true;\n');

  assert.deepEqual(findings.map((item) => item.rule), [
    'lint:trailing-whitespace',
    'lint:tab-character',
  ]);
  assert(findings.every((item) => !item.message.includes('secret')));
});

test('readability checks flag generated, bundled, and minified authored source', () => {
  const generated = readabilityFindings('src/generated-looking.js', '// DO NOT EDIT\nexport const value = 1;\n');
  const bundled = readabilityFindings('src/bundle.js', `const marker = '${'webpack' + 'Bootstrap'}';\n`);
  const minified = readabilityFindings('src/compact.js', `const payload = '${'x'.repeat(1201)}';\n`);

  assert.equal(generated[0].rule, 'readability:generated-source');
  assert.equal(bundled[0].rule, 'readability:bundled-source');
  assert.equal(minified[0].rule, 'readability:minified-source');
});

test('allowlist validation requires safe scanned paths, supported rules, and metadata', () => {
  const result = validateAllowlist({
    version: 1,
    entries: [
      {
        paths: ['src/compact.js'],
        rules: ['readability:minified-source'],
        owner: '@engineering-team/governance',
        reason: 'Compact parser fixture kept intentionally for regression coverage.',
        followUp: 'Remove this entry when the fixture is replaced by a readable source.',
      },
    ],
  }, ['src/compact.js']);

  assert.equal(result.errors.length, 0);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].path, 'src/compact.js');
});

test('allowlist validation rejects stale paths, unsupported rules, and placeholders', () => {
  const result = validateAllowlist({
    version: 1,
    entries: [
      {
        path: 'src/missing.js',
        rules: ['lint:trailing-whitespace'],
        owner: 'TBD',
        reason: '',
        followUp: 'TODO',
      },
    ],
  }, ['src/covered.js']);

  assert(result.errors.some((item) => item.rule === 'allowlist:stale-entry'));
  assert(result.errors.some((item) => item.message.includes('unsupported rule')));
  assert(result.errors.some((item) => item.message.includes('owner')));
  assert(result.errors.some((item) => item.message.includes('reason')));
  assert(result.errors.some((item) => item.message.includes('followUp')));
});

test('allowlist suppresses readability findings only and reports stale exceptions', () => {
  const entries = [{
    path: 'src/compact.js',
    rules: ['readability:minified-source'],
    owner: '@engineering-team/governance',
    reason: 'Legacy compact source.',
    followUp: 'Reformat later.',
  }];
  const findings = [
    { path: 'src/compact.js', line: 1, rule: 'readability:minified-source', message: 'compact' },
    { path: 'src/compact.js', line: 2, rule: 'lint:tab-character', message: 'tab' },
  ];

  const filtered = applyAllowlist(findings, entries);
  assert.deepEqual(filtered.suppressed.map((item) => item.rule), ['readability:minified-source']);
  assert.deepEqual(filtered.active.map((item) => item.rule), ['lint:tab-character']);
  assert.equal(staleAllowlistFindings(entries, findings).length, 0);
  assert.equal(staleAllowlistFindings(entries, []).length, 1);
});
