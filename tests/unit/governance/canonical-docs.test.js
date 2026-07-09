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
    assert.match(text, new RegExp(escapeRegExp(value)), `missing ${value}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('canonical architecture and runbook no longer contain placeholders', () => {
  const architecture = read('docs/architecture.md');
  const runbook = read('docs/runbook.md');
  const bannedPhrases = [
    "Describe the repository's primary deployment unit",
    'document the logical layers',
    'record how to gather release evidence',
    'record any external systems',
    'record who owns protected-path changes',
  ];

  for (const phrase of bannedPhrases) {
    assert.doesNotMatch(architecture, new RegExp(escapeRegExp(phrase), 'i'));
    assert.doesNotMatch(runbook, new RegExp(escapeRegExp(phrase), 'i'));
  }
});

test('architecture documents runtime boundaries, state, and external systems', () => {
  const architecture = read('docs/architecture.md');

  assertIncludesAll(architecture, [
    'src/app/',
    'api/',
    'lib/auth/',
    'lib/audit/',
    'lib/task-platform/',
    'PostgreSQL',
    'coordinated stack',
    'monitoring/',
    'dev-standards/',
    'State Ownership',
    'External Systems',
  ]);
});

test('runbook documents operator commands, evidence, rollback, and monitoring', () => {
  const runbook = read('docs/runbook.md');

  assertIncludesAll(runbook, [
    'npm run auth:registration:production-smoke',
    'npm run task-platform:rollout',
    'npm run audit:rebuild',
    'monitoring/dashboards/registration-auth-security.json',
    'repo-contract.yaml',
    'make verify',
    'Release Evidence',
    'Rollback',
  ]);
});

test('canonical docs and diagrams do not expose secret values', () => {
  const checkedFiles = [
    'docs/architecture.md',
    'docs/runbook.md',
    'README.md',
    'docs/diagrams/workflow-architecture-runbooks.mmd',
    'docs/diagrams/architecture-architecture-runbooks.mmd',
  ];
  const secretValuePattern =
    /\b(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL)\s*=\s*(?!\.\.\.|<|redacted|postgres:\/\/(?:\.\.\.|<))[^\s`]+/i;
  const privateKeyPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

  for (const file of checkedFiles) {
    const text = read(file);
    assert.doesNotMatch(text, secretValuePattern, `${file} contains a secret-looking assignment`);
    assert.doesNotMatch(text, privateKeyPattern, `${file} contains a private key block`);
  }
});

test('README links to canonical architecture and runbook docs', () => {
  const readme = read('README.md');

  assertIncludesAll(readme, ['docs/architecture.md', 'docs/runbook.md']);
});

test('architecture and workflow diagrams exist as Mermaid flowcharts', () => {
  const workflow = read('docs/diagrams/workflow-architecture-runbooks.mmd');
  const architecture = read('docs/diagrams/architecture-architecture-runbooks.mmd');

  assert.match(workflow, /^flowchart\s+TD/m);
  assert.match(architecture, /^flowchart\s+LR/m);
  assertIncludesAll(workflow, ['docs/architecture.md', 'docs/runbook.md']);
  assertIncludesAll(architecture, ['Browser app', 'Node services']);
});

test('runbook command references exist in package scripts or Makefile targets', () => {
  const packageJson = JSON.parse(read('package.json'));
  const makefile = read('Makefile');
  const scripts = packageJson.scripts;

  for (const scriptName of [
    'lint',
    'typecheck',
    'test:unit',
    'test:browser',
    'build',
    'standards:check',
    'auth:registration:production-smoke',
    'task-platform:rollout',
    'audit:rebuild',
  ]) {
    assert.ok(scripts[scriptName], `missing npm script ${scriptName}`);
  }

  assert.match(makefile, /^verify:/m);
});
