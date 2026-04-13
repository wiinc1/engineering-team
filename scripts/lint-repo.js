#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGETS = [
  'lib/audit/authz.js',
  'lib/audit/core.js',
  'lib/audit/feature-flags.js',
  'lib/audit/http.js',
  'lib/audit/postgres.js',
  'lib/audit/store.js',
  'lib/http',
  'lib/task-platform',
  'src/components/Button/Button.tsx',
  'src/components/Button/index.ts',
  'src/components/Button/types.ts',
  'src/features/task-creation/index.ts',
  'src/global.d.ts',
  'tests/accessibility/task-assignment.a11y.spec.ts',
  'tests/visual/task-assignment.visual.spec.ts',
  'tests/performance/lighthouse-task-detail.spec.ts',
  'tests/ui/task-assignment-harness.tsx',
  'tests/unit/task-assignment.test.js',
  'tests/unit/task-platform-api.test.js',
  'tests/e2e/task-assignment.test.js',
  'tests/contract/task-assignment.contract.test.js',
  'tests/integration/task-assignment-integration.test.js',
  'tests/security/task-assignment-security.test.js',
  'scripts/check-task-assignment-smoke.js',
  'scripts/lint-repo.js',
];

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs']);
const violations = [];

function walk(entryPath) {
  const stat = fs.statSync(entryPath);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(entryPath)) {
      if (child === 'node_modules' || child === 'dist') continue;
      walk(path.join(entryPath, child));
    }
    return;
  }

  if (!CODE_EXTENSIONS.has(path.extname(entryPath))) return;
  const content = fs.readFileSync(entryPath, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    if (/\s+$/.test(line)) {
      violations.push(`${entryPath}:${index + 1} trailing whitespace`);
    }
    if (/\t/.test(line)) {
      violations.push(`${entryPath}:${index + 1} tab character`);
    }
  });
}

for (const target of TARGETS) {
  const full = path.join(ROOT, target);
  if (fs.existsSync(full)) walk(full);
}

if (violations.length) {
  process.stderr.write(`${violations.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('lint checks passed\n');
