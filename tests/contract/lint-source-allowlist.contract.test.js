const test = require('node:test');
const assert = require('node:assert/strict');

const { validateAllowlist } = require('../../scripts/lint-repo');

test('lint source allowlist contract accepts grouped path exceptions', () => {
  const result = validateAllowlist({
    version: 1,
    entries: [{
      paths: ['src/one.js', 'tests/two.test.js'],
      rules: ['readability:minified-source'],
      owner: '@engineering-team/governance',
      reason: 'Legacy compact source requires a tracked cleanup path.',
      followUp: 'Remove each path after it is reformatted.',
    }],
  }, ['src/one.js', 'tests/two.test.js']);

  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.entries.map((entry) => entry.path), [
    'src/one.js',
    'tests/two.test.js',
  ]);
});

test('lint source allowlist contract rejects malformed schemas and unsafe paths', () => {
  const invalidSchema = validateAllowlist({ version: 2, entries: [] }, ['src/one.js']);
  const unsafePath = validateAllowlist({
    version: 1,
    entries: [{
      path: '../outside.js',
      rules: ['readability:minified-source'],
      owner: '@engineering-team/governance',
      reason: 'Invalid path coverage.',
      followUp: 'Use a repo-relative source path.',
    }],
  }, ['src/one.js']);

  assert.equal(invalidSchema.errors[0].rule, 'allowlist:invalid-schema');
  assert(unsafePath.errors.some((item) => item.rule === 'allowlist:invalid-entry'));
});
