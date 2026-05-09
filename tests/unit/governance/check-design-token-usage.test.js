const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeTempDir,
  runScriptWithArgs,
  writeFile,
} = require('./helpers');

function runUsageCheck(root, paths = ['src/app/styles.css']) {
  return runScriptWithArgs('check-design-token-usage.mjs', paths, root);
}

test('check-design-token-usage passes tokenized CSS', () => {
  const root = makeTempDir('governance-token-usage-pass-');
  writeFile(root, 'src/app/styles.css', `
.panel {
  color: var(--color-on-surface);
  border-radius: var(--design-radius-panel);
  box-shadow: var(--design-shadow-sm);
  font-size: var(--design-typography-body-md-font-size);
}
`);

  const result = runUsageCheck(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /design token usage enforcement passed/);
});

test('check-design-token-usage fails forbidden visual literals', () => {
  const root = makeTempDir('governance-token-usage-fail-');
  writeFile(root, 'src/app/styles.css', `
.panel {
  color: #fff;
  background: rgba(15, 23, 42, 0.08);
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  font-size: 14px;
}
`);

  const result = runUsageCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /hex color literal/);
  assert.match(result.stderr, /rgb\(\)\/rgba\(\)\/hsl\(\)\/hsla\(\) color literal/);
  assert.match(result.stderr, /border-radius size literal/);
  assert.match(result.stderr, /box-shadow literal/);
  assert.match(result.stderr, /common font-size literal/);
});

test('check-design-token-usage allows reasoned one-off exceptions', () => {
  const root = makeTempDir('governance-token-usage-exception-');
  writeFile(root, 'src/app/styles.css', `
/* DESIGN-TOKEN-EXCEPTION: third-party iframe requires exact inherited white edge until embed is replaced */
.vendor-frame {
  color: #fff;
}
`);

  const result = runUsageCheck(root);
  assert.equal(result.status, 0, result.stderr);
});

test('check-design-token-usage rejects exception comments without reasons', () => {
  const root = makeTempDir('governance-token-usage-empty-exception-');
  writeFile(root, 'src/app/styles.css', `
/* DESIGN-TOKEN-EXCEPTION: */
.vendor-frame {
  color: #fff;
}
`);

  const result = runUsageCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires a short reason/);
});

test('check-design-token-usage skips generated token outputs', () => {
  const root = makeTempDir('governance-token-usage-generated-');
  writeFile(root, 'src/app/design-tokens.css', `
:root {
  --color-surface: #FFFFFF;
  --design-shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.08);
}
`);

  const result = runUsageCheck(root, ['src/app/design-tokens.css']);
  assert.equal(result.status, 0, result.stderr);
});
