const test = require('node:test');
const assert = require('node:assert/strict');

const {
  browserSourceFiles,
  runBrowserSourceReadability,
} = require('../../../scripts/check-browser-source-readability');
const { makeTempDir, writeFile } = require('./helpers');

test('browser source readability scope includes app and feature source only', () => {
  assert.deepEqual(browserSourceFiles([
    'src/app/App.jsx',
    'src/app/App.test.tsx',
    'src/features/task-detail/route.js',
    'src/features/task-detail/route.spec.js',
    'src/components/Button/Button.tsx',
    'tests/browser/task-detail.browser.spec.ts',
  ]), [
    'src/app/App.jsx',
    'src/features/task-detail/route.js',
  ]);
});

test('browser source readability fails compact app and feature source without allowlist suppression', () => {
  const root = makeTempDir('browser-source-readability-');
  const compactLine = `export const compact = "${'x'.repeat(1201)}";\n`;
  const files = [
    'src/app/compact.js',
    'src/features/task-detail/readable.js',
    'tests/browser/compact.spec.ts',
  ];

  writeFile(root, 'src/app/compact.js', compactLine);
  writeFile(root, 'src/features/task-detail/readable.js', 'export const readable = true;\n');
  writeFile(root, 'tests/browser/compact.spec.ts', compactLine);

  const result = runBrowserSourceReadability({ root, files });

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].path, 'src/app/compact.js');
  assert.equal(result.failures[0].rule, 'readability:minified-source');
});
