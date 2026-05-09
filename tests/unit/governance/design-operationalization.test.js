const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  commitAll,
  git,
  initGitRepo,
  makeTempDir,
  runScriptWithArgs,
  writeFile,
} = require('./helpers');

function minimalAuditConfig(overrides = {}) {
  return {
    schema_version: '1.0',
    source_of_truth: 'DESIGN.md',
    audit_document: 'docs/design/DESIGN_MD_ADOPTION_AUDIT.md',
    audit: {
      date: '2026-05-09',
      summary: '`DESIGN.md` is authoritative.',
    },
    generated_outputs: ['src/app/design-tokens.css'],
    enforcement: {
      paths: ['src/app/styles.css'],
      generated_allowlist: ['src/app/design-tokens.css'],
    },
    component_coverage: [
      {
        area: 'Global styles',
        uses_design_tokens: 'yes',
        enforcement_covered: true,
        paths: ['src/app/styles.css'],
        notes: '`src/app/styles.css` consumes generated variables.',
      },
    ],
    optional_areas: {
      accessibility: {
        status: 'implemented',
        reason: '`DESIGN.md` defines keyboard and contrast rules.',
      },
    },
    acceptance_criteria: [
      {
        criterion: '`DESIGN.md` is declared as source of truth.',
        status: 'pass',
        evidence: '`DESIGN.md` exists.',
      },
    ],
    follow_up_backlog: ['Keep generated audit docs current.'],
    ...overrides,
  };
}

function writeMinimalDesignRepo(root) {
  writeFile(root, 'DESIGN.md', '# Design\n');
  writeFile(root, 'docs/design/design-md-adoption.config.json', JSON.stringify(minimalAuditConfig(), null, 2));
  writeFile(root, 'docs/design/DESIGN_MD_ADOPTION_AUDIT.md', '# stale\n');
  writeFile(root, 'repo-contract.yaml', `
visual_identity:
  generated_outputs:
    paths:
    - src/app/design-tokens.css
`);
  writeFile(root, 'src/app/styles.css', '.app { color: var(--color-on-surface); }\n');
  writeFile(root, 'src/app/design-tokens.css', ':root { --color-on-surface: #111827; }\n');
}

test('generate-design-adoption-audit is deterministic', () => {
  const root = makeTempDir('governance-design-audit-deterministic-');
  writeFile(root, 'docs/design/design-md-adoption.config.json', JSON.stringify(minimalAuditConfig(), null, 2));

  const first = runScriptWithArgs('generate-design-adoption-audit.mjs', [], root);
  assert.equal(first.status, 0, first.stderr);
  const firstOutput = fs.readFileSync(path.join(root, 'docs/design/DESIGN_MD_ADOPTION_AUDIT.md'), 'utf8');

  const second = runScriptWithArgs('generate-design-adoption-audit.mjs', [], root);
  assert.equal(second.status, 0, second.stderr);
  const secondOutput = fs.readFileSync(path.join(root, 'docs/design/DESIGN_MD_ADOPTION_AUDIT.md'), 'utf8');

  assert.equal(secondOutput, firstOutput);
  assert.match(firstOutput, /Generated from: `docs\/design\/design-md-adoption\.config\.json`/);
});

test('generate-design-adoption-audit --check fails stale audit docs', () => {
  const root = makeTempDir('governance-design-audit-stale-');
  writeFile(root, 'docs/design/design-md-adoption.config.json', JSON.stringify(minimalAuditConfig(), null, 2));
  writeFile(root, 'docs/design/DESIGN_MD_ADOPTION_AUDIT.md', '# stale\n');

  const result = runScriptWithArgs('generate-design-adoption-audit.mjs', ['--check'], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Design adoption audit is stale/);
});

test('generate-design-adoption-audit fails optional areas missing reason', () => {
  const root = makeTempDir('governance-design-audit-missing-reason-');
  writeFile(root, 'docs/design/design-md-adoption.config.json', JSON.stringify(minimalAuditConfig({
    optional_areas: {
      accessibility: {
        status: 'implemented',
      },
    },
  }), null, 2));

  const result = runScriptWithArgs('generate-design-adoption-audit.mjs', [], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /optional_areas\.accessibility\.reason is required/);
});

test('check-design-change-guard fails UI changes without design artifacts', () => {
  const root = makeTempDir('governance-design-change-guard-fail-');
  initGitRepo(root);
  git(root, ['branch', '-M', 'main']);
  writeMinimalDesignRepo(root);
  runScriptWithArgs('generate-design-adoption-audit.mjs', [], root);
  commitAll(root, 'baseline');

  writeFile(root, 'src/app/styles.css', '.app { color: var(--color-primary); }\n');

  const result = runScriptWithArgs('check-design-change-guard.mjs', [], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Authored UI files changed without a related DESIGN\.md artifact/);
  assert.match(result.stderr, /src\/app\/styles\.css/);
});

test('check-design-change-guard passes UI changes with design artifacts', () => {
  const root = makeTempDir('governance-design-change-guard-pass-');
  initGitRepo(root);
  git(root, ['branch', '-M', 'main']);
  writeMinimalDesignRepo(root);
  runScriptWithArgs('generate-design-adoption-audit.mjs', [], root);
  commitAll(root, 'baseline');

  writeFile(root, 'src/app/styles.css', '.app { color: var(--color-primary); }\n');
  writeFile(root, 'DESIGN.md', '# Design\n\nChanged visual semantics.\n');

  const result = runScriptWithArgs('check-design-change-guard.mjs', [], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /design change guard passed/);
});
