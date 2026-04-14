const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const {
  makeTempDir,
  runScript,
  writeFile,
} = require('./helpers');

function createEvent(root, body) {
  const eventPath = path.join(root, 'event.json');
  writeFile(root, 'event.json', JSON.stringify({ pull_request: { body, base: { sha: 'abc' }, head: { sha: 'def' } } }));
  return eventPath;
}

function writeFakeGit(root, changedFiles) {
  const originalPath = process.env.PATH;
  writeFile(root, 'git', `#!/bin/sh
printf '%s\n' ${changedFiles.map((file) => `"${file}"`).join(' ')}
`);
  fs.chmodSync(path.join(root, 'git'), 0o755);
  return `${root}:${originalPath}`;
}

test('verify-pr-body skips cleanly when no event path is provided', () => {
  const root = makeTempDir('governance-pr-skip-');
  const result = runScript('verify-pr-body.js', root, { GITHUB_EVENT_PATH: '' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pr body check skipped/);
});

test('verify-pr-body passes on a fully populated PR body', () => {
  const root = makeTempDir('governance-pr-pass-');
  const pathEnv = writeFakeGit(root, ['tests/unit/sample.test.js', 'docs/runbooks/sample.md']);
  const eventPath = createEvent(root, `## Linked Task
- Task: TSK-123

## Standards Compliance
- Standards baseline reviewed: yes
- Checklist completed or updated: yes
- Compliance checklist path: docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md
- Relevant standards areas: testing and quality assurance
- Standards gaps or exceptions: Gap observed: minor follow-up. Documented rationale: tracked explicitly (source https://example.com/standard).

## Required Evidence
- Standards check result: npm run standards:check
- Lint result: npm run lint
- Tests: npm run test:unit
- Test evidence paths: tests/unit/sample.test.js
- Docs updated: docs/standards/software-development-standards.md
- Doc evidence paths: docs/runbooks/sample.md

## Risk and Rollback
- Risk level: low
- Rollback path: revert governance changes
`);

  const result = runScript('verify-pr-body.js', root, {
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_EVENT_NAME: 'pull_request',
    PATH: pathEnv,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pr body checks passed/);
});

test('verify-pr-body fails when required fields are missing', () => {
  const root = makeTempDir('governance-pr-fail-');
  const pathEnv = writeFakeGit(root, ['tests/unit/sample.test.js', 'docs/runbooks/sample.md']);
  const eventPath = createEvent(root, `## Standards Compliance
- Standards baseline reviewed: yes
`);

  const result = runScript('verify-pr-body.js', root, {
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_EVENT_NAME: 'pull_request',
    PATH: pathEnv,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing PR field: Task/);
  assert.match(result.stderr, /missing PR field: Tests/);
});

test('verify-pr-body fails when evidence paths are not in the diff', () => {
  const root = makeTempDir('governance-pr-paths-');
  const eventPath = createEvent(root, `## Linked Task
- Task: TSK-123

## Standards Compliance
- Standards baseline reviewed: yes
- Checklist completed or updated: yes
- Compliance checklist path: docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md
- Relevant standards areas: testing and quality assurance
- Standards gaps or exceptions: Gap observed: minor follow-up. Documented rationale: tracked explicitly (source https://example.com/standard).

## Required Evidence
- Standards check result: npm run standards:check
- Lint result: npm run lint
- Tests: npm run test:unit
- Test evidence paths: tests/unit/missing.test.js
- Docs updated: docs/runbooks/sample.md
- Doc evidence paths: docs/runbooks/missing.md

## Risk and Rollback
- Risk level: low
- Rollback path: revert governance changes
`,
  );
  const pathEnv = writeFakeGit(root, ['tests/unit/sample.test.js', 'docs/runbooks/sample.md']);

  const result = runScript('verify-pr-body.js', root, {
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_EVENT_NAME: 'pull_request',
    PATH: pathEnv,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /references file not changed in diff: tests\/unit\/missing\.test\.js/);
  assert.match(result.stderr, /references file not changed in diff: docs\/runbooks\/missing\.md/);
});
