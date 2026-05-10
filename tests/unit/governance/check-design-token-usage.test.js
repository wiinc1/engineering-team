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
  font-family: var(--design-typography-body-md-font-family);
  font-size: var(--design-typography-body-md-font-size);
  font-weight: var(--design-typography-body-md-font-weight);
  line-height: var(--design-typography-body-md-line-height);
  transition: none;
  animation: none;
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
  font-family: Arial, sans-serif;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: 0;
  transition: all 0.15s ease-in-out;
  animation: spin 1s linear infinite;
  opacity: 0.5;
}
`);

  const result = runUsageCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /hex color literal/);
  assert.match(result.stderr, /rgb\(\)\/rgba\(\)\/hsl\(\)\/hsla\(\) color literal/);
  assert.match(result.stderr, /border-radius size literal/);
  assert.match(result.stderr, /box-shadow literal/);
  assert.match(result.stderr, /font-family literal/);
  assert.match(result.stderr, /font-size literal/);
  assert.match(result.stderr, /font-weight literal/);
  assert.match(result.stderr, /line-height literal/);
  assert.match(result.stderr, /letter-spacing literal/);
  assert.match(result.stderr, /transition literal/);
  assert.match(result.stderr, /animation literal/);
  assert.match(result.stderr, /opacity literal/);
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

test('check-design-token-usage fails when exception budget is exceeded', () => {
  const root = makeTempDir('governance-token-usage-budget-');
  writeFile(root, 'docs/design/design-md-adoption.config.json', JSON.stringify({
    schema_version: '1.0',
    exceptionBudget: 0,
    enforcement: {
      paths: ['src/app/styles.css'],
      generated_allowlist: [],
    },
    component_coverage: [],
  }));
  writeFile(root, 'src/app/styles.css', `
/* DESIGN-TOKEN-EXCEPTION: legacy vendor white border until iframe wrapper is removed */
.vendor-frame {
  color: #fff;
}
`);

  const result = runScriptWithArgs('check-design-token-usage.mjs', [], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exception budget exceeded: 1 exception\(s\), budget 0/);
});

test('check-design-token-usage fails duplicate exception reasons', () => {
  const root = makeTempDir('governance-token-usage-duplicate-exception-');
  writeFile(root, 'docs/design/design-md-adoption.config.json', JSON.stringify({
    schema_version: '1.0',
    exceptionBudget: 2,
    enforcement: {
      paths: ['src/app/styles.css'],
      generated_allowlist: [],
    },
    component_coverage: [],
  }));
  writeFile(root, 'src/app/styles.css', `
/* DESIGN-TOKEN-EXCEPTION: legacy vendor white border until iframe wrapper is removed */
.vendor-frame {
  color: #fff;
}

/* DESIGN-TOKEN-EXCEPTION: legacy vendor white border until iframe wrapper is removed */
.vendor-frame-secondary {
  border-color: #fff;
}
`);

  const result = runScriptWithArgs('check-design-token-usage.mjs', [], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate DESIGN-TOKEN-EXCEPTION reason/);
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

test('check-design-token-usage uses adoption config when no paths are passed', () => {
  const root = makeTempDir('governance-token-usage-config-');
  writeFile(root, 'docs/design/design-md-adoption.config.json', JSON.stringify({
    schema_version: '1.0',
    enforcement: {
      paths: ['src/app/styles.css', 'src/components/Button/Button.module.css'],
      generated_allowlist: ['src/app/design-tokens.css'],
    },
    component_coverage: [
      {
        area: 'Global styles',
        enforcement_covered: true,
        paths: ['src/app/styles.css'],
      },
      {
        area: 'Button',
        enforcement_covered: true,
        paths: ['src/components/Button/Button.module.css'],
      },
    ],
  }));
  writeFile(root, 'src/app/styles.css', '.panel { color: var(--color-on-surface); }');
  writeFile(root, 'src/components/Button/Button.module.css', '.button { border-radius: var(--button-border-radius); }');
  writeFile(root, 'src/app/design-tokens.css', ':root { --color-surface: #FFFFFF; }');

  const result = runScriptWithArgs('check-design-token-usage.mjs', [], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 file\(s\)/);
});

test('check-design-token-usage fails when authored CSS is outside config scope', () => {
  const root = makeTempDir('governance-token-usage-missing-css-');
  writeFile(root, 'docs/design/design-md-adoption.config.json', JSON.stringify({
    schema_version: '1.0',
    enforcement: {
      paths: ['src/app/styles.css'],
      generated_allowlist: ['src/app/design-tokens.css'],
    },
    component_coverage: [],
  }));
  writeFile(root, 'src/app/styles.css', '.panel { color: var(--color-on-surface); }');
  writeFile(root, 'src/features/task-detail/TaskDetailActivityShell.module.css', '.shell { color: var(--color-on-surface); }');

  const result = runScriptWithArgs('check-design-token-usage.mjs', [], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing from enforcement scope: src\/features\/task-detail\/TaskDetailActivityShell\.module\.css/);
});

test('check-design-token-usage fails when audited coverage paths are not scanned', () => {
  const root = makeTempDir('governance-token-usage-coverage-mismatch-');
  writeFile(root, 'docs/design/design-md-adoption.config.json', JSON.stringify({
    schema_version: '1.0',
    enforcement: {
      paths: ['src/app/styles.css', 'src/features/task-detail/TaskDetailActivityShell.module.css'],
      generated_allowlist: [],
    },
    component_coverage: [
      {
        area: 'Task detail',
        enforcement_covered: true,
        paths: [
          'src/features/task-detail/TaskDetailActivityShell.module.css',
          'src/features/task-detail/TaskHistoryTimeline.module.css',
        ],
      },
    ],
  }));
  writeFile(root, 'src/app/styles.css', '.panel { color: var(--color-on-surface); }');
  writeFile(root, 'src/features/task-detail/TaskDetailActivityShell.module.css', '.shell { color: var(--color-on-surface); }');
  writeFile(root, 'src/features/task-detail/TaskHistoryTimeline.module.css', '.timeline { color: var(--color-on-surface); }');

  const result = runScriptWithArgs('check-design-token-usage.mjs', [], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /adoption audit marks Task detail as enforced, but path is not scanned/);
});
