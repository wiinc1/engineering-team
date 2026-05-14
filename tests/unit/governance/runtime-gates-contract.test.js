const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertIncludesAll(text, values) {
  for (const value of values) {
    assert.ok(text.includes(value), `missing ${value}`);
  }
}

test('repo contract declares the application runtime and owned runtime modules', () => {
  const contract = read('repo-contract.yaml');

  assertIncludesAll(contract, [
    'name: javascript',
    'Node.js 22 runtime',
    'name: typescript',
    'version: PostgreSQL-compatible migrations',
    'toolchains: [node, npm, vite, react, typescript, vitest, playwright',
    'package_managers: [npm, pip]',
    'src/features/',
    'api/',
    'lib/auth/',
    'lib/audit/',
    'lib/task-platform/',
    'lib/software-factory/',
    'db/migrations/',
    'monitoring/',
    'observability/',
    'package.json',
    '.github/workflows/verify.yml',
  ]);
});

test('check manifest and Makefile map merge gates to real runtime commands', () => {
  const manifest = read('check-manifest.yaml');
  const makefile = read('Makefile');

  assertIncludesAll(manifest, [
    'command: make lint',
    'command: make typecheck',
    'command: make test',
    'command: make build',
    'command: make design-local-gates',
    'command: npm run standards:check',
    'command: make verify',
  ]);

  assert.match(makefile, /^lint: standards-policy-gates$/m);
  assert.match(makefile, /^typecheck: standards-python-typecheck$/m);
  assert.match(makefile, /^test: standards-python-test$/m);
  assert.match(makefile, /^build: standards-python-build$/m);
  assert.match(makefile, /^verify: design-local-gates lint typecheck test build$/m);
  assertIncludesAll(makefile, [
    '\tnpm run lint',
    '\tnpm run typecheck',
    '\tnpm run test:unit',
    '\tnpm run test:browser',
    '\tnpm run build',
    '\tnpm run standards:check',
    'validate_artifact_provenance.py',
    'validate_test_policy.py',
  ]);
});

test('local build script remains runnable without production auth secrets', () => {
  const packageJson = JSON.parse(read('package.json'));

  assertIncludesAll(packageJson.scripts.build, [
    'npm run auth:deploy:bootstrap',
    'node scripts/check-auth-config.js',
    '--target ${AUTH_CONFIG_TARGET:-${VERCEL_ENV:-development}}',
    '--write-artifact',
    'vite build',
  ]);
});

test('verify workflow installs the runtime dependencies required by make verify', () => {
  const workflow = read('.github/workflows/verify.yml');

  assertIncludesAll(workflow, [
    'node-version: 22',
    'run: npm ci',
    'run: npx playwright install --with-deps chromium firefox',
    'make verify',
  ]);
});

test('runtime governance docs and diagrams publish the gate mapping', () => {
  const architecture = read('docs/architecture.md');
  const runbook = read('docs/runbook.md');
  const branchProtection = read('.github/BRANCH_PROTECTION.md');
  const workflow = read('docs/diagrams/workflow-governance-runtime-gates.mmd');
  const architectureDiagram = read('docs/diagrams/architecture-governance-runtime-gates.mmd');

  assertIncludesAll(architecture, ['Governance Runtime Contract', 'make standards-policy-gates', 'npm run test:browser']);
  assertIncludesAll(runbook, ['Full local ship gate', 'make verify', 'CI mapping']);
  assertIncludesAll(branchProtection, ['Repo validation', 'Browser validation', '`verify`', 'npm run standards:check']);
  assert.match(workflow, /^flowchart\s+TD/m);
  assert.match(architectureDiagram, /^flowchart\s+LR/m);
  assertIncludesAll(workflow, ['npm run build', 'Vercel deployment preview']);
  assertIncludesAll(architectureDiagram, ['Node Vite React TypeScript PostgreSQL Python', 'Branch protection']);
});
